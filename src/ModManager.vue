<script setup>
import {ref,computed,onMounted,watch,nextTick} from 'vue'
const props=defineProps({instance:Object,filter:Object,hits:Array,total:Number,offset:Number,searching:Boolean,busy:Boolean})
const emit=defineEmits(['task','page'])
const api=window.launcher,rows=ref([]),snapshot=ref(''),loading=ref(false),error=ref(''),warning=ref(''),details=ref(null),options=ref({}),picked=ref({}),pending=ref([]),removed=ref([]),preview=ref(null),localQuery=ref(''),dragOver=ref(false),failedIcons=ref({})
const compact=ref(false)
try{compact.value=localStorage.getItem('chenmeng.mods.compact')==='true'}catch{}
watch(compact,value=>{try{localStorage.setItem('chenmeng.mods.compact',String(value))}catch{}})
const planDialog=ref(null),planError=ref('')
function closePlan(){planDialog.value?.close()}
const storageKey='chenmeng.mods.draft.'+props.instance.id
try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved){pending.value=saved.pending||[];removed.value=saved.removed||[]}}catch{}
watch([pending,removed],()=>{preview.value=null;sessionStorage.setItem(storageKey,JSON.stringify({pending:pending.value,removed:removed.value}))},{deep:true})
const existing=computed(()=>new Set([...rows.value.map(r=>r.projectId),...pending.value.map(r=>r.projectId),...(preview.value?.changes||[]).map(r=>r.projectId)].filter(Boolean)))
const online=computed(()=>(props.hits||[]).filter(h=>!existing.value.has(h.project_id)))
const draftRows=computed(()=>[...pending.value,...(preview.value?.changes||[]).filter(r=>r.automatic&&!pending.value.some(p=>p.projectId===r.projectId))].filter(p=>!rows.value.some(r=>r.projectId===p.projectId)))
const visibleRows=computed(()=>rows.value.filter(r=>(r.title+' '+r.path).toLowerCase().includes(localQuery.value.toLowerCase())))
const canAdd=computed(()=>props.instance.loader!=='vanilla' && props.filter.version===props.instance.version && props.filter.loader===props.instance.loader)
async function act(fn){if(loading.value)return;loading.value=true;error.value='';try{await fn()}catch(e){error.value=e.message}finally{loading.value=false}}
async function refresh(check=false){const data=await api.modsList(props.instance.id,check);rows.value=data.rows;snapshot.value=data.snapshot;warning.value=data.warning;preview.value=null}
async function loadVersions(hit){const id=hit.project_id||hit.projectId;const filter=JSON.stringify(props.filter);const list=await api.contentVersions(id,'mod',props.filter);if(filter!==JSON.stringify(props.filter))return;options.value[id]=list;picked.value[id]=list[0]?.id||''}
function stage(hit,id){
  if(!canAdd.value||props.busy||loading.value)return
  const projectId=hit.project_id||hit.projectId
  if(!id)return
  const v=options.value[projectId]?.find(v=>v.id===id)
  pending.value=[...pending.value.filter(r=>r.projectId!==projectId),{projectId,versionId:id,title:hit.title,versionNumber:v?.version_number||hit.latest?.number||id,icon_url:hit.icon_url}]
  removed.value=removed.value.filter(p=>!rows.value.some(r=>r.projectId===projectId&&r.path===p))
}
function drag(event,hit){const id=picked.value[hit.project_id];if(!id||!canAdd.value||props.busy){event.preventDefault();return}event.dataTransfer.setData('application/x-chenmeng-mod',JSON.stringify({projectId:hit.project_id,versionId:id}));event.dataTransfer.effectAllowed='copy'}
function drop(event){dragOver.value=false;try{const d=JSON.parse(event.dataTransfer.getData('application/x-chenmeng-mod'));const hit=online.value.find(h=>h.project_id===d.projectId);if(hit&&options.value[d.projectId]?.some(v=>v.id===d.versionId))stage(hit,d.versionId)}catch{}}
function remove(row){removed.value=removed.value.includes(row.path)?removed.value.filter(p=>p!==row.path):[...removed.value,row.path];pending.value=pending.value.filter(p=>p.projectId!==row.projectId)}
async function plan(){
  preview.value=null;planError.value=''
  await nextTick()
  if(!planDialog.value.open)planDialog.value.showModal()
  try{
    const result=await api.modsPlan(props.instance.id,{versions:pending.value.map(r=>r.versionId),remove:removed.value,snapshot:snapshot.value})
    if(!result?.token || !Array.isArray(result.changes) || !Array.isArray(result.remove))throw Error('检查结果无效，请重试')
    preview.value=result
  }catch(e){planError.value=e.message || String(e)}
}
async function apply(){
  if(!preview.value)return
  planError.value=''
  try{
    const id=await api.modsApply(props.instance.id,preview.value.token)
    if(!id)throw Error('未能创建下载任务，请重新检查')
    pending.value=[];removed.value=[];sessionStorage.removeItem(storageKey);closePlan();emit('task',id)
  }catch(e){planError.value=e.message || String(e);preview.value=null}
}
function icon(r){return r.icon_url&&!failedIcons.value[r.icon_url]}
watch(()=>JSON.stringify(props.filter),()=>{options.value={};picked.value={}})
onMounted(()=>act(()=>refresh()))
</script>
<template>
<section class="mod-manager" :class="{compact}">
<div class="manager-toolbar"><strong>模组工作台</strong><button :aria-pressed="compact" @click="compact=!compact">{{compact?'完整显示':'精简显示'}}</button><button :disabled="loading||busy" @click="act(()=>refresh())">扫描本地</button><button :disabled="loading||busy" @click="act(()=>refresh(true))">检查更新 / 前置</button><button :disabled="loading||busy||!snapshot" @click="act(plan)">检查更改 / 补齐前置</button></div>
<p class="hint">左侧选择版本后拖到右侧，或点击“加入”。编辑期间不下载；点击右侧底部“检查并下载”，确认清单后才执行。离开页面会保留本次会话的草稿。</p>
<p v-if="!canAdd" class="hint">当前筛选仅供浏览。添加模组需选择与实例相同的 {{instance.version}} / {{instance.loader}}；原版实例请先安装加载器。</p>
<p v-if="error" role="alert">{{error}}</p><p v-if="warning" role="status">{{warning}}</p><p v-if="loading">正在读取或检查…</p>
<div class="mod-columns">
<section class="mod-pane"><header><strong>网上模组</strong><small>已隐藏右侧已识别的项目</small></header><div class="mod-scroll">
<article v-for="hit in online" :key="hit.project_id" class="mod-row" :draggable="!!picked[hit.project_id]&&canAdd&&!busy&&!loading" @dragstart="drag($event,hit)">
<div class="mod-main"><span class="mod-icon"><img v-if="icon(hit)" :src="hit.icon_url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedIcons[hit.icon_url]=true"><span v-else>◇</span></span><button class="mod-title" @click="details=hit">{{hit.title}}</button></div><small v-if="!compact" class="description">{{hit.description}}</small>
<div class="row-actions"><button :disabled="loading" @click="act(()=>loadVersions(hit))">选择版本</button><select v-if="options[hit.project_id]" v-model="picked[hit.project_id]" :aria-label="hit.title+' 版本'"><option v-for="v in options[hit.project_id]" :key="v.id" :value="v.id">{{v.version_number}} · {{v.version_type}}</option></select><button :disabled="!canAdd||!picked[hit.project_id]||busy||loading" @click="stage(hit,picked[hit.project_id])">加入 →</button></div>
</article><p v-if="!online.length">{{searching?'正在搜索…':'本页没有未安装项目，可换页或调整筛选。'}}</p></div>
<footer><button :disabled="searching||!offset" @click="emit('page',-1)">上一页</button><small>{{total?offset+1:0}}–{{offset+(hits?.length||0)}} / {{total}}</small><button :disabled="searching||offset+(hits?.length||0)>=total" @click="emit('page',1)">下一页</button></footer></section>
<section class="mod-pane" :class="{dragover:dragOver}" @dragover.prevent="dragOver=true" @dragleave.self="dragOver=false" @drop.prevent="drop"><header><strong>本地模组 · {{rows.length}}</strong><input v-model="localQuery" placeholder="筛选本地" aria-label="筛选本地模组"></header><div class="mod-scroll">
<article v-for="item in draftRows" :key="item.projectId" class="mod-row pending"><strong>{{item.title}}</strong><small>待新增 · {{item.versionNumber}} {{item.automatic?'（必需前置）':''}}</small><button v-if="!item.automatic" :disabled="loading||busy" @click="pending=pending.filter(p=>p.projectId!==item.projectId)">撤销</button></article>
<article v-for="row in visibleRows" :key="row.path" class="mod-row" :class="{removing:removed.includes(row.path)}"><div class="mod-main"><span class="mod-icon"><img v-if="icon(row)" :src="row.icon_url" alt="" loading="lazy" @error="failedIcons[row.icon_url]=true"><span v-else>◇</span></span><button class="mod-title" @click="details=row">{{row.title}}</button></div>
<small>本地 {{row.localVersion||row.versionNumber||'未知版本'}}{{row.disabled?' · 已禁用':''}}</small><small v-if="row.latest">最新兼容正式版 {{row.latest.number}}{{row.updateAvailable?' · 可更新':''}}</small><small v-if="row.checkMessage">{{row.checkMessage}}</small><small v-if="row.missing?.length">缺少 {{row.missing.length}} 项前置，请点击“检查更改 / 补齐前置”</small><small v-if="!row.projectId">未识别 · 可查看本地信息与搜索相关网站</small>
<small v-if="pending.some(p=>p.projectId===row.projectId)" class="pending">待更新 → {{pending.find(p=>p.projectId===row.projectId).versionNumber}} <button @click="pending=pending.filter(p=>p.projectId!==row.projectId)" :disabled="loading||busy">撤销</button></small><small v-if="removed.includes(row.path)">待移除</small>
<div class="row-actions"><button @click="act(()=>api.modReveal(instance.id,row.path))">本地位置</button><button v-if="row.projectId&&!row.disabled" :disabled="loading||busy||!canAdd" @click="act(()=>loadVersions(row))">指定版本</button><select v-if="options[row.projectId]" v-model="picked[row.projectId]" :aria-label="row.title+' 本地目标版本'"><option v-for="v in options[row.projectId]" :key="v.id" :value="v.id">{{v.version_number}} · {{v.version_type}}</option></select><button v-if="options[row.projectId]" :disabled="loading||busy||!canAdd||!picked[row.projectId]" @click="stage(row,picked[row.projectId])">加入更改</button><button v-if="row.updateAvailable&&!row.disabled" :disabled="loading||busy||!canAdd" @click="stage(row,row.latest.id)">加入更新</button><button :disabled="loading||busy" @click="remove(row)">{{removed.includes(row.path)?'撤销移除':'移除'}}</button></div></article>
<p v-if="!rows.length&&!pending.length">将左侧模组拖到这里，编辑完成后统一应用。</p></div><footer><small>{{pending.length}} 项待添加 / 更新 · {{removed.length}} 项待移除</small><div class="row-actions"><button class="download-entry" :disabled="loading||busy||!snapshot" @click="act(plan)">检查并下载（{{pending.length+removed.length}}）</button><button :disabled="loading||busy" @click="pending=[];removed=[]">放弃编辑</button></div></footer></section>
</div>
<Teleport to="body"><dialog ref="planDialog" class="mod-confirm" aria-labelledby="mod-confirm-title" @cancel.prevent="!loading && closePlan()">
<h3 id="mod-confirm-title">确认模组更改</h3>
<p v-if="loading" role="status">{{preview?'正在创建下载任务…':'正在检查版本和必需前置，请稍候…'}}</p>
<p v-if="planError" role="alert" class="plan-error">{{planError}}</p>
<section v-if="preview" class="plan-panel"><p v-if="!preview.changes.length&&!preview.remove.length">没有需要应用的更改，已识别模组的必需前置齐全。</p><p v-for="r in preview.changes" :key="r.projectId">{{r.action}} · {{r.title}} {{r.from? r.from+' → ':''}}{{r.versionNumber||r.versionId}} <strong v-if="r.automatic">（前置补全）</strong></p><p v-for="p in preview.remove" :key="p">备份并移出 · {{p}}</p><p v-for="w in preview.warnings" :key="w">{{w}}</p><small>校验版本、加载器和已声明的依赖关系，不保证所有模组能共同运行。运行时冲突需结合日志手动排查。</small><button class="apply-button" :disabled="loading||busy||(!preview.changes.length&&!preview.remove.length)" @click="act(apply)">确认下载并应用更改</button></section>
<button v-if="planError" :disabled="loading||busy" @click="act(plan)">重新检查</button>
<button :disabled="loading" @click="closePlan">返回编辑</button>
</dialog></Teleport>
<section v-if="details" class="mod-detail"><button class="detail-close" @click="details=null">关闭信息</button><h3>{{details.title}}</h3><p>{{details.description||'没有提供简介'}}</p><p v-if="details.path">文件：{{details.path}} · {{Math.ceil(details.size/1024)}} KiB</p><p v-if="details.gameVersions">适用版本：{{details.gameVersions.join(', ')}} · {{details.loaders?.join(', ')}}</p><p v-if="details.declaredDependencies?.length">文件声明的前置：{{details.declaredDependencies.join('；')}}</p><div class="row-actions"><button v-if="details.projectId||details.project_id" @click="act(()=>api.modLink('modrinth',details.title,details.projectId||details.project_id))">Modrinth 项目 ↗</button><button @click="act(()=>api.modLink('curseforge',details.title))">CurseForge 搜索 ↗</button><button @click="act(()=>api.modLink('mcmod',details.title))">MC 百科搜索 ↗</button></div><small>跨站未确认同一项目时使用名称搜索，不猜测项目地址。</small></section>
</section>
</template>
<style scoped>
.mod-manager{margin-top:20px}.manager-toolbar,.row-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.manager-toolbar strong{margin-right:auto}.mod-manager button,.mod-manager input,.mod-manager select{font-size:12px;padding:6px 8px;margin:0;min-width:0}.hint,.mod-manager small{font-size:12px;line-height:1.6;color:#786c61}.mod-manager small{display:block}.mod-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mod-pane{min-width:0;border:1px solid #b5a58c;border-radius:8px;background:#fff5;overflow:hidden}.mod-pane header,.mod-pane footer{padding:10px;display:flex;gap:8px;align-items:center;justify-content:space-between;background:#e7dfd04d}.mod-pane header input{width:42%}.mod-scroll{height:440px;overflow:auto;padding:0 10px}.mod-row{padding:10px 0;border-bottom:1px dotted #b6a891}.mod-main{display:flex;align-items:center;gap:8px}.mod-icon{width:32px;height:32px;flex-shrink:0;background:#e5ddce;display:grid;place-items:center;border-radius:6px;overflow:hidden}.mod-icon img{width:100%;height:100%;object-fit:contain}.mod-title{text-align:left;border:0;background:none;font-weight:700;overflow-wrap:anywhere}.description{display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:5px 0}.row-actions{margin-top:7px}.row-actions select{max-width:100%;flex:1}.pending{background:#b7cfad33}.removing{opacity:.6}.dragover{outline:2px dashed #8e654e;background:#e2cfaf55}.plan-panel,.mod-detail{margin-top:14px;padding:16px;border:1px dashed #a89986;border-radius:8px}.plan-panel p{font-size:13px}.apply-button{margin-top:12px!important;background:#eed2be}.detail-close{float:right}@media(max-width:760px){.mod-columns{grid-template-columns:1fr}.mod-scroll{height:320px}} 
.mod-pane header{-webkit-app-region:no-drag}.mod-pane footer{margin:0;letter-spacing:normal}.mod-manager .mod-detail{overflow-wrap:anywhere}
.compact .mod-row{padding:5px 0}.compact .row-actions{margin-top:2px}.compact .mod-icon{width:24px;height:24px}.compact .row-actions button{padding:4px 7px}
.download-entry{background:#eed2be;font-weight:800}.mod-pane footer{flex-wrap:wrap}
.mod-confirm{color:#130918;background:#f2f0e6;border:1px solid #a89986;border-radius:10px;width:min(620px,90vw);max-height:80vh;overflow:auto;padding:24px}
.mod-confirm::backdrop{background:#241c1966}.mod-confirm button{margin:8px 8px 0 0;font-size:14px}.mod-confirm .plan-panel{border:0;padding:0}.plan-error{color:#a12828;white-space:pre-wrap;overflow-wrap:anywhere}
</style>
