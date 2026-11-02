import test from 'node:test'
import assert from 'node:assert/strict'
import {configureNetwork} from '../electron/sources.mjs'
import {resolveContent} from '../electron/content.mjs'
test('explicit selected-only plan skips missing required dependencies but retains compatibility and hashes',async t=>{
  const calls=[]
  const version={id:'jei-v',project_id:'jei',game_versions:['26.1.2'],loaders:['fabric'],version_number:'29.53.0.115',files:[{filename:'jei.jar',hashes:{sha512:'a'.repeat(128)},size:10,url:'https://cdn.modrinth.com/jei.jar'}],dependencies:[{dependency_type:'required',project_id:'missing'}]}
  configureNetwork({settings:()=>({}),fetch:async url=>{
    calls.push(String(url))
    if(String(url).endsWith('/version/jei-v'))return Response.json(version)
    if(String(url).endsWith('/project/jei'))return Response.json({title:'JEI',project_type:'mod'})
    if(String(url).endsWith('/project/missing'))return Response.json({title:'Bundled API',project_type:'mod'})
    return Response.json([])
  }})
  t.after(()=>configureNetwork({settings:()=>({}),fetch:(...args)=>globalThis.fetch(...args)}))
  const instance={version:'26.1.2',loader:'fabric'}
  await assert.rejects(resolveContent(instance,'jei-v'),/\[DEPENDENCY_UNRESOLVED\].*Bundled API/)
  calls.length=0
  const result=await resolveContent(instance,['jei-v'],[],{dependencyMode:'selected-only'})
  assert.deepEqual(result.map(r=>r.versionId),['jei-v'])
  assert(!calls.some(c=>c.includes('missing')))
  await assert.rejects(resolveContent({...instance,loader:'neoforge'},['jei-v'],[],{dependencyMode:'selected-only'}),/没有匹配/)
  delete version.files[0].hashes.sha512
  await assert.rejects(resolveContent(instance,['jei-v'],[],{dependencyMode:'selected-only'}),/完整性校验/)
})
