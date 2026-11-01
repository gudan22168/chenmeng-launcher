import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {parse,compileScript} from '@vue/compiler-sfc'
import {Window} from 'happy-dom'
const dom=new Window({url:'http://localhost/'})
for(const k of ['window','document','navigator','HTMLElement','SVGElement','Element','Node','sessionStorage'])Object.defineProperty(globalThis,k,{value:k==='window'?dom:dom[k],configurable:true})
const calls=[]
window.launcher={
 modsList:async()=>({rows:[{projectId:'local',title:'Local Mod',localVersion:'1',latest:{id:'l2',number:'2'},updateAvailable:true,path:'mods/local.jar'}],snapshot:'test',warning:''}),
 contentVersions:async()=>[{id:'v1',version_number:'1.0',version_type:'release'}],
 modsPlan:async(id,input)=>{calls.push(['plan',input]);return {token:'token',changes:[{projectId:'remote',title:'Remote Mod',versionNumber:'1.0',action:'新增'},{projectId:'dep',title:'Required API',versionNumber:'2',action:'新增',automatic:true}],remove:[],warnings:[]}},
 modsApply:async()=>{calls.push(['apply']);return 'job'},modLink:async()=>{},modReveal:async()=>{}
}
const source=await readFile('src/ModManager.vue','utf8'),{descriptor}=parse(source)
const compiled=compileScript(descriptor,{id:'test-mod-manager',inlineTemplate:true})
const temporary=await mkdtemp(new URL('./.vue-test-',import.meta.url))
const compiledFile=temporary+'/compiled.mjs'
await writeFile(compiledFile,compiled.content)
try{
 const {createApp,nextTick}=await import('vue'),{default:Component}=await import(compiledFile)
 const root=document.createElement('div');document.body.append(root)
 const app=createApp(Component,{instance:{id:'test',version:'1.21.1',loader:'fabric'},filter:{version:'1.21.1',loader:'fabric'},hits:[{project_id:'remote',title:'Remote Mod'},{project_id:'local',title:'Local Mod'}],total:2,offset:0,busy:false})
 app.mount(root)
 const flush=async()=>{await new Promise(r=>setTimeout(r,0));await nextTick()}
 await flush()
 assert.equal(root.querySelectorAll('.mod-pane')[0].querySelectorAll('.mod-row').length,1,'local project is excluded online')
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text)
 button('选择版本').click();await flush()
 const sourceRow=root.querySelector('.mod-pane .mod-row')
 const dt={store:{},setData(k,v){this.store[k]=v},getData(k){return this.store[k]}}
 const drag=new dom.Event('dragstart',{bubbles:true,cancelable:true});drag.dataTransfer=dt;sourceRow.dispatchEvent(drag)
 const drop=new dom.Event('drop',{bubbles:true,cancelable:true});drop.dataTransfer=dt;root.querySelectorAll('.mod-pane')[1].dispatchEvent(drop);await flush()
 assert.equal(calls.length,0,'dragging must not download or apply')
 assert.equal(root.querySelectorAll('.mod-pane')[0].querySelectorAll('.mod-row').length,0)
 assert(root.querySelectorAll('.mod-pane')[1].textContent.includes('待新增'))
 button('检查更改 / 补齐前置').click();await flush()
 assert.equal(calls.length,1);assert.equal(calls[0][0],'plan')
 assert(root.querySelectorAll('.mod-pane')[1].textContent.includes('Required API'))
 assert.equal(calls.filter(c=>c[0]==='apply').length,0)
 button('应用更改并下载').click();await flush()
 assert.equal(calls.filter(c=>c[0]==='apply').length,1)
 app.unmount()
 console.log('PASS Vue DOM: hide local projects, choose version, drag to staged list, dependency preview, explicit apply only')
}finally{await rm(temporary,{recursive:true,force:true});dom.happyDOM.abort()}
