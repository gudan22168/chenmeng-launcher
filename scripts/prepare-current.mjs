import path from 'node:path'
import { Downloads } from '../electron/downloads.mjs'
import { prepare } from '../electron/vanilla.mjs'
import { Store } from '../electron/store.mjs'

const store = new Store(path.resolve('.dev-data'))
if(store.data.account.type==='microsoft') throw Error('正版账号请从尘梦启动器首页启动')
const instance = store.instance(store.data.selectedId)
const downloads = new Downloads(() => store.data.settings, () => {})
const signal = new AbortController().signal
const plan = await prepare(store, instance, {
  signal,
  download: (url, file, checks) => downloads.file(url, file, checks, { signal, bytes() {} }),
  progress: (percent, message) => { if (percent === 100) console.error(message) }
})
const java = instance.javaPath || (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java')
console.log(JSON.stringify({ ...plan, java }))
