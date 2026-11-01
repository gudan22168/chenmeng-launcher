import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {configureNetwork,sourceURLs,sourceText,mirrorURL} from '../electron/sources.mjs'
import {Downloads} from '../electron/downloads.mjs'
import {dataRoot} from '../electron/data-root.mjs'
import {loaderVersions} from '../electron/loaders.mjs'
import {instanceName} from '../src/instance-name.mjs'
const official='https://libraries.minecraft.net/a.jar',mirror=mirrorURL(official)
assert.equal(mirror,'https://bmclapi2.bangbang93.com/maven/a.jar')
assert.deepEqual(sourceURLs(official,{downloadSource:'official',downloadFallback:false}),[official])
assert.deepEqual(sourceURLs(official,{downloadSource:'bmclapi'}),[mirror,official])
assert.deepEqual(sourceURLs('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{}),['https://login.microsoftonline.com/consumers/oauth2/v2.0/token'])
assert.equal(dataRoot({portable:path.resolve('portable'),packaged:true,executable:'/temp/app.exe'}),path.resolve('portable','.minecraft'))
assert.equal(dataRoot({packaged:false,project:path.resolve('project')}),path.resolve('project','.minecraft'))
assert.equal(instanceName('26.1','fabric',[]),'26.1-fabric')
assert.equal(instanceName('26.1','fabric',[{name:'26.1-fabric'}]),'26.1-fabric (2)')
assert.equal(instanceName('26.1','vanilla',[]),'26.1')
let calls=[]
configureNetwork({settings:()=>({downloadSource:'official'}),fetch:async url=>{calls.push(url);return new Response(url===official?'bad':'{"ok":true}') }})
assert.deepEqual(await sourceText(official,undefined,JSON.parse),{ok:true})
assert.equal(calls.length,2)
configureNetwork({settings:()=>({downloadSource:'official'}),fetch:async()=>Response.json({files:['21.1.5','26.1.0.5-beta','26.1.1.1'].map(name=>({name,type:'DIRECTORY'}))})})
assert.deepEqual(await loaderVersions('26.1','neoforge'),['26.1.0.5-beta'])
assert.deepEqual(await loaderVersions('26.1.1','neoforge'),['26.1.1.1'])
assert.deepEqual(await loaderVersions('1.21.1','neoforge'),['21.1.5'])
const folder=await mkdtemp(path.join(os.tmpdir(),'chenmeng-sources-')),file=path.join(folder,'a.jar'),body=Buffer.from('verified'),sha1=createHash('sha1').update(body).digest('hex')
calls=[]
configureNetwork({fetch:async url=>{calls.push(url);return new Response(url===mirror?'corrupt':body)}})
const queue=new Downloads(()=>({downloadSource:'bmclapi'}),()=>{})
try{
 await queue.file(official,file,{sha1},{signal:new AbortController().signal,bytes(){},connection(){}})
 assert.deepEqual(calls,[mirror,official])
 assert.equal((await readFile(file)).toString(),'verified')
 const abort=new AbortController();abort.abort()
 await assert.rejects(queue.file(official,path.join(folder,'cancel.jar'),{sha1},{signal:abort.signal}))
 assert.equal(calls.length,2)
 console.log('PASS source routing, JSON fallback, checksum fallback, cancellation, NeoForge 26.x, instance naming and portable data root')
}finally{await rm(folder,{recursive:true,force:true})}
