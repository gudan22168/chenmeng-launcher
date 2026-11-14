import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import AdmZip from 'adm-zip'
import {downloadURL} from '../electron/content.mjs'
import {inspectArchive,importArchive} from '../electron/archive-import.mjs'
import {Store} from '../electron/store.mjs'
import {rar4} from './helpers/rar4.mjs'

test('pack downloads accept explicit ForgeCDN hosts and reject lookalikes and insecure URLs',()=>{
  for(const host of ['mediafilez.forgecdn.net','edge.forgecdn.net','cdn.modrinth.com']){
    const url='https://'+host+'/files/1234/567/example.jar'
    assert.equal(downloadURL(url),url)
  }
  for(const url of ['http://mediafilez.forgecdn.net/file.jar','https://mediafilez.forgecdn.net.evil.example/file.jar','https://evilforgecdn.net/file.jar','https://unknown.forgecdn.net/file.jar','https://mediafilez.forgecdn.net@evil.example/file.jar','https://user:pass@mediafilez.forgecdn.net/file.jar','https://127.0.0.1/file.jar'])assert.throws(()=>downloadURL(url))
})
for(const extension of ['zip','mrpack','rar'])test(extension+' imports a Modrinth manifest with ForgeCDN downloads and retains checksum checks',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chen-forgecdn-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const data=Buffer.from('fixture mod contents'),hashes=Object.fromEntries(['sha1','sha512'].map(a=>[a,createHash(a).update(data).digest('hex')]))
  const downloads=['https://mediafilez.forgecdn.net/files/1234/567/example.jar','https://edge.forgecdn.net/files/1234/567/example.jar']
  const index={formatVersion:1,game:'minecraft',name:'ForgeCDN pack',dependencies:{minecraft:'1.20.1'},files:[{path:'mods/example.jar',hashes,downloads,fileSize:data.length}]}
  const manifest=JSON.stringify(index),file=path.join(root,'pack.'+extension)
  if(extension==='rar')await fs.writeFile(file,rar4([{name:'modrinth.index.json',data:manifest}]))
  else{const zip=new AdmZip();zip.addFile('modrinth.index.json',Buffer.from(manifest));await fs.writeFile(file,zip.toBuffer())}
  const pack=await inspectArchive(file),store=new Store(path.join(root,'.minecraft')),seen=[]
  assert.equal(pack.type,'mrpack')
  const instance=await importArchive(store,file,pack,{signal:new AbortController().signal,progress(){},async download(url,target,checks){
    seen.push(url);assert.deepEqual(checks,{...hashes,size:data.length})
    if(url===downloads[0])throw Error('Simulated unavailable CDN endpoint')
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data)
  }})
  assert.deepEqual(seen,downloads)
  assert.deepEqual(await fs.readFile(path.join(store.directory(instance.id),'mods/example.jar')),data)
  assert.equal(store.directory(instance.id),path.join(store.root,'versions','1.20.1'))
})
