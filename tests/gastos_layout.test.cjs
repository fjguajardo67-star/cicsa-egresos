const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/workspace.css'),'utf8');
const page=html.slice(html.indexOf('id="page-gastos"'),html.indexOf('id="page-presupuesto"'));
const render=html.slice(html.indexOf('function renderGastos(){'),html.indexOf('function normalizarParaComparar('));

test('Gastos conserva ocho columnas con anchos propios y región desplazable por teclado',()=>{
  assert.equal((page.match(/<col class=/g)||[]).length,8);
  assert.equal((page.match(/<th scope="col"/g)||[]).length,8);
  assert.match(page,/gastos-table-wrap" tabindex="0" role="region"/);
  assert.match(css,/#page-gastos \.gastos-table \{ table-layout:fixed; min-width:1192px; \}/);
  const widths={respaldo:80,fecha:96,categoria:176,factura:168,pago:176,importe:152,acciones:80};
  for(const [name,width] of Object.entries(widths)){
    assert(css.includes(`#page-gastos .gastos-col-${name} { width:${width}px; }`));
  }
  assert.equal(1192-Object.values(widths).reduce((a,b)=>a+b,0),264);
});
test('Eliminar conserva su permiso y alinea un contenedor interior, no una celda flex',()=>{
  assert.match(render,/<td class="gastos-actions-cell"><div class="gastos-row-actions">\$\{celdaAcciones\(g, P\)\}<\/div><\/td>/);
  assert(!render.includes('<td style="display:flex'));
  assert.match(render,/const P = permisosDetalle\("edicion"\)/);
  assert.match(css,/#page-gastos \.gastos-actions-cell \{ display:table-cell; \}/);
  assert.match(css,/#page-gastos \.gastos-row-actions \.del-btn \{ width:44px; min-width:44px; height:44px;/);
});
test('ampliar el importe no altera la celda compartida ni sus cambios de valor',()=>{
  assert.match(css,/#page-gastos \.gastos-table \.amount-cell input \{ width:100% !important; \}/);
  const amount=html.slice(html.indexOf('function celdaImporte('),html.indexOf('function celdaFormaPago('));
  assert(amount.includes('type="number" step="0.01"'));
  assert(amount.includes('width:90px'));
  assert(amount.includes("'importe',parseFloat(this.value)||0"));
  assert(html.includes('workspace.css?v=20260912-egresos4'));
});
