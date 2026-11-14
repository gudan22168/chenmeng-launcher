import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import {Store} from '../electron/store.mjs'
import {inspectArchive,importArchive} from '../electron/archive-import.mjs'
const vanilla={id:'1.20.1',arguments:{game:[],jvm:[]},mainClass:'net.minecraft.client.main.Main',libraries:[]}
async function fixture(t,entries){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chen-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const zip=new AdmZip();for(const [name,value] of Object.entries(entries))zip.addFile(name,Buffer.from(typeof value==='string'?value:JSON.stringify(value)))
  const file=path.join(root,'pack.zip');await fs.writeFile(file,zip.toBuffer());return {root,file}
}
const task=()=>({signal:new AbortController().signal,progress(){},download(){throw Error('Unexpected network')}})
test('wrapped PCL ZIP imports isolated gameplay, excludes accounts and keeps main event loop responsive',async t=>{
  const {root,file}=await fixture(t,{'Bundle/.minecraft/versions/1.20.1/1.20.1.json':vanilla,'Bundle/.minecraft/versions/1.20.1/mods/sample.jar':'jar','Bundle/.minecraft/versions/1.20.1/config/a.json':'{}','Bundle/.minecraft/launcher_accounts.json':'secret','Bundle/.minecraft/saves/shared.txt':'not isolated'})
  let ticks=0;const timer=setInterval(()=>ticks++,1)
  const pack=await inspectArchive(file);clearInterval(timer);assert(ticks>0)
  const store=new Store(path.join(root,'.minecraft')),before=store.data.instances.length
  const instance=await importArchive(store,file,pack,task())
  assert.equal(store.data.instances.length,before+1);assert.equal(store.directory(instance.id),path.join(store.root,'versions','1.20.1'))
  assert.equal(await fs.readFile(path.join(store.directory(instance.id),'mods/sample.jar'),'utf8'),'jar')
  await assert.rejects(fs.stat(path.join(store.directory(instance.id),'launcher_accounts.json')))
  await assert.rejects(fs.stat(path.join(store.directory(instance.id),'saves/shared.txt')))
  assert.deepEqual(await fs.readdir(path.join(store.root,'imports')),[])
})
test('shared ZIP and inherited Fabric profile with downloadable missing base',async t=>{
  const {root,file}=await fixture(t,{'versions/Fabric/Fabric.json':{id:'Fabric',inheritsFrom:'1.20.1',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',libraries:[{name:'net.fabricmc:fabric-loader:0.16.0'}]},'mods/m.jar':'mod'})
  const pack=await inspectArchive(file);assert.equal(pack.loader,'fabric');assert.equal(pack.version,'1.20.1')
  const store=new Store(path.join(root,'game')),i=await importArchive(store,file,pack,task())
  assert.equal(await fs.readFile(path.join(store.directory(i.id),'mods/m.jar'),'utf8'),'mod')
})
test('changed archive and cancellation leave no partial instance or staging files',async t=>{
  const {root,file}=await fixture(t,{'versions/1.20.1/1.20.1.json':vanilla,'mods/m.jar':'mod'})
  const pack=await inspectArchive(file),store=new Store(path.join(root,'game')),before=structuredClone(store.data)
  const cancelled=task();cancelled.signal=AbortSignal.abort(Error('cancelled'))
  await assert.rejects(importArchive(store,file,pack,cancelled),/cancelled/)
  await fs.appendFile(file,'changed')
  await assert.rejects(importArchive(store,file,pack,task()),/已变化/)
  assert.deepEqual(store.data,before);assert.deepEqual(await fs.readdir(path.join(store.root,'imports')),[])
})
test('reject case collisions, ambiguous versions, unsupported CurseForge manifest and traversal',async t=>{
  for(const entries of [
    {'mods/a.jar':'1','mods/A.jar':'2'},
    {'versions/1.20.1/1.20.1.json':vanilla,'versions/1.21.1/1.21.1.json':{...vanilla,id:'1.21.1'}},
    {'manifest.json':{files:[{projectID:1,fileID:2}]}},
    {'modrinth.index.json':{formatVersion:1,game:'minecraft',name:'bad',dependencies:{minecraft:'1.20.1'},files:[{path:'../escape.jar'}]}}
  ]){const {file}=await fixture(t,entries);await assert.rejects(inspectArchive(file))}
})
test('standard paths honor isolation, collision suffixes and legacy instances',async t=>{
  const {root}=await fixture(t,{}),store=new Store(path.join(root,'game'))
  const a=store.create({name:'a',version:'1.20.1'}),b=store.create({name:'b',version:'1.20.1'})
  assert.equal(a.directoryName,'1.20.1');assert.equal(b.directoryName,'1.20.1-2')
  assert.equal(store.versionMetadataPath(a.id),path.join(store.root,'versions/1.20.1/1.20.1.json'))
  assert.equal(store.versionClientPath(a.id),path.join(store.root,'versions/1.20.1/1.20.1.jar'))
  store.setSettings({isolated:false});assert.equal(store.directory(a.id),store.root)
  b.isolated=true;assert.equal(store.directory(b.id),path.join(store.root,'versions/1.20.1-2'))
  delete a.layout;assert.equal(store.directory(a.id),path.join(store.root,'shared'))
  assert.equal(store.minecraftRoot(a.id),path.join(store.root,'runtime'))
  store.setSettings({isolated:true});assert.equal(store.directory(a.id),path.join(store.root,'instances',a.id))
  assert.throws(()=>store.create({name:'bad',version:'..'}));assert.throws(()=>store.create({name:'bad',version:'CON'}))
})


test('vanilla preparation writes standard JSON and JAR, including duplicate profile inheritance',async t=>{
  const {root}=await fixture(t,{}),store=new Store(path.join(root,'game'))
  const a=store.create({name:'base',version:'1.20.1'}),b=store.create({name:'copy',version:'1.20.1'})
  const meta={...vanilla,type:'release',javaVersion:{majorVersion:17},downloads:{client:{url:'https://example.invalid/client',size:3}},assetIndex:{id:'test',url:'https://example.invalid/index'}}
  const {hashFile}=await import('../electron/util.mjs'),{prepare}=await import('../electron/vanilla.mjs')
  await fs.writeFile(store.versionMetadataPath(a.id),JSON.stringify(meta))
  a.metadataHash=b.metadataHash=await hashFile(store.versionMetadataPath(a.id))
  const downloaded=[]
  const fake={...task(),async download(url,destination){downloaded.push(destination);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,url.endsWith('/index')?JSON.stringify({objects:{}}):'jar')}}
  const plan=await prepare(store,b,fake)
  assert.equal(plan.cwd,store.directory(b.id));assert(downloaded.includes(store.versionClientPath(b.id)))
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.profileDirectory(b.id),b.directoryName+'.json'),'utf8')),{id:b.directoryName,inheritsFrom:'1.20.1'})
})

test('failed Modrinth download can be retried without a leftover instance',async t=>{
  const index={formatVersion:1,game:'minecraft',name:'retry',dependencies:{minecraft:'1.20.1'},files:[{path:'mods/mod.jar',hashes:{sha1:'a'.repeat(40),sha512:'b'.repeat(128)},downloads:['https://cdn.modrinth.com/mod.jar'],fileSize:3}]}
  const {root,file}=await fixture(t,{'modrinth.index.json':index,'client-overrides/config/client.txt':'override'}),store=new Store(path.join(root,'game')),pack=await inspectArchive(file),before=store.data.instances.length
  await assert.rejects(importArchive(store,file,pack,{...task(),download(){throw Error('network failed')}}),/network failed/)
  assert.equal(store.data.instances.length,before)
  const instance=await importArchive(store,file,pack,{...task(),async download(url,target){await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'jar')}})
  assert.equal(await fs.readFile(path.join(store.directory(instance.id),'config/client.txt'),'utf8'),'override')
  assert.equal(store.data.instances.length,before+1)
})
