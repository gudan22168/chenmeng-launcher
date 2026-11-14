// Optional maintainer tool: node scripts/make-rar-fixtures.mjs <official Rar.exe>
// The test suite uses checked-in archives and does not require WinRAR.
import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const tool=path.resolve(process.argv[2]),output=path.resolve('tests/fixtures/rar')
const root=await fs.mkdtemp(path.join(os.tmpdir(),'chen-rar-fixtures-'))
const vanilla={id:'1.20.1',arguments:{game:[],jvm:[]},mainClass:'net.minecraft.client.main.Main',libraries:[]}
await fs.mkdir(output,{recursive:true})
async function write(name,data){const dest=path.join(root,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data))}
function rar(name,args,files,cwd=root){execFileSync(tool,['a','-ma5','-r','-md4m','-m3','-idq','-y',...args,path.join(output,name),...files],{cwd,stdio:'pipe',windowsHide:true})}
try{
  const base='中文整合包/.minecraft/versions/1.20.1/'
  await write(base+'1.20.1.json',vanilla)
  await write(base+'mods/smoke.jar','desktop drop fixture')
  await write(base+'config/中文设置.txt','中文配置\n'.repeat(300))
  for(let n=0;n<25;n++)await write(base+'config/file-'+n+'.txt','fixture data\n'.repeat(200))
  await write('中文整合包/.minecraft/launcher_accounts.json','excluded fixture credentials')
  rar('game-solid.rar',['-s'],['中文整合包'])
  await write('modrinth/modrinth.index.json',{formatVersion:1,game:'minecraft',name:'RAR manifest',dependencies:{minecraft:'1.20.1'},files:[]})
  await write('modrinth/overrides/config/priority.txt','common')
  await write('modrinth/client-overrides/config/priority.txt','client')
  rar('modrinth.rar',['-s'],['*'],path.join(root,'modrinth'))
  await write('secret.txt','fixture password only')
  rar('encrypted.rar',['-ptest-only'],['secret.txt'])
  rar('encrypted-headers.rar',['-hptest-only'],['secret.txt'])
  const noise=Buffer.concat(Array.from({length:400},(_,n)=>createHash('sha256').update(String(n)).digest()))
  await write('volume.bin',noise)
  rar('split.rar',['-v4k','-m0'],['volume.bin'])
  // Only keep the first volume: rejection must happen before extraction asks for part 2.
  for(const name of await fs.readdir(output))if(/^split\.part[2-9]\d*\.rar$/.test(name))await fs.rm(path.join(output,name))
}finally{await fs.rm(root,{recursive:true,force:true})}
