import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {Store} from '../electron/store.mjs'
import {modFiles,modFingerprint,toggleMods,listModBackups,restoreModBackup,createModBackup,finishModBackup} from '../electron/mod-history.mjs'
const task={progress(){},signal:new AbortController().signal}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chenmeng-history-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const store=new Store(root),instance=store.instance(store.data.selectedId),dir=store.directory(instance.id)
  instance.loader='fabric'
  await fs.writeFile(path.join(dir,'mods','a.jar'),'A')
  await fs.writeFile(path.join(dir,'mods','b.jar'),'B')
  await fs.writeFile(path.join(dir,'config','keep.txt'),'KEEP')
  return {root,store,instance,dir}
}
test('batch disable, restore and undo restore preserve contents and config',async t=>{
  const {store,instance,dir}=await fixture(t)
  const before=modFingerprint(await modFiles(dir))
  await toggleMods(store,instance,['mods/a.jar','mods/b.jar'],false,before,task)
  assert.deepEqual((await fs.readdir(path.join(dir,'mods'))).sort(),['a.jar.disabled','b.jar.disabled'])
  const backup=(await listModBackups(store,instance)).find(b=>b.reason==='批量禁用前')
  assert(backup.canRestore)
  await restoreModBackup(store,instance,backup.id,task)
  assert.equal(modFingerprint(await modFiles(dir)),before)
  assert.equal(await fs.readFile(path.join(dir,'config','keep.txt'),'utf8'),'KEEP')
  const undo=(await listModBackups(store,instance)).find(b=>b.reason==='恢复备份前'&&b.canRestore)
  assert(undo)
  await restoreModBackup(store,instance,undo.id,task)
  assert.equal(await fs.readFile(path.join(dir,'mods','a.jar.disabled'),'utf8'),'A')
})
test('enable and disable refuse collisions and stale snapshots',async t=>{
  const {store,instance,dir}=await fixture(t)
  const initial=modFingerprint(await modFiles(dir))
  await fs.writeFile(path.join(dir,'mods','a.jar.disabled'),'OTHER')
  await assert.rejects(toggleMods(store,instance,['mods/a.jar'],false,initial,task),/文件已变化/)
  await assert.rejects(toggleMods(store,instance,['mods/a.jar'],false,modFingerprint(await modFiles(dir)),task),/不能覆盖/)
  assert.equal(await fs.readFile(path.join(dir,'mods','a.jar'),'utf8'),'A')
})
test('restore rejects manual edits and corrupted snapshot',async t=>{
  const {store,instance,dir}=await fixture(t)
  await toggleMods(store,instance,['mods/a.jar'],false,modFingerprint(await modFiles(dir)),task)
  const backup=(await listModBackups(store,instance))[0]
  await fs.writeFile(path.join(dir,'mods','extra.jar'),'EXTRA')
  await assert.rejects(restoreModBackup(store,instance,backup.id,task),/已停止恢复/)
  await fs.unlink(path.join(dir,'mods','extra.jar'))
  await fs.writeFile(path.join(dir,'mod-backups',backup.id,'files','mods','a.jar'),'CORRUPTED')
  await assert.rejects(restoreModBackup(store,instance,backup.id,task),/备份文件损坏/)
  assert.equal(await fs.readFile(path.join(dir,'mods','a.jar.disabled'),'utf8'),'A')
})
test('failed enable/disable commit rolls files and records back',async t=>{
  const {store,instance,dir}=await fixture(t),before=modFingerprint(await modFiles(dir))
  const save=store.save.bind(store)
  store.save=()=>{throw Error('disk full')}
  await assert.rejects(toggleMods(store,instance,['mods/a.jar','mods/b.jar'],false,before,task),/disk full/)
  store.save=save
  assert.equal(modFingerprint(await modFiles(dir)),before)
  assert.equal((await listModBackups(store,instance)).length,0)
})
test('completed update snapshot can restore old files while incomplete backup is hidden',async t=>{
  const {store,instance,dir}=await fixture(t),before=modFingerprint(await modFiles(dir))
  const backup=await createModBackup(store,instance,'更新前',before,task)
  assert.equal((await listModBackups(store,instance)).length,0)
  await fs.writeFile(path.join(dir,'mods','a.jar'),'UPDATED')
  await finishModBackup(store,instance,backup)
  await restoreModBackup(store,instance,backup.manifest.id,task)
  assert.equal(modFingerprint(await modFiles(dir)),before)
})
test('enable is an inverse rename; cancelled operation leaves files alone',async t=>{
  const {store,instance,dir}=await fixture(t)
  await toggleMods(store,instance,['mods/a.jar'],false,modFingerprint(await modFiles(dir)),task)
  await toggleMods(store,instance,['mods/a.jar.disabled'],true,modFingerprint(await modFiles(dir)),task)
  assert.equal(await fs.readFile(path.join(dir,'mods','a.jar'),'utf8'),'A')
  const before=modFingerprint(await modFiles(dir)),controller=new AbortController()
  controller.abort()
  await assert.rejects(toggleMods(store,instance,['mods/a.jar'],false,before,{progress(){},signal:controller.signal}),{name:'AbortError'})
  assert.equal(modFingerprint(await modFiles(dir)),before)
})
