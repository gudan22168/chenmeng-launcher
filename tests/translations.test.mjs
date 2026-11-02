import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {PACK_NAME,validateTranslation,parseTranslation,batches,packMetadata,mergeEntries} from '../electron/translation-core.mjs'
import {readMergedPack,writeMergedPack} from '../electron/translations.mjs'
test('translation preserves placeholders and validates complete response',()=>{
  assert.equal(validateTranslation('Hello %s §A','你好 %s §A'),'你好 %s §A')
  assert.throws(()=>validateTranslation('%s %d','%d %s'))
  assert.throws(()=>validateTranslation('a\nb','ab'))
  assert.throws(()=>parseTranslation('{"0":"好","extra":"坏"}',[{id:'0',source:'Good'}]))
  assert.deepEqual(parseTranslation('{"0":"好"}',[{id:'0',source:'Good'}]),{'0':'好'})
  assert.equal(batches(Array.from({length:61},()=>({key:'key',source:'Hello'}))).length,3)
})
test('metadata uses installed client format',()=>{
  assert.equal(packMetadata({pack_version:{resource:15}}).pack.pack_format,15)
  assert.deepEqual(packMetadata({pack_version:{resource:84}}).pack.min_format,[84,0])
  assert.throws(()=>packMetadata({}))
})
test('two mods update exactly one pack with backup and stale-write protection',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'chenmeng-translations-'))
  try{
    const row=(namespace,value)=>({namespace,key:'hello',source:'Hello',value})
    const metadata=packMetadata({pack_version:{resource:84}})
    const first=mergeEntries({},[row('one','你好')],'zh_cn')
    await writeMergedPack(root,'',first,metadata)
    const old=await readMergedPack(root)
    const second=mergeEntries(old.files,[row('two','您好')],'zh_cn')
    await writeMergedPack(root,old.hash,second,metadata)
    const merged=await readMergedPack(root)
    assert.equal(merged.files['assets/one/lang/zh_cn.json'].hello,'你好')
    assert.equal(merged.files['assets/two/lang/zh_cn.json'].hello,'您好')
    assert.deepEqual(await fs.readdir(path.join(root,'resourcepacks')),[PACK_NAME])
    assert.ok((await fs.stat(path.join(root,'translation-backups',PACK_NAME+'.previous'))).size)
    await assert.rejects(writeMergedPack(root,old.hash,first,metadata),/已被修改/)
    await assert.rejects(writeMergedPack(root,merged.hash,{'assets/../lang/zh_cn.json':{}},metadata),/非法/)
    assert.throws(()=>mergeEntries(merged.files,[row('one','覆盖')],'zh_cn'),/冲突/)
    const multilingual=mergeEntries(merged.files,[row('one','こんにちは')],'ja_jp')
    assert.equal(Object.keys(multilingual).length,3)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
