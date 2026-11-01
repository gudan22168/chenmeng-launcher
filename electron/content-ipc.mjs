import path from 'node:path'
import {promises as fs} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {searchContent,versions,installContent,installed,setInstalled,modrinth,safeTarget,downloadURL} from './content.mjs'
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
  ipcMain.handle('contentVersions',(_,id,type)=>versions(id,current(),type))
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
    if(!version.game_versions.includes(instance.version) || !version.loaders.includes(instance.loader))throw Error('整合包不匹配当前版本或加载器')
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
