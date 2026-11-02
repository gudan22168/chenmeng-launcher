<script setup>
import {ref,onMounted,watch,nextTick,onUnmounted} from 'vue'
const props=defineProps({instance:Object})
const api=window.launcher,data=ref(null),busy=ref(false),error=ref(''),message=ref(''),report=ref(''),answer=ref(''),reviewed=ref(false),model=ref(''),selectedLog=ref('')
async function act(fn){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn()}catch(e){error.value=e.message}finally{busy.value=false}}
async function refresh(){
  data.value=await api.diagnostics(props.instance.id)
  report.value=data.value.report;model.value=data.value.ai.model||'';reviewed.value=false;answer.value=''
  selectedLog.value=data.value.logs[0]?.name||''
}
const aiPending=ref(false),aiError=ref(''),aiStatus=ref(''),elapsed=ref(0),resultPanel=ref(null)
let waitTimer
onUnmounted(()=>clearInterval(waitTimer))
async function analyze(){
  aiPending.value=true;aiError.value='';aiStatus.value='';answer.value='';elapsed.value=0
  waitTimer=setInterval(()=>elapsed.value++,1000)
  try{
    const result=await api.diagnosticAnalyze(props.instance.id,report.value,model.value)
    if(result===null){aiStatus.value='已取消，本次未发送报告';return}
    if(typeof result!=='string'||!result.trim())throw Error('AI 没有返回分析正文，请检查模型设置后手动重试。')
    answer.value=result;aiStatus.value='分析完成'
  }catch(e){aiError.value=e.message || String(e)}
  finally{
    clearInterval(waitTimer);aiPending.value=false
    await nextTick();resultPanel.value?.scrollIntoView({block:'nearest',behavior:'smooth'})
  }
}
watch(report,()=>reviewed.value=false)
onMounted(()=>act(refresh))
</script>
<template>
<main class="diagnostics-page">
<small>WORLD JOURNAL / DIAGNOSTICS</small><h2>日志与诊断</h2><p>{{instance.name}} · {{instance.version}} / {{instance.loader}}</p>
<div><button :disabled="busy" @click="act(refresh)">刷新并本地分析</button><button :disabled="busy" @click="act(()=>api.diagnosticFolder(instance.id))">打开实例目录</button><button :disabled="busy" @click="act(async()=>{if(await api.diagnosticExport(instance.id))message='诊断包已导出'})">一键导出诊断 ZIP</button></div>
<p v-if="busy" role="status">正在处理，请稍候…</p><p v-if="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
<template v-if="data">
<h3>本地规则检查</h3>
<p v-if="!data.summary.findings.length">尚未匹配到常见错误规则。这不代表没有问题，请检查日志或导出诊断。</p>
<article v-for="finding in data.summary.findings" :key="finding.id"><strong>{{finding.title}}</strong><p>{{finding.hint}}</p><pre>{{finding.evidence.join('\n')}}</pre></article>
<p v-for="warning in data.summary.warnings" :key="warning">{{warning}}</p>
<h3>启动日志与崩溃报告</h3><small>显示经过脱敏的有限片段，时间不同的日志不一定属于同一次启动。原文件可从实例目录打开。</small>
<p v-if="!data.logs.length">没有找到 launcher.log、游戏日志或崩溃报告。启动前失败的信息会显示在下方报告的状态字段中。</p>
<select v-if="data.logs.length" v-model="selectedLog" aria-label="选择日志"><option v-for="log in data.logs" :key="log.name" :value="log.name">{{log.name}} · {{new Date(log.time).toLocaleString()}}{{log.truncated?'（截取）':''}}</option></select>
<pre v-if="selectedLog" class="log-view">{{data.logs.find(l=>l.name===selectedLog)?.text}}</pre>
<h3>AI 分析（可选）</h3>
<p v-if="!data.ai.baseURL">尚未配置 AI。可到设置页填写服务地址、Key 和模型；本地规则和导出始终可用。</p>
<template v-else><small>目标：{{data.ai.baseURL}}</small><label>模型 <input v-model.trim="model" :disabled="busy" placeholder="模型 ID"></label></template>
<p>报告包括游戏与加载器版本、Java 版本、内存、显卡标识、模组清单、本地规则结果，以及提取去重后的错误上下文。不会附带存档或账户配置。脱敏无法覆盖所有个人信息，请检查后再发送。</p>
<details><summary>查看 / 编辑将发送的报告（{{report.length}} 字符，上限 64000）</summary><textarea v-model="report" :disabled="busy" maxlength="64000" spellcheck="false" aria-label="AI 诊断报告预览"/></details>
<label><input v-model="reviewed" type="checkbox" :disabled="busy"> 我已检查报告内容，确认本次提交</label>
<button :disabled="busy || !data.ai.baseURL || !model || !reviewed || !report.trim()" @click="act(analyze)">提交给 AI 分析</button>
<div ref="resultPanel" aria-live="polite"><p v-if="aiPending" role="status">正在等待确认或 AI 分析，已等待 {{elapsed}} 秒。确认发送后请求最多等待 90 秒，请留在此页。</p><p v-if="aiError" role="alert">{{aiError}}</p><p v-if="aiStatus" role="status">{{aiStatus}}</p></div>
<small v-if="data.ai.baseURL.includes('api.deepseek.com')">官方 DeepSeek 分析请求使用非思考模式；启动器不会自动重试。</small>
<section v-if="answer"><h3>AI 分析结果</h3><small>模型建议可能不准确，请结合日志验证。启动器不会执行其中的命令或自动修改文件。</small><pre class="ai-answer">{{answer}}</pre></section>
</template>
</main>
</template>
<style scoped>
.diagnostics-page article{padding:14px;border:1px dotted #a89986;margin:10px 0}.diagnostics-page p,.diagnostics-page small{line-height:1.6;font-size:13px}.diagnostics-page pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace}.log-view{max-height:300px;overflow:auto;background:#fff6;padding:14px}.diagnostics-page textarea{width:100%;height:300px;margin:10px 0;font:12px/1.5 monospace;background:#fff9}.diagnostics-page label{display:block;margin:12px 0}.diagnostics-page details{margin:12px 0}.diagnostics-page select{max-width:100%}
</style>
