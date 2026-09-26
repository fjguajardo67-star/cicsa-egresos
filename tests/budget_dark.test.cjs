const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'assets/budget-dark.css'),'utf8');
test('el piloto solo afecta Presupuesto oscuro y solo en pantalla',()=>{
  const clean=css.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.match(clean,/@media screen\s*\{/);
  const rules=[...clean.matchAll(/([^{}]+)\{/g)].map(m=>m[1].trim()).filter(s=>!s.startsWith('@'));
  assert(rules.length>15);
  rules.forEach(s=>assert(s.startsWith(':root[data-theme="dark"] #page-presupuesto'),s));
  assert(!/@import|url\(|position\s*:|display\s*:|pointer-events\s*:/.test(clean));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(html.includes('assets/budget-dark.css?v=20260926-palette1'));
});
function luminance(hex){const c=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const dark=html.match(/:root\[data-theme="dark"\] \{([^}]+)\}/)[1];
const tokens=Object.fromEntries([...dark.matchAll(/--dk-([\w-]+):#([\da-f]{6})/gi)].map(m=>[m[1],m[2]]));
test('Resumen y Presupuesto comparten verde, naranja, amarillo y un solo blanco',()=>{
  assert.equal(tokens.brand,'3FAE4C');assert.equal(tokens.orange,'F57C00');assert.equal(tokens.gold,'FFC23E');assert.equal(tokens.ink,'FFFFFF');
  for(const alias of ['ink2','ink3'])assert(dark.includes(`--dk-${alias}:var(--dk-ink)`));
  for(const [name,target] of [['txt','ink'],['txt2','ink'],['vd','brand'],['vm','brand'],['red','orange'],['naranja','orange'],['do','gold']])assert(css.includes(`--${name}:var(--dk-${target})`));
  assert(!/#(?:F0A395|321F1C|89554C|A9D477|C0E593|E7C04A|FFB078|B8C2AC|EBEEDF|192D35|6C98AA)\b/i.test(css));
});
test('texto, advertencias y botones tienen contraste AA con los tokens reales',()=>{
  for(const ink of ['ink','brand','orange','gold'])for(const bg of ['bg','surface','surface2'])assert(contrast(tokens[ink],tokens[bg])>=4.5,ink+' / '+bg);
  for(const bg of ['brand','gold'])assert(contrast('14200F',tokens[bg])>=4.5,'botón / '+bg);
  assert(contrast(tokens.ink,'0F3D2E')>=4.5,'texto de captura');
});
