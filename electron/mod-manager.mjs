import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import AdmZip from 'adm-zip'
import {getJSON,USER_AGENT} from './downloads.mjs'
import {hashFile,inside} from './util.mjs'
import {modrinth,installed,setInstalled,safeTarget,resolveContent,versions} from './content.mjs'

function metadata(file){
  try{
    const zip=new AdmZip(file)
    const read=name=>{const e=zip.getEntry(name);return e && e.header.size<1024*1024?e.getData().toString('utf8'):''}
    const fabric=read('fabric.mod.json')
    if(fabric){const m=JSON.parse(fabric);return {title:m.name||m.id,localVersion:String(m.version||''),description:typeof m.description==='string'?m.description:'',modId:m.id,declaredDependencies:Object.entries(m.depends||{}).map(([id,range])=>id+' '+JSON.stringify(range))}}
    const toml=read('META-INF/neoforge.mods.toml')||read('META-INF/mods.toml')
    if(toml){const field=k=>toml.match(new RegExp('^\\s*'+k+'\\s*=\\s*"([^"\\n]+)"','m'))?.[1];return {title:field('displayName')||field('modId'),modId:field('modId'),localVersion:field('version'),description:field('description')||'',declaredDependencies:[]}}
  }catch{}
  return {}
}
export async function scanMods(store,instance){
  const root=store.directory(instance.id),dir=await safeTarget(root,'mods'),records=installed(store,instance),rows=[]
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(!entry.isFile() || !/\.jar(?:\.disabled)?$/i.test(entry.name))continue
    const relative='mods/'+entry.name,file=await safeTarget(root,relative),hash=await hashFile(file,'sha512')
    const record=records.find(r=>r.path===relative && r.hashes?.sha512===hash)
    rows.push({...metadata(file),...record,path:relative,hash,size:(await fs.stat(file)).size,disabled:entry.name.endsWith('.disabled')})
    rows.at(-1).title ||= entry.name
  }
  return rows.sort((a,b)=>a.path.localeCompare(b.path))
}
export async function identifyMods(rows){
  if(!rows.length)return rows
  const found={}
  for(let i=0;i<rows.length;i+=100){
    const response=await fetch(modrinth+'/version_files',{method:'POST',headers:{'User-Agent':USER_AGENT,'Content-Type':'application/json'},body:JSON.stringify({hashes:rows.slice(i,i+100).map(r=>r.hash),algorithm:'sha512'}),signal:AbortSignal.timeout(60000)})
    if(!response.ok)throw Error('模组识别失败：HTTP '+response.status)
    Object.assign(found,await response.json())
  }
  const projects=new Map()
  for(const row of rows){
    const v=found[row.hash]
    if(!v)continue
    if(!projects.has(v.project_id))projects.set(v.project_id,await getJSON(modrinth+'/project/'+v.project_id))
    const p=projects.get(v.project_id)
    if(p.project_type!=='mod')continue
    Object.assign(row,{projectId:v.project_id,versionId:v.id,localVersion:v.version_number,datePublished:v.date_published,title:p.title,description:p.description,icon_url:p.icon_url,slug:p.slug,dependencySpecs:v.dependencies,gameVersions:v.game_versions,loaders:v.loaders})
  }
  return rows
}
export async function checkMods(rows,instance){
  await identifyMods(rows)
  for(const row of rows){
    if(!row.projectId){row.checkMessage='未在 Modrinth 识别，需手动检查';continue}
    try{
      const list=await versions(row.projectId,instance,'mod')
      const latest=list.filter(v=>v.version_type==='release').sort((a,b)=>Date.parse(b.date_published)-Date.parse(a.date_published))[0]
      row.latest=latest?{id:latest.id,number:latest.version_number,date:latest.date_published}:null
      row.updateAvailable=!!latest && latest.id!==row.versionId && (!row.datePublished || Date.parse(latest.date_published)>Date.parse(row.datePublished))
      row.missing=(row.disabled?[]:(row.dependencySpecs||[])).filter(d=>d.dependency_type==='required' && !rows.some(r=>!r.disabled && (d.version_id?r.versionId===d.version_id:r.projectId===d.project_id)))
      row.checkMessage=latest?'':'没有匹配的正式版'
    }catch(e){row.checkMessage=e.message}
  }
  return rows
}
export function fingerprint(rows){return JSON.stringify(rows.map(r=>[r.path,r.hash]).sort((a,b)=>a[0].localeCompare(b[0])))}
export async function planMods(store,instance,input){
  if(!Array.isArray(input.versions)||!Array.isArray(input.remove)||input.versions.length>300||input.remove.length>1000)throw Error('更改清单无效')
  const before=await identifyMods(await scanMods(store,instance))
  if(input.snapshot!==fingerprint(before))throw Error('本地模组已变化，请刷新后重新编辑')
  const remove=new Set(input.remove)
  if([...remove].some(p=>!before.some(r=>r.path===p)))throw Error('要移除的文件不存在')
  const selected=[]
  for(const id of input.versions){
    if(typeof id!=='string'||!/^\w{1,80}$/.test(id))throw Error('版本无效')
    selected.push(await getJSON(modrinth+'/version/'+id))
  }
  const pins=new Map()
  for(const v of selected){if(pins.has(v.project_id)&&pins.get(v.project_id)!==v.id)throw Error('同一模组选中了不同版本');pins.set(v.project_id,v.id)}
  const retained=before.filter(r=>!remove.has(r.path)&&!r.disabled&&r.projectId&&!pins.has(r.projectId))
  for(const r of retained){if(pins.has(r.projectId)&&pins.get(r.projectId)!==r.versionId)throw Error('本地存在同一模组的多个版本，请先选择移除');pins.set(r.projectId,r.versionId)}
  const roots=[...pins.values()]
  const resolved=roots.length?await resolveContent(instance,roots,[],{pins}):[]
  if(resolved.some(r=>r.type!=='mod'||!/^mods\/[^/]+\.jar$/i.test(r.path)))throw Error('该操作仅支持模组，其他类型请使用内容工坊')
  const changes=[],affected=new Set(remove)
  for(const r of resolved){
    const old=before.filter(b=>b.projectId===r.projectId&&!remove.has(b.path))
    if(old.some(b=>b.disabled))throw Error(r.title+' 存在已禁用文件，请先移除或手动启用')
    if(old.length===1&&old[0].versionId===r.versionId)continue
    for(const b of old)affected.add(b.path)
    changes.push({...r,action:old.length?'更新':'新增',automatic:!selected.some(v=>v.id===r.versionId),from:old.map(b=>b.localVersion||b.versionId).join(', ')})
  }
  const targets=new Set()
  for(const r of changes){
    if(targets.has(r.path.toLowerCase()))throw Error('模组文件名冲突：'+r.path)
    targets.add(r.path.toLowerCase())
    const target=await safeTarget(store.directory(instance.id),r.path)
    if(await fs.stat(target).catch(()=>null)){
      if(!affected.has(r.path))throw Error('已有同名本地文件，不能覆盖：'+r.path)
    }
  }
  return {instanceId:instance.id,gameVersion:instance.version,loader:instance.loader,root:store.directory(instance.id),snapshot:fingerprint(before),before,changes,remove:[...affected],warnings:before.filter(r=>!r.projectId&&!remove.has(r.path)).map(r=>r.title+'：未识别，无法自动检查前置或冲突')}
}
export async function applyModPlan(store,instance,plan,task){
  const root=store.directory(instance.id)
  if(instance.version!==plan.gameVersion||instance.loader!==plan.loader||root!==plan.root||fingerprint(await scanMods(store,instance))!==plan.snapshot)throw Error('本地文件或版本隔离设置已改变，请重新生成清单')
  const stage=path.join(store.root,'staging',randomUUID()),backup=await safeTarget(root,'mod-backups/'+randomUUID())
  const oldRecords=installed(store,instance).slice(),moved=[],added=[]
  await fs.mkdir(stage,{recursive:true})
  try{
    for(let i=0;i<plan.changes.length;i++){
      const r=plan.changes[i];task.progress(i/Math.max(1,plan.changes.length)*85,'下载 '+r.title)
      await task.download(r.url,inside(stage,r.path),{...r.hashes,size:r.size})
      if(await hashFile(inside(stage,r.path),'sha512')!==r.hashes.sha512)throw Error('模组校验失败：'+r.title)
    }
    task.signal?.throwIfAborted()
    if(fingerprint(await scanMods(store,instance))!==plan.snapshot)throw Error('下载期间本地模组发生变化，请重新编辑')
    // No cancellation points inside the short commit phase; failure restores all old files.
    for(const relative of plan.remove){
      const source=await safeTarget(root,relative),dest=inside(backup,relative)
      await fs.mkdir(path.dirname(dest),{recursive:true});await fs.rename(source,dest);moved.push([source,dest])
    }
    for(const r of plan.changes){
      const dest=await safeTarget(root,r.path)
      await fs.copyFile(inside(stage,r.path),dest,fs.constants.COPYFILE_EXCL);added.push(dest)
    }
    setInstalled(store,instance,[...oldRecords.filter(r=>!plan.remove.includes(r.path)&&!plan.changes.some(n=>n.projectId===r.projectId)),...plan.changes.map(({action,automatic,from,...r})=>r)])
    store.save()
  }catch(e){
    for(const f of added)await fs.unlink(f)
    for(const [source,dest] of moved.reverse())await fs.rename(dest,source)
    setInstalled(store,instance,oldRecords)
    throw e
  }finally{await fs.rm(stage,{recursive:true,force:true})}
  task.progress(100,'模组更改已应用；原文件保存在实例的 mod-backups 中')
}
