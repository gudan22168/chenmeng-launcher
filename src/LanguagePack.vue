<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
import {alias} from './mod-aliases.mjs'
const modQuery=ref(''),chosen=ref([]),glossaryText=ref(''),glossaryOpen=ref(false)
try{glossaryText.value=localStorage.getItem('chenmeng.translation.glossary')||''}catch{}
watch(glossaryText,v=>{try{localStorage.setItem('chenmeng.translation.glossary',v)}catch{}})
function glossary(){return glossaryText.value.split('\n').filter(l=>l.trim()).map(line=>{const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw Error('术语表每行使用 原文=译文');return {source:line.slice(0,at).trim(),target:line.slice(at+1).trim()}})}
const props=defineProps({instance:Object,busy:Boolean})
const api=window.launcher,mods=ref([]),selected=ref(''),source=ref('en_us'),target=ref('zh_cn'),draft=ref(null),working=ref(false),message=ref(''),progress=ref(''),page=ref(0)
const locales=computed(()=>[...new Set(mods.value.flatMap(m=>m.locales))].sort())
const filteredMods=computed(()=>mods.value.filter(m=>(alias(m)+' '+(m.title||'')+' '+m.name).toLowerCase().includes(modQuery.value.toLowerCase())))
const missing=computed(()=>draft.value?.rows.filter(r=>!r.value.trim()).length||0)
const shown=computed(()=>draft.value?.rows.slice(page.value*30,page.value*30+30)||[])
const disabled=computed(()=>working.value||props.busy)
const values=()=>draft.value.rows.map(r=>({id:r.id,value:r.value}))
async function act(fn){if(disabled.value)return;working.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{working.value=false;progress.value=''}}
async function scan(){mods.value=await api.languageMods(props.instance.id);chosen.value=[];draft.value=null}
function reset(){draft.value=null;page.value=0}
watch([chosen,source,target],reset,{deep:true})
watch(selected,()=>{source.value=locales.value.includes('en_us')?'en_us':locales.value[0]||'en_us'})
watch(()=>props.instance.id,()=>{reset();act(scan)})
async function prepare(){draft.value=await api.languagePrepare(props.instance.id,[...chosen.value],source.value,target.value);page.value=0;if(!draft.value.rows.length)message.value='没有缺失条目：可能已有目标语言，或此源语言没有内容。'}
async function translate(){draft.value=await api.languageTranslate(props.instance.id,draft.value.token,values(),glossary());message.value=draft.value.error||'本次请求结束，已完成的译文已保存。'}
async function exportWithOriginals(){
  if (!window.confirm('将 '+missing.value+' 条空白译文按原文写入资源包？已填写的译文会保留。')) return
  for (const row of draft.value.rows) if (!row.value.trim()) row.value = row.source
  await exportPack()
}
async function exportPack(){const name=await api.languageExport(props.instance.id,draft.value.token,values());message.value='已更新 '+name+'。请在游戏的资源包设置中启用。'}
let unsubscribe
onMounted(()=>{act(scan);unsubscribe=window.onLanguageProgress?.(p=>{if(p.token===draft.value?.token)progress.value='正在翻译第 '+p.index+' / '+p.total+' 批…'})})
onUnmounted(()=>unsubscribe?.())
</script>
<template>
<section class="language-pack">
<h3>AI 模组语言翻译 · 合并资源包</h3>
<p>每个实例只生成一个 <strong>ChenMeng-Translations.zip</strong>，多个模组与语言合并保存。只补缺失条目，保留已有译文，不修改模组 JAR。</p>
<p>沿用设置中的 AI 地址、Key 和模型。提交前确认服务与批次数；每批成功后自动保存草稿，失败可继续。第一版支持 JAR 内的 JSON 语言文件。</p>
<div class="language-controls">
<input v-model="modQuery" placeholder="搜索模组名称 / 文件名 / 别名" aria-label="检索翻译模组" style="width:260px">
<button :disabled="disabled" @click="chosen=[...new Set([...chosen,...filteredMods.filter(m=>m.locales.includes(source)).map(m=>m.path)])]">选择可翻译结果</button><button :disabled="disabled" @click="chosen=[]">清空选择</button><span>已选 {{chosen.length}} 项</span>
<button :disabled="disabled" @click="act(scan)">重新扫描</button>
<label>源语言 <select v-model="source" :disabled="disabled"><option v-for="lang in locales" :key="lang" :value="lang">{{lang}}</option></select></label>
<label>目标语言 <input v-model.trim="target" :disabled="disabled" list="translation-locales" placeholder="zh_cn"><datalist id="translation-locales"><option value="zh_cn"/><option value="zh_tw"/><option value="ja_jp"/><option value="en_us"/></datalist></label>
<button :disabled="disabled||!chosen.length" @click="act(prepare)">读取 / 恢复预览</button>
<button :disabled="disabled" @click="act(()=>api.languageFolder(instance.id))">资源包位置 ↗</button>
</div>
<div class="translation-mods"><label v-for="mod in filteredMods" :key="mod.path"><input type="checkbox" v-model="chosen" :value="mod.path" :disabled="disabled||!mod.locales.includes(source)">{{alias(mod)||mod.title||mod.name}}<span v-if="alias(mod)" class="original-name">（{{mod.title||mod.name}}）</span><small v-if="mod.error">{{mod.error}}</small><small v-else-if="!mod.locales.includes(source)">没有 {{source}} 源语言，不能提交</small></label></div>
<button :aria-expanded="glossaryOpen" @click="glossaryOpen=!glossaryOpen">术语表 {{glossaryOpen?'收起':'展开'}}</button>
<div v-if="glossaryOpen"><p>每行 原文=译文，如 Mana=魔力。最多 200 条；仅保存在本机，翻译时一同提交 AI，修改后对新翻译生效。</p><textarea v-model="glossaryText" :disabled="disabled" rows="6" placeholder="Mana=魔力" aria-label="翻译术语表"/></div>
<p role="status">{{progress||message}}</p>
<template v-if="draft">
<p v-for="note in draft.notices" :key="note">{{note}}</p><p>待补译 {{draft.rows.length}} 条 · 尚未填写 {{missing}} 条 · 已跳过 {{draft.skipped}} 条 · 原文约 {{draft.rows.reduce((n,r)=>n+r.source.length,0)}} 字符</p>
<div class="language-controls"><button :disabled="disabled||!missing" @click="act(translate)">AI 翻译剩余 {{missing}} 条</button><button v-if="missing" :disabled="disabled" @click="act(exportWithOriginals)">空白使用原文并导出</button><button :disabled="disabled||missing>0||!draft.rows.length" @click="act(exportPack)">校验并更新合并资源包</button></div>
<div v-for="row in shown" :key="row.id" class="language-row">
<code>{{row.namespace}} · {{row.key}}</code><small v-if="row.changed">原文已变化 · 旧译文：{{row.previous}}</small><div class="language-pair"><pre>{{row.source}}</pre><textarea v-model="row.value" :disabled="disabled" rows="3" aria-label="可编辑译文"/></div>
</div>
<div v-if="draft.rows.length" class="language-controls"><button :disabled="page===0" @click="page--">上一页</button><span>{{page+1}} / {{Math.ceil(draft.rows.length/30)}}</span><button :disabled="(page+1)*30>=draft.rows.length" @click="page++">下一页</button></div>
</template>
<p class="language-note">导出前保留上一版备份于实例的 translation-backups 文件夹。导出后需在游戏内启用资源包；手动编辑请先导出再离开。更新后重新选择模组并读取，将补译新增和原文变化的条目；旧版包没有原文记录，仅补新增条目。已删除的键暂时保留。</p>
</section>
</template>
<style scoped>
.translation-mods{max-height:220px;overflow:auto;margin:12px 0}.translation-mods label{display:block;padding:6px;border-bottom:1px dotted #b4a68f}.translation-mods input{width:auto}.translation-mods small{display:block;color:#786c61}.original-name{opacity:.55}.language-pack{border:1px solid #b4a68f;border-radius:8px;padding:16px;margin-top:16px}.language-pack p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.language-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.language-controls label{display:flex;gap:6px;align-items:center;max-width:100%}.language-controls select{max-width:360px;min-width:90px}.language-controls input{width:100px}.language-row{padding:12px 0;border-bottom:1px dotted #b4a68f}.language-row code{overflow-wrap:anywhere;font-size:12px}.language-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}.language-pair pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;font-size:13px}.language-pair textarea{box-sizing:border-box;width:100%;resize:vertical;min-width:0;background:transparent}.language-note{color:#756c62}@media(max-width:760px){.language-pair{grid-template-columns:1fr}.language-controls select{max-width:230px}}
</style>
