const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('barra lateral y móvil incluyen el PNG negativo y conservan el positivo',()=>{
  const js=fs.readFileSync(path.join(root,'assets/workspace.js'),'utf8');
  const brand={innerHTML:''},mobile={innerHTML:''};
  vm.runInNewContext(js.slice(js.indexOf('  const brand ='),js.indexOf('  const title=')),{document:{querySelector:s=>s==='.side-brand'?brand:s==='.mt-title'?mobile:null}});
  for(const el of [brand,mobile]){
    assert.match(el.innerHTML,/assets\/cicsa-logo-negativo.png/);
    assert.match(el.innerHTML,/assets\/cicsa-logo.png/);
    assert.match(el.innerHTML,/brand-negative/);
    assert.match(el.innerHTML,/width="960" height="360"/);
  }
  const png=fs.readFileSync(path.join(root,'assets/cicsa-logo-negativo.png'));
  assert.equal(png.subarray(1,4).toString(),'PNG');
  assert.equal(png.readUInt32BE(16),960);assert.equal(png.readUInt32BE(20),360);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(html.includes('sha384-'+crypto.createHash('sha384').update(js).digest('base64')));
});
test('logo oscuro transparente y cambio por CSS sin lógica de tema nueva',()=>{
  const css=fs.readFileSync(path.join(root,'assets/workspace.css'),'utf8');
  assert.match(css,/\.brand-negative\s*\{\s*display:none/);
  assert.match(css,/:root\[data-theme=dark\] \.brand-positive\s*\{\s*display:none/);
  assert.match(css,/:root\[data-theme=dark\] \.brand-negative\s*\{\s*display:block; background:transparent/);
});
test('Revisa tus gastos usa el amarillo de marca en ambos temas',()=>{
  const css=fs.readFileSync(path.join(root,'assets/workspace.css'),'utf8');
  const rules=[...css.matchAll(/(?:^|\n)([^{}]*\.workspace-review)\s*\{([^}]+)\}/g)];
  assert.equal(rules.length,2);
  for(const r of rules)assert.match(r[2],/background:var\(--amarillo\)/);
  assert.match(css,/--amarillo:#FFC23E/);
});
test('la tarjeta de captura tiene un título directo y usa el verde acordado en oscuro',()=>{
  const js=fs.readFileSync(path.join(root,'assets/workspace.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'assets/workspace.css'),'utf8');
  assert(js.includes('<h2>Registra una factura</h2>'));
  assert(!js.includes('Una factura, todo en orden.'));
  assert.match(css,/:root\[data-theme=dark\] \.workspace-capture \{ background:var\(--dk-brand\); color:var\(--dk-bg\);/);
  assert.match(css,/:root\[data-theme=dark\] \.workspace-capture p \{ color:var\(--dk-bg\);/);
});
