<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
import {House, LibraryBig, Palette, Settings, Box, ArrowRightLeft, Ellipsis, Play, Minus, Square, X, Bookmark} from 'lucide-vue-next'
import Content from './Content.vue'
import {instanceName} from './instance-name.mjs'
import Journal from './Journal.vue'
import brand from './brand.webp'
import journalCover from './journal-cover.webp'
import avatar from './avatar.webp'
const api=window.launcher, page=ref('主页'), state=ref(null), cover=ref(''), notice=ref(''), name=ref(''), version=ref('1.21.1')
const miniQuery=window.matchMedia('(max-width: 480px), (max-height: 320px)')
const mini=ref(miniQuery.matches)
const visiblePage=computed(()=>mini.value?'主页':page.value)
function resizeMode(event){mini.value=event.matches}
miniQuery.addEventListener('change',resizeMode)
onUnmounted(()=>miniQuery.removeEventListener('change',resizeMode))
function expandWindow(){api?.windowAction('expand')}
const activeJob=computed(()=>jobs.value.find(j=>['queued','running'].includes(j.status)))
const gameStatus=ref({busy:false,message:''})
const accountOpen=ref(false), player=ref(''), loginError=ref('')
const versions=ref([]), loadingVersions=ref(false), versionError=ref(''), jobs=ref([])
const loader=ref('vanilla'),loaderVersion=ref(''),loaderOptions=ref([]),loaderBusy=ref(false),loaderError=ref(''),pendingPack=ref('')
let loaderRequest=0
watch([version,loader],async()=>{
  const request=++loaderRequest
  loaderVersion.value='';loaderOptions.value=[];loaderError.value=''
  if(loader.value==='vanilla'){loaderBusy.value=false;return}
  loaderBusy.value=true
  try{
    const list=await api.loaderVersions(version.value,loader.value)
    if(request!==loaderRequest)return
    loaderOptions.value=list;loaderVersion.value=list[0] || ''
    if(!list.length)loaderError.value='该游戏版本暂无此加载器'
  }catch(e){if(request===loaderRequest)loaderError.value=e.message}
  finally{if(request===loaderRequest)loaderBusy.value=false}
})
async function contentTask(id){
  if(!id)return
  await run(()=>api.state())
  navigate('下载')
  returning={id,page:'内容'}
  finishReturn()
}
const statuses={queued:'等待中',running:'进行中',completed:'已完成',failed:'失败'}
const suggestion=computed(()=>{
  const list=state.value?.instances || []
  return instanceName(version.value,loader.value,list)
})
watch(suggestion,(next,old)=>{if(!name.value || name.value===old)name.value=next},{immediate:true})
let returning=null
function finishReturn(){
  if(returning && page.value==='下载' && jobs.value.some(j=>j.id===returning.id && j.status==='completed' && !j.name.startsWith('下载整合包'))) navigate(returning.page)
}
const msBusy=ref(false)
async function microsoft(){
  msBusy.value=true
  loginError.value=''
  try{state.value=await api.microsoft();accountOpen.value=false}
  catch(e){loginError.value=e.message}
  finally{msBusy.value=false}
}
function toggleAccount(){
  player.value=state.value?.account.name || 'Explorer'
  loginError.value=''
  accountOpen.value=!accountOpen.value
}
async function login(){
  try {
    state.value=await api.offline(player.value.trim())
    accountOpen.value=false
  } catch(e){loginError.value=e.message}
}
async function loadVersions(){
  if(loadingVersions.value || !api)return
  loadingVersions.value=true
  versionError.value=''
  try{versions.value=await api.versions()}catch(e){versionError.value='版本列表获取失败，可重试或手动输入。'}
  finally{loadingVersions.value=false}
}
function receiveJobs(next){
  const finished=next.some(j=>j.status==='completed' && jobs.value.find(old=>old.id===j.id)?.status!=='completed')
  jobs.value=next
  finishReturn()
  if(finished)run(()=>api.state())
}
const current=computed(()=>state.value?.instances.find(i=>i.id===state.value.selectedId))
async function run(action){
  notice.value=''
  if (!api){notice.value='请在桌面版中使用此功能';return}
  try {const result=await action(); if(result){state.value=result;cover.value='';cover.value=await api.cover()}} catch(e){notice.value=e.message}
}
onMounted(()=>{if(api){window.onPackReady(file=>pendingPack.value=file);window.onJobs(receiveJobs);api.jobs().then(receiveJobs);window.onGameStatus(s=>gameStatus.value=s);api.gameStatus().then(s=>gameStatus.value=s);run(()=>api.state())}})
function navigate(target){returning=null;page.value=target;notice.value='';accountOpen.value=false;if(target==='实例' && !versions.value.length)loadVersions()}
async function queueTask(action){
  const origin=page.value
  try {
    const id=await action()
    if(page.value!==origin)return
    if(mini.value)return
    navigate('下载')
    returning={id,page:origin}
    finishReturn()
  } catch(e){notice.value=e.message}
}
function startPlay(){return queueTask(()=>api.play())}
function install(){return queueTask(()=>api.install())}
async function create(){await run(()=>api.create({name:name.value,version:version.value,loader:loader.value,loaderVersion:loaderVersion.value}));if(!notice.value){name.value=suggestion.value;await install()}}
const folders={'实例目录':'','存档':'saves','游戏截图':'screenshots','光影包':'shaderpacks','资源包':'resourcepacks','模组':'mods'}
</script>
<template>
<header><img :src="brand" alt="尘梦启动器 CHENMENG"><div class="controls"><button class="expand-window" title="展开完整启动器" aria-label="展开完整启动器" @click="expandWindow"><ArrowRightLeft/></button><button v-for="[key,label,icon] in [['minimize','最小化',Minus],['maximize','最大化或还原',Square],['close','关闭',X]]" :title="label" :aria-label="label" @click="api?.windowAction(key)"><component :is="icon"/></button></div></header>
<nav aria-label="主导航"><button v-for="[key,icon] in [['主页',House],['实例',LibraryBig],['内容',Box],['世界手记',Bookmark],['下载',ArrowRightLeft],['外观',Palette],['设置',Settings]]" :title="key" :aria-label="key" :class="{active:page===key}" @click="navigate(key)"><component :is="icon"/></button></nav>
<main v-if="visiblePage==='主页'" class="home" @pointerdown="!$event.target.closest('.account,.account-panel') && (accountOpen=false)">
<img class="art" :class="{custom:cover}" :src="cover || journalCover" alt="">
<div class="intro"><small>01　我的世界 · 我的旅程</small><em>每个世界，一页梦境。</em></div>
<button class="account" @click="toggleAccount" :aria-expanded="accountOpen" aria-controls="account-panel"><img :src="avatar" alt=""><span><b>{{state?.account.name || 'Explorer'}}</b><br>● {{state?.account.type==='microsoft'?'正版':'离线'}}　⌄</span></button>
<form v-if="accountOpen" id="account-panel" class="account-panel" @submit.prevent="login" @keydown.esc="accountOpen=false">
<div class="account-heading"><strong>账户</strong><button type="button" aria-label="关闭账户面板" @click="accountOpen=false"><X/></button></div><label>玩家名<input required pattern="[A-Za-z0-9_]{3,16}" maxlength="16" v-model="player" autocomplete="off" title="3–16 位字母、数字或下划线"></label><small>3–16 位英文字母、数字或下划线</small><p v-if="loginError" role="alert">{{loginError}}</p><button>使用此用户名</button><button type="button" :disabled="msBusy" @click="microsoft">{{msBusy?'等待 Microsoft 授权…':'Microsoft 正版登录'}}</button></form>
<section class="journey"><div class="world"><small>继续你的旅程</small><h1>{{current?.name || '尚无实例'}}</h1><div class="meta">MINECRAFT {{current?.version || '1.21.1'}}　/　{{(current?.loader || 'vanilla').toUpperCase()}}</div><aside><Bookmark/> {{current?.lastPlayed ? '上次游玩 · '+ new Date(current.lastPlayed).toLocaleString('zh-CN') : '新的旅程'}}</aside></div>
<div class="switch"><button @click="navigate('实例')"><ArrowRightLeft/> 切换游戏</button><button title="实例目录" aria-label="打开实例目录" @click="run(()=>api.folder(''))"><Ellipsis/></button></div>
<div class="launch"><button class="primary" :disabled="gameStatus.busy || !current" @click="startPlay()"><Play/>{{gameStatus.busy?'游戏进行中':'启动游戏'}}</button><small>{{gameStatus.busy?'IN PROGRESS':'JAVA EDITION'}}</small></div></section>
</main><main v-else-if="visiblePage==='实例'"><small>WORLD JOURNAL　/　01</small><h2>游戏实例</h2><label>当前实例 <select :value="current?.id" @change="run(()=>api.select($event.target.value))"><option v-for="i in state?.instances" :value="i.id">{{i.name}} · {{i.version}}</option></select></label><button :disabled="!current" @click="run(()=>api.java())">选择 Java</button><button :disabled="!current || gameStatus.busy" @click="install">检查并下载当前版本</button><button :disabled="!current || gameStatus.busy" @click="run(()=>api.removeInstance(current.id))">删除实例</button><h3>快捷目录</h3><button :disabled="!current" v-for="(dir,label) in folders" @click="run(()=>api.folder(dir))">{{label}} ↗</button><h3>新建并安装实例</h3><form @submit.prevent="create"><input required v-model.trim="name" placeholder="实例名称"><select v-if="versions.length" v-model="version" aria-label="官方正式版"><option v-for="v in versions" :key="v">{{v}}</option></select><input v-else required v-model.trim="version" aria-label="游戏版本"><small>{{loadingVersions ? '正在读取官方版本列表…' : versionError}}</small><button v-if="versionError" type="button" @click="loadVersions">重试</button><label>加载器 <select v-model="loader"><option value="vanilla">原版</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></label><select v-if="loader!=='vanilla'" v-model="loaderVersion" :disabled="loaderBusy" aria-label="加载器版本"><option v-for="v in loaderOptions" :value="v">{{v}}</option></select><small>{{loaderBusy?'读取加载器版本…':loaderError}}</small><button v-if="loaderError" type="button" @click="const old=loader;loader='vanilla';$nextTick(()=>loader=old)">重试列表</button><button :disabled="gameStatus.busy || loaderBusy || (loader!=='vanilla' && !loaderVersion)">创建并安装</button></form></main>
<Content v-else-if="visiblePage==='内容' && current" :key="current.id" :instance="current" :busy="gameStatus.busy || !!activeJob" @task="contentTask"/><main v-else-if="visiblePage==='内容'"><h2>内容工坊</h2><button @click="navigate('实例')">先创建实例</button><button @click="api.packImport().then(contentTask).catch(e=>notice=e.message)">导入 .mrpack</button></main>
<Journal v-else-if="visiblePage==='世界手记' && current" :key="current.id" :instance="current"/><main v-else-if="visiblePage==='世界手记'"><h2>世界手记</h2><button @click="navigate('实例')">先创建实例</button></main>
<main v-else-if="visiblePage==='下载'" class="downloads"><small>WORLD JOURNAL　/　DOWNLOADS</small><h2>下载任务</h2><button v-if="pendingPack" :disabled="!!activeJob || gameStatus.busy" @click="api.packImportDownloaded(pendingPack).then(async id=>{if(id){pendingPack='';await contentTask(id)}}).catch(e=>notice=e.message)">整合包已下载 · 确认导入</button><p v-if="!jobs.length">还没有下载任务。到实例页选择游戏版本，即可检查并补全文件。</p><button v-if="!jobs.length" @click="navigate('实例')">前往实例</button>
<article v-for="job in jobs" :key="job.id" :class="{working:job.status==='running'}"><strong>{{job.name}}</strong><span>{{statuses[job.status] || job.status}} · {{Math.floor(job.percent)}}%</span><button v-if="job.status==='failed'" :disabled="gameStatus.busy || !!activeJob" @click="api.retryJob(job.id).catch(e=>notice=e.message)">重试任务</button><div class="track" role="progressbar" :aria-valuenow="Math.floor(job.percent)" aria-valuemin="0" aria-valuemax="100" :aria-label="job.name"><i :style="{width:job.percent+'%'}"></i></div><small>{{job.error || job.stage || '等待检查'}} <template v-if="job.source"> · {{job.source}}</template>　·　已下载 {{(job.transferred/1048576).toFixed(1)}} MB <template v-if="job.speed"> · {{(job.speed/1048576).toFixed(1)}} MB/s</template></small></article></main>
<main v-else-if="visiblePage==='外观'"><small>WORLD JOURNAL　/　02</small><h2>主页封面</h2><p>自动封面取自当前实例最近的游戏截图。</p><button v-for="(label,mode) in {auto:'游戏截图',default:'默认山景',fixed:'固定图片'}" :class="{active:state?.settings.coverMode===mode}" @click="run(()=>mode==='fixed'?api.choose():api.settings(mode))">{{label}}</button></main>
<main v-else><small>WORLD JOURNAL　/　03</small><h2>启动设置</h2><section v-if="state && current" class="prefs"><h3>{{current.name}} · 游戏运行</h3><label>游戏最大内存（MiB） <input type="number" min="1024" :max="state.system.memory-512" :value="current.memory" @change="run(()=>api.options({memory:Number($event.target.value)}))"></label><small>系统已用 {{(state.system.used/1024).toFixed(1)}} / {{(state.system.memory/1024).toFixed(1)}} GiB · 游戏分配 {{Math.round(100*current.memory/state.system.memory)}}%</small><button :disabled="!current" @click="run(()=>api.java())">选择 Java</button><small>{{current.javaPath || '启动时自动配置'}}</small><h3>下载与文件</h3><label>下载源 <select :value="state.settings.downloadSource || 'auto'" @change="run(()=>api.options({downloadSource:$event.target.value}))"><option value="auto">自动（镜像优先，故障暂时避让）</option><option value="official">官方优先</option><option value="bmclapi">BMCLAPI 镜像优先</option></select></label><label><input type="checkbox" :checked="state.settings.downloadFallback!==false" @change="run(()=>api.options({downloadFallback:$event.target.checked}))"> 失败时回退到另一下载源</label><small>覆盖 Minecraft 与加载器文件；Modrinth 和微软登录保持原服务。镜像由 BMCLAPI 提供。</small><small>游戏数据目录：{{state.system.dataPath}}</small><small>独立 EXE 默认使用同目录下的 .minecraft。移动时请把它和 EXE 一起移动。</small><h3>所有实例</h3><label><input type="checkbox" :checked="state.settings.isolated" @change="run(()=>api.options({isolated:$event.target.checked}))"> 开启版本隔离</label><small>关闭后使用共享存档与模组目录。切换不会搬移文件。</small><label><input type="checkbox" :checked="state.settings.closeOnLaunch" @change="run(()=>api.options({closeOnLaunch:$event.target.checked}))"> 游戏启动后隐藏启动器，退出时恢复</label><label>游戏窗口标题 <input maxlength="100" placeholder="使用游戏默认标题" :value="state.settings.gameTitle" @change="run(()=>api.options({gameTitle:$event.target.value}))"></label></section></main><footer role="status"><span>尘梦　/　0.1　世界手记</span><span :title="notice || activeJob?.stage || gameStatus.message"><Box/> {{notice || (activeJob ? activeJob.stage+' · '+Math.floor(activeJob.percent)+'%' : gameStatus.message) || '就绪'}}</span></footer>
</template>




