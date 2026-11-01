import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f:]/.test(relative) || relative.includes('\\') || relative.startsWith('/')) throw new Error('不安全的文件路径 / Unsafe file path')
  if (relative.split('/').some(p => p === '..' || p === '.' || !p || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw new Error('不安全的文件路径 / Unsafe file path')
  const target = path.resolve(root, ...relative.split('/'))
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('路径超出实例目录 / Path escapes instance')
  return target
}

export async function hashFile(file, algorithm = 'sha1') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export const exists = async file => !!(await fs.stat(file).catch(() => null))
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'))
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(value, null, 2))
  await fs.rename(tmp, file)
}
export function offlineUUID(name) {
  const bytes = createHash('md5').update('OfflinePlayer:' + name).digest()
  bytes[6] = (bytes[6] & 15) | 48
  bytes[8] = (bytes[8] & 63) | 128
  return bytes.toString('hex')
}
export function playerName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('离线名称须为 3–16 位英文字母、数字或下划线 / Use 3–16 letters, digits or underscores')
  return name
}
export function assertText(value, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error('名称无效 / Invalid name')
  return value.trim()
}
export function requireHTTPS(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) throw new Error('仅允许公共 HTTPS 下载地址 / Public HTTPS URLs only')
  return url
}
export function javaMajor(meta) {
  if (meta.javaVersion?.majorVersion) return meta.javaVersion.majorVersion
  const [major, minor, patch = 0] = meta.id.split('.').map(Number)
  if (major === 1 && minor >= 20 && (minor > 20 || patch >= 5)) return 21
  if (major === 1 && minor >= 18) return 17
  if (major === 1 && minor === 17) return 16
  return 8
}
export function evaluateRules(rules, platform = process.platform, arch = process.arch, features = {}) {
  if (!rules?.length) return true
  const osName = { win32: 'windows', darwin: 'osx', linux: 'linux' }[platform]
  let allowed = false
  for (const rule of rules) {
    if (rule.os?.name && rule.os.name !== osName) continue
    if (rule.os?.arch && !(arch === 'ia32' ? ['x86','i386'] : arch === 'x64' ? ['amd64','x86_64','x64'] : [arch]).includes(rule.os.arch)) continue
    if (rule.os?.version && !new RegExp(rule.os.version).test(process.getSystemVersion?.() || '10.0')) continue
    if (rule.features && Object.entries(rule.features).some(([k, v]) => !!features[k] !== v)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}
export function mavenPath(name) {
  const [coordinates, extension = 'jar'] = name.split('@')
  const [group, artifact, version, classifier] = coordinates.split(':')
  if (!group || !artifact || !version) throw new Error('无效的 Maven 坐标 / Invalid Maven coordinate')
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? '-' + classifier : ''}.${extension}`
}
export async function mapLimit(items, limit, worker) {
  let cursor = 0
  let failure
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const i = cursor++
      try { await worker(items[i], i) } catch (error) { failure ||= error }
    }
  }))
  if (failure) throw failure
}

