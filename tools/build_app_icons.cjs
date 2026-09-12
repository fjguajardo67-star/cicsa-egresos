// Empaquetado reproducible en macOS del original aprobado: tamaños PNG e ICO.
// No redibuja el símbolo; sips solo genera sus resoluciones de distribución.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),icons=path.join(root,'assets/icons');
const master=path.join(icons,'cicsa-1024.png');
if(process.platform!=='darwin') throw Error('Este generador usa sips de macOS; los iconos finales están versionados.');
if(!fs.existsSync(master)) throw Error('Falta el original aprobado assets/icons/cicsa-1024.png');
for(const n of [16,32,48,180,192,256,512])
  execFileSync('/usr/bin/sips',['-z',String(n),String(n),master,'--out',path.join(icons,`cicsa-${n}.png`)],{stdio:'ignore'});
const sizes=[16,32,48,256],header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
const images=sizes.map((size,i)=>{
  const bytes=fs.readFileSync(path.join(icons,`cicsa-${size}.png`)),p=6+i*16;
  header[p]=size===256?0:size;header[p+1]=header[p];
  header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);
  header.writeUInt32LE(bytes.length,p+8);header.writeUInt32LE(offset,p+12);
  offset+=bytes.length;return bytes;
});
fs.writeFileSync(path.join(root,'favicon.ico'),Buffer.concat([header,...images]));
console.log('Iconos PNG e ICO generados desde el original aprobado.');
