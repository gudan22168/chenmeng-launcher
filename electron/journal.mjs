import path from 'node:path'
import {readdir,lstat,readFile,writeFile} from 'node:fs/promises'

const supported = name => /\.(png|jpe?g|webp)$/i.test(name) && !/\.手记(?:-\d+)?\.png$/i.test(name)

export function registerJournal({store,ipcMain,shell,dialog,win}) {
  const directory=id=>path.join(store.directory(id),'screenshots')
  async function source(id,name){
    if(typeof name!=='string' || path.basename(name)!==name || !supported(name)) throw Error('截图名称无效')
    const file=path.join(directory(id),name)
    if(!(await lstat(file)).isFile()) throw Error('原截图已移动')
    return file
  }
  const key=(id,name)=>JSON.stringify([store.data.settings.isolated?id:'shared',name])
  ipcMain.handle('journalList',async(_,id)=>{
    const dir=directory(id)
    const files=(await readdir(dir,{withFileTypes:true})).filter(f=>f.isFile() && supported(f.name))
    return (await Promise.all(files.map(async({name})=>{
      const time=(await lstat(path.join(dir,name))).mtimeMs
      return {name,time,...store.data.journal?.[key(id,name)]}
    }))).sort((a,b)=>b.time-a.time)
  })
  ipcMain.handle('journalPhoto',async(_,id,name)=>{
    const file=await source(id,name)
    return 'data:image/'+path.extname(name).slice(1).replace(/^jpg$/i,'jpeg')+';base64,'+(await readFile(file)).toString('base64')
  })
  ipcMain.handle('journalReveal',async(_,id,name)=>shell.showItemInFolder(await source(id,name)))
  ipcMain.handle('journalSave',async(_,id,name,entry)=>{
    await source(id,name)
    const {title,date,note,filter}=entry
    if(typeof title!=='string'||title.length>80||typeof note!=='string'||note.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['original','warm','mist','mono'].includes(filter)) throw Error('手记内容无效')
    store.data.journal??={}
    store.data.journal[key(id,name)]={title,date,note,filter}
    store.save()
  })
  ipcMain.handle('journalExport',async(_,id,name,bytes)=>{
    const file=await source(id,name)
    const base=file.slice(0,-path.extname(file).length)+'.手记'
    let dest=base+'.png', n=1
    while(await lstat(dest).catch(e=>{if(e.code!=='ENOENT')throw e})) dest=base+'-'+(++n)+'.png'
    const result=await dialog.showSaveDialog(win,{defaultPath:dest,filters:[{name:'PNG 图片',extensions:['png']}]})
    if(result.canceled)return ''
    if(path.resolve(result.filePath).toLowerCase()===path.resolve(file).toLowerCase())throw Error('请选择不同于原截图的文件名')
    await writeFile(result.filePath,Buffer.from(bytes))
    return result.filePath
  })
}
