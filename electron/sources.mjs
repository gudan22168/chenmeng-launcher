import {requireHTTPS} from './util.mjs'
export const MIRROR='https://bmclapi2.bangbang93.com'
let preferences=()=>({}), transport=(...args)=>globalThis.fetch(...args)
const failures=new Map()
export function configureNetwork(options={}){if(options.settings)preferences=options.settings;if(options.fetch)transport=options.fetch;failures.clear()}
export function networkFetch(url,options){return transport(url,options)}
export function mirrorURL(value){
 const u=requireHTTPS(value),p=u.pathname+u.search
 if(['piston-meta.mojang.com','launchermeta.mojang.com','piston-data.mojang.com','launcher.mojang.com'].includes(u.hostname))return MIRROR+p
 if(u.hostname==='resources.download.minecraft.net')return MIRROR+'/assets'+p
 if(u.hostname==='libraries.minecraft.net')return MIRROR+'/maven'+p
 if(['maven.minecraftforge.net','files.minecraftforge.net'].includes(u.hostname))return MIRROR+'/maven'+p.replace(/^\/maven/,'')
 if(u.hostname==='maven.neoforged.net'&&u.pathname.startsWith('/api/'))return MIRROR+'/neoforge/meta'+p
 if(u.hostname==='maven.neoforged.net'&&u.pathname.startsWith('/releases/'))return MIRROR+'/maven'+p.slice('/releases'.length)
 if(u.hostname==='meta.fabricmc.net')return MIRROR+'/fabric-meta'+p
 if(u.hostname==='maven.fabricmc.net')return MIRROR+'/maven'+p
 return null
}
export function sourceURLs(url,settings=preferences()){
 requireHTTPS(url)
 const mirror=mirrorURL(url);if(!mirror)return [url]
 const mode=settings.downloadSource||'auto'
 let urls=mode==='official'?[url,mirror]:[mirror,url]
 if(settings.downloadFallback===false)return urls.slice(0,1)
 if(mode==='auto' && (failures.get(new URL(urls[0]).origin)||0)>Date.now())urls.reverse()
 return urls
}
export function sourceFailed(url){failures.set(new URL(url).origin,Date.now()+60000)}
export async function sourceText(url,signal,parse=x=>x){
 let last
 for(const candidate of sourceURLs(url)){
  signal?.throwIfAborted()
  let response
  try{
   response=await networkFetch(candidate,{headers:{'User-Agent':'ChenMengLauncher/0.1.0'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)})
   if(!response.ok)throw Error('HTTP '+response.status)
   return parse(await response.text())
  }catch(e){
   await response?.body?.cancel().catch(()=>{})
   if(signal?.aborted)throw e
   if(!response || response.status>=500)sourceFailed(candidate)
   last=Error(new URL(candidate).hostname+'：'+e.message)
  }
 }
 throw last
}
