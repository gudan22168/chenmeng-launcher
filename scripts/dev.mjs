import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import electron from 'electron'
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
let desktop
for (let i = 0; i < 100; i++) {
  try { await fetch('http://127.0.0.1:5173'); break } catch { await new Promise(r => setTimeout(r, 150)) }
}
desktop = spawn(electron, ['.'], {
  stdio: 'inherit', env: { ...process.env, CHENMENG_DEV_URL: 'http://127.0.0.1:5173', CHENMENG_DATA_DIR: resolve('.dev-data') }
})
const stop = () => { desktop?.kill(); vite.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
desktop.on('close', () => { vite.kill(); process.exit() })
