export function redact(text,secrets=[]){
  let value=String(text||'')
  for(const secret of [...secrets].filter(s=>typeof s==='string'&&s.length>=3).sort((a,b)=>b.length-a.length))value=value.split(secret).join('[已隐藏]')
  return value
    .replace(/^.*(?:\[CHAT\]|Connecting to |Setting user:).*/gmi,'[聊天或账户/服务器信息已隐藏]')
    .replace(/(Authorization\s*:\s*)(?:Bearer\s+)?[^\r\n]+/gi,'$1[已隐藏]')
    .replace(/((?:--)?(?:access[_-]?token|refresh[_-]?token|client[_-]?token|api[_-]?key|password|secret|session(?:id)?)["']?\s*(?:[:=]\s*|\s+)["']?)[^\s"',;}\r\n]+/gi,'$1[已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[KEY]')
    .replace(/https?:\/\/[^\s"'<>]+/gi,'[URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
    .replace(/((?:server(?: address)?|ip(?: address)?)\s*[:=]\s*)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/gi,'$1[IP]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'[UUID]')
    .replace(/\b[0-9a-f]{32}\b/gi,'[UUID]')
    .replace(/[A-Z]:[\\/]Users[\\/][^\\/\s"']+/gi,'[USER_HOME]')
    .replace(/\/(?:home|Users)\/[^/\s"']+/g,'[USER_HOME]')
}
export const rules=[
  {id:'java-version',pattern:/UnsupportedClassVersionError|class file version|compiled by a more recent version/i,title:'Java 版本不匹配',hint:'按实例要求选择对应 Java 主版本，再重试启动。不要只根据已安装的 Java 文件夹名判断版本。'},
  {id:'java-path',pattern:/ClassNotFoundException:\s*[A-Z]:[\\/].*javaw?\.exe|spawn .*java.*ENOENT|无法找到.*Java/i,title:'Java 路径或启动命令异常',hint:'重新自动配置 Java；如果日志把 java.exe 当作主类，请更新启动器并保留该日志。'},
  {id:'memory',pattern:/OutOfMemoryError|Could not reserve enough space|Native memory allocation.*failed|insufficient memory/i,title:'内存不足或分配失败',hint:'检查系统可用内存。Java 堆不足时适度增加分配；无法预留内存时降低分配并关闭其他程序。'},
  {id:'dependency',pattern:/requires .*version|Missing.*dependenc|depends on|requires.*which is missing|Incompatible mod set|Mod resolution encountered/i,title:'模组前置或版本要求不满足',hint:'阅读错误中的模组 ID 和版本范围，补齐对应加载器的前置；已内置的依赖需结合 JAR 元数据确认。'},
  {id:'duplicate',pattern:/DuplicateModsFoundException|Duplicate mod|Found duplicate mods/i,title:'存在重复模组',hint:'检查 mods 中是否有同一模组的多个版本，先备份后只保留目标版本。'},
  {id:'mixin',pattern:/MixinApplyError|MixinTransformerError|InvalidMixinException|InjectionError|Critical injection failure/i,title:'模组注入失败',hint:'查看首个 Caused by 和关联模组；更新匹配版本，或逐个移除最近新增模组复测。单凭堆栈不能确认责任模组。'},
  {id:'graphics',pattern:/GLFW error 65542|does not support OpenGL|Failed to create.*GL.*context|Pixel format not accelerated/i,title:'显卡驱动或 OpenGL 支持问题',hint:'核对实际使用的显卡与驱动；更新显卡厂商驱动，并检查是否通过远程桌面运行。'},
  {id:'native-crash',pattern:/A fatal error has been detected|EXCEPTION_ACCESS_VIOLATION|SIGSEGV|Problematic frame:/i,title:'Java 或本地库崩溃',hint:'结合 hs_err 报告的 Problematic frame、显卡驱动和 Java 版本排查；可能涉及驱动、原生库或内存。'},
  {id:'missing-class',pattern:/NoClassDefFoundError|ClassNotFoundException|NoSuchMethodError|NoSuchFieldError/i,title:'类库缺失或二进制版本不兼容',hint:'检查前置与模组版本是否配套，必要时重新校验游戏文件。不要仅凭错误类名删除文件。'},
  {id:'disk',pattern:/No space left on device|ENOSPC|磁盘空间不足|AccessDeniedException|Permission denied|EACCES/i,title:'磁盘空间或文件权限问题',hint:'检查游戏所在磁盘空间、文件占用和目录权限。'},
  {id:'download',pattern:/checksum mismatch|哈希校验失败|SocketTimeoutException|UnknownHostException|ETIMEDOUT|net::ERR_/i,title:'下载、校验或网络异常',hint:'检查连接、代理和下载源后重试；保留文件校验，不要跳过损坏文件。'}
]
export function diagnose(text){
  return rules.filter(r=>r.pattern.test(text)).map(({pattern,...rule})=>({...rule,evidence:text.split(/\r?\n/).filter(line=>pattern.test(line)).slice(0,3).map(line=>line.slice(0,400))}))
}
export function compactLog(text,maxChars=18000){
  const lines=String(text).split(/\r?\n/),chosen=new Set()
  // Preserve the start, crash context and end; repeated progress/chat lines are not useful.
  for(let i=0;i<Math.min(18,lines.length);i++)chosen.add(i)
  for(let i=Math.max(0,lines.length-55);i<lines.length;i++)chosen.add(i)
  for(let i=0;i<lines.length;i++)if(/ERROR|FATAL|Exception|Caused by:|requires|missing|incompatible|Problematic frame|JRE version|Java VM|OutOfMemory|Mixin.*fail/i.test(lines[i])){
    for(let n=Math.max(0,i-3);n<Math.min(lines.length,i+12);n++)chosen.add(n)
  }
  const counts=new Map(),out=[]
  for(const i of [...chosen].sort((a,b)=>a-b)){
    const line=lines[i]
    if(/\[CHAT\]|聊天或账户\/服务器信息已隐藏/.test(line))continue
    const key=line.replace(/^\[[^\]]+\]\s*/,'')
    const count=(counts.get(key)||0)+1;counts.set(key,count)
    if(count<=2)out.push((i+1)+': '+line.slice(0,1200))
  }
  let result=out.join('\n')
  if(result.length>maxChars)result=result.slice(0,Math.floor(maxChars*.65))+'\n[中间内容因长度限制省略]\n'+result.slice(-Math.floor(maxChars*.35))
  return result
}
