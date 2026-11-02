<script setup>
import {ref} from 'vue'
const emit=defineEmits(['task'])
defineProps({busy:Boolean})
const api=window.launcher,open=ref(false),loading=ref(false),result=ref(null),error=ref('')
async function scan(choose=false){
  if(loading.value)return
  loading.value=true;error.value='';open.value=true
  try{const found=await api.scanMinecraft(choose);if(found)result.value=found}catch(e){error.value=e.message}finally{loading.value=false}
}
async function reveal(row){try{await api.revealMinecraft(row.token,row.isolated)}catch(e){error.value=e.message}}
async function importRow(row){
  loading.value=true;error.value=''
  try{const id=await api.importMinecraft(row.token,row.isolated);if(id)emit('task',id)}catch(e){error.value=e.message}finally{loading.value=false}
}
</script>
<template>
<section class="directory-import">
<button :disabled="loading" @click="scan()">扫描并导入已有 Minecraft</button>
<button v-if="open" :disabled="loading" @click="scan(true)">选择其他扫描文件夹</button>
<button v-if="open" @click="open=false">收起</button>
<div v-if="open">
<p>扫描启动器所在文件夹及最多四层子文件夹。复制导入会保留原目录；首次启动时检查下载游戏和加载器。暂不导入自定义启动参数、账户和 Java 配置。</p>
<p v-if="loading" role="status">正在处理，请稍候…</p>
<p v-if="error" role="alert">{{error}}</p>
<template v-if="result">
<small>扫描范围：{{result.root}}</small>
<p v-for="warning in result.warnings" :key="warning">{{warning}}</p>
<p v-if="!result.rows.length && !loading">未找到包含版本 JSON 的 Minecraft 目录。可以选择旧启动器所在文件夹或 .minecraft 重新扫描。</p>
<article v-for="row in result.rows" :key="row.token">
<strong>{{row.name}}</strong><small>Minecraft {{row.version}} · {{row.loader}} {{row.loaderVersion}}</small>
<small>版本位置：{{row.versionPath}}</small>
<label>游玩数据位置 <select v-model="row.isolated" :disabled="loading"><option :value="true">版本目录（开启版本隔离）</option><option :value="false">共享根目录（未开启版本隔离）</option></select></label>
<code>{{row.isolated?row.versionPath:row.root}}</code>
<p v-if="row.reason">暂不能导入：{{row.reason}}</p>
<button :disabled="loading" @click="reveal(row)">在资源管理器打开</button>
<button :disabled="loading || busy || !!row.reason" @click="importRow(row)">复制导入</button>
</article>
</template>
</div>
</section>
</template>
<style scoped>
.directory-import{margin-top:20px}.directory-import p{font-size:13px;line-height:1.6}
article{padding:14px 0;border-bottom:1px dotted #a89986}small,code{display:block;overflow-wrap:anywhere;margin:6px 0}code{font-size:12px}label{display:block;margin:8px 0}
</style>
