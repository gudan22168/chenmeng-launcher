import { promises as fs } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { exists, hashFile, requireHTTPS } from './util.mjs'

export const USER_AGENT = 'ChenMengLauncher/0.1.0 (desktop Minecraft launcher)'
export async function getJSON(url, signal) {
  requireHTTPS(url)
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`请求失败 / Request failed: ${response.status} · ${new URL(url).hostname}`)
  return response.json()
}

export class Downloads {
  constructor(settings, emit) { this.settings = settings; this.emit = emit; this.jobs = []; this.nextSlot = 0; this.locks = new Set(); this.active = false }
  snapshot() { return this.jobs.map(({ controller, run, ...job }) => job) }
  publish() { this.emit('jobs', this.snapshot()) }
  add(name, run, instanceId = null) {
    if (instanceId && this.jobs.some(j => j.instanceId === instanceId && ['queued', 'running', 'paused', 'cancelling'].includes(j.status))) throw new Error('此实例已有任务，请先完成或取消 / This instance already has a task')
    const job = { id: randomUUID(), name, instanceId, status: 'queued', percent: 0, stage: '', transferred: 0, total: 0, speed: 0, createdAt: Date.now(), error: '', run }
    this.jobs.unshift(job)
    this.publish()
    this.pump()
    return job.id
  }
  async pump() {
    if (this.active) return
    this.active = true
    try {
      let job
      while ((job = this.jobs.find(j => j.status === 'queued'))) {
        job.controller = new AbortController()
        job.status = 'running'
        let last = 0, sampleTime = Date.now(), sampleBytes = job.transferred
        const context = {
          signal: job.controller.signal,
          progress: (percent, stage) => { job.percent = Math.max(0, Math.min(100, percent)); job.stage = stage; this.publish() },
          bytes: (n, total) => {
            job.transferred += n
            if (total) job.total = Math.max(job.total, total)
            const now = Date.now()
            if (now - last > 250) {
              job.speed = (job.transferred - sampleBytes) / Math.max(.01, (now - sampleTime) / 1000)
              if (now - sampleTime > 1500) { sampleTime = now; sampleBytes = job.transferred }
              last = now; this.publish()
            }
          },
          download: (url, destination, checks = {}) => this.file(url, destination, checks, context)
        }
        this.publish()
        try {
          await job.run(context)
          job.controller.signal.throwIfAborted()
          job.status = 'completed'; job.percent = 100
        } catch (error) {
          if (job.controller.signal.aborted) job.status = job.pauseRequested ? 'paused' : 'cancelled'
          else { job.status = 'failed'; job.error = error.message || String(error) }
        }
        job.pauseRequested = false
        job.speed = 0
        this.publish()
        this.emit('state-changed', null)
      }
    } finally { this.active = false }
  }
  control(id, action) {
    const job = this.jobs.find(j => j.id === id)
    if (!job) throw new Error('任务不存在 / Task not found')
    if (action === 'pause' && job.status === 'running') { job.pauseRequested = true; job.controller.abort(); job.status = 'cancelling' }
    if (action === 'pause' && job.status === 'queued') job.status = 'paused'
    if (action === 'resume' && ['paused', 'failed'].includes(job.status)) { job.status = 'queued'; job.error = '' }
    if (action === 'cancel' && ['running', 'cancelling'].includes(job.status)) { job.pauseRequested = false; job.controller.abort(); job.status = 'cancelling' }
    else if (action === 'cancel' && ['paused', 'queued', 'failed'].includes(job.status)) job.status = 'cancelled'
    this.publish(); this.pump()
  }
  async throttle(n, signal) {
    const limit = Number(this.settings().downloadLimit) * 1024 * 1024
    if (!limit) return
    const now = Date.now()
    const start = Math.max(now, this.nextSlot)
    this.nextSlot = start + n / limit * 1000
    if (start > now) await delay(start - now, null, { signal })
  }
  async file(url, destination, checks, context) {
    context.signal.throwIfAborted()
    requireHTTPS(url)
    if (await exists(destination)) {
      const stat = await fs.stat(destination)
      const algo = checks.sha512 ? 'sha512' : checks.sha256 ? 'sha256' : checks.sha1 ? 'sha1' : null
      if ((!checks.size || checks.size === stat.size) && (algo ? await hashFile(destination, algo) === checks[algo] : stat.size > 0)) return
    }
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const temporary = destination + '.' + randomUUID() + '.part'
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      let stream, timeout
      const idle = new AbortController()
      const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => idle.abort(new Error('下载连接超时 / Download timed out')), 90000) }
      try {
        context.signal.throwIfAborted()
        resetTimeout()
        const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.any([context.signal, idle.signal]) })
        if (!response.ok || !response.body) throw new Error(`下载失败 / Download failed: HTTP ${response.status}`)
        stream = createWriteStream(temporary)
        const streamError = new Promise((_, reject) => stream.once('error', reject))
        streamError.catch(() => {})
        const length = Number(response.headers.get('content-length')) || 0
        let received = 0
        for await (const chunk of response.body) {
          resetTimeout()
          await this.throttle(chunk.length, context.signal)
          context.signal.throwIfAborted()
          if (!stream.write(chunk)) await Promise.race([once(stream, 'drain'), streamError])
          received += chunk.length
          context.bytes(chunk.length, length)
        }
        const closed = once(stream, 'close')
        stream.end()
        await Promise.race([closed, streamError])
        stream = null
        if (checks.size && received !== checks.size) throw new Error('文件大小校验失败 / File size mismatch')
        for (const algo of ['sha1', 'sha256', 'sha512']) if (checks[algo] && await hashFile(temporary, algo) !== checks[algo]) throw new Error('文件哈希校验失败 / File checksum mismatch')
        await fs.rename(temporary, destination)
        clearTimeout(timeout)
        return
      } catch (error) {
        lastError = error
        if (stream) { stream.destroy(); await once(stream, 'close').catch(() => {}) }
        await fs.rm(temporary, { force: true })
        if (context.signal.aborted) throw error
        if (attempt < 2) await delay(500 * (attempt + 1), null, { signal: context.signal })
      } finally { clearTimeout(timeout) }
    }
    throw lastError
  }
}
