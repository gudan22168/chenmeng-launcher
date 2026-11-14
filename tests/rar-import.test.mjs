import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Store} from '../electron/store.mjs'
import {inspectArchive,importArchive} from '../electron/archive-import.mjs'
const fixture=name=>fileURLToPath(new URL('./fixtures/rar/'+name,import.meta.url))
const task=()=>({signal:new AbortController().signal,progress(){},download(){throw Error('Unexpected network')}})
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'chen-rar-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
test('compressed solid RAR imports Chinese paths to standard version directory without blocking UI',async t=>{
  const root=await temporary(t),file=fixture('game-solid.rar')
  let ticks=0;const timer=setInterval(()=>ticks++,1)
  let pack;try{pack=await inspectArchive(file)}finally{clearInterval(timer)}
  assert(ticks>0);assert.equal(pack.version,'1.20.1')
  const store=new Store(path.join(root,'.minecraft')),i=await importArchive(store,file,pack,task())
  assert.equal(store.directory(i.id),path.join(store.root,'versions/1.20.1'))
  assert.equal(await fs.readFile(path.join(store.directory(i.id),'mods/smoke.jar'),'utf8'),'desktop drop fixture')
  assert.equal(await fs.readFile(path.join(store.directory(i.id),'config/中文设置.txt'),'utf8'),'中文配置\n'.repeat(300))
  await assert.rejects(fs.stat(path.join(store.directory(i.id),'launcher_accounts.json')))
  assert.deepEqual(await fs.readdir(path.join(store.root,'imports')),[])
})
test('RAR Modrinth index honors client overrides regardless of archive entry order',async t=>{
  const root=await temporary(t),file=fixture('modrinth.rar'),pack=await inspectArchive(file),store=new Store(root)
  assert.equal(pack.type,'mrpack')
  const i=await importArchive(store,file,pack,task())
  assert.equal(await fs.readFile(path.join(store.directory(i.id),'config/priority.txt'),'utf8'),'client')
})
test('RAR rejects password and split archives with useful messages',async()=>{
  for(const name of ['encrypted.rar','encrypted-headers.rar'])await assert.rejects(inspectArchive(fixture(name)),/加密 RAR/)
  await assert.rejects(inspectArchive(fixture('split.part1.rar')),/分卷 RAR/)
})
test('RAR cancellation during extraction and archive mutation leave no partial instance',async t=>{
  const root=await temporary(t),file=path.join(root,'pack.RAR');await fs.copyFile(fixture('game-solid.rar'),file)
  const pack=await inspectArchive(file),store=new Store(path.join(root,'game')),before=structuredClone(store.data),controller=new AbortController()
  await assert.rejects(importArchive(store,file,pack,{...task(),signal:controller.signal,progress(n,stage){if(stage.startsWith('解压游玩文件'))controller.abort(Error('cancelled during RAR extraction'))}}),/cancelled/)
  assert.deepEqual(store.data,before);assert.deepEqual(await fs.readdir(path.join(store.root,'imports')),[])
  await fs.appendFile(file,'changed')
  await assert.rejects(importArchive(store,file,pack,task()),/已变化/)
  assert.deepEqual(store.data,before)
})
test('invalid or truncated RAR fails without creating an instance',async t=>{
  const root=await temporary(t),file=path.join(root,'invalid.rar')
  for(const bytes of [Buffer.from('not a RAR'),(await fs.readFile(fixture('game-solid.rar'))).subarray(0,40)]){
    await fs.writeFile(file,bytes);await assert.rejects(inspectArchive(file),/RAR/)
  }
})


import {rar4} from './helpers/rar4.mjs'
const profile={name:'versions/1.20.1/1.20.1.json',data:JSON.stringify({id:'1.20.1',arguments:{game:[],jvm:[]},mainClass:'net.minecraft.client.main.Main',libraries:[]})}
test('RAR4 compatibility and CRC corruption cleanup',async t=>{
  const root=await temporary(t),file=path.join(root,'stored.rar'),bytes=rar4([profile,{name:'mods/test.jar',data:'rar4 data'}])
  await fs.writeFile(file,bytes)
  const store=new Store(path.join(root,'game')),pack=await inspectArchive(file),i=await importArchive(store,file,pack,task())
  assert.equal(await fs.readFile(path.join(store.directory(i.id),'mods/test.jar'),'utf8'),'rar4 data')
  bytes[bytes.indexOf(Buffer.from('rar4 data'))]^=1;await fs.writeFile(file,bytes)
  const broken=await inspectArchive(file),before=structuredClone(store.data)
  await assert.rejects(importArchive(store,file,broken,task()),/RAR/)
  assert.deepEqual(store.data,before);assert.deepEqual(await fs.readdir(path.join(store.root,'imports')),[])
})
test('RAR rejects traversal, absolute paths, reserved names, duplicate paths and excessive sizes',async t=>{
  const root=await temporary(t),file=path.join(root,'unsafe.rar')
  for(const entries of [
    [{name:'../escape.txt'}],[{name:'..\\escape.txt'}],[{name:'/outside.txt'}],[{name:'C:\\outside.txt'}],[{name:'mods/NUL.jar'}],
    [{name:'mods/a.jar'},{name:'mods/A.jar'}],[{name:'mods/large.jar',size:256*1024**2+1}]
  ]){await fs.writeFile(file,rar4([profile,...entries]));await assert.rejects(inspectArchive(file),/路径|256 MiB/)}
  await assert.rejects(fs.stat(path.join(root,'escape.txt')))
})
test('RAR symbolic-link records never create links on disk',async t=>{
  const root=await temporary(t),file=path.join(root,'link.rar')
  await fs.writeFile(file,rar4([profile,{name:'mods/link.jar',data:'../../outside.jar',host:3,attr:0xa1ff}]))
  const store=new Store(path.join(root,'game')),before=structuredClone(store.data)
  await assert.rejects(async()=>importArchive(store,file,await inspectArchive(file),task()))
  assert.deepEqual(store.data,before)
  await assert.rejects(fs.stat(path.join(root,'outside.jar')))
})
