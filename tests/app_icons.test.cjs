const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'site.webmanifest'),'utf8'));
function pngSize(bytes){
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes.subarray(12,16).toString(),'IHDR');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}
test('manifiesto en español, rutas relativas y ventana independiente',()=>{
  assert.equal(manifest.lang,'es-MX');assert.equal(manifest.name,'CICSA Egresos');
  assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.id,'./');
  assert.equal(manifest.display,'standalone');assert.equal(manifest.theme_color,'#0F3D2E');
});
test('Safari y Dock disponen de PNG reales, cuadrados y de alta resolución',()=>{
  assert(manifest.icons.some(i=>i.sizes==='1024x1024'&&i.purpose.includes('maskable')));
  for(const icon of manifest.icons){
    assert(!icon.src.startsWith('/')&&!icon.src.includes('..'));
    assert.equal(pngSize(fs.readFileSync(path.join(root,icon.src.split('?')[0]))),icon.sizes);
  }
  assert.equal(pngSize(fs.readFileSync(path.join(root,'assets/icons/cicsa-180.png'))),'180x180');
});
test('HTML anuncia favicon, apple-touch-icon y manifiesto sin alterar el script financiero',()=>{
  assert.match(html,/<link rel="icon"[^>]*href="favicon\.ico\?/);
  assert.match(html,/<link rel="apple-touch-icon"[^>]*sizes="180x180"/);
  assert.match(html,/<link rel="manifest"[^>]*href="site\.webmanifest\?/);
  assert(html.includes('2026-09-12-egresos-v3'));
});
test('ICO contiene imágenes válidas de 16, 32, 48 y 256 píxeles',()=>{
  const ico=fs.readFileSync(path.join(root,'favicon.ico'));
  assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),4);
  for(const [i,size] of [16,32,48,256].entries()){
    const p=6+i*16,length=ico.readUInt32LE(p+8),offset=ico.readUInt32LE(p+12);
    assert(offset+length<=ico.length);
    assert.equal(pngSize(ico.subarray(offset,offset+length)),`${size}x${size}`);
  }
});
