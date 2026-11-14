import {parentPort,workerData} from 'node:worker_threads'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import AdmZip from 'adm-zip'
import {inside} from './util.mjs'
import {inspectPackEntries} from './packs.mjs'
import {rarError} from './rar-reader.mjs'
import {gameFiles} from './directory-import.mjs'

const limit=2*1024**3
function json(entry){
  if(!entry || entry.header.size>4*1024**2)throw Error('整合包配置缺失或超过 4 MiB')
  return JSON.parse(entry.getData().toString('utf8').replace(/^\uFEFF/,''))
}
function inspect(zip){
  if(zip.getEntry('modrinth.index.json')){
    const {index,loader,loaderVersion}=inspectPackEntries(zip)
    return {type:'mrpack',name:index.name,version:index.dependencies.minecraft,loader,loaderVersion,index}
  }
  const profiles=new Map()
  for(const entry of zip.getEntries()){
    const match=entry.entryName.match(/^(.*?)(?:versions)\/([^/]+)\/([^/]+)\.json$/)
    if(match && match[2]===match[3])profiles.set(match[1]+match[2],{prefix:match[1],id:match[2],meta:json(entry)})
  }
  const parents=new Set([...profiles.values()].filter(p=>p.meta.inheritsFrom).map(p=>p.prefix+p.meta.inheritsFrom))
  const leaves=[...profiles.entries()].filter(([key])=>!parents.has(key)).map(([,p])=>p)
  if(leaves.length>1)throw Error('压缩包包含多个独立版本，请分别打包导入，或使用“导入本地目录”选择版本')
  if(leaves.length===1){
    const selected=leaves[0],chain=[],seen=new Set()
    let next=selected
    while(next){
      if(seen.has(next.id)||seen.size>=12)throw Error('版本继承关系无效')
      seen.add(next.id);chain.unshift(next.meta)
      const parent=next.meta.inheritsFrom
      if(!parent)break
      inside('/validation',parent)
      next=profiles.get(selected.prefix+parent)
      if(!next){
        if(!/^1\.\d+(?:\.\d+)?$/.test(parent))throw Error('缺少继承版本 '+parent)
        chain.unshift({id:parent,arguments:{},libraries:[]});break
      }
    }
    const libraries=chain.flatMap(m=>m.libraries||[]).map(l=>l.name||'')
    let loader='vanilla',loaderVersion='',version=chain[0].id
    const matches=[['fabric','net.fabricmc:fabric-loader:'],['forge','net.minecraftforge:forge:'],['neoforge','net.neoforged:neoforge:'],['quilt','org.quiltmc:quilt-loader:']].filter(([,prefix])=>libraries.some(n=>n.startsWith(prefix)))
    if(matches.length>1)throw Error('版本包含多个加载器，无法可靠导入')
    if(matches.length){const [kind,prefix]=matches[0];loader=kind;loaderVersion=libraries.find(n=>n.startsWith(prefix)).slice(prefix.length).split(':')[0]}
    if(loader==='forge'){const match=loaderVersion.match(/^(1\.\d+(?:\.\d+)?)-(.+)$/);if(match){version=match[1];loaderVersion=match[2]}}
    if(loader==='quilt')throw Error('当前尚不支持 Quilt 安装')
    if(!/^1\.\d+(?:\.\d+)?$/.test(version) || !chain.some(m=>m.arguments))throw Error('暂不支持此版本的启动格式')
    const main=chain.map(m=>m.mainClass).filter(Boolean).at(-1)
    if(loader==='vanilla' && main!=='net.minecraft.client.main.Main')throw Error('自定义客户端暂不支持自动导入')
    const isolatedPrefix=selected.prefix+'versions/'+selected.id+'/'
    const isolated=zip.getEntries().some(e=>e.entryName.startsWith(isolatedPrefix) && gameFiles.some(f=>e.entryName===isolatedPrefix+f || e.entryName.startsWith(isolatedPrefix+f+'/')))
    return {type:'tree',name:selected.id,version,loader,loaderVersion,prefix:isolated?isolatedPrefix:selected.prefix}
  }
  if(zip.getEntries().some(e=>/(^|\/)manifest\.json$/.test(e.entryName)))throw Error('此压缩包是 CurseForge 清单包；目前请使用完整游戏目录 ZIP / RAR 或 Modrinth 整合包')
  throw Error('请选择 Modrinth .mrpack，或含 versions/版本/版本.json 的 Minecraft ZIP / RAR')
}
async function run(){
  const info=await fs.stat(workerData.file)
  if(!info.isFile()||info.size>limit)throw Error('压缩包不存在或超过 2 GiB')
  const bytes=await fs.readFile(workerData.file),digest=createHash('sha256').update(bytes).digest('hex')
  if(workerData.digest && workerData.digest!==digest)throw Error('压缩包已变化，请重新选择导入')
  const rar=path.extname(workerData.file).toLowerCase()==='.rar'
  const zip=rar?await (await import('./rar-reader.mjs')).openRar(bytes):new AdmZip(bytes)
  const entries=zip.getEntries(),names=new Set()
  if(entries.length>100000)throw Error('压缩包文件数量超过限制')
  let total=0
  for(const entry of entries){
    const relative=entry.entryName.replace(/\/$/,'')
    inside('/validation',relative)
    const name=relative.toLowerCase()
    if(names.has(name))throw Error('压缩包包含重复路径：'+relative)
    names.add(name)
    if(((entry.attr>>>16)&0xf000)===0xa000)throw Error('不支持压缩包中的符号链接')
    if(!Number.isSafeInteger(entry.header.size)||entry.header.size<0)throw Error('压缩包文件大小无效')
    total+=entry.header.size
    if(total>limit || entry.header.size>256*1024**2)throw Error('解压内容超过 2 GiB 或单个文件超过 256 MiB')
  }
  const metadata=entries.filter(e=>!e.isDirectory && (e.entryName==='modrinth.index.json' || /(?:^|\/)versions\/([^/]+)\/\1\.json$/.test(e.entryName)))
  if(metadata.some(e=>e.header.size>4*1024**2) || metadata.reduce((n,e)=>n+e.header.size,0)>16*1024**2)throw Error('整合包配置过大')
  zip.loadMetadata?.(metadata)
  const pack={...inspect(zip),digest}
  if(workerData.action==='inspect')return pack
  if(workerData.action!=='extract')throw Error('无效的压缩包操作')
  const prefixes=pack.type==='mrpack'?['overrides/','client-overrides/']:[pack.prefix]
  const targets=new Map()
  for(const prefix of prefixes){
    for(const entry of entries){
      if(entry.isDirectory || !entry.entryName.startsWith(prefix))continue
      const relative=entry.entryName.slice(prefix.length)
      if(pack.type==='tree' && !gameFiles.some(f=>relative===f || relative.startsWith(f+'/')))continue
      if(relative)targets.set(relative.toLowerCase(),{entry,relative})
    }
  }
  const selected=[...targets.values()],destinations=new Map(selected.map(({entry,relative})=>[entry.entryName,inside(workerData.target,relative)]))
  const extracted=rar?zip.extract(selected.map(t=>t.entry)):(function*(){for(const {entry} of selected)yield {entry,data:entry.getData()}})()
  let count=0
  for(const {entry,data} of extracted){
    if(data.length!==entry.header.size)throw Error('压缩包文件长度不一致')
    const dest=destinations.get(entry.entryName)
    await fs.mkdir(path.dirname(dest),{recursive:true})
    await fs.writeFile(dest,data)
    if(++count%20===0)parentPort.postMessage({progress:Math.min(80,count/Math.max(1,selected.length)*80),stage:'解压游玩文件 '+count})
  }
  if(count!==selected.length)throw Error('压缩包文件未完整解压')
  return pack
}
run().then(result=>parentPort.postMessage({result})).catch(error=>parentPort.postMessage({error:rarError(error).message}))
