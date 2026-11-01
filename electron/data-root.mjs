import path from 'node:path'
export function dataRoot({override,portable,packaged,executable,project}){
 return override?path.resolve(override):path.join(portable || (packaged?path.dirname(executable):project),'.minecraft')
}
