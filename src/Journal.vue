<script setup>
import {ref,reactive,onMounted,watch,nextTick} from 'vue'
const props=defineProps({instance:Object})
const api=window.launcher, entries=ref([]), selected=ref(''), canvas=ref(null), message=ref(''), busy=ref(false)
const draft=reactive({title:'',date:'',note:'',filter:'original'})
const filters={original:['原色','none'],warm:['暖阳','sepia(.17) saturate(1.08)'],mist:['薄雾','contrast(.9) saturate(.76) brightness(1.05)'],mono:['银盐','grayscale(1)']}
let photo=null
function localDate(ms){
  const d=new Date(ms)
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
}
async function save(){
  if(!photo)return
  await api.journalSave(props.instance.id,selected.value,{...draft})
  Object.assign(entries.value.find(e=>e.name===selected.value),draft)
}
async function act(fn){
  if(busy.value)return
  busy.value=true
  message.value=''
  try{await fn()}catch(e){message.value=e.message}finally{busy.value=false}
}
async function open(entry){
  await save()
  photo=null
  selected.value=entry.name
  Object.assign(draft,{title:entry.title??props.instance.name,date:entry.date??localDate(entry.time),note:entry.note??'',filter:entry.filter??'original'})
  await nextTick()
  canvas.value.width=1
  const img=new Image()
  img.src=await api.journalPhoto(props.instance.id,entry.name)
  await img.decode()
  photo=img
  paint()
}
async function refresh(){
  await save()
  entries.value=await api.journalList(props.instance.id)
  photo=null
  selected.value=''
  if(entries.value.length)await open(entries.value[0])
}
function paint(){
  if(!photo||!canvas.value)return
  const c=canvas.value,ctx=c.getContext('2d')
  const scale=Math.min(1,4096/Math.max(photo.width,photo.height))
  const w=Math.round(photo.width*scale),h=Math.round(photo.height*scale)
  const pad=Math.max(8,Math.round(w*.021)),body=Math.max(12,Math.round(w*.014)),heading=Math.round(body*1.45)
  const wrap=(value,size)=>{
    ctx.font=size+'px "Microsoft YaHei", sans-serif'
    const lines=[]
    for(const paragraph of value.split('\n')){
      let line=''
      for(const ch of paragraph){
        if(line && ctx.measureText(line+ch).width>w){lines.push(line);line=''}
        line+=ch
      }
      lines.push(line)
    }
    return lines
  }
  const titles=wrap(draft.title||props.instance.name,heading),notes=draft.note?wrap(draft.note,body):[]
  c.width=w+2*pad
  c.height=Math.ceil(h+3*pad+(titles.length*heading+notes.length*body+body)*1.5)
  ctx.fillStyle='#f6f3e9';ctx.fillRect(0,0,c.width,c.height)
  ctx.filter=filters[draft.filter][1];ctx.drawImage(photo,pad,pad,w,h);ctx.filter='none'
  let y=h+2*pad
  ctx.textBaseline='top'
  function lines(text,size,color){
    ctx.fillStyle=color;ctx.font=size+'px "Microsoft YaHei", sans-serif'
    for(const line of text){ctx.fillText(line,pad,y);y+=size*1.5}
  }
  lines(titles,heading,'#37322e');lines([draft.date],body,'#756c62');lines(notes,body,'#514b45')
}
watch(draft,paint,{flush:'post'})
async function exportPage(){
  await save()
  paint()
  const blob=await new Promise(resolve=>canvas.value.toBlob(resolve,'image/png'))
  const dest=await api.journalExport(props.instance.id,selected.value,new Uint8Array(await blob.arrayBuffer()))
  message.value=dest?'已导出至 '+dest:'已取消导出'
}
onMounted(()=>act(refresh))
</script>
<template>
<main class="journal"><small>WORLD JOURNAL　/　FIELD NOTES</small><h2>世界手记</h2>
<div class="journal-tools"><strong>{{instance.name}}</strong><button :disabled="busy" @click="act(refresh)">刷新截图</button><button @click="act(()=>api.folder('screenshots'))">打开截图文件夹 ↗</button></div>
<p v-if="!entries.length && !busy">这本手记还没有截图。在游戏中按 F2 留下画面，回来刷新，就可以写下当天的故事。</p>
<template v-if="selected"><label>翻到 <select :disabled="busy" :value="selected" @change="act(()=>open(entries.find(e=>e.name===$event.target.value)))"><option v-for="e in entries" :value="e.name" :key="e.name">{{e.date || localDate(e.time)}} · {{e.title || e.name}}</option></select></label>
<div class="journal-layout"><figure><canvas ref="canvas" aria-label="手记导出预览"></canvas><figcaption>印样预览 · {{selected}}</figcaption></figure>
<fieldset :disabled="busy"><label>标题<input maxlength="80" v-model="draft.title"></label><label>记录日期<input type="date" required v-model="draft.date"></label><label>页边笔记<textarea rows="4" maxlength="500" v-model="draft.note" placeholder="今天在世界里发生了什么？"></textarea></label><label>画面滤镜<select v-model="draft.filter"><option v-for="([label],id) in filters" :value="id">{{label}}</option></select></label>
<button @click="act(async()=>{await save();message='手记已保存'})">保存手记</button><button @click="act(exportPage)">导出手记 PNG</button><button @click="act(()=>api.journalReveal(instance.id,selected))">在资源管理器中定位原图 ↗</button></fieldset></div></template>
<p role="status">{{message}}</p></main>
</template>
<style scoped>
.journal h2{margin:10px 0}.journal-tools{display:flex;align-items:center;gap:10px;margin-bottom:16px}.journal-layout{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(190px,1fr);gap:24px;margin-top:18px;align-items:start}.journal figure{margin:0}.journal canvas{max-width:100%;height:auto;box-shadow:0 2px 10px #47342925}.journal figcaption{font-size:12px;color:#756c62;margin:8px 0}.journal fieldset,.journal fieldset label{display:grid;gap:7px}.journal fieldset{padding:0;border:0}.journal textarea{font:inherit;resize:vertical;background:#ffffff40;border:1px solid #83786b;padding:8px}.journal fieldset input{min-width:0;margin:0}.journal label{font-size:13px}
</style>
