<script setup>
import {ref,onMounted} from 'vue'
const api=window.launcher
const baseURL=ref(''),key=ref(''),model=ref(''),hasKey=ref(false),clearKey=ref(false),models=ref([]),busy=ref(false),message=ref(''),error=ref('')
function assign(c){baseURL.value=c.baseURL||'';model.value=c.model||'';hasKey.value=c.hasKey;key.value='';clearKey.value=false}
async function act(fn){if(busy.value)return;busy.value=true;message.value='';error.value='';try{await fn()}catch(e){error.value=e.message}finally{busy.value=false}}
async function save(){assign(await api.aiSave({baseURL:baseURL.value,key:key.value,model:model.value,clearKey:clearKey.value}));message.value='已保存到本机'}
async function check(){await save();models.value=await api.aiModels();message.value='连接成功，读取到 '+models.value.length+' 个模型。具体模型是否可调用还取决于服务权限。'}
onMounted(()=>act(async()=>assign(await api.aiSettings())))
</script>
<template>
<section class="ai-settings">
<h3>AI 分析（可选）</h3>
<p>本地诊断无需 AI。支持 OpenAI 兼容接口：/models 与 /chat/completions。</p>
<label>API 基础地址 <input v-model.trim="baseURL" :disabled="busy" placeholder="https://服务地址/v1" autocomplete="off"></label>
<label>API Key <input v-model="key" :disabled="busy" type="password" :placeholder="hasKey?'已保存；留空保留原 Key':'本地无鉴权服务可留空'" autocomplete="new-password"></label>
<label><input v-model="clearKey" :disabled="busy" type="checkbox"> 清除已保存的 Key</label>
<label>模型 <input v-model.trim="model" :disabled="busy" list="diagnostic-ai-models" placeholder="获取列表后选择，或手动填写模型 ID"><datalist id="diagnostic-ai-models"><option v-for="id in models" :key="id" :value="id"/></datalist></label>
<small>地址、模型和加密后的 Key 只保存到本机。更换服务地址会清除原 Key，需要重新填写。获取模型会向该地址发起一次认证请求。</small>
<div><button :disabled="busy" @click="act(save)">保存 AI 设置</button><button :disabled="busy || !baseURL" @click="act(check)">{{busy?'处理中…':'获取模型 / 连通检测'}}</button></div>
<p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert">{{error}}</p>
</section>
</template>
<style scoped>
.ai-settings{width:min(760px,100%);margin-top:20px;padding-top:10px;border-top:1px dotted #a89986}.ai-settings label{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}.ai-settings input:not([type=checkbox]){flex:1;min-width:160px}.ai-settings p,.ai-settings small{font-size:12px;line-height:1.6}
</style>
