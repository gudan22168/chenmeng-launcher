import {fileURLToPath} from 'node:url'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import {prepareLoader} from './loaders.mjs'
import { getJSON } from './downloads.mjs'
import { inside, readJSON, hashFile, mapLimit, evaluateRules, javaMajor } from './util.mjs'

const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export async function prepare(store, instance, task, account=store.data.account) {
  if(instance.packPending)throw Error('整合包尚未完成导入，请从内容页重试导入')
  const root = path.resolve(store.root,'runtime')
  const game = path.resolve(store.directory(instance.id))
  const versionDir = inside(root, 'versions/'+instance.version)
  const metadata = path.join(versionDir,'version.json')
  const cached = instance.metadataHash && await hashFile(metadata).catch(()=>null) === instance.metadataHash
  if (!cached) {
    const manifest = await getJSON(manifestUrl,task.signal)
    const entry = manifest.versions.find(v=>v.id===instance.version)
    if (!entry) throw Error('官方版本列表中没有 '+instance.version)
    await task.download(entry.url,metadata,entry)
    instance.metadataHash = entry.sha1
    store.save()
  }
  const meta = await readJSON(metadata)
  if (!meta.arguments || !meta.downloads?.client) throw Error('此版本使用旧启动格式，目前请选择 1.21.1 等现代原版')
  // Check before loader installation: Forge processors need Java too.
  if (task.ensureJava) await task.ensureJava(javaMajor(meta))
  const assets = path.join(root,'assets')
  const libs = path.join(root,'libraries')
  const natives = path.join(versionDir,'natives')
  await fs.mkdir(natives,{recursive:true})
  const cp = []
  const files = []
  const archives = []
  for (const lib of meta.libraries.filter(l=>evaluateRules(l.rules))) {
    const artifact = lib.downloads?.artifact
    if (artifact) {
      const dest = inside(libs,artifact.path)
      cp.push(dest)
      files.push([artifact,dest])
    }
    const classifier = lib.natives?.[{win32:'windows',linux:'linux',darwin:'osx'}[process.platform]]
    if (classifier) {
      const native = lib.downloads.classifiers[classifier.replace('${arch}', process.arch==='ia32'?'32':'64')]
      const dest = inside(libs,native.path)
      files.push([native,dest])
      archives.push([dest,lib.extract?.exclude || []])
    }
  }
  const client = path.join(versionDir,'client.jar')
  cp.push(client)
  files.push([meta.downloads.client,client])
  const index = inside(assets,'indexes/'+meta.assetIndex.id+'.json')
  await task.download(meta.assetIndex.url,index,meta.assetIndex)
  const objects = new Map(Object.values((await readJSON(index)).objects).map(o=>[o.hash,o]))
  for (const {hash,size} of objects.values()) {
    if (!/^[0-9a-f]{40}$/.test(hash)) throw Error('资源索引无效')
    const key = hash.slice(0,2)+'/'+hash
    files.push([{url:'https://resources.download.minecraft.net/'+key,sha1:hash,size},inside(assets,'objects/'+key)])
  }
  let done=0
  await mapLimit(files,store.data.settings.concurrency,async ([item,dest])=>{
    await task.download(item.url,dest,item)
    done++
    if (done%16===0 || done===files.length) task.progress(done/files.length*100,'校验与安装 '+done+' / '+files.length)
  })
  for (const [file,exclude] of archives) {
    for (const entry of new AdmZip(file).getEntries()) {
      if (entry.isDirectory || entry.entryName.startsWith('META-INF/') || exclude.some(x=>entry.entryName.startsWith(x))) continue
      const dest = inside(natives,entry.entryName)
      await fs.mkdir(path.dirname(dest),{recursive:true})
      await fs.writeFile(dest,entry.getData())
    }
  }
  if(instance.loader!=='vanilla')return prepareLoader(store,instance,meta,task,account,natives)
  instance.status='installed'
  store.save()

  const vars={natives_directory:natives,classpath:cp.join(path.delimiter),launcher_name:'chenmeng',launcher_version:'0.1.0',game_directory:game,assets_root:assets,assets_index_name:meta.assetIndex.id,auth_uuid:account.uuid,auth_player_name:account.name,auth_access_token:account.accessToken || '0',clientid:account.clientId || '0',auth_xuid:account.xuid || '0',user_type:account.type==='microsoft'?'msa':'legacy',version_type:meta.type,version_name:meta.id,library_directory:libs,classpath_separator:path.delimiter}
  const expand = entries => entries.flatMap(e=>typeof e==='string'?[e]:evaluateRules(e.rules)?e.value:[]).map(s=>s.replace(/\$\{(\w+)\}/g,(_,k)=>{
    if (!(k in vars)) throw Error('不支持的启动参数 '+k)
    return vars[k]
  }))
  return {major:javaMajor(meta),cwd:game,args:['-Xmx'+instance.memory+'M',...expand(meta.arguments.jvm),meta.mainClass,...expand(meta.arguments.game)]}
}

export async function checkJava(java,major) {
  try {
    const {stdout,stderr}=await promisify(execFile)(java,['-version'],{windowsHide:true,timeout:5000})
    return Number((stdout+stderr).match(/version "(?:1\.)?(\d+)/)?.[1])===major
  } catch { return false }
}
export async function detectJava(major) {
  const exe=process.platform==='win32'?'java.exe':'java'
  const paths=new Set()
  if(process.env.JAVA_HOME) paths.add(path.join(process.env.JAVA_HOME,'bin',exe))
  for(const dir of (process.env.PATH||'').split(path.delimiter).filter(Boolean)) paths.add(path.join(dir,exe))
  const bases=['Java','Eclipse Adoptium','Microsoft','Amazon Corretto','Zulu'].map(dir=>path.join(process.env.ProgramFiles||'/opt',dir))
  bases.push('/usr/lib/jvm')
  for(const base of bases) for(const dir of await fs.readdir(base).catch(()=>[])) paths.add(path.join(base,dir,'bin',exe))
  for(const candidate of paths) if(await fs.stat(candidate).catch(()=>null) && await checkJava(candidate,major)) return candidate
}
export async function launch(instance, plan, onExit,title) {
  const java = instance.javaPath || (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME,'bin','java') : 'java')
  const {stderr,stdout} = await promisify(execFile)(java,['-version'],{windowsHide:true,timeout:10000})
  const major = Number((stderr+stdout).match(/version "(?:1\.)?(\d+)/)?.[1])
  if (major !== plan.major) throw Error('此实例需要 Java '+plan.major+'，当前检测到 '+(major||'未知版本')+'。请在实例页选择 Java。')
  const log = await fs.open(path.join(plan.cwd,'launcher.log'),'w')
  try {
    const child = spawn(java,plan.args,{cwd:plan.cwd,windowsHide:true,stdio:['ignore',log.fd,log.fd]})
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);child.once('exit',onExit)})
    if(title && process.platform==='win32') {
      const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'window-title.ps1')
      const helper=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',await fs.readFile(script,'utf8')],{windowsHide:true,stdio:'ignore',env:{...process.env,CM_GAME_PID:String(child.pid),CM_GAME_TITLE:title}})
      helper.on('error',()=>{})
    }
  } finally {await log.close()}
}

