import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { assertText, playerName, offlineUUID } from './util.mjs'

export const defaultSettings = {
  language: 'zh', surface: 'paper', background: '#F2F0E6', ink: '#130918', accent: '#FE4B5E',
  font: 'Bahnschrift', inputFont: 'JetBrains Mono', fontScale: 100,
  iconStyle: 'pencil', iconWeight: 1.6, customIcon: '',
  coverMode: 'auto', fixedCover: '', watercolor: 65, paperEdge: true,
  reducedMotion: false, downloadLimit: 0, concurrency: 4, closeOnLaunch: false, isolated: true, gameTitle: ""
}

export class Store {
  constructor(root) {
    this.root = root
    this.file = path.join(root, 'launcher.json')
    mkdirSync(root, { recursive: true })
    let saved
    try { saved = JSON.parse(readFileSync(this.file, 'utf8')) } catch (error) {
      if (existsSync(this.file)) throw new Error('配置文件无法读取，请保留 launcher.json 并检查内容。' + error.message)
    }
    this.data = saved || { settings: {}, instances: [], selectedId: '', account: { type: 'offline', name: 'Explorer', uuid: offlineUUID('Explorer') } }
    this.data.settings = { ...defaultSettings, ...this.data.settings }
    if (!saved) this.create({ name: '原野生存', version: '1.21.1', loader: 'vanilla' })
    this.save()
  }
  save() {
    writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2))
    renameSync(this.file + '.tmp', this.file)
  }
  instance(id) {
    if (typeof id !== 'string' || !/^[a-f\d-]{36}$/.test(id)) throw new Error('实例不存在 / Instance not found')
    const instance = this.data.instances.find(i => i.id === id)
    if (!instance) throw new Error('实例不存在 / Instance not found')
    return instance
  }
  directory(id) { return this.data.settings.isolated ? path.join(this.root, 'instances', this.instance(id).id) : path.join(this.root,'shared') }
  create(input) {
    const version = assertText(input.version)
    if (!/^[\w.+-]{1,80}$/.test(version)) throw new Error('版本无效 / Invalid version')
    const loader = input.loader || 'vanilla'
    if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) throw new Error('加载器无效 / Invalid loader')
    const instance = { id: randomUUID(), name: assertText(input.name), version, loader, loaderVersion: input.loaderVersion || '',
      memory: 4096, javaPath: '', status: 'new', versionId: '', createdAt: Date.now(), lastPlayed: null, playTime: 0,
      coverMode: 'inherit', cover: '', coverImage: '', installed: [] }
    this.data.instances.push(instance)
    this.data.selectedId = instance.id
    mkdirSync(this.directory(instance.id), { recursive: true })
    for (const folder of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots', 'config']) mkdirSync(path.join(this.directory(instance.id), folder), { recursive: true })
    this.save()
    return instance
  }
  update(id, changes) {
    const instance = this.instance(id)
    if (changes.name !== undefined) instance.name = assertText(changes.name)
    if (changes.memory !== undefined) {
      const memory = Number(changes.memory)
      if (!Number.isInteger(memory) || memory < 1024 || memory > Math.floor(os.totalmem() / 1048576) - 512) throw new Error('内存超出可分配范围 / Invalid memory allocation')
      instance.memory = memory
    }
    if (changes.javaPath !== undefined) instance.javaPath = String(changes.javaPath)
    if (changes.coverMode && ['inherit', 'auto', 'fixed', 'default'].includes(changes.coverMode)) instance.coverMode = changes.coverMode
    this.save()
    return instance
  }
  setSettings(changes) {
    const s = this.data.settings
    for (const key of ['background', 'ink', 'accent']) if (changes[key] !== undefined) {
      if (!/^#[a-f\d]{6}$/i.test(changes[key])) throw new Error('颜色无效 / Invalid color')
      s[key] = changes[key]
    }
    for (const [key, values] of Object.entries({ language: ['zh', 'en'], surface: ['paper', 'frosted', 'liquid'], iconStyle: ['pencil', 'clean', 'bold'], coverMode: ['auto', 'fixed', 'default'] })) {
      if (changes[key] !== undefined) { if (!values.includes(changes[key])) throw new Error('设置无效 / Invalid setting'); s[key] = changes[key] }
    }
    for (const [key, min, max] of [['watercolor', 0, 100], ['fontScale', 85, 115], ['iconWeight', 1, 3], ['downloadLimit', 0, 1024], ['concurrency', 1, 8]]) {
      if (changes[key] !== undefined) { const n = Number(changes[key]); if (!Number.isFinite(n) || n < min || n > max) throw new Error('设置值超出范围 / Setting out of range'); s[key] = n }
    }
    for (const key of ['paperEdge', 'reducedMotion', 'closeOnLaunch', 'isolated']) if (changes[key] !== undefined) s[key] = !!changes[key]
    if (changes.gameTitle !== undefined) s.gameTitle = String(changes.gameTitle).trim().slice(0,100)
    if (changes.isolated !== undefined) for (const instance of this.data.instances) for (const folder of ['mods','resourcepacks','shaderpacks','saves','screenshots','config']) mkdirSync(path.join(this.directory(instance.id),folder),{recursive:true})
    for (const key of ['font', 'inputFont']) if (changes[key] !== undefined) s[key] = assertText(changes[key], 100)
    this.save()
    return s
  }
  setAccount(name) {
    name = playerName(name)
    this.data.account = { name, type: 'offline', uuid: offlineUUID(name) }
    this.save()
    return this.data.account
  }
  snapshot() {
    const {credential,...visible}=this.data
    return { ...visible, system: { used: Math.round((os.totalmem()-os.freemem())/1048576), memory: Math.floor(os.totalmem() / 1048576), platform: process.platform, arch: process.arch, dataPath: this.root }, appVersion: '0.1.0' }
  }
}
