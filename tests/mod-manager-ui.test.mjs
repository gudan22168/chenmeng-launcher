import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {parse,compileScript} from '@vue/compiler-sfc'
import {Window} from 'happy-dom'
const dom=new Window({url:'http://localhost/'})
for(const k of ['window','document','navigator','HTMLElement','SVGElement','Element','Node','sessionStorage'])Object.defineProperty(globalThis,k,{value:k==='window'?dom:dom[k],configurable:true})
const calls=[]
let failPlan=true,failApply=true
window.launcher={
 modsList:async()=>({rows:[{projectId:'local',title:'Local Mod',localVersion:'1',latest:{id:'l2',number:'2'},updateAvailable:true,path:'mods/local.jar'}],snapshot:'test',warning:''}),
 contentVersions:async(...args)=>{structuredClone(args);return [{id:'v1',version_number:'1.0',version_type:'release'}]},
 modsPlan:async(id,input)=>{structuredClone(input);calls.push(['plan',input]);if(failPlan){failPlan=false;throw Error('[DEPENDENCY_UNRESOLVED] 缺少前置')}return {token:'token',changes:[{projectId:'remote',title:'Remote Mod',versionNumber:'1.0',action:'新增'},{projectId:'dep',title:'Required API',versionNumber:'2',action:'新增',automatic:true}],remove:[],warnings:[]}},
 modsApply:async()=>{calls.push(['apply']);if(failApply){failApply=false;throw Error('本地文件已变化，请重新检查')}return 'job'},modLink:async()=>{},modReveal:async()=>{}
}
const source=await readFile('src/ModManager.vue','utf8'),{descriptor}=parse(source)
const compiled=compileScript(descriptor,{id:'test-mod-manager',inlineTemplate:true})
const temporary=await mkdtemp(new URL('./.vue-test-',import.meta.url))
const compiledFile=temporary+'/compiled.mjs'
await writeFile(compiledFile,compiled.content)
try{
 const {createApp,nextTick}=await import('vue'),{default:Component}=await import(pathToFileURL(compiledFile).href)
 const root=document.createElement('div');document.body.append(root)
 const app=createApp(Component,{instance:{id:'test',version:'1.21.1',loader:'fabric'},filter:{version:'1.21.1',loader:'fabric'},hits:[{project_id:'remote',title:'Remote Mod'},{project_id:'local',title:'Local Mod'}],total:2,offset:0,busy:false})
 app.mount(root)
 const flush=async()=>{await new Promise(r=>setTimeout(r,0));await nextTick()}
 await flush()
 assert.equal(root.querySelectorAll('.mod-pane')[0].querySelectorAll('.mod-row').length,1,'local project is excluded online')
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
 button('选择版本').click();await flush()
 const sourceRow=root.querySelector('.mod-pane .mod-row')
 const dt={store:{},setData(k,v){this.store[k]=v},getData(k){return this.store[k]}}
 const drag=new dom.Event('dragstart',{bubbles:true,cancelable:true});drag.dataTransfer=dt;sourceRow.dispatchEvent(drag)
 const drop=new dom.Event('drop',{bubbles:true,cancelable:true});drop.dataTransfer=dt;root.querySelectorAll('.mod-pane')[1].dispatchEvent(drop);await flush()
 assert.equal(calls.length,0,'dragging must not download or apply')
 assert.equal(root.querySelectorAll('.mod-pane')[0].querySelectorAll('.mod-row').length,0)
 assert(root.querySelectorAll('.mod-pane')[1].textContent.includes('待新增'))
 button('检查并下载（1）').click();await flush()
 assert(document.querySelector('dialog').open,'checking opens visible confirmation dialog')
 assert(document.querySelector('dialog [role=alert]').textContent.includes('[DEPENDENCY_UNRESOLVED] 缺少前置'))
 assert.equal(calls.filter(c=>c[0]==='apply').length,0)
 assert(root.querySelector('.pending'),'failed checks preserve staged changes')
 button('忽略前置，生成仅下载所选模组的清单').click();await flush()
 assert.equal(calls.filter(c=>c[0]==='plan').at(-1)[1].dependencyMode,'selected-only')
 assert(root.querySelectorAll('.mod-pane')[1].textContent.includes('Required API'))
 assert.equal(calls.filter(c=>c[0]==='apply').length,0,'checking never downloads')
 assert(!button('确认下载并应用更改').disabled)
 button('确认下载并应用更改').click();await flush()
 assert(document.querySelector('dialog [role=alert]').textContent.includes('本地文件已变化'))
 assert(root.querySelector('.pending'),'failed apply preserves staged changes')
 button('重新检查').click();await flush()
 button('确认下载并应用更改').click();await flush()
 assert.equal(calls.filter(c=>c[0]==='apply').length,2)
 assert(!document.querySelector('dialog').open,'queued download closes confirmation')
 app.unmount()
 console.log('PASS Vue DOM: hide local projects, choose version, drag to staged list, dependency preview, visible check failure, retry, preserved draft on failed apply, explicit download only')
}finally{await rm(temporary,{recursive:true,force:true});dom.happyDOM.abort()}
