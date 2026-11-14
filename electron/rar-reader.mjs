// RAR is loaded only by the archive worker, never during application startup.
import {createRequire} from 'node:module'
import {promises as fs} from 'node:fs'
const require=createRequire(import.meta.url)

export function rarError(error){
  if(['ERAR_MISSING_PASSWORD','ERAR_BAD_PASSWORD'].includes(error.reason))return Error('暂不支持加密 RAR，请先解密后重新打包导入')
  if(error.reason==='ERAR_NO_MEMORY')return Error('RAR 解压内存不足，请缩小整合包后重试')
  if(error.reason)return Error('RAR 文件损坏或使用了不支持的压缩方式，请重新打包后导入（'+error.reason+'）')
  return error
}
export async function openRar(bytes){
  const {createExtractorFromData}=await import('node-unrar-js')
  // Explicit bytes work both in development and inside Electron's app.asar.
  const wasmBinary=await fs.readFile(require.resolve('node-unrar-js/dist/js/unrar.wasm'))
  const extractor=await createExtractorFromData({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),wasmBinary})
  const list=extractor.getFileList()
  if(list.arcHeader.flags.volume)throw Error('暂不支持分卷 RAR，请合并为单个压缩包后导入')
  if(list.arcHeader.flags.headerEncrypted)throw Error('暂不支持加密 RAR，请先解密后重新打包导入')
  const entries=[],byOriginal=new Map(),metadata=new Map()
  for(const h of list.fileHeaders){
    if(entries.length>=100000)throw Error('压缩包文件数量超过限制')
    if(h.flags.encrypted)throw Error('暂不支持加密 RAR，请先解密后重新打包导入')
    const entry={entryName:h.name.replace(/\\/g,'/'),originalName:h.name,isDirectory:h.flags.directory,header:{size:h.unpSize},attr:0,
      getData(){const data=metadata.get(h.name);if(!data)throw Error('RAR 配置未读取');return data}}
    entries.push(entry);byOriginal.set(h.name,entry)
  }
  function* extract(selected){
    const wanted=new Set(selected.map(e=>e.originalName))
    // Iterate to the end so the component closes its native archive handle.
    for(const item of extractor.extract({files:h=>wanted.has(h.name)}).files){
      const entry=byOriginal.get(item.fileHeader.name),data=item.extraction
      // Only write plain bytes ourselves; never give the extractor a disk destination.
      if(!entry || !data || data.length!==entry.header.size)throw Error('RAR 含不支持的链接或文件长度不一致')
      yield {entry,data:Buffer.from(data)}
    }
  }
  return {getEntries:()=>entries,getEntry:name=>entries.find(e=>e.entryName===name),extract,
    loadMetadata(selected){for(const {entry,data} of extract(selected))metadata.set(entry.originalName,data)}}
}
