import {_electron} from 'playwright'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'chen-desktop-'))
const zip=new AdmZip()
zip.addFile('.minecraft/versions/1.20.1/1.20.1.json',Buffer.from(JSON.stringify({id:'1.20.1',mainClass:'net.minecraft.client.main.Main',arguments:{game:[],jvm:[]},libraries:[]})))
zip.addFile('.minecraft/versions/1.20.1/mods/smoke.jar',Buffer.from('desktop drop fixture'))
const isRar=process.argv.includes('--rar'),picker=process.argv.includes('--picker')
const file=path.join(root,isRar?'desktop-pack.rar':'desktop-pack.zip')
if(isRar)await fs.copyFile(new URL('../tests/fixtures/rar/game-solid.rar',import.meta.url),file)
else await fs.writeFile(file,zip.toBuffer())
const packaged=process.argv.slice(2).find(a=>!a.startsWith('--'))
const executable=packaged||path.resolve('node_modules/electron/dist/electron.exe')
const start=Date.now()
let app
try{
  app=await _electron.launch({timeout:30000,executablePath:executable,args:packaged?[]:['.'],env:{...process.env,CHENMENG_DATA_DIR:path.join(root,'.minecraft')}})
  const page=await app.firstWindow(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.locator('.launch').waitFor()
  console.log('Startup:',JSON.stringify({readyMs:Date.now()-start,renderer:await page.evaluate(()=>({now:performance.now(),domLoaded:performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd}))}))
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})})
  if(picker){
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async(win,options)=>{if(!options.filters.some(f=>f.extensions.includes('rar')))throw Error('RAR missing from picker');return {canceled:false,filePaths:[file]}}},file)
    await page.evaluate(()=>window.launcher.packImport())
  }else{
    const session=await page.context().newCDPSession(page)
    for(const type of ['dragEnter','dragOver','drop'])await session.send('Input.dispatchDragEvent',{type,x:500,y:300,data:{items:[],files:[file],dragOperationsMask:1}})
  }
  for(let n=0;n<200;n++){
    const jobs=await page.evaluate(()=>window.launcher.jobs())
    if(jobs[0]?.status==='failed')throw Error(jobs[0].error)
    if(jobs[0]?.status==='completed')break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  const state=await page.evaluate(()=>window.launcher.state())
  const imported=state.instances.find(i=>i.version==='1.20.1')
  assert.equal(imported.directoryName,'1.20.1')
  assert.equal(await fs.readFile(path.join(root,'.minecraft','versions','1.20.1','mods','smoke.jar'),'utf8'),'desktop drop fixture')
  const jobs=await page.evaluate(()=>window.launcher.jobs());assert.equal(jobs[0].status,'completed')
  assert.deepEqual(errors,[])
  console.log('PASS',isRar?'RAR':'ZIP',picker?'file picker':'native-file drag','background worker, completed import and standard directory')
}finally{await app?.close();await fs.rm(root,{recursive:true,force:true})}
