import { Downloads, getJSON } from './downloads.mjs'
import { prepare, launch, detectJava, checkJava } from './vanilla.mjs'
import {deviceCode,redeem,renew,minecraftSession} from './microsoft.mjs'
import { clipboard, safeStorage, app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { readdir, readFile, stat, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './store.mjs'

import {registerContent} from './content-ipc.mjs'
import {registerJournal} from './journal.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
app.whenReady().then(async () => {
const store = new Store(process.env.CHENMENG_DATA_DIR || app.getPath('userData'))
const current = () => store.data.selectedId
ipcMain.handle('state', () => store.snapshot())
ipcMain.handle('select', (_, id) => { store.instance(id); store.data.selectedId = id; store.save(); return store.snapshot() })
ipcMain.handle('create', (_, input) => { store.create(input); return store.snapshot() })
ipcMain.handle('settings', (_, mode) => { store.setSettings({coverMode: mode}); return store.snapshot() })
ipcMain.handle('options', (_,changes) => {
  if(gameStatus.busy || queue.snapshot().some(j=>['queued','running','cancelling'].includes(j.status)))throw Error('请等待游戏或任务结束再修改运行设置')
  if(changes.memory !== undefined) store.update(current(),{memory:changes.memory})
  else store.setSettings(changes)
  return store.snapshot()
})
ipcMain.handle('folder', async (_, name) => {
  if (!['', 'screenshots','saves','shaderpacks','mods','resourcepacks'].includes(name)) throw Error('目录无效')
  const error = await shell.openPath(path.join(store.directory(current()), name))
  if (error) throw Error(error)
})
ipcMain.handle('choose', async () => {
  const result = await dialog.showOpenDialog({properties:['openFile'], filters:[{name:'封面', extensions:['jpg','jpeg','png','webp']}]})
  if (!result.canceled) {
    const source = result.filePaths[0]
    if ((await stat(source)).size > 32*1024*1024) throw Error('请选择小于 32 MB 的图片')
    const dest = path.join(store.root, 'cover' + path.extname(source).toLowerCase())
    if (source !== dest) await copyFile(source, dest)
    store.data.settings.fixedCover = dest
    store.setSettings({coverMode:'fixed'})
  }
  return store.snapshot()
})
ipcMain.handle('cover', async () => {
  const {coverMode, fixedCover} = store.data.settings
  let file = fixedCover
  if (!current() || coverMode === 'default') return ''
  if (coverMode === 'auto') {
    const dir = path.join(store.directory(current()), 'screenshots')
    const names = (await readdir(dir,{withFileTypes:true})).filter(x=>x.isFile() && !/\.手记(?:-\d+)?\.png$/i.test(x.name) && /\.(png|jpe?g|webp)$/i.test(x.name))
    const files = await Promise.all(names.map(async x=>({file:path.join(dir,x.name), info:await stat(path.join(dir,x.name))})))
    file = files.filter(x=>x.info.size<=32*1024*1024).sort((a,b)=>b.info.mtimeMs-a.info.mtimeMs)[0]?.file
  }
  if (!file) return ''
  const ext = path.extname(file).slice(1).replace(/^jpg$/i,'jpeg')
  return 'data:image/'+ext+';base64,'+(await readFile(file)).toString('base64')
})
Menu.setApplicationMenu(null)
const win = new BrowserWindow({icon:path.join(here,'icon.png'),frame:false,autoHideMenuBar:true,backgroundColor:"#F2F0E6",width:1180,height:760,minWidth:340,minHeight:230,webPreferences:{preload:path.join(here,'preload.cjs'),sandbox:true}})
ipcMain.handle('windowAction', (event, action) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target) return
  if (action === 'expand') {
    if(target.isMaximized()) target.unmaximize()
    target.setSize(1180,760)
    return
  }
  if (action === 'minimize') target.minimize()
  if (action === 'maximize') target.isMaximized() ? target.unmaximize() : target.maximize()
  if (action === 'close') target.close()
})
let gameStatus = {busy:false,message:''}
const status = (busy,message) => { gameStatus={busy,message}; if(!win.isDestroyed()) win.webContents.send('game-status',gameStatus) }
ipcMain.handle('gameStatus',()=>gameStatus)
ipcMain.handle('java',async ()=>{
  const id=current()
  const picked=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Java',extensions:['exe']}]})
  if(!picked.canceled)store.update(id,{javaPath:picked.filePaths[0]})
  return store.snapshot()
})
let session=null, signingIn=false
const clientId=()=>process.env.CHENMENG_CLIENT_ID || store.data.clientId || '8afeda54-6272-4879-a5e6-5c8b24f2e26e'
const protect=token=>safeStorage.encryptString(token).toString('base64')
ipcMain.handle('microsoft',async()=>{
  if(signingIn || gameStatus.busy)throw Error('请等待当前登录或游戏结束')
  const id=clientId().trim()
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw Error('请输入 Entra 应用概述中的客户端 ID')
  if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用')
  signingIn=true
  try{
    const device=await deviceCode(id)
    const deadline=Date.now()+device.expires_in*1000
    const url=new URL(device.verification_uri)
    if(url.protocol!=='https:' || !['microsoft.com','www.microsoft.com','login.microsoftonline.com','login.live.com'].includes(url.hostname))throw Error('Microsoft 登录地址无效')
    clipboard.writeText(device.user_code)
    await shell.openExternal(url.href)
    const answer=await dialog.showMessageBox(win,{type:'info',message:'在 Microsoft 官方页面输入 '+device.user_code,detail:'设备代码已复制。在微软页面按 Ctrl+V 粘贴，核对应用名称并完成登录，再点击「已完成授权」。',buttons:['已完成授权','取消'],cancelId:1})
    if(answer.response!==0)return store.snapshot()
    const tokens=await redeem(id,device,deadline)
    const next=await minecraftSession(tokens.access_token)
    const encrypted=protect(tokens.refresh_token)
    store.data.clientId=id
    store.data.credential=encrypted
    store.data.account={name:next.name,uuid:next.uuid,type:next.type}
    store.save()
    session=next
    return store.snapshot()
  }finally{signingIn=false}
})
async function launchAccount(){
  const account=store.data.account
  if(account.type!=='microsoft')return account
  if(!session || session.expires<Date.now()+120000){
    const token=safeStorage.decryptString(Buffer.from(store.data.credential,'base64'))
    const tokens=await renew(clientId(),token)
    if(tokens.refresh_token){store.data.credential=protect(tokens.refresh_token);store.save()}
    session=await minecraftSession(tokens.access_token)
    if(session.uuid!==account.uuid){session=null;throw Error('账号资料已变更，请重新登录')}
  }
  return {...session,clientId:clientId()}
}
ipcMain.handle('offline', (_, name) => {
  if(signingIn || gameStatus.busy)throw Error('请等待当前登录或游戏结束')
  store.setAccount(name)
  delete store.data.credential
  session=null
  store.save()
  return store.snapshot()
})
ipcMain.handle('versions', async () => {
  const manifest = await getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  return manifest.versions.filter(v => v.type === 'release' && v.releaseTime >= '2018-07-18').map(v => v.id)
})
const queue = new Downloads(() => store.data.settings, (event, data) => {
  if (event === 'jobs' && !win.isDestroyed()) win.webContents.send('jobs', data)
})
registerContent({store,queue,ipcMain,dialog,shell,win,isBusy:()=>gameStatus.busy})
registerJournal({store,ipcMain,shell,dialog,win})
ipcMain.handle('removeInstance',async(_,id)=>{
  const instance=store.instance(id)
  const check=()=>{if(gameStatus.busy || queue.snapshot().some(j=>j.instanceId===id && !['completed','failed','cancelled'].includes(j.status))) throw Error('请先结束游戏或下载任务')}
  check()
  const result=await dialog.showMessageBox(win,{type:'warning',message:'删除实例「'+instance.name+'」？',detail:'将从启动器列表移除。存档、截图和手记文件保留在本机。',buttons:['取消','确认删除'],defaultId:0,cancelId:0})
  if(result.response===1){
    check()
    store.data.instances=store.data.instances.filter(i=>i.id!==id)
    if(current()===id)store.data.selectedId=store.data.instances[0]?.id || ''
    store.save()
  }
  return store.snapshot()
})
ipcMain.handle('jobs', () => queue.snapshot())
ipcMain.handle('retryJob',(_,id)=>{
  if(gameStatus.busy || queue.snapshot().some(j=>['queued','running','cancelling'].includes(j.status)))throw Error('请等待游戏或任务结束')
  const job=queue.snapshot().find(j=>j.id===id)
  if(!job || job.status!=='failed')throw Error('只能重试失败任务')
  if(job.instanceId)store.instance(job.instanceId)
  queue.control(id,'resume')
})
function enqueue(startGame) {
  const instance = store.instance(current())
  if (signingIn || gameStatus.busy) throw Error('请等待当前游戏退出或启动任务结束')
  if (startGame) status(true,'正在准备 '+instance.name)
  try {
    return queue.add(instance.name+' · '+instance.version, async task => {
      if(startGame)status(true,'正在准备 '+instance.name)
      try {
        task.progress(0,'检查版本、依赖库和资源索引')
        const plan = await prepare(store,instance,task,startGame ? await launchAccount() : store.data.account)
        task.progress(100,'游戏文件已就绪')
        if (!startGame) return
        if (!instance.javaPath || !await checkJava(instance.javaPath,plan.major)) {
          const response=await dialog.showMessageBox(win,{type:'question',message:'此实例需要 Java '+plan.major+'。自动查找本机 Java 并重新启动游戏？',buttons:['自动配置并启动','取消'],cancelId:1})
          if(response.response!==0) throw Error('已取消启动')
          const java=await detectJava(plan.major)
          if(!java) throw Error('未找到 Java '+plan.major+'，请安装后重试或在设置里选择 Java。')
          store.update(instance.id,{javaPath:java})
        }
        await launch(instance,plan,code => {
          if(!win.isDestroyed() && !win.isVisible()) win.show()
          status(false,code === 0 ? '游戏已退出' : '游戏异常退出，请查看 launcher.log')
        },store.data.settings.gameTitle)
        if(gameStatus.busy && store.data.settings.closeOnLaunch) win.hide()
        instance.lastPlayed = Date.now()
        store.save()
        if (gameStatus.busy) status(true,'游戏运行中')
      } catch (error) {
        if (startGame) status(false,'启动失败：'+error.message)
        throw error
      }
    }, instance.id)
  } catch (error) {
    if (startGame) status(false,error.message)
    throw error
  }
}
ipcMain.handle('install', () => enqueue(false))
ipcMain.handle('play', () => enqueue(true))
if (process.env.CHENMENG_DEV_URL === 'http://127.0.0.1:5173') await win.loadURL(process.env.CHENMENG_DEV_URL)
else await win.loadFile(path.join(here,'../dist/index.html'))
app.on('window-all-closed',()=>app.quit())


}).catch(error => { dialog.showErrorBox('尘梦启动器', error.message); app.quit() })


