import test from 'node:test'
import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {redact,diagnose,compactLog} from '../electron/diagnostics-core.mjs'
import {collectDiagnostics,registerDiagnostics} from '../electron/diagnostics.mjs'

test('redact secrets while preserving mod versions and useful error evidence',()=>{
  const cleaned=redact('Authorization: Bearer private-key\n--accessToken abcdef\napi_key="sample-key"\nC:\\Users\\Alice\\game\nJEI 29.53.0.115\nserver: 192.168.1.1\nExplorer',['Explorer'])
  for(const secret of ['private-key','abcdef','sample-key','Alice','192.168.1.1','Explorer'])assert(!cleaned.includes(secret))
  assert(cleaned.includes('29.53.0.115'))
  assert(diagnose('UnsupportedClassVersionError: class file version 69').some(r=>r.id==='java-version'))
  assert(diagnose('java.lang.OutOfMemoryError').some(r=>r.id==='memory'))
  assert(diagnose('DuplicateModsFoundException').some(r=>r.id==='duplicate'))
  const compact=compactLog('progress\n'.repeat(1000)+'Caused by: Missing dependency\n'+'at loader.run\n'.repeat(30),1000)
  assert(compact.length<1100)
  assert(compact.includes('Caused by'))
})
test('collect bounded local logs, crash reports and context without credentials',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chenmeng-diag-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  await fs.mkdir(path.join(root,'logs'))
  await fs.mkdir(path.join(root,'crash-reports'))
  await fs.mkdir(path.join(root,'mods'))
  await fs.writeFile(path.join(root,'launcher.json'),'PRIVATE_ACCOUNT')
  await fs.writeFile(path.join(root,'ai-settings.json'),'PRIVATE_KEY')
  await fs.writeFile(path.join(root,'logs','latest.log'),'[CHAT] private conversation\nERROR OutOfMemoryError\n--accessToken top-secret\n')
  await fs.writeFile(path.join(root,'crash-reports','crash.txt'),'MixinApplyError\nCaused by: missing dependency')
  const instance={id:'id',version:'26.1.2',loader:'fabric',loaderVersion:'0.16',memory:4096}
  const store={root,instance:()=>instance,directory:()=>root,data:{account:{name:'Explorer',uuid:'secret-uuid'}}}
  const report=await collectDiagnostics(store,'id')
  assert(report.logs.some(l=>l.name==='crash-reports/crash.txt'))
  assert(report.summary.findings.some(r=>r.id==='memory'))
  assert(!report.report.includes('top-secret'))
  assert(!report.report.includes('private conversation'))
  assert(!JSON.stringify(report).includes('PRIVATE_ACCOUNT'))
  assert(!JSON.stringify(report).includes('PRIVATE_KEY'))
  assert(report.report.length<=64000)
})
test('AI sends only after confirmation, hides stored key and clears it when provider changes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chenmeng-ai-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const handlers=new Map(),calls=[]
  let confirm=false
  const originalFetch=globalThis.fetch
  t.after(()=>globalThis.fetch=originalFetch)
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({choices:[{message:{content:'Check Java'}}],data:[{id:'test-model'}]})}
  registerDiagnostics({store:{root,instance:()=>({}),directory:()=>root,data:{account:{}}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    dialog:{showMessageBox:async()=>({response:confirm?0:1})},shell:{},win:{},app:{},getStatus:()=>'',safeStorage:{
      isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('protected:'+s),decryptString:b=>b.toString().replace('protected:','')
    }})
  const invoke=(name,...args)=>handlers.get(name)(null,...args)
  const config=await invoke('aiSave',{baseURL:'https://example.com/v1',model:'test-model',key:'test-secret'})
  assert.equal(config.hasKey,true)
  assert(!JSON.stringify(await invoke('aiSettings')).includes('test-secret'))
  await invoke('diagnosticAnalyze','id','OutOfMemoryError','test-model')
  assert.equal(calls.length,0,'cancel must make no network request')
  confirm=true
  await invoke('diagnosticAnalyze','id','OutOfMemoryError','test-model')
  assert.equal(calls.length,1)
  assert.equal(calls[0].options.redirect,'error')
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-secret')
  assert(!calls[0].options.body.includes('test-secret'))
  const changed=await invoke('aiSave',{baseURL:'https://other.example/v1',model:'test-model',key:''})
  assert.equal(changed.hasKey,false,'do not forward previous key to a different provider')
  await assert.rejects(invoke('aiSave',{baseURL:'http://remote.example/v1',model:'test-model'}),/HTTPS/)
})


test('AI blank/reasoning-only/truncated results are not silent successes',async()=>{
 const {extractAIAnswer}=await import('../electron/ai-response.mjs')
 assert.throws(()=>extractAIAnswer({choices:[{message:{content:''},finish_reason:'stop'}]}),/空的分析正文/)
 assert.throws(()=>extractAIAnswer({choices:[{message:{content:null,reasoning_content:'private reasoning'},finish_reason:'length'}]}),/输出达到上限/)
 assert.throws(()=>extractAIAnswer({choices:[{message:{content:' ',reasoning_content:'private reasoning'},finish_reason:'stop'}]}),/没有最终分析正文/)
 assert.equal(extractAIAnswer({choices:[{message:{content:' Java mismatch '},finish_reason:'stop'}]}),'Java mismatch')
 assert.match(extractAIAnswer({choices:[{message:{content:'Partial'},finish_reason:'length'}]}),/被截断/)
})
