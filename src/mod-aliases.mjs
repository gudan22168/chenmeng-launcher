import {ref} from 'vue'
const key='chenmeng.mod.aliases'
function read(){try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return {}}}
export const aliases=ref(read())
export function aliasKey(r){return r.projectId||r.project_id||r.title||r.name||r.path}
export function alias(r){return (aliases.value[aliasKey(r)]||Object.values(aliases.value).find(v=>(r.path&&v.path===r.path)||v.title===(r.title||r.name)))?.alias||''}
export function saveAlias(r,value){
 const name=String(value).trim().slice(0,80),id=aliasKey(r),next={...aliases.value}
 if(name)next[id]={alias:name,title:r.title||r.name||r.path,path:r.path||''};else delete next[id]
 localStorage.setItem(key,JSON.stringify(next));aliases.value=next
}
export function clearAliases(){localStorage.removeItem(key);aliases.value={}}
export function resolveAlias(query){return Object.values(aliases.value).find(r=>r.alias.toLowerCase()===query.trim().toLowerCase())?.title||query}
