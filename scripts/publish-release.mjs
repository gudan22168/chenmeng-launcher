import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'))
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'))
if(!/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?$/.test(pkg.version)||lock.version!==pkg.version||lock.packages[''].version!==pkg.version)throw Error('Release version mismatch')
const tag='v'+pkg.version,notes='releases/'+tag+'.md',sha=process.env.GITHUB_SHA
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Missing exact build commit')
if(!fs.existsSync(notes))throw Error('Release notes missing')
const gh=(...args)=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})
const releases=JSON.parse(gh('api','--paginate','--slurp','repos/'+process.env.GITHUB_REPOSITORY+'/releases')).flat()
const existing=releases.find(r=>r.tag_name===tag)
if(existing&&!existing.draft){console.log(tag+' already published; immutable assets preserved');process.exit(0)}
if(existing&&existing.target_commitish!==sha)throw Error('Draft belongs to a different commit; refusing overwrite')
const exe='release/ChenMeng-Launcher-'+pkg.version+'-portable.exe'
const hash=createHash('sha256').update(fs.readFileSync(exe)).digest('hex')
fs.writeFileSync('release/SHA256SUMS.txt',hash+'  '+path.basename(exe)+'\n')
if(!existing)gh('release','create',tag,'--draft','--target',sha,'--title','尘梦启动器 '+tag,'--notes-file',notes)
gh('release','upload',tag,exe,'release/SHA256SUMS.txt','--clobber')
gh('release','edit',tag,'--draft=false',pkg.version.includes('-')?'--prerelease':'--latest')
console.log('Published '+tag+' at '+sha)
