import path from 'node:path'
import {promises as fs} from 'node:fs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {MinecraftFolder,Version,generateArguments} from '@xmcl/core'
import {createModernForgeInstallWorkflow,createFabricInstallWorkflow,createNodeInstallRuntime,executeInstallWorkflow,resolveLibraryInstallFiles} from '@xmcl/installer'
import {getJSON,USER_AGENT} from './downloads.mjs'
import {inside,javaMajor,hashFile} from './util.mjs'
import {checkJava,detectJava} from './vanilla.mjs'

export async function loaderVersions(game,loader){
  if(loader==='vanilla')return []
  if(loader==='fabric'){
    const items=await getJSON('https://meta.fabricmc.net/v2/versions/loader/'+encodeURIComponent(game))
    return items.map(v=>v.loader.version)
  }
  if(!['forge','neoforge'].includes(loader))throw Error('不支持的加载器')
  const base=loader==='forge'?'https://maven.minecraftforge.net/net/minecraftforge/forge/':'https://maven.neoforged.net/releases/net/neoforged/neoforge/'
  const response=await fetch(base+'maven-metadata.xml',{headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(30000)}).catch(()=>{throw Error('无法连接 '+loader+' 官方版本源，请检查网络后重试')})
  if(!response.ok)throw Error('无法读取加载器版本列表')
  let versions=[...(await response.text()).matchAll(/<version>([^<]+)<\/version>/g)].map(m=>m[1])
  if(loader==='forge')versions=versions.filter(v=>v.startsWith(game+'-')).map(v=>v.slice(game.length+1))
  else{
    const [,minor,patch='0']=game.split('.')
    if(!game.startsWith('1.'))return []
    versions=versions.filter(v=>v.startsWith(minor+'.'+patch+'.'))
  }
  return versions.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))
}
export async function prepareLoader(store,instance,base,task,account,natives){
  const root=path.resolve(store.root,'runtime'),mc=MinecraftFolder.from(root)
  const baseDir=inside(root,'versions/'+instance.version)
  await fs.copyFile(path.join(baseDir,'version.json'),path.join(baseDir,instance.version+'.json'))
  await fs.copyFile(path.join(baseDir,'client.jar'),path.join(baseDir,instance.version+'.jar'))
  const major=javaMajor(base)
  const java=await checkJava(instance.javaPath || 'java',major) ? (instance.javaPath || 'java') : await detectJava(major)
  if(!java && instance.loader!=='fabric')throw Error('安装 '+instance.loader+' 需要 Java '+major+'，请在设置中选择兼容 Java 后重试')
  if(java)instance.javaPath=java
  if(!instance.loaderVersion){
    instance.loaderVersion=(await loaderVersions(instance.version,instance.loader))[0]
    if(!instance.loaderVersion)throw Error('该游戏版本没有可用加载器')
    store.save()
  }
  async function download(files){
    for(let n=0;n<files.length;n++){
      const f=files[n],checksum=f.checksum
      if(checksum && await hashFile(f.path,checksum.algorithm).catch(()=>null)===checksum.value)continue
      if(!checksum && await fs.stat(f.path).catch(()=>null))continue
      let last
      for(const url of f.urls){
        try{
          await task.download(url,f.path,{size:f.size>0?f.size:undefined,...(checksum?{[checksum.algorithm]:checksum.value}:{})})
          last=null;break
        }catch(e){last=e}
      }
      if(last || !f.urls.length)throw last || Error('缺少加载器依赖 '+f.path)
      task.progress(90,'加载器依赖 '+(n+1)+' / '+files.length)
    }
  }
  const runtime=createNodeInstallRuntime({
    signal:task.signal,download,
    runJava:async command=>{
      task.progress(95,'处理 '+instance.loader+' 安装文件，请稍候')
      await promisify(execFile)(command.executable,command.args,{cwd:command.cwd,env:{...process.env,...command.env},windowsHide:true,timeout:600000,maxBuffer:16*1024*1024,signal:task.signal})
    }
  })
  let workflow
  if(instance.loader==='fabric'){
    workflow=createFabricInstallWorkflow({minecraft:mc,minecraftVersion:instance.version,version:instance.loaderVersion,side:'client'})
  }else{
    const forge=instance.loader==='forge'
    const artifact=forge?instance.version+'-'+instance.loaderVersion:instance.loaderVersion
    const relative=(forge?'net/minecraftforge/forge/':'net/neoforged/neoforge/')+artifact+'/'+(forge?'forge':'neoforge')+'-'+artifact+'-installer.jar'
    const url=(forge?'https://maven.minecraftforge.net/':'https://maven.neoforged.net/releases/')+relative
    const response=await fetch(url+'.sha1',{signal:AbortSignal.timeout(30000)})
    const sha=(await response.text()).trim().split(/\s/)[0]
    if(!response.ok || !/^[a-f0-9]{40}$/i.test(sha))throw Error('无法校验加载器安装器')
    workflow=createModernForgeInstallWorkflow({
      id:instance.loader+'-'+artifact,minecraft:mc,minecraftVersion:instance.version,artifactVersion:artifact,
      installer:{path:inside(root,'libraries/'+relative),urls:[url],checksum:{algorithm:'sha1',value:sha}},
      java,installOptions:{java,side:'client'},side:'client'
    })
  }
  const result=await executeInstallWorkflow(workflow,runtime,{signal:task.signal,onEvent:event=>{
    if(event.type==='task-start')task.progress(90,'安装 '+instance.loader+' · '+event.task.type)
  }})
  const versionId=typeof result==='string'?result:result.version
  const resolved=await Version.parse(root,versionId)
  await download(resolveLibraryInstallFiles(resolved.libraries,mc))
  const args=await generateArguments({
    version:resolved,gamePath:store.directory(instance.id),resourcePath:root,javaPath:java || 'java',
    gameProfile:{name:account.name,id:account.uuid},accessToken:account.accessToken || '0',
    userType:account.type==='microsoft'?'msa':'legacy',maxMemory:instance.memory,
    nativeRoot:natives,extraJVMArgs:[],launcherName:'chenmeng'
  })
  for(let n=0;n<args.length;n++){
    if(args[n]==='--clientId')args[n+1]=account.clientId || '0'
    if(args[n]==='--xuid')args[n+1]=account.xuid || '0'
  }
  instance.versionId=versionId
  instance.status='installed'
  store.save()
  return {major,cwd:store.directory(instance.id),args}
}
