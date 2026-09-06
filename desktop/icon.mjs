import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
export function buildIcon(dir) {
  const size = 256, raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const i=y*(size*4+1)+1+x*4
    const corner = Math.max(0,32-x,x-223)**2 + Math.max(0,32-y,y-223)**2 > 32**2
    const h=(x>=65 && x<88 && y>=64 && y<192)||(x>=168 && x<191 && y>=64 && y<192)||(x>=88 && x<168 && y>=116 && y<140)
    raw[i]=h?230:15; raw[i+1]=h?246:Math.round(90+70*y/255); raw[i+2]=h?255:Math.round(155+55*x/255); raw[i+3]=corner?0:255
  }
  function crc(buf) { let c=0xffffffff; for(const b of buf){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)} return (c^0xffffffff)>>>0 }
  function chunk(type,data){const t=Buffer.from(type), out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return out}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
  writeFileSync(dir+'/icon.png',png)
  const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18)
  writeFileSync(dir+'/icon.ico',Buffer.concat([ico,png]))
}
