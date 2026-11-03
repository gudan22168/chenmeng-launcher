<script setup>
import {ref,onMounted,computed} from 'vue'
import ModManager from './ModManager.vue'
import LanguagePack from './LanguagePack.vue'
import {resolveAlias} from './mod-aliases.mjs'
const translatorOpen=ref(false)
const props=defineProps({instance:Object,busy:Boolean})
const emit=defineEmits(['task'])
const api=window.launcher,query=ref(''),type=ref('mod'),hits=ref([]),total=ref(0),offset=ref(0),loading=ref(false),error=ref(''),records=ref([]),choices=ref([]),selected=ref(''),project=ref(null)
const gameVersion=ref(props.instance.version),loaderFilter=ref(props.instance.loader),category=ref(''),filterData=ref({categories:[],versions:[]}),filterWarning=ref('')
const browseFilter=computed(()=>({version:gameVersion.value,loader:loaderFilter.value}))
const matchingInstance=computed(()=>gameVersion.value===props.instance.version && loaderFilter.value===props.instance.loader)
const categoryNames={adventure:'冒险',decoration:'装饰',equipment:'装备',food:'食物',library:'前置 / 类库',magic:'魔法',management:'管理',minigame:'小游戏',mobs:'生物',optimization:'优化',social:'社交',storage:'仓储',technology:'科技',transportation:'交通',utility:'实用',worldgen:'世界生成',combat:'战斗',economy:'经济',quests:'任务',kitchen_sink:'综合',lightweight:'轻量',multiplayer:'多人',realistic:'写实',simplistic:'简约',themed:'主题',gui:'界面'}
const availableCategories=computed(()=>filterData.value.categories.filter(c=>c.type===type.value))
async function filters(){try{filterData.value=await api.contentFilters();filterWarning.value=''}catch{filterWarning.value='分类列表读取失败，可重试；版本仍可手动输入。'}}
async function page(delta){offset.value=Math.max(0,offset.value+delta*20);await search(false)}
const failedIcons=ref({})
function icon(item){return item.icon_url && !failedIcons.value[item.icon_url] ? item.icon_url : ''}
const exportOpen=ref(false),selection=ref(['mods','resourcepacks','shaderpacks','config','options.txt'])
const categories={mods:'模组',resourcepacks:'资源包',shaderpacks:'光影包',config:'配置', 'options.txt':'游戏选项',saves:'存档',screenshots:'截图'}
async function act(fn){
  if(loading.value)return
  loading.value=true;error.value=''
  try{await fn()}catch(e){error.value=e.message}finally{loading.value=false}
}
async function search(reset=true){
  if(reset)offset.value=0
  project.value=null;choices.value=[];hits.value=[];total.value=0
  const result=await api.contentSearch({query:type.value==='mod'?resolveAlias(query.value):query.value,type:type.value,offset:offset.value,...browseFilter.value,category:category.value})
  hits.value=result.hits;total.value=result.total_hits
}
async function choose(hit){
  project.value=hit
  choices.value=await api.contentVersions(hit.project_id,hit.project_type,browseFilter.value)
  selected.value=choices.value[0]?.id || ''
}
async function install(){
  if(type.value==='mod' && props.instance.loader==='vanilla')throw Error('请先创建对应加载器实例，再安装模组')
  const id=type.value==='modpack'?await api.packDownload(selected.value):await api.contentInstall(selected.value)
  emit('task',id)
}
onMounted(filters)
onMounted(()=>act(async()=>{records.value=await api.contentInstalled();await search()}))
</script>
<template>
<main class="content-page"><small>MODRINTH / CONTENT</small><h2>内容工坊</h2>
<p>{{instance.name}} · Minecraft {{instance.version}} · {{instance.loader}} {{instance.loaderVersion}}</p>
<form class="content-search" @submit.prevent="act(()=>search())"><select v-model="type" :disabled="loading" @change="category='';act(()=>search())"><option value="mod">模组</option><option value="resourcepack">资源包</option><option value="shader">光影包</option><option value="modpack">整合包</option></select><input v-model="query" placeholder="搜索 Modrinth" aria-label="搜索内容"><button :disabled="loading">搜索</button><button type="button" :disabled="!query.trim()" title="打开 MC 百科搜索当前关键词，查找英文名称后返回搜索" @click="act(()=>api.modLink('mcmod',query,''))">MC百科 ↗</button></form>
<div class="content-search filters"><label>游戏版本 <input v-model.trim="gameVersion" :disabled="loading" list="content-game-versions" aria-label="筛选游戏版本" @change="act(()=>search())"><datalist id="content-game-versions"><option v-for="v in filterData.versions" :key="v" :value="v"/></datalist></label><label>加载器 <select v-model="loaderFilter" :disabled="loading" @change="act(()=>search())"><option value="vanilla">不限（浏览）</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label><label>分类 <select v-model="category" :disabled="loading" @change="act(()=>search())"><option value="">全部分类</option><option v-for="c in availableCategories" :key="c.name" :value="c.name">{{categoryNames[c.name]||c.name}}</option></select></label><button :disabled="loading" @click="gameVersion=instance.version;loaderFilter=instance.loader;category='';act(()=>search())">匹配当前实例</button></div><small v-if="filterWarning">{{filterWarning}} <button @click="filters">重试</button></small><small v-if="!matchingInstance">正在浏览其他版本或加载器，安装前请切回当前实例条件。</small>
<p v-if="instance.loader==='vanilla' && ['mod','modpack'].includes(type)">当前为原版实例，可浏览各加载器的内容。安装模组请先创建对应加载器实例；导入整合包会按包内配置创建独立实例。</p>
<div v-if="type==='modpack'" class="content-actions"><button :disabled="loading || busy" @click="act(async()=>emit('task',await api.packImport()))">导入 .mrpack</button><button :disabled="busy" @click="exportOpen=!exportOpen">导出整合包</button></div>
<section v-if="exportOpen && type==='modpack'" class="export-panel"><strong>选择导出内容</strong><label v-for="(label,key) in categories" :key="key"><input type="checkbox" :value="key" v-model="selection">{{label}}</label><small>本地文件会随包导出，分享前请确认所选存档、截图和配置适合公开。导出上限 1 GiB。</small><button :disabled="loading || busy || !selection.length" @click="act(async()=>emit('task',await api.packExport([...selection])))">选择位置并导出</button></section>
<p v-if="error" role="alert">{{error}}</p><p v-if="loading">正在读取，请稍候…</p>
<button v-if="type==='mod' && translatorOpen" @click="translatorOpen=false">返回模组管理</button>
<LanguagePack v-if="type==='mod' && translatorOpen" :key="instance.id" :instance="instance" :busy="busy"/>
<ModManager v-show="type==='mod' && !translatorOpen" :instance="instance" :filter="browseFilter" :hits="type==='mod'?hits:[]" :total="total" :offset="offset" :searching="loading" :busy="busy" @task="emit('task',$event)" @page="act(()=>page($event))" @translate="translatorOpen=true"/>
<div v-if="type!=='mod'">
<section v-if="project" class="export-panel"><div class="project-heading"><span class="content-icon"><img v-if="icon(project)" :src="icon(project)" alt="" referrerpolicy="no-referrer" @error="failedIcons[project.icon_url]=true"><span v-else aria-hidden="true">◇</span></span><strong>{{project.title}}</strong></div><select v-model="selected" aria-label="内容版本"><option v-for="v in choices" :key="v.id" :value="v.id">{{v.name}} · {{v.version_number}} · {{v.loaders.join(' / ')}}</option></select><small v-if="!choices.length">没有兼容版本。</small><button :disabled="!selected || loading || busy || !matchingInstance || (type==='mod' && instance.loader==='vanilla')" @click="act(install)">{{type==='modpack'?'下载整合包':'安装并补齐必需依赖'}}</button></section>
<div class="content-results"><article v-for="hit in hits" :key="hit.project_id"><span class="content-icon"><img v-if="icon(hit)" :src="icon(hit)" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedIcons[hit.icon_url]=true"><span v-else aria-hidden="true">◇</span></span><div class="content-summary"><strong>{{hit.title}}</strong><small>{{hit.author}}</small><p>{{hit.description}}</p></div><button :disabled="loading" @click="act(()=>choose(hit))">选择版本</button></article></div>
<p v-if="!hits.length && !loading">没有找到匹配内容。</p><div class="content-actions"><button :disabled="loading || !offset" @click="act(async()=>{offset=Math.max(0,offset-20);await search(false)})">上一页</button><span>{{total ? offset+1 : 0}}–{{offset+hits.length}} / {{total}}</span><button :disabled="loading || offset+hits.length>=total" @click="act(async()=>{offset+=20;await search(false)})">下一页</button></div>
<h3>已安装的受管理内容</h3><button :disabled="loading" @click="act(async()=>records=await api.contentInstalled())">刷新</button><p v-if="!records.length">尚未通过内容工坊安装。手动放入和整合包内的文件可从实例目录查看。</p>
<article v-for="record in records" :key="record.projectId"><span class="content-icon"><img v-if="icon(record)" :src="icon(record)" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedIcons[record.icon_url]=true"><span v-else aria-hidden="true">◇</span></span><span class="content-summary">{{record.title}} <small>{{record.path}}</small></span><button :disabled="loading || busy" @click="act(async()=>{await api.contentRemove(record.projectId);records=await api.contentInstalled()})">移除</button></article>
</div>
</main>
</template>
<style scoped>
.content-search,.content-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.content-search input{flex:1;min-width:120px}.content-page small{display:block;color:#756c62}.content-page article{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px dotted #a89986;padding:16px 0}.content-page article>div{min-width:0}.content-page article button{flex-shrink:0}.content-page article p{font-size:13px;line-height:1.6;overflow-wrap:anywhere}.export-panel{display:grid;gap:10px;border:1px dashed #a89986;padding:16px;margin:14px 0}.export-panel input{width:auto}.content-results{margin-top:12px}
.content-summary{flex:1;min-width:0;overflow-wrap:anywhere}.content-icon{display:grid;place-items:center;flex:0 0 52px;width:52px;height:52px;border-radius:10px;background:#e7dfd0;color:#8b7860;overflow:hidden;font-size:28px}.content-icon img{width:100%;height:100%;object-fit:contain}.project-heading{display:flex;align-items:center;gap:12px}@media(max-width:620px){.content-icon{flex-basis:40px;width:40px;height:40px}.content-page article{gap:10px}}
.filters{margin:12px 0}.filters input{width:110px}.filters label{font-size:12px}
</style>
