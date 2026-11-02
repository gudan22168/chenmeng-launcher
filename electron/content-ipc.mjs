import {toggleMods,listModBackups,restoreModBackup} from './mod-history.mjs'
import {scanMods,identifyMods,checkMods,fingerprint,planMods,applyModPlan} from './mod-manager.mjs'
import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {searchContent,versions,browseContext,packCompatible,installContent,installed,setInstalled,modrinth,safeTarget,downloadURL} from './content.mjs'
import {inspectPack,unpackPack,exportPack} from './packs.mjs'
import {loaderVersions} from './loaders.mjs'
import {getJSON} from './downloads.mjs'
import {prepare} from './vanilla.mjs'

export function registerContent({store,queue,ipcMain,dialog,shell,win,isBusy}){
  const current=()=>store.instance(store.data.selectedId)
  const idle=()=>{
    if(isBusy() || queue.snapshot().some(j=>['queued','running','cancelling'].includes(j.status)))throw Error('请等待游戏或当前任务结束')
  }
  ipcMain.handle('loaderVersions',(_,game,loader)=>loaderVersions(game,loader))
  ipcMain.handle('contentSearch',(_,input)=>searchContent(current(),input))
  ipcMain.handle('contentVersions',(_,id,type,filter)=>versions(id,browseContext(current(),filter),type))
  const plans=new Map()
  ipcMain.handle('contentFilters',async()=>{
    const [categories,gameVersions]=await Promise.all([getJSON(modrinth+'/tag/category'),getJSON(modrinth+'/tag/game_version')])
    return {categories:categories.map(c=>({name:c.name,type:c.project_type})),versions:gameVersions.filter(v=>v.version_type==='release').map(v=>v.version)}
  })
  ipcMain.handle('modsList',async(_,id,check=false)=>{
    const instance=store.instance(id),rows=await scanMods(store,instance)
    let warning=''
    try{if(check)await checkMods(rows,instance);else await identifyMods(rows)}catch(e){warning='联网识别未完成：'+e.message}
    return {rows,snapshot:fingerprint(rows),warning}
  })
  ipcMain.handle('modsPlan',async(_,id,input)=>{
    idle()
    const instance=store.instance(id),plan=await planMods(store,instance,input)
    const token=randomUUID()
    plans.clear();plans.set(token,plan)
    return {token,changes:plan.changes,remove:plan.remove,warnings:plan.warnings}
  })
  ipcMain.handle('modsApply',(_,id,token)=>{
    idle()
    const plan=plans.get(token),instance=store.instance(id)
    if(!plan||plan.instanceId!==id)throw Error('清单已失效，请重新检查')
    plans.delete(token)
    return queue.add('应用模组更改 · '+instance.name,task=>applyModPlan(store,instance,plan,task),instance.id)
  })
  ipcMain.handle('modsToggle',async(_,id,paths,enabled,snapshot)=>{
    idle()
    const instance=store.instance(id)
    if(!Array.isArray(paths)||!paths.length||paths.length>1000||typeof enabled!=='boolean'||typeof snapshot!=='string')throw Error('批量操作参数无效')
    const answer=await dialog.showMessageBox(win,{type:'question',message:(enabled?'启用':'禁用')+'所选 '+paths.length+' 个模组？',
      detail:'操作前会备份当前全部模组。禁用只把 .jar 改名为 .jar.disabled，不删除文件。依赖这些模组的其他模组可能需要一起调整。',
      buttons:[enabled?'备份并启用':'备份并禁用','取消'],defaultId:1,cancelId:1})
    if(answer.response!==0)return
    idle()
    return queue.add((enabled?'启用':'禁用')+'模组 · '+instance.name,task=>toggleMods(store,instance,paths,enabled,snapshot,task),instance.id)
  })
  ipcMain.handle('modBackups',(_,id)=>listModBackups(store,store.instance(id)))
  ipcMain.handle('modBackupFolder',async(_,id)=>{
    const directory=await safeTarget(store.directory(id),'mod-backups')
    await fs.mkdir(directory,{recursive:true})
    const error=await shell.openPath(directory);if(error)throw Error(error)
  })
  ipcMain.handle('restoreModBackup',async(_,id,backupId)=>{
    idle()
    const instance=store.instance(id),backup=(await listModBackups(store,instance)).find(b=>b.id===backupId)
    if(!backup||!backup.canRestore)throw Error('该备份无法直接恢复：当前模组与该次操作完成时不同。请打开备份目录核对。')
    const answer=await dialog.showMessageBox(win,{type:'question',message:'恢复到 '+new Date(backup.time).toLocaleString()+' 操作前的模组状态？',
      detail:'还原 '+backup.count+' 个模组及启用状态。不会修改存档、模组配置、资源包和光影。恢复前的当前模组也会另存备份。',
      buttons:['备份当前状态并恢复','取消'],defaultId:1,cancelId:1})
    if(answer.response!==0)return
    idle()
    return queue.add('恢复模组备份 · '+instance.name,task=>restoreModBackup(store,instance,backupId,task),instance.id)
  })

  ipcMain.handle('modReveal',async(_,id,relative)=>{
    if(typeof relative!=='string'||!/^mods\/[^/]+\.jar(?:\.disabled)?$/i.test(relative))throw Error('模组路径无效')
    const file=await safeTarget(store.directory(id),relative)
    await fs.stat(file);shell.showItemInFolder(file)
  })
  ipcMain.handle('modLink',async(_,site,title,projectId)=>{
    const query=encodeURIComponent(String(title).slice(0,160))
    let url
    if(site==='curseforge')url='https://www.curseforge.com/minecraft/search?class=mc-mods&search='+query
    else if(site==='mcmod')url='https://search.mcmod.cn/s?key='+query
    else if(site==='modrinth' && /^\w{1,80}$/.test(projectId))url='https://modrinth.com/mod/'+projectId
    else throw Error('网站无效')
    await shell.openExternal(url)
  })
  ipcMain.handle('contentInstalled',()=>installed(store,current()))
  ipcMain.handle('contentInstall',(_,versionId)=>{
    idle()
    const instance=current()
    return queue.add('安装内容与依赖 · '+instance.name,task=>installContent(store,instance,versionId,task),instance.id)
  })
  ipcMain.handle('contentRemove',async(_,projectId)=>{
    idle()
    const instance=current(),records=installed(store,instance),record=records.find(r=>r.projectId===projectId)
    if(!record)throw Error('内容已移除')
    if(records.some(r=>r.dependencies?.includes(projectId)))throw Error('其他已安装内容依赖此项目，请先移除依赖它的内容')
    const result=await dialog.showMessageBox(win,{type:'question',message:'移除 '+record.title+'？',buttons:['取消','移到回收站'],cancelId:0,defaultId:0})
    if(result.response!==1)return
    idle()
    const file=await safeTarget(store.directory(instance.id),record.path)
    if(await fs.stat(file).catch(()=>null))await shell.trashItem(file)
    setInstalled(store,instance,records.filter(r=>r!==record))
    store.save()
  })
  async function importFile(file){
    const pack=inspectPack(file)
    const answer=await dialog.showMessageBox(win,{
      type:'question',message:'导入「'+pack.index.name+'」？',
      detail:'Minecraft '+pack.index.dependencies.minecraft+' · '+pack.loader+' '+pack.loaderVersion+'。将创建独立实例并安装游戏和加载器。',
      checkboxLabel:'同时安装标为可选的客户端文件',checkboxChecked:false,buttons:['导入','取消'],cancelId:1
    })
    if(answer.response!==0)return
    idle()
    const instance=store.create({name:pack.index.name,version:pack.index.dependencies.minecraft,loader:pack.loader,loaderVersion:pack.loaderVersion,isolated:true})
    instance.packPending=true
    store.save()
    return queue.add('导入整合包 · '+instance.name,async task=>{
      await unpackPack(store,instance,pack,task,answer.checkboxChecked)
      instance.packPending=false
      store.save()
      await prepare(store,instance,task)
      task.progress(100,'整合包和游戏已就绪')
    },instance.id)
  }
  ipcMain.handle('packImport',async()=>{
    idle()
    const picked=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Modrinth 整合包',extensions:['mrpack']}]})
    if(!picked.canceled)return importFile(picked.filePaths[0])
  })
  ipcMain.handle('packDownload',async(_,versionId)=>{
    idle()
    const instance=current()
    const version=await getJSON(modrinth+'/version/'+encodeURIComponent(versionId))
    if(!packCompatible(version,instance))throw Error('整合包不匹配当前版本或加载器')
    const file=version.files.find(f=>f.primary) || version.files[0]
    if(!file.filename.endsWith('.mrpack'))throw Error('该文件不是 mrpack')
    const dest=path.join(store.root,'packs',randomUUID()+'.mrpack')
    idle()
    return queue.add('下载整合包 · '+version.name,async task=>{
      await task.download(downloadURL(file.url),dest,{...file.hashes,size:file.size})
      // Import confirmation is handled after download, outside the queue lock.
      if(!win.isDestroyed())win.webContents.send('pack-ready',dest)
    })
  })
  ipcMain.handle('packImportDownloaded',async(_,token)=>{
    const dir=path.resolve(store.root,'packs')
    if(typeof token!=='string' || path.dirname(path.resolve(token))!==dir || !/^[a-f0-9-]+\.mrpack$/.test(path.basename(token)))throw Error('整合包路径无效')
    idle()
    return importFile(token)
  })
  ipcMain.handle('packExport',async(_,selection)=>{
    idle()
    const instance=current()
    const picked=await dialog.showSaveDialog(win,{defaultPath:instance.name.replace(/[<>:"/\\|?*]/g,'_')+'.mrpack',filters:[{name:'Modrinth 整合包',extensions:['mrpack']}]})
    if(picked.canceled)return
    idle()
    return queue.add('导出整合包 · '+instance.name,task=>exportPack(store,instance,selection,picked.filePath,task),instance.id)
  })
}
