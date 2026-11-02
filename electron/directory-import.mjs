import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'

export const gameFiles=['mods','config','defaultconfigs','saves','resourcepacks','shaderpacks','screenshots','kubejs','scripts','patchouli_books','journeymap','xaeroworldmap','xaerominimap','schematics','options.txt','optionsof.txt','optionsshaders.txt','servers.dat','servers.dat_old']
const skipped=new Set(['assets','libraries','natives','node_modules','.git','logs','crash-reports','saves','mods','resourcepacks','shaderpacks','screenshots','config','runtime','instances'])
const validId=value=>typeof value==='string' && /^[\w.+-]{1,160}$/.test(value) && !['.','..'].includes(value)
async function json(file){
  const info=await fs.lstat(file)
  if(!info.isFile() || info.isSymbolicLink() || info.size>4*1024*1024)throw Error('版本配置不是普通文件或超过 4 MiB')
  return JSON.parse(await fs.readFile(file,'utf8'))
}
async function profile(root,id,seen=new Set()){
  if(!validId(id)||seen.has(id)||seen.size>=12)throw Error('版本继承关系无效')
  seen.add(id)
  const dir=path.join(root,'versions',id)
  const info=await fs.lstat(dir)
  if(!info.isDirectory()||info.isSymbolicLink())throw Error('不支持链接形式的版本目录')
  const own=await json(path.join(dir,id+'.json'))
  const parent=own.inheritsFrom?await profile(root,own.inheritsFrom,seen):null
  return {id:own.id||id,base:parent?.base||own.id||id,arguments:own.arguments||parent?.arguments,
    libraries:[...(parent?.libraries||[]),...(own.libraries||[])],mainClass:own.mainClass||parent?.mainClass}
}
function identify(meta){
  const names=meta.libraries.map(l=>l.name||'')
  let loader='vanilla',loaderVersion=''
  for(const [kind,prefix] of [['fabric','net.fabricmc:fabric-loader:'],['neoforge','net.neoforged:neoforge:'],['forge','net.minecraftforge:forge:'],['quilt','org.quiltmc:quilt-loader:']]){
    const found=names.find(n=>n.startsWith(prefix))
    if(found){loader=kind;loaderVersion=found.slice(prefix.length).split(':')[0];break}
  }
  let version=meta.base
  if(loader==='forge'){
    const split=loaderVersion.match(/^(\d+\.\d+(?:\.\d+)?)-(.+)$/)
    if(split){version=split[1];loaderVersion=split[2]}
  }
  let reason=''
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(version))reason='无法可靠识别原版版本号'
  else if(loader==='quilt')reason='当前尚不支持 Quilt 安装'
  else if(!meta.arguments)reason='暂不支持旧版启动格式'
  else if(loader==='vanilla' && meta.mainClass!=='net.minecraft.client.main.Main')reason='自定义客户端暂不支持自动导入'
  return {version,loader,loaderVersion,reason}
}
export async function scanMinecraft(folder,{exclude='',maxDepth=4,maxDirectories=3000}={}){
  const root=await fs.realpath(folder),rows=[],warnings=[],seen=new Set()
  const excludePath=exclude?await fs.realpath(exclude).catch(()=>path.resolve(exclude)):''
  let visited=0,truncated=false
  async function walk(dir,depth){
    if(dir===excludePath)return
    if(++visited>maxDirectories){truncated=true;return}
    let entries
    try{entries=await fs.readdir(dir,{withFileTypes:true})}catch{warnings.push('无法读取：'+dir);return}
    const versions=entries.find(e=>e.name==='versions'&&e.isDirectory()&&!e.isSymbolicLink())
    if(versions){
      for(const item of await fs.readdir(path.join(dir,'versions'),{withFileTypes:true}).catch(()=>[])){
        if(rows.length>=500){truncated=true;break}
        if(!item.isDirectory()||item.isSymbolicLink()||!validId(item.name))continue
        const versionPath=path.join(dir,'versions',item.name)
        if(seen.has(versionPath))continue
        seen.add(versionPath)
        try{
          const meta=identify(await profile(dir,item.name))
          const isolated=(await Promise.all(['mods','saves','config','options.txt'].map(n=>fs.lstat(path.join(versionPath,n)).catch(()=>null)))).some(Boolean)
          rows.push({token:randomUUID(),name:item.name,root:dir,versionPath,isolated,...meta})
        }catch(e){rows.push({token:randomUUID(),name:item.name,root:dir,versionPath,isolated:true,version:'未知',loader:'未知',reason:e.message})}
      }
    }
    if(depth>=maxDepth)return
    for(const entry of entries){
      if(visited>=maxDirectories){truncated=true;break}
      if(!entry.isDirectory()||entry.isSymbolicLink()||entry.name==='versions'||skipped.has(entry.name.toLowerCase()))continue
      await walk(path.join(dir,entry.name),depth+1)
    }
  }
  await walk(root,0)
  if(truncated)warnings.push('扫描达到数量限制，请选择更具体的目录重新扫描。')
  return {root,rows,warnings,depth:maxDepth}
}
async function copyEntry(source,destination,signal,progress){
  signal?.throwIfAborted()
  const info=await fs.lstat(source)
  if(info.isSymbolicLink())throw Error('为避免复制到目录外，暂不导入链接：'+source)
  if(info.isDirectory()){
    await fs.mkdir(destination,{recursive:true})
    for(const name of await fs.readdir(source))await copyEntry(path.join(source,name),path.join(destination,name),signal,progress)
  }else if(info.isFile()){
    await fs.copyFile(source,destination,fs.constants.COPYFILE_EXCL)
    progress?.(source)
  }else throw Error('不支持的文件类型：'+source)
}
export async function copyGameData(source,destination,{signal,progress}={}){
  // Only gameplay data, never launcher accounts, executable scripts or runtime caches.
  for(const name of gameFiles){
    if(await fs.lstat(path.join(source,name)).catch(()=>null))await copyEntry(path.join(source,name),path.join(destination,name),signal,progress)
  }
}
export function registerDirectoryImport({store,queue,ipcMain,dialog,shell,win,isBusy}){
  let candidates=new Map(),scanning=false,importing=false
  const idle=()=>{if(isBusy()||queue.snapshot().some(j=>['queued','running','cancelling'].includes(j.status)))throw Error('请等待游戏或下载任务结束')}
  ipcMain.handle('scanMinecraft',async(_,choose=false)=>{
    if(scanning)throw Error('扫描正在进行中')
    scanning=true
    try{
      let folder=path.dirname(store.root)
      if(choose){const picked=await dialog.showOpenDialog(win,{properties:['openDirectory'],defaultPath:folder});if(picked.canceled)return null;folder=picked.filePaths[0]}
      const result=await scanMinecraft(folder,{exclude:store.root})
      candidates=new Map(result.rows.map(r=>[r.token,r]))
      return result
    }finally{scanning=false}
  })
  ipcMain.handle('revealMinecraft',async(_,token,isolated=true)=>{
    const row=candidates.get(token)
    if(!row)throw Error('扫描结果已失效，请重新扫描')
    const error=await shell.openPath(isolated?row.versionPath:row.root)
    if(error)throw Error(error)
  })
  ipcMain.handle('importMinecraft',async(_,token,isolated)=>{
    idle()
    if(importing)throw Error('请先完成当前导入确认')
    const row=candidates.get(token)
    if(!row||row.reason)throw Error(row?.reason||'扫描结果已失效，请重新扫描')
    importing=true
    try{
      const source=isolated?row.versionPath:row.root
      const answer=await dialog.showMessageBox(win,{type:'question',message:'复制导入「'+row.name+'」？',
        detail:'来源：'+source+'\nMinecraft '+row.version+' / '+row.loader+' '+row.loaderVersion+'\n仅复制存档、模组、配置、资源包、光影、截图等游玩数据。原目录不变。游戏和加载器文件将在首次启动时检查下载；旧启动器的账户、Java 路径和自定义启动参数不会导入。请先关闭使用此目录的游戏。',
        buttons:['复制导入','取消'],defaultId:1,cancelId:1})
      if(answer.response!==0)return
      idle()
      return queue.add('导入本地实例 · '+row.name,async task=>{
        if(await fs.realpath(row.root)!==row.root || await fs.realpath(source)!==source)throw Error('源目录已变化，请重新扫描')
        const now=identify(await profile(row.root,row.name))
        if(now.reason || ['version','loader','loaderVersion'].some(k=>now[k]!==row[k]))throw Error('版本配置已变化，请重新扫描')
        const stage=path.join(store.root,'imports',randomUUID())
        await fs.mkdir(stage,{recursive:true})
        let instance
        const previous=store.data.selectedId
        try{
          let count=0
          task.progress(0,'复制游玩数据')
          await copyGameData(source,stage,{signal:task.signal,progress:()=>{if(++count%20===0)task.progress(50,'已复制 '+count+' 个文件')}})
          task.signal.throwIfAborted()
          let name=row.name,n=1
          while(store.data.instances.some(i=>i.name===name))name=row.name+' ('+(++n)+')'
          instance=store.create({name,version:row.version,loader:row.loader,loaderVersion:row.loaderVersion,isolated:true})
          await copyGameData(stage,store.directory(instance.id),{signal:task.signal})
          instance.importedFrom=source
          store.save()
          task.progress(100,'导入完成；首次启动会检查游戏文件')
        }catch(e){
          if(instance){
            const target=store.directory(instance.id)
            if(path.dirname(target)!==path.join(store.root,'instances'))throw Error('导入目录校验失败，已停止清理')
            store.data.instances=store.data.instances.filter(i=>i.id!==instance.id)
            if(store.data.selectedId===instance.id)store.data.selectedId=previous
            store.save()
            await fs.rm(target,{recursive:true,force:true})
          }
          throw e
        }finally{
          if(path.dirname(stage)===path.join(store.root,'imports'))await fs.rm(stage,{recursive:true,force:true})
        }
      })
    }finally{importing=false}
  })
}
