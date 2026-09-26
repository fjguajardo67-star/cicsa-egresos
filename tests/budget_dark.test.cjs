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
  assert(html.includes('assets/budget-dark.css?v=20260926-preview1'));
});
function luminance(hex){const c=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('texto, advertencias y botones tienen contraste AA',()=>{
  for(const [ink,bg] of [['EBEEDF','1B2115'],['B8C2AC','1B2115'],['EBEEDF','232B1B'],['A9D477','1B2115'],['F0A395','321F1C'],['EBEEDF','302815'],['E7C04A','232B1B'],['14200F','A9D477'],['14200F','FFC23E']])assert(contrast(ink,bg)>=4.5,ink+' / '+bg);
});
