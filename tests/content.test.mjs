import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import {Store} from '../electron/store.mjs'
import {inspectPack,exportPack,unpackPack} from '../electron/packs.mjs'
import {resolveContent,installContent} from '../electron/content.mjs'
import {createHash} from 'node:crypto'
const root=await mkdtemp(path.join(os.tmpdir(),'chenmeng-test-')),store=new Store(root)
const instance=store.instance(store.data.selectedId),dir=store.directory(instance.id)
await writeFile(path.join(dir,'config','sample.txt'),'config')
await writeFile(path.join(dir,'saves','excluded.txt'),'private')
const exported=path.join(root,'test.mrpack')
await exportPack(store,instance,['config'],exported,{progress(){}})
const pack=inspectPack(exported)
assert(pack.zip.getEntry('overrides/config/sample.txt'))
assert(!pack.zip.getEntry('overrides/saves/excluded.txt'))
const next=store.create({name:'imported',version:'1.21.1',isolated:true})
await unpackPack(store,next,pack,{progress(){}})
assert.equal(await readFile(path.join(store.directory(next.id),'config/sample.txt'),'utf8'),'config')
const bad=new AdmZip();bad.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'bad',dependencies:{minecraft:'1.21.1'},files:[{path:'../escape.jar'}]})))
const badPath=path.join(root,'bad.mrpack');await writeFile(badPath,bad.toBuffer())
assert.throws(()=>inspectPack(badPath),/路径/)
const data=Buffer.from('test file'),hashes={sha512:createHash('sha512').update(data).digest('hex')}
const version=(id,project,deps=[])=>({id,project_id:project,game_versions:['1.21.1'],loaders:['fabric'],files:[{filename:project+'.jar',primary:true,hashes,size:data.length,url:'https://cdn.modrinth.com/'+project+'.jar'}],dependencies:deps})
const versions={a:version('a','A',[{dependency_type:'required',version_id:'b'}]),b:version('b','B')}
global.fetch=async url=>{
 const [kind,id]=new URL(url).pathname.split('/').slice(-2)
 return Response.json(kind==='version'?versions[id]:{id,title:id,project_type:'mod'})
}
instance.loader='fabric'
const resolved=await resolveContent(instance,'a')
assert.equal(resolved.length,2);assert.deepEqual(resolved[0].dependencies,['B'])
let count=0
await assert.rejects(installContent(store,instance,'a',{progress(){},download:async(url,dest)=>{if(++count===2)throw Error('network');await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,data)}}),/network/)
assert.equal(instance.installed.length,0)
await assert.rejects(readFile(path.join(dir,'mods/A.jar')))
console.log('PASS export selection, round trip, unsafe paths, dependency resolution, failed-download rollback')
