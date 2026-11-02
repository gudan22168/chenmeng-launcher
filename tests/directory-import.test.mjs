import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {promises as fs} from 'node:fs'
import {scanMinecraft,copyGameData} from '../electron/directory-import.mjs'

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chenmeng-import-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  return root
}
async function version(root,id,meta){
  const dir=path.join(root,'versions',id)
  await fs.mkdir(dir,{recursive:true})
  await fs.writeFile(path.join(dir,id+'.json'),JSON.stringify({id,...meta}))
  return dir
}
test('scan nested roots, inherited loaders, isolation and unsupported profiles',async t=>{
  const root=await fixture(t),game=path.join(root,'old-launcher','.minecraft')
  await version(game,'1.21.1',{arguments:{jvm:[],game:[]},mainClass:'net.minecraft.client.main.Main',libraries:[]})
  const fabric=await version(game,'my-fabric',{inheritsFrom:'1.21.1',libraries:[{name:'net.fabricmc:fabric-loader:0.16.10'}],mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient'})
  await fs.mkdir(path.join(fabric,'mods'))
  await version(game,'broken',{inheritsFrom:'missing'})
  await version(game,'cycle',{inheritsFrom:'cycle'})
  await version(game,'unsafe',{inheritsFrom:'../../outside'})
  const scanned=await scanMinecraft(root)
  const row=scanned.rows.find(r=>r.name==='my-fabric')
  assert.equal(row.version,'1.21.1')
  assert.equal(row.loader,'fabric')
  assert.equal(row.loaderVersion,'0.16.10')
  assert.equal(row.isolated,true)
  assert.equal(row.versionPath,await fs.realpath(fabric))
  for(const name of ['broken','cycle','unsafe'])assert.ok(scanned.rows.find(r=>r.name===name).reason)
  assert.equal((await scanMinecraft(root,{exclude:game})).rows.length,0)
})
test('copy gameplay data without launcher credentials and refuse overwrites',async t=>{
  const root=await fixture(t),source=path.join(root,'source'),dest=path.join(root,'dest')
  await fs.mkdir(path.join(source,'saves','world'),{recursive:true})
  await fs.mkdir(dest)
  await fs.writeFile(path.join(source,'saves','world','level.dat'),'world')
  await fs.writeFile(path.join(source,'options.txt'),'settings')
  await fs.writeFile(path.join(source,'launcher_accounts.json'),'private')
  await copyGameData(source,dest)
  assert.equal(await fs.readFile(path.join(dest,'saves','world','level.dat'),'utf8'),'world')
  assert.equal(await fs.readFile(path.join(dest,'options.txt'),'utf8'),'settings')
  await assert.rejects(fs.stat(path.join(dest,'launcher_accounts.json')))
  await assert.rejects(copyGameData(source,dest),/exist/i)
  assert.equal(await fs.readFile(path.join(source,'options.txt'),'utf8'),'settings')
})
test('cancel before copying',async t=>{
  const root=await fixture(t)
  await fs.writeFile(path.join(root,'options.txt'),'settings')
  const controller=new AbortController()
  controller.abort()
  await assert.rejects(copyGameData(root,path.join(root,'copy'),{signal:controller.signal}),{name:'AbortError'})
})
