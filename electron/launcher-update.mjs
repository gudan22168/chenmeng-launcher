import path from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {copyFile, link, unlink} from 'node:fs/promises'

const project = 'gudan22168/chenmeng-launcher'
const releaseRoot = 'https://github.com/' + project + '/releases/download/'
const stable = /^\d+\.\d+\.\d+$/

export function newer(candidate, current) {
  if (!stable.test(candidate) || !stable.test(current)) return false
  const parts = current.split('.').map(Number)
  for (const [i, n] of candidate.split('.').map(Number).entries()) {
    if (n !== parts[i]) return n > parts[i]
  }
  return false
}

async function checksum(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

export async function installVerified(source, directory, name, expected) {
  const destination = path.join(directory, name)
  const temp = path.join(directory, '.chenmeng-' + randomUUID() + '.tmp')
  try {
    await copyFile(source, temp)
    if (await checksum(temp) !== expected) throw Error('更新包校验失败，请重新下载官方便携版。')
    // Link the verified copy without overwriting another executable.
    try { await link(temp, destination) }
    catch (error) {
      if (error.code !== 'EEXIST' || await checksum(destination) !== expected) throw error
    }
    return destination
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}

export function registerUpdates({app, ipcMain, dialog, shell, win, busy}) {
  const current = app.getVersion()
  let latest, pending, installing = false
  async function check() {
    const res = await fetch('https://api.github.com/repos/' + project + '/releases/latest', {signal: AbortSignal.timeout(12000)})
    if (!res.ok) throw Error('暂时无法检查更新')
    const release = await res.json()
    const version = String(release.tag_name).replace(/^v/, '')
    if (!stable.test(version) || release.draft || release.prerelease) throw Error('发行信息无效')
    const name = 'ChenMeng-Launcher-' + version + '-portable.exe'
    if (newer(version, current)) {
      const prefix = releaseRoot + 'v' + version + '/'
      if (![name,'SHA256SUMS.txt'].every(file => release.assets?.some(a => a.name === file && a.browser_download_url === prefix + file))) throw Error('新版文件尚未就绪')
      const sums = await fetch(prefix + 'SHA256SUMS.txt', {signal: AbortSignal.timeout(12000)})
      if (!sums.ok) throw Error('暂时无法读取更新校验文件')
      const [digest, filename] = (await sums.text()).trim().split(/\s+/)
      if (!/^[a-f0-9]{64}$/i.test(digest) || filename !== name) throw Error('发行校验文件无效')
      latest = {version, name, digest: digest.toLowerCase(), download: prefix + name}
    } else latest = null
    return {current, available: latest?.version || ''}
  }
  ipcMain.handle('launcherUpdateCheck', () => pending ||= check().finally(() => { pending = null }))
  ipcMain.handle('launcherUpdateDownload', () => latest && shell.openExternal(latest.download))
  ipcMain.handle('launcherUpdateLocal', async () => {
    const directory = process.env.PORTABLE_EXECUTABLE_DIR
    if (!directory || !app.isPackaged) throw Error('请在 Windows 便携版中安装更新')
    if (!latest || installing || busy()) throw Error('请先检查版本，并等待当前任务结束')
    const release = latest
    installing = true
    try {
      const choice = await dialog.showOpenDialog(win, {title:'选择已下载的官方便携版', properties:['openFile'], filters:[{name:'Windows 便携版', extensions:['exe']}]})
      if (choice.canceled) return ''
      const file = await installVerified(choice.filePaths[0], directory, release.name, release.digest)
      const answer = await dialog.showMessageBox(win, {message:'新版已安装到启动器目录', detail:file, buttons:['稍后启动','关闭当前版本并打开新版'], defaultId:0, cancelId:0})
      if (answer.response === 1 && !busy()) {
        const error = await shell.openPath(file)
        if (error) throw Error(error)
        app.quit()
      }
      return file
    } finally { installing = false }
  })
}
