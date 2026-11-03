import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Store} from '../electron/store.mjs'

test('legacy Microsoft login survives offline selection and restart until explicitly cleared', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'chenmeng-account-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const legacy = new Store(root)
  const profile = {type: 'microsoft', name: 'OnlineCat', uuid: '1234567890abcdef1234567890abcdef'}
  legacy.data.account = profile
  legacy.data.credential = 'encrypted-test-fixture'
  legacy.save()
  const migrated = new Store(root)
  migrated.setAccount('OfflineCat')
  const reopened = new Store(root)
  assert.equal(reopened.data.account.name, 'OfflineCat')
  assert.deepEqual(reopened.snapshot().savedMicrosoft, profile)
  assert.equal(reopened.data.credential, 'encrypted-test-fixture')
  assert.equal(reopened.snapshot().credential, undefined)
  reopened.clearMicrosoft()
  const cleared = new Store(root)
  assert.equal(cleared.data.account.name, 'OfflineCat')
  assert.equal(cleared.data.credential, undefined)
  assert.equal(cleared.data.savedMicrosoft, undefined)
})
