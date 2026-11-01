import {promises as fs} from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import {inside,hashFile} from './util.mjs'
import {installed,downloadURL,safeTarget} from './content.mjs'

export const exportChoices=['mods','resourcepacks','shaderpacks','config','options.txt','saves','screenshots']
const loaderKeys={forge:'forge',neoforge:'neoforge','fabric-loader':'fabric'}
export function inspectPack(file){
  const zip=new AdmZip(file)
  const entry=zip.getEntry('modrinth.index.json')
  if(!entry || entry.header.size>4*1024*1024)throw Error('请选择包含 modrinth.index.json 的 .mrpack 整合包')
  const index=JSON.parse(entry.getData().toString('utf8'))
  if(index.formatVersion!==1 || index.game!=='minecraft' || !Array.isArray(index.files))throw Error('不支持的整合包格式')
  const deps=index.dependencies || {}
  if(!deps.minecraft || Object.keys(deps).some(k=>k!=='minecraft' && !loaderKeys[k]))throw Error('整合包包含不支持的游戏或加载器依赖')
  const loaders=Object.keys(loaderKeys).filter(k=>deps[k])
  if(loaders.length>1)throw Error('整合包同时要求多个加载器')
  const loader=loaderKeys[loaders[0]] || 'vanilla'
  let total=0
  for(const item of zip.getEntries()){
    total+=item.header.size
    if(total>2*1024**3)throw Error('整合包解压内容超过 2 GiB，请精简后导入')
    if(!item.isDirectory)inside('/validation',item.entryName)
  }
  const paths=new Set()
  for(const f of index.files){
    inside('/validation',f.path)
    if(paths.has(f.path.toLowerCase()))throw Error('整合包包含重复路径')
    paths.add(f.path.toLowerCase())
    if(!/^[a-f0-9]{40}$/i.test(f.hashes?.sha1) || !/^[a-f0-9]{128}$/i.test(f.hashes?.sha512) || !Array.isArray(f.downloads) || !f.downloads.length)throw Error('整合包缺少文件校验或下载地址')
    f.downloads.forEach(downloadURL)
  }
  return {zip,index,loader,loaderVersion:deps[loaders[0]] || ''}
}
export async function unpackPack(store,instance,pack,task,includeOptional=false){
  const root=store.directory(instance.id)
  const files=pack.index.files.filter(f=>f.env?.client!=='unsupported' && (includeOptional || f.env?.client!=='optional'))
  for(let n=0;n<files.length;n++){
    const f=files[n]
    task.progress(n/Math.max(1,files.length)*90,'安装整合包 '+(n+1)+' / '+files.length)
    let last
    for(const url of f.downloads){
      try{await task.download(downloadURL(url),await safeTarget(root,f.path),{...f.hashes,size:f.fileSize});last=null;break}catch(e){last=e}
    }
    if(last)throw last
  }
  for(const prefix of ['overrides/','client-overrides/']){
    for(const entry of pack.zip.getEntries()){
      if(entry.isDirectory || !entry.entryName.startsWith(prefix))continue
      const dest=await safeTarget(root,entry.entryName.slice(prefix.length))
      await fs.mkdir(path.dirname(dest),{recursive:true})
      await fs.writeFile(dest,entry.getData())
    }
  }
  instance.packFiles=files
  instance.packImported=true
  store.save()
}
export async function exportPack(store,instance,selection,destination,task){
  if(!Array.isArray(selection) || selection.some(s=>!exportChoices.includes(s)))throw Error('导出选项无效')
  if(instance.loader!=='vanilla' && !instance.loaderVersion)throw Error('请先安装加载器，再导出整合包')
  const root=store.directory(instance.id),zip=new AdmZip(),files=[]
  if(path.resolve(destination).startsWith(path.resolve(root)+path.sep))throw Error('请将整合包导出到实例目录之外，例如桌面')
  async function walk(relative){
    const file=await safeTarget(root,relative)
    const stat=await fs.stat(file).catch(e=>{if(e.code!=='ENOENT')throw e})
    if(!stat)return
    if(stat.isDirectory()){
      for(const name of await fs.readdir(file))await walk(relative+'/'+name)
    }else if(stat.isFile()){
      files.push({relative,file,size:stat.size})
    }
  }
  for(const selected of new Set(selection))await walk(selected)
  if(files.reduce((sum,f)=>sum+f.size,0)>1024**3)throw Error('导出内容超过 1 GiB，请减少存档或截图选择后重试')
  const index={formatVersion:1,game:'minecraft',versionId:String(Date.now()),name:instance.name,files:[],dependencies:{minecraft:instance.version}}
  if(instance.loader!=='vanilla')index.dependencies[instance.loader==='fabric'?'fabric-loader':instance.loader]=instance.loaderVersion
  const known=installed(store,instance)
  for(let n=0;n<files.length;n++){
    const f=files[n]
    task.progress(n/Math.max(1,files.length)*95,'打包 '+f.relative)
    const hashes={sha1:await hashFile(f.file),sha512:await hashFile(f.file,'sha512')}
    const managed=known.find(r=>r.path===f.relative && r.hashes?.sha512===hashes.sha512)
    const imported=instance.packFiles?.find(r=>r.path===f.relative && r.hashes.sha512===hashes.sha512)
    const downloads=managed?[managed.url]:imported?.downloads
    if(downloads)index.files.push({path:f.relative,hashes,downloads,fileSize:f.size})
    else zip.addFile('overrides/'+f.relative,await fs.readFile(f.file))
  }
  zip.addFile('modrinth.index.json',Buffer.from(JSON.stringify(index,null,2)))
  const temporary=destination+'.part'
  try{await fs.writeFile(temporary,zip.toBuffer());await fs.rename(temporary,destination)}
  finally{await fs.rm(temporary,{force:true})}
  task.progress(100,'整合包已导出')
}
