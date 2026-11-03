export const PACK_NAME='ChenMeng-Translations.zip'
export function tokens(text){
  return String(text).match(/%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z%]|\$\{[^}]+\}|\$\([^)]+\)|\{\d+(?:,[^}]+)?\}|§[0-9a-fk-or]|<\/?[^>]+>|\n/gi)||[]
}
export function validateTranslation(source,value){
  if(typeof value!=='string'||!value.trim()||value.length>12000)throw Error('译文为空或过长')
  // Preserve order as well as count: unnumbered printf parameters cannot be freely reordered.
  if(JSON.stringify(tokens(source))!==JSON.stringify(tokens(value)))throw Error('占位符、格式代码或换行与原文不一致')
  return value
}
export function parseTranslation(text,rows){
  const clean=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')
  let result
  try{result=JSON.parse(clean)}catch{throw Error('AI 返回的不是合法 JSON，本批尚未保存')}
  if(!result||Array.isArray(result)||typeof result!=='object')throw Error('AI 返回结构不正确')
  const keys=rows.map(r=>r.id)
  if(Object.keys(result).length!==keys.length||keys.some(k=>!Object.hasOwn(result,k)))throw Error('AI 返回的条目键不完整或包含额外条目')
  for(const row of rows)validateTranslation(row.source,result[row.id])
  return result
}
export function batches(rows,maxChars=5000,maxEntries=30){
  const result=[];let batch=[],size=0
  for(const row of rows){
    const n=row.source.length+row.key.length+100
    if(n>maxChars)throw Error('单条原文过长，请在预览中手动填写：'+row.key)
    if(batch.length&&(size+n>maxChars||batch.length>=maxEntries)){result.push(batch);batch=[];size=0}
    batch.push(row);size+=n
  }
  if(batch.length)result.push(batch)
  return result
}
export function packMetadata(version){
  const p=version.pack_version||{}
  const value=p.resource
  let major,minor=0
  if(Number.isInteger(p.resource_major)){major=p.resource_major;minor=p.resource_minor||0}
  else if(Number.isInteger(value))major=value
  else if(Array.isArray(value)){[major,minor=0]=value}
  else if(value&&typeof value==='object'){major=value.major;minor=value.minor||0}
  else if(typeof value==='number'&&Number.isFinite(value)){major=Math.floor(value);minor=Number(String(value).split('.')[1]||0)}
  if(!Number.isInteger(major)||major<1||!Number.isInteger(minor)||minor<0)throw Error('无法读取游戏资源包格式，请先检查并安装当前游戏版本')
  const pack={description:'尘梦 · 合并模组翻译'}
  if(major>=65){pack.min_format=[major,minor];pack.max_format=[major,minor]}
  else pack.pack_format=major
  return {pack}
}
export function mergeEntries(files,rows,target){
  const result=Object.fromEntries(Object.entries(files).map(([file,data])=>[file,{...data}]))
  for(const row of rows){
    validateTranslation(row.source,row.value)
    const file='assets/'+row.namespace+'/lang/'+target+'.json'
    result[file]||=Object.create(null)
    if(Object.hasOwn(result[file],row.key)&&result[file][row.key]!==row.value)throw Error('已有译文冲突，已停止覆盖：'+row.key)
    Object.defineProperty(result[file],row.key,{value:row.value,enumerable:true,writable:true,configurable:true})
  }
  return result
}

export function incrementalEntry(text,key,builtin,existing,sources){
 const previous=sources?.[key]
 const changed=Object.hasOwn(existing,key)&&typeof previous==='string'&&previous!==text
 if(!text.trim()||Object.hasOwn(builtin,key)||(Object.hasOwn(existing,key)&&!changed))return null
 return {changed,previous:changed?existing[key]:null}
}
export function validateGlossary(glossary){
 if(!Array.isArray(glossary)||glossary.length>200||glossary.some(r=>!r||typeof r.source!=='string'||typeof r.target!=='string'||!r.source.trim()||!r.target.trim()||r.source.length>100||r.target.length>100))throw Error('术语表最多 200 项，每项原文和译文各最多 100 字符')
 return glossary
}
