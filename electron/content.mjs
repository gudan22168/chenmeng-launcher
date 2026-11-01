import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {getJSON} from './downloads.mjs'
import {inside,hashFile,requireHTTPS} from './util.mjs'

export const modrinth='https://api.modrinth.com/v2'
export const contentFolders={mod:'mods',resourcepack:'resourcepacks',shader:'shaderpacks'}
export function compatible(version,instance,type){
  return version.game_versions.includes(instance.version) &&
    (type!=='mod' && type!=='modpack' || version.loaders.includes(instance.loader))
}
export async function versions(project,instance,type){
  const params=new URLSearchParams({game_versions:JSON.stringify([instance.version])})
  if(['mod','modpack'].includes(type))params.set('loaders',JSON.stringify([instance.loader]))
  return getJSON(modrinth+'/project/'+encodeURIComponent(project)+'/version?'+params)
}
export async function searchContent(instance,{query='',type='mod',offset=0}){
  if(!['mod','resourcepack','shader','modpack'].includes(type))throw Error('内容类型无效')
  const facets=[['project_type:'+type],['versions:'+instance.version]]
  if(['mod','modpack'].includes(type))facets.push(['categories:'+instance.loader])
  return getJSON(modrinth+'/search?'+new URLSearchParams({query:String(query).slice(0,120),facets:JSON.stringify(facets),limit:'20',offset:String(Math.max(0,Number(offset)||0))}))
}
export function installed(store,instance){
  return store.data.settings.isolated || instance.isolated ? (instance.installed ||= []) : (store.data.sharedInstalled ||= [])
}
export function setInstalled(store,instance,value){
  if(store.data.settings.isolated || instance.isolated)instance.installed=value
  else store.data.sharedInstalled=value
}
export async function safeTarget(root,relative){
  const file=inside(root,relative)
  let cursor=root
  for(const part of relative.split('/')){
    cursor=path.join(cursor,part)
    const info=await fs.lstat(cursor).catch(e=>{if(e.code!=='ENOENT')throw e})
    if(info?.isSymbolicLink())throw Error('目录包含链接，请使用普通实例目录')
  }
  return file
}
export function downloadURL(url){
  const parsed=requireHTTPS(url)
  if(!['cdn.modrinth.com','github.com','raw.githubusercontent.com','gitlab.com'].includes(parsed.hostname))throw Error('整合包包含不支持的下载域名：'+parsed.hostname)
  return parsed.href
}
export async function resolveContent(instance,versionId,existing=[]){
  const result=new Map(), visiting=new Set(), incompatible=[]
  async function visit(id){
    if(visiting.has(id))return
    visiting.add(id)
    const version=await getJSON(modrinth+'/version/'+encodeURIComponent(id))
    const project=await getJSON(modrinth+'/project/'+version.project_id)
    const type=project.project_type
    if(!contentFolders[type] || !compatible(version,instance,type))throw Error(project.title+' 没有匹配当前游戏版本和加载器的文件')
    const conflict=result.get(version.project_id)
    if(conflict && conflict.versionId!==version.id)throw Error('依赖要求冲突：'+project.title)
    const old=existing.find(e=>e.projectId===version.project_id)
    if(old && old.versionId!==version.id)throw Error(project.title+' 已安装其他版本，请先在已安装列表移除')
    const file=version.files.find(f=>f.primary) || version.files[0]
    if(!file?.hashes?.sha512)throw Error('内容缺少完整性校验')
    const relative=contentFolders[type]+'/'+file.filename
    inside('/validation',relative)
    const record={projectId:version.project_id,versionId:version.id,title:project.title,type,path:relative,hashes:file.hashes,size:file.size,url:downloadURL(file.url),dependencies:[]}
    result.set(version.project_id,record)
    for(const dep of version.dependencies || []){
      if(dep.dependency_type==='incompatible'){
        incompatible.push(dep)
        if(existing.some(e=>dep.version_id?e.versionId===dep.version_id:e.projectId===dep.project_id) || [...result.values()].some(e=>dep.version_id?e.versionId===dep.version_id:e.projectId===dep.project_id))throw Error(project.title+' 与已安装或待安装内容不兼容')
        continue
      }
      if(dep.dependency_type!=='required')continue
      let depId=dep.version_id
      if(!depId){
        if(!dep.project_id)throw Error('请手动安装外部依赖：'+(dep.file_name||project.title))
        const p=await getJSON(modrinth+'/project/'+dep.project_id)
        const choices=await versions(dep.project_id,instance,p.project_type)
        depId=choices[0]?.id
      }
      if(!depId)throw Error('缺少匹配版本的必需依赖：'+project.title)
      await visit(depId)
      const resolved=[...result.values()].find(r=>r.versionId===depId)
      if(resolved)record.dependencies.push(resolved.projectId)
    }
  }
  await visit(versionId)
  const all=[...existing,...result.values()]
  if(incompatible.some(dep=>all.some(e=>dep.version_id?e.versionId===dep.version_id:e.projectId===dep.project_id)))throw Error('内容之间存在不兼容声明，请调整选择')
  return [...result.values()]
}
export async function installContent(store,instance,versionId,task){
  const before=installed(store,instance)
  const records=await resolveContent(instance,versionId,before)
  const root=store.directory(instance.id)
  const staging=path.join(store.root,'staging',randomUUID())
  await fs.mkdir(staging,{recursive:true})
  const added=[]
  try{
    for(let i=0;i<records.length;i++){
      const r=records[i]
      const dest=await safeTarget(root,r.path)
      const present=await fs.stat(dest).catch(()=>null)
      if(present && await hashFile(dest,'sha512')!==r.hashes.sha512)throw Error('目标文件已存在且内容不同：'+r.path)
      task.progress(i/records.length*90,'下载 '+r.title+'（含必需依赖）')
      if(!present)await task.download(r.url,inside(staging,r.path),{...r.hashes,size:r.size})
    }
    for(const r of records){
      const staged=inside(staging,r.path)
      if(!await fs.stat(staged).catch(()=>null))continue
      const dest=await safeTarget(root,r.path)
      await fs.mkdir(path.dirname(dest),{recursive:true})
      await fs.copyFile(staged,dest,fs.constants.COPYFILE_EXCL)
      added.push(dest)
    }
    setInstalled(store,instance,[...before.filter(e=>!records.some(r=>r.projectId===e.projectId)),...records])
    store.save()
  }catch(e){
    setInstalled(store,instance,before)
    for(const file of added)await fs.unlink(file)
    throw e
  }finally{await fs.rm(staging,{recursive:true,force:true})}
  task.progress(100,'内容和必需依赖已安装')
}
