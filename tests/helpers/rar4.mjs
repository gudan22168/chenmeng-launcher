// Stored RAR4 records for boundary tests; compressed RAR5 fixtures use the official tool.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function header(type,flags,extra=Buffer.alloc(0)){
  const h=Buffer.alloc(7+extra.length);h[2]=type;h.writeUInt16LE(flags,3);h.writeUInt16LE(h.length,5);extra.copy(h,7);h.writeUInt16LE(crc32(h.subarray(2))&0xffff);return h
}
export function rar4(entries){
  const blocks=[Buffer.from('526172211a0700','hex'),header(0x73,0,Buffer.alloc(6))]
  for(const {name,data='',size,attr=0x20,host=2} of entries){
    const filename=Buffer.from(name),bytes=Buffer.from(data),extra=Buffer.alloc(25+filename.length)
    extra.writeUInt32LE(bytes.length,0);extra.writeUInt32LE(size??bytes.length,4);extra[8]=host;extra.writeUInt32LE(crc32(bytes),9)
    extra[17]=20;extra[18]=0x30;extra.writeUInt16LE(filename.length,19);extra.writeUInt32LE(attr,21);filename.copy(extra,25)
    blocks.push(header(0x74,0x8000,extra),bytes)
  }
  blocks.push(header(0x7b,0));return Buffer.concat(blocks)
}
