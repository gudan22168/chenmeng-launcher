const {contextBridge,ipcRenderer,webUtils} = require('electron')
contextBridge.exposeInMainWorld('launcher', Object.fromEntries(['launcherUpdateCheck','launcherUpdateDownload','launcherUpdateLocal','languageMods','languagePrepare','languageTranslate','languageExport','languageFolder','modsToggle','modBackups','modBackupFolder','restoreModBackup','diagnostics','diagnosticFolder','diagnosticExport','diagnosticAnalyze','aiSettings','aiSave','aiModels','scanMinecraft','revealMinecraft','importMinecraft','modsList','modsPlan','modsApply','modReveal','modLink','contentFilters','retryJob','loaderVersions','contentSearch','contentVersions','contentInstalled','contentInstall','contentRemove','packImport','packImportFile','packExport','packDownload','packImportDownloaded','microsoft','clearMicrosoft','journalList','journalPhoto','journalSave','journalReveal','journalExport','removeInstance','options','offline','versions','jobs','install','windowAction','play','java','gameStatus','state','select','create','settings','choose','cover','folder'].map(name=>[name,(...args)=>ipcRenderer.invoke(name,...args)])))

contextBridge.exposeInMainWorld('onGameStatus',callback=>ipcRenderer.on('game-status',(_,value)=>callback(value)))


contextBridge.exposeInMainWorld('onJobs', callback => ipcRenderer.on('jobs', (_, jobs) => callback(jobs)))

contextBridge.exposeInMainWorld('onPackReady', callback => ipcRenderer.on('pack-ready', (_, file) => callback(file)))

contextBridge.exposeInMainWorld('onDiagnostic',callback=>ipcRenderer.on('diagnostic-ready',(_,id)=>callback(id)))

contextBridge.exposeInMainWorld('onLanguageProgress',callback=>{
  const listener=(_,value)=>callback(value)
  ipcRenderer.on('language-progress',listener)
  return ()=>ipcRenderer.removeListener('language-progress',listener)
})


contextBridge.exposeInMainWorld('onPackDrop',callback=>{
  const external=event=>Array.from(event.dataTransfer?.types||[]).includes('Files')
  const over=event=>{if(external(event)){event.preventDefault();event.dataTransfer.dropEffect='copy'}}
  const drop=event=>{
    if(!external(event))return
    event.preventDefault();event.stopPropagation()
    const files=Array.from(event.dataTransfer.files)
    if(files.length!==1 || !/\.(zip|rar|mrpack)$/i.test(files[0].name)){callback({error:'请一次拖入一个 .zip、.rar 或 .mrpack 整合包'});return}
    const file=webUtils.getPathForFile(files[0])
    callback(file?{file}:{error:'无法读取文件路径，请使用选择文件导入'})
  }
  window.addEventListener('dragover',over,true);window.addEventListener('drop',drop,true)
  return ()=>{window.removeEventListener('dragover',over,true);window.removeEventListener('drop',drop,true)}
})
