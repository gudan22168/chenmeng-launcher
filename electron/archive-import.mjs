import {Worker} from 'node:worker_threads'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {downloadURL,safeTarget} from './content.mjs'

function work(data,{signal,progress=()=>{}}={}){
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted()
    const worker=new Worker(new URL('./archive-worker.mjs',import.meta.url),{workerData:data})
    let settled=false
    const finish=async(error,result)=>{
      if(settled)return
      settled=true;signal?.removeEventListener('abort',abort)
      await worker.terminate()
      error?reject(error):resolve(result)
    }
    const abort=()=>finish(signal.reason || Error('已取消导入'))
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    worker.on('message',m=>{if(m.error)finish(Error(m.error));else if('result' in m)finish(null,m.result);else progress(m.progress,m.stage)})
    worker.on('error',e=>finish(e))
    worker.on('exit',code=>{if(!settled)finish(Error('压缩包处理意外退出：'+code))})
  })
}
export function inspectArchive(file,options){
  if(typeof file!=='string'||!['.zip','.rar','.mrpack'].includes(path.extname(file).toLowerCase()))throw Error('请选择 .zip、.rar 或 .mrpack 整合包')
  return work({action:'inspect',file},options)
}
export function extractArchive(file,pack,target,options){return work({action:'extract',file,digest:pack.digest,target},options)}
export async function importArchive(store,file,pack,task,includeOptional=false){
  const stage=path.join(store.root,'imports',randomUUID()),previous=store.data.selectedId
  let instance
  await fs.mkdir(stage,{recursive:true})
  try{
    task.progress(0,'后台解压整合包')
    const files=pack.type==='mrpack'?pack.index.files.filter(f=>f.env?.client!=='unsupported' && (includeOptional || f.env?.client!=='optional')):[]
    for(let n=0;n<files.length;n++){
      task.signal.throwIfAborted()
      const file=files[n]
      task.progress(80+n/Math.max(1,files.length)*15,'下载整合包文件 '+(n+1)+' / '+files.length)
      let error
      for(const url of file.downloads){
        try{await task.download(downloadURL(url),await safeTarget(stage,file.path),{...file.hashes,size:file.fileSize});error=null;break}catch(e){error=e;task.signal.throwIfAborted()}
      }
      if(error)throw error
    }
    task.signal.throwIfAborted()
    await extractArchive(file,pack,stage,task)
    task.signal.throwIfAborted()
    instance=store.create({name:pack.name,version:pack.version,loader:pack.loader,loaderVersion:pack.loaderVersion,isolated:true})
    await fs.cp(stage,store.directory(instance.id),{recursive:true,force:true})
    task.signal.throwIfAborted()
    instance.packImported=true;instance.packFiles=files
    store.save()
    task.progress(100,'导入完成；首次启动时检查并补全游戏与加载器')
    return instance
  }catch(error){
    if(instance){
      const target=store.directory(instance.id),expected=path.resolve(store.root,'versions',instance.directoryName)
      if(path.resolve(target)!==expected || path.dirname(expected)!==path.resolve(store.root,'versions'))throw Error('导入目录校验失败，已停止清理')
      store.data.instances=store.data.instances.filter(i=>i.id!==instance.id)
      if(store.data.selectedId===instance.id)store.data.selectedId=previous
      store.save()
      await fs.rm(target,{recursive:true,force:true})
    }
    throw error
  }finally{
    if(path.dirname(path.resolve(stage))!==path.resolve(store.root,'imports'))throw Error('临时目录无效')
    await fs.rm(stage,{recursive:true,force:true})
  }
}
