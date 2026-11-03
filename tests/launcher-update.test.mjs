import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {installVerified, newer} from '../electron/launcher-update.mjs'

test('only offer newer stable releases', () => {
  assert.ok(newer('1.10.0','1.9.9'))
  for (const v of ['1.9.9','1.8.0','1.10.0-beta.1']) assert.equal(newer(v,'1.9.9'), false)
})
test('reject mismatched packages and preserve existing files', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'cm-update-'))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const source = path.join(dir,'download.exe'), name = 'new.exe'
  await writeFile(source,'fixture')
  const hash = createHash('sha256').update('fixture').digest('hex')
  await assert.rejects(installVerified(source,dir,name,'0'.repeat(64)),/校验失败/)
  const dest = await installVerified(source,dir,name,hash)
  assert.equal(await readFile(dest,'utf8'),'fixture')
  await writeFile(dest,'unrelated')
  await assert.rejects(installVerified(source,dir,name,hash))
  assert.equal(await readFile(dest,'utf8'),'unrelated')
})
