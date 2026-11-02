const {contextBridge,ipcRenderer} = require('electron')
contextBridge.exposeInMainWorld('launcher', Object.fromEntries(['modsToggle','modBackups','modBackupFolder','restoreModBackup','diagnostics','diagnosticFolder','diagnosticExport','diagnosticAnalyze','aiSettings','aiSave','aiModels','scanMinecraft','revealMinecraft','importMinecraft','modsList','modsPlan','modsApply','modReveal','modLink','contentFilters','retryJob','loaderVersions','contentSearch','contentVersions','contentInstalled','contentInstall','contentRemove','packImport','packExport','packDownload','packImportDownloaded','microsoft','journalList','journalPhoto','journalSave','journalReveal','journalExport','removeInstance','options','offline','versions','jobs','install','windowAction','play','java','gameStatus','state','select','create','settings','choose','cover','folder'].map(name=>[name,(...args)=>ipcRenderer.invoke(name,...args)])))

contextBridge.exposeInMainWorld('onGameStatus',callback=>ipcRenderer.on('game-status',(_,value)=>callback(value)))


contextBridge.exposeInMainWorld('onJobs', callback => ipcRenderer.on('jobs', (_, jobs) => callback(jobs)))

contextBridge.exposeInMainWorld('onPackReady', callback => ipcRenderer.on('pack-ready', (_, file) => callback(file)))

contextBridge.exposeInMainWorld('onDiagnostic',callback=>ipcRenderer.on('diagnostic-ready',(_,id)=>callback(id)))
