<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
const props=defineProps({instance:Object,busy:Boolean})
const api=window.launcher,mods=ref([]),selected=ref(''),source=ref('en_us'),target=ref('zh_cn'),draft=ref(null),working=ref(false),message=ref(''),progress=ref(''),page=ref(0)
const locales=computed(()=>mods.value.find(m=>m.path===selected.value)?.locales||[])
const missing=computed(()=>draft.value?.rows.filter(r=>!r.value.trim()).length||0)
const shown=computed(()=>draft.value?.rows.slice(page.value*30,page.value*30+30)||[])
const disabled=computed(()=>working.value||props.busy)
const values=()=>draft.value.rows.map(r=>({id:r.id,value:r.value}))
async function act(fn){if(disabled.value)return;working.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{working.value=false;progress.value=''}}
async function scan(){mods.value=await api.languageMods(props.instance.id);selected.value=mods.value.find(m=>m.locales.length)?.path||''}
function reset(){draft.value=null;page.value=0}
watch([selected,source,target],reset)
watch(selected,()=>{source.value=locales.value.includes('en_us')?'en_us':locales.value[0]||'en_us'})
watch(()=>props.instance.id,()=>{reset();act(scan)})
async function prepare(){draft.value=await api.languagePrepare(props.instance.id,selected.value,source.value,target.value);page.value=0;if(!draft.value.rows.length)message.value='没有缺失条目：可能已有目标语言，或此源语言没有内容。'}
async function translate(){draft.value=await api.languageTranslate(props.instance.id,draft.value.token,values());message.value=draft.value.error||'本次请求结束，已完成的译文已保存。'}
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
<label>本地模组 <select v-model="selected" :disabled="disabled"><option value="">请选择</option><option v-for="mod in mods" :key="mod.path" :value="mod.path" :disabled="!mod.locales.length">{{mod.name}}{{mod.error?'（无法读取）':''}}</option></select></label>
<button :disabled="disabled" @click="act(scan)">重新扫描</button>
<label>源语言 <select v-model="source" :disabled="disabled"><option v-for="lang in locales" :key="lang" :value="lang">{{lang}}</option></select></label>
<label>目标语言 <input v-model.trim="target" :disabled="disabled" list="translation-locales" placeholder="zh_cn"><datalist id="translation-locales"><option value="zh_cn"/><option value="zh_tw"/><option value="ja_jp"/><option value="en_us"/></datalist></label>
<button :disabled="disabled||!selected" @click="act(prepare)">读取 / 恢复预览</button>
<button :disabled="disabled" @click="act(()=>api.languageFolder(instance.id))">资源包位置 ↗</button>
</div>
<p role="status">{{progress||message}}</p>
<template v-if="draft">
<p>缺失 {{draft.rows.length}} 条 · 尚未填写 {{missing}} 条 · 已跳过 {{draft.skipped}} 条 · 原文约 {{draft.rows.reduce((n,r)=>n+r.source.length,0)}} 字符</p>
<div class="language-controls"><button :disabled="disabled||!missing" @click="act(translate)">AI 翻译剩余 {{missing}} 条</button><button :disabled="disabled||missing>0||!draft.rows.length" @click="act(exportPack)">校验并更新合并资源包</button></div>
<div v-for="row in shown" :key="row.id" class="language-row">
<code>{{row.namespace}} · {{row.key}}</code><div class="language-pair"><pre>{{row.source}}</pre><textarea v-model="row.value" :disabled="disabled" rows="3" aria-label="可编辑译文"/></div>
</div>
<div v-if="draft.rows.length" class="language-controls"><button :disabled="page===0" @click="page--">上一页</button><span>{{page+1}} / {{Math.ceil(draft.rows.length/30)}}</span><button :disabled="(page+1)*30>=draft.rows.length" @click="page++">下一页</button></div>
</template>
<p class="language-note">导出前保留上一版备份于实例的 translation-backups 文件夹。导出后需在游戏内启用资源包；手动编辑请先导出再离开。已有译文暂不覆盖，模组更新后的过期译文清理留待后续版本。</p>
</section>
</template>
<style scoped>
.language-pack{border:1px solid #b4a68f;border-radius:8px;padding:16px;margin-top:16px}.language-pack p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}.language-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.language-controls label{display:flex;gap:6px;align-items:center;max-width:100%}.language-controls select{max-width:360px;min-width:90px}.language-controls input{width:100px}.language-row{padding:12px 0;border-bottom:1px dotted #b4a68f}.language-row code{overflow-wrap:anywhere;font-size:12px}.language-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}.language-pair pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;font-size:13px}.language-pair textarea{box-sizing:border-box;width:100%;resize:vertical;min-width:0;background:transparent}.language-note{color:#756c62}@media(max-width:760px){.language-pair{grid-template-columns:1fr}.language-controls select{max-width:230px}}
</style>
