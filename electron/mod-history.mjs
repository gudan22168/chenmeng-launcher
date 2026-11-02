import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {safeTarget,installed,setInstalled} from './content.mjs'
import {hashFile,inside} from './util.mjs'

const modPath=/^mods\/[^/\\]+\.jar(?:\.disabled)?$/i
export const modFingerprint=rows=>JSON.stringify(rows.map(r=>[r.path,r.hash]).sort((a,b)=>a[0].localeCompare(b[0])))
export async function modFiles(root){
  const dir=await safeTarget(root,'mods'),rows=[]
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(!entry.isFile()||!/\.jar(?:\.disabled)?$/i.test(entry.name))continue
    const relative='mods/'+entry.name,file=await safeTarget(root,relative),stat=await fs.stat(file)
    rows.push({path:relative,hash:await hashFile(file,'sha512'),size:stat.size})
  }
  return rows
}
async function writeManifest(directory,manifest){
  const file=path.join(directory,'manifest.json')
  await fs.writeFile(file+'.tmp',JSON.stringify(manifest,null,2))
  await fs.rename(file+'.tmp',file)
}
export async function createModBackup(store,instance,reason,expected,task={}){
  const root=store.directory(instance.id),files=await modFiles(root),fingerprint=modFingerprint(files)
  if(expected!==undefined && fingerprint!==expected)throw Error('模组文件已变化，请扫描本地后重试')
  const id=randomUUID(),directory=await safeTarget(root,'mod-backups/'+id)
  const manifest={format:1,id,instanceId:instance.id,gameVersion:instance.version,loader:instance.loader,loaderVersion:instance.loaderVersion||'',
    gameDirectory:path.relative(store.root,root),time:new Date().toISOString(),reason,status:'prepared',
    before:fingerprint,after:null,files,records:JSON.parse(JSON.stringify(installed(store,instance).filter(r=>modPath.test(r.path)&&files.some(f=>f.path===r.path&&f.hash===r.hashes?.sha512))))}
  await fs.mkdir(directory,{recursive:true})
  try{
    for(let i=0;i<files.length;i++){
      task.signal?.throwIfAborted()
      const row=files[i],dest=inside(directory,'files/'+row.path)
      await fs.mkdir(path.dirname(dest),{recursive:true})
      await fs.copyFile(await safeTarget(root,row.path),dest,fs.constants.COPYFILE_EXCL)
      if(await hashFile(dest,'sha512')!==row.hash)throw Error('备份校验失败：'+row.path)
      task.progress?.(85+10*(i+1)/Math.max(1,files.length),'备份模组 '+(i+1)+' / '+files.length)
    }
    if(modFingerprint(await modFiles(root))!==fingerprint)throw Error('备份期间模组文件发生变化')
    await writeManifest(directory,manifest)
    return {directory,manifest}
  }catch(error){
    const parent=path.resolve(root,'mod-backups')
    if(path.dirname(path.resolve(directory))===parent)await fs.rm(directory,{recursive:true,force:true})
    throw error
  }
}
export async function finishModBackup(store,instance,backup){
  backup.manifest.after=modFingerprint(await modFiles(store.directory(instance.id)))
  backup.manifest.status='complete'
  await writeManifest(backup.directory,backup.manifest)
}
async function readBackup(store,instance,id){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw Error('备份编号无效')
  const root=store.directory(instance.id),directory=await safeTarget(root,'mod-backups/'+id)
  const file=await safeTarget(directory,'manifest.json'),stat=await fs.stat(file)
  if(!stat.isFile()||stat.size>8*1024*1024)throw Error('备份清单无效')
  const manifest=JSON.parse(await fs.readFile(file,'utf8'))
  if(manifest.format!==1||manifest.id!==id||manifest.status!=='complete'||manifest.instanceId!==instance.id||
    manifest.gameVersion!==instance.version||manifest.loader!==instance.loader||manifest.loaderVersion!==(instance.loaderVersion||'')||
    manifest.gameDirectory!==path.relative(store.root,root)||!Array.isArray(manifest.files)||!Array.isArray(manifest.records))throw Error('备份与当前实例不匹配或尚未完成')
  const paths=new Set()
  for(const row of manifest.files){
    if(!modPath.test(row.path)||!/^[a-f0-9]{128}$/i.test(row.hash)||paths.has(row.path.toLowerCase()))throw Error('备份文件清单无效')
    paths.add(row.path.toLowerCase())
  }
  if(manifest.before!==modFingerprint(manifest.files)||typeof manifest.after!=='string')throw Error('备份指纹无效')
  for(const record of manifest.records)if(!modPath.test(record.path)||!paths.has(record.path.toLowerCase()))throw Error('备份记录无效')
  return {directory,manifest}
}
export async function listModBackups(store,instance){
  const root=store.directory(instance.id),dir=await safeTarget(root,'mod-backups'),current=modFingerprint(await modFiles(root)),rows=[]
  for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue
    try{
      const {manifest:m}=await readBackup(store,instance,entry.name)
      rows.push({id:m.id,time:m.time,reason:m.reason,count:m.files.length,bytes:m.files.reduce((n,r)=>n+(r.size||0),0),canRestore:m.after===current})
    }catch{}
  }
  return rows.sort((a,b)=>b.time.localeCompare(a.time))
}
export async function toggleMods(store,instance,paths,enabled,expected,task={}){
  if(!Array.isArray(paths)||!paths.length||paths.length>1000||typeof enabled!=='boolean')throw Error('批量启用 / 禁用参数无效')
  const root=store.directory(instance.id),before=await modFiles(root),current=modFingerprint(before)
  if(current!==expected)throw Error('模组文件已变化，请扫描本地后重试')
  const changes=[]
  for(const relative of new Set(paths)){
    if(!modPath.test(relative)||!before.some(r=>r.path===relative))throw Error('选择的模组文件不存在')
    const disabled=/\.disabled$/i.test(relative)
    if(enabled!==disabled)continue
    const target=enabled?relative.replace(/\.disabled$/i,''):relative+'.disabled'
    if(await fs.lstat(await safeTarget(root,target)).catch(e=>{if(e.code!=='ENOENT')throw e}))throw Error('目标文件已存在，不能覆盖：'+target)
    changes.push([relative,target])
  }
  if(!changes.length){task.progress?.(100,'所选模组已处于目标状态');return}
  const backup=await createModBackup(store,instance,enabled?'批量启用前':'批量禁用前',current,task)
  task.signal?.throwIfAborted()
  if(modFingerprint(await modFiles(root))!==current)throw Error('模组文件已变化，请重新检查')
  const old=installed(store,instance).slice(),moved=[]
  try{
    for(const [source,target] of changes){
      const from=await safeTarget(root,source),to=await safeTarget(root,target)
      if(await fs.lstat(to).catch(e=>{if(e.code!=='ENOENT')throw e}))throw Error('目标文件已存在：'+target)
      await fs.rename(from,to);moved.push([from,to])
    }
    const map=new Map(changes)
    setInstalled(store,instance,old.map(r=>map.has(r.path)?{...r,path:map.get(r.path),disabled:!enabled}:r))
    store.save()
    await finishModBackup(store,instance,backup)
  }catch(error){
    for(const [from,to] of moved.reverse())await fs.rename(to,from)
    setInstalled(store,instance,old);try{store.save()}catch{}
    throw error
  }
  task.progress?.(100,(enabled?'已启用 ':'已禁用 ')+changes.length+' 个模组；可从备份恢复')
}
export async function restoreModBackup(store,instance,id,task={}){
  const source=await readBackup(store,instance,id),root=store.directory(instance.id),current=modFingerprint(await modFiles(root))
  if(current!==source.manifest.after)throw Error('当前模组与该次操作完成时不同，可能有后续安装或手动改动。为避免覆盖，已停止恢复；可打开备份目录手动提取文件。')
  for(const row of source.manifest.files){
    task.signal?.throwIfAborted()
    const file=await safeTarget(source.directory,'files/'+row.path)
    if(await hashFile(file,'sha512')!==row.hash)throw Error('备份文件损坏：'+row.path)
  }
  const undo=await createModBackup(store,instance,'恢复备份前',current,task),oldRecords=installed(store,instance).slice(),moved=[],added=[]
  task.signal?.throwIfAborted()
  if(modFingerprint(await modFiles(root))!==current)throw Error('模组文件已变化，请重新检查')
  try{
    for(const row of await modFiles(root)){
      const file=await safeTarget(root,row.path),rollback=inside(undo.directory,'rollback/'+row.path)
      await fs.mkdir(path.dirname(rollback),{recursive:true});await fs.rename(file,rollback);moved.push([file,rollback])
    }
    for(const row of source.manifest.files){
      const from=await safeTarget(source.directory,'files/'+row.path),to=await safeTarget(root,row.path)
      await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);added.push(to)
      if(await hashFile(to,'sha512')!==row.hash)throw Error('恢复校验失败：'+row.path)
    }
    setInstalled(store,instance,[...oldRecords.filter(r=>!modPath.test(r.path)),...source.manifest.records])
    store.save()
    await finishModBackup(store,instance,undo)
  }catch(error){
    for(const file of added)await fs.unlink(file)
    for(const [file,rollback] of moved.reverse())await fs.rename(rollback,file)
    setInstalled(store,instance,oldRecords);try{store.save()}catch{}
    throw error
  }
  // rollback is generated only under this operation's verified backup directory.
  const rollback=path.resolve(undo.directory,'rollback')
  if(path.dirname(rollback)===path.resolve(undo.directory))await fs.rm(rollback,{recursive:true,force:true}).catch(()=>{})
  task.progress?.(100,'模组已恢复；恢复前状态也已备份。存档和配置未改动。')
}
