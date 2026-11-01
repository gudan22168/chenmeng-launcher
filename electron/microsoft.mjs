import {setTimeout as delay} from 'node:timers/promises'

const identity='https://login.microsoftonline.com/consumers/oauth2/v2.0/'
const minecraft='https://api.minecraftservices.com/'
const scope='XboxLive.signin offline_access'

async function request(url,options,stage){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(25000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok){
    const code=data.XErr || (typeof data.error==='string' ? data.error : '')
    const error=Error(stage+'失败（HTTP '+response.status+(code?' · '+code:'')+'）')
    const aad=(data.error_description || '').match(/AADSTS\d+/)?.[0]
    if(aad) error.message+=' · '+aad
    if(aad==='AADSTS70002' && /marked as 'mobile'/i.test(data.error_description)) error.message+='：请在 Entra 应用的「身份验证」中开启「允许公共客户端流」并保存。'
    if(response.status===403 && url===minecraft+'authentication/login_with_xbox'){
      error.message+='。Microsoft 和 Xbox 授权已完成，但 Minecraft 服务拒绝签发游戏令牌。请启动器开发者核对该客户端 ID 的 Java Edition Game Service API 审核状态。'
    }
    error.code=code
    throw error
  }
  return data
}
const form=(route,fields)=>request(identity+route,{method:'POST',body:new URLSearchParams(fields)},route==='devicecode'?'Microsoft 设备代码申请':'Microsoft 令牌兑换')
const json=(url,body,stage)=>request(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)},stage)

export function deviceCode(client_id){
  return form('devicecode',{client_id,scope})
}
export async function redeem(client_id,device,deadline){
  let interval=(device.interval||5)*1000
  while(Date.now()+interval<deadline){
    await delay(interval)
    try{return await form('token',{client_id,device_code:device.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'})}
    catch(e){
      if(e.code==='slow_down')interval+=5000
      else if(e.code!=='authorization_pending')throw e
    }
  }
  throw Error('登录码已过期，请重新登录')
}
export const renew=(client_id,refresh_token)=>form('token',{client_id,refresh_token,grant_type:'refresh_token',scope})

export async function minecraftSession(msToken){
  const xbox=await json('https://user.auth.xboxlive.com/user/authenticate',{
    Properties:{AuthMethod:'RPS',SiteName:'user.auth.xboxlive.com',RpsTicket:'d='+msToken},
    RelyingParty:'http://auth.xboxlive.com',TokenType:'JWT'
  },'Xbox Live 登录')
  const xsts=await json('https://xsts.auth.xboxlive.com/xsts/authorize',{
    Properties:{SandboxId:'RETAIL',UserTokens:[xbox.Token]},RelyingParty:'rp://api.minecraftservices.com/',TokenType:'JWT'
  },'Xbox 游戏授权')
  const claim=xsts.DisplayClaims.xui[0]
  const mc=await json(minecraft+'authentication/login_with_xbox',{identityToken:'XBL3.0 x='+claim.uhs+';'+xsts.Token},'Minecraft 服务授权')
  const options={headers:{Authorization:'Bearer '+mc.access_token}}
  const profile=await request(minecraft+'minecraft/profile',options,'读取 Java 版角色（请确认该账号有游戏资格并已创建角色）')
  if(!profile.name || !/^[a-f0-9]{32}$/i.test(profile.id))throw Error('Minecraft 角色资料无效')
  return {name:profile.name,uuid:profile.id,type:'microsoft',accessToken:mc.access_token,xuid:claim.xid || '',expires:Date.now()+mc.expires_in*1000}
}
