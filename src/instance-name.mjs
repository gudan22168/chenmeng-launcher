export function instanceName(version,loader,instances){
 const base=version+(loader==='vanilla'?'':'-'+loader)
 let name=base,n=1
 while(instances.some(i=>i.name===name))name=base+' ('+(++n)+')'
 return name
}
