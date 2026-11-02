export function extractAIAnswer(result){
  const choice=result?.choices?.[0],message=choice?.message
  const content=typeof message?.content==='string'?message.content.trim():''
  if(!content){
    if(choice?.finish_reason==='length')throw Error('AI 输出达到上限，但没有生成最终分析正文。请换用非思考模型或缩短报告后重试。')
    if(message?.reasoning_content)throw Error('AI 只返回了思考内容，没有最终分析正文。请换用非思考模型后重试。')
    throw Error('AI 返回了空的分析正文（结束原因：'+String(choice?.finish_reason||'未知').slice(0,60)+'）。请检查模型或稍后手动重试。')
  }
  return content+(choice.finish_reason==='length'?'\n\n[提示：分析因输出长度上限被截断，以上内容可能不完整。]':'')
}
