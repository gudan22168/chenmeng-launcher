import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,mkdir,readdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import AdmZip from 'adm-zip'
import {Store} from '../electron/store.mjs'
import {scanMods,identifyMods,checkMods,fingerprint,planMods,applyModPlan} from '../electron/mod-manager.mjs'
import {searchContent} from '../electron/content.mjs'
const root=await mkdtemp(path.join(os.tmpdir(),'chenmeng-mod-manager-')),store=new Store(root),instance=store.instance(store.data.selectedId)
instance.loader='fabric'
const dir=store.directory(instance.id),data={old:Buffer.from('old'),next:Buffer.from('new'),dep:Buffer.from('dep')}
const hash=b=>createHash('sha512').update(b).digest('hex')
const version=(id,project,bytes,deps=[])=>({id,project_id:project,version_number:id,version_type:'release',date_published:id==='old'?'2025-01-01':'2026-01-01',game_versions:['1.21.1'],loaders:['fabric'],files:[{filename:project+'.jar',primary:true,hashes:{sha512:hash(bytes)},size:bytes.length,url:'https://cdn.modrinth.com/'+id}],dependencies:deps})
const versions={old:version('old','A',data.old),next:version('next','A',data.next,[{dependency_type:'required',version_id:'dep',project_id:'B'}]),dep:version('dep','B',data.dep)}
const actualFetch=global.fetch
let searchURL
// Only metadata APIs are permitted during planning; binary downloads use the task stub below.
global.fetch=async(url,options)=>{
 const u=new URL(url),parts=u.pathname.split('/'),id=parts.at(-1)
 if(id==='version_files')return Response.json(Object.fromEntries(Object.values(versions).filter(v=>JSON.parse(options.body).hashes.includes(v.files[0].hashes.sha512)).map(v=>[v.files[0].hashes.sha512,v])))
 if(id==='search'){searchURL=u;return Response.json({hits:[],total_hits:0})}
 if(parts.at(-2)==='version')return Response.json(versions[id])
 if(id==='version')return Response.json(Object.values(versions).filter(v=>v.project_id===parts.at(-2)).reverse())
 if(parts.at(-2)==='project')return Response.json({id,title:id,project_type:'mod'})
 throw Error('Unexpected API '+url)
}
try{
 await writeFile(path.join(dir,'mods/A.jar'),data.old)
 const jar=new AdmZip();jar.addFile('fabric.mod.json',Buffer.from(JSON.stringify({id:'local',name:'Manual Mod',version:'2.0',depends:{minecraft:'1.21.1'}})));await writeFile(path.join(dir,'mods/manual.jar'),jar.toBuffer())
 let rows=await identifyMods(await scanMods(store,instance))
 assert.equal(rows.find(r=>r.projectId==='A').localVersion,'old')
 assert.equal(rows.find(r=>r.title==='Manual Mod').localVersion,'2.0')
 const checked=await checkMods(rows,instance)
 assert.equal(checked.find(r=>r.projectId==='A').latest.id,'next')
 assert(checked.find(r=>r.projectId==='A').updateAvailable)
 await searchContent(instance,{type:'mod',version:'1.20.1',loader:'forge',category:'technology'})
 assert.deepEqual(JSON.parse(searchURL.searchParams.get('facets')),[['project_type:mod'],['versions:1.20.1'],['categories:technology'],['categories:forge']])
 const input={snapshot:fingerprint(rows),versions:['next'],remove:[]}
 const plan=await planMods(store,instance,input)
 assert.equal(plan.changes.length,2);assert(plan.changes.find(r=>r.projectId==='B').automatic)
 assert.equal((await readFile(path.join(dir,'mods/A.jar'))).toString(),'old')
 let count=0
 await assert.rejects(applyModPlan(store,instance,plan,{progress(){},download:async(url,dest)=>{if(++count===2)throw Error('network');await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,data.next)}}),/network/)
 assert.equal((await readFile(path.join(dir,'mods/A.jar'))).toString(),'old')
 const task={progress(){},download:async(url,dest)=>{await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,data[url.split('/').at(-1)])}}
 const save=store.save.bind(store);store.save=()=>{throw Error('disk full')}
 await assert.rejects(applyModPlan(store,instance,plan,task),/disk full/)
 assert.equal((await readFile(path.join(dir,'mods/A.jar'))).toString(),'old')
 assert(!(await readdir(path.join(dir,'mods'))).includes('B.jar'))
 store.save=save
 await applyModPlan(store,instance,plan,task)
 assert.equal((await readFile(path.join(dir,'mods/A.jar'))).toString(),'new')
 assert.equal((await readFile(path.join(dir,'mods/B.jar'))).toString(),'dep')
 assert.equal(instance.installed.length,2)
 await assert.rejects(applyModPlan(store,instance,plan,task),/改变/)
 rows=await identifyMods(await scanMods(store,instance))
 const removePlan=await planMods(store,instance,{snapshot:fingerprint(rows),versions:[],remove:['mods/A.jar','mods/B.jar']})
 await applyModPlan(store,instance,removePlan,task)
 assert.deepEqual(await readdir(path.join(dir,'mods')),['manual.jar'])
 assert.equal(instance.installed.length,0)
 console.log('PASS manual JAR metadata, hash identification, compatible updates, category filters, deferred plans, automatic dependencies, failed-download and failed-commit rollback, stale plans, removal backups')
}finally{global.fetch=actualFetch;await rm(root,{recursive:true,force:true})}
