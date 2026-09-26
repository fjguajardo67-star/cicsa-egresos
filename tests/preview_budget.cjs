// Vista local aislada: HTML y renderizadores reales, datos ficticios, sin APIs ni guardado.
// node tests/preview_budget.cjs → http://127.0.0.1:4181
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const harness=fs.readFileSync(path.join(__dirname,'run_js_tests.js'),'utf8');
const setup=harness.slice(harness.indexOf('\n')+1,harness.indexOf('let pass = 0, fail = 0;'));
const {extractFunction}=new Function('require','__dirname',setup+'\nreturn {extractFunction};')(require,__dirname);
const names=['renderPresupuesto','renderDetallePresupuesto','actualizarTotalPresupuesto','basePresupuestoPeriodo',
  'pintarSelectorPeriodoSP','celdaProveedor','celdaCategoria','celdaFolio','celdaImporte','celdaFormaPago',
  'formaPagoSelectHtml','esc','escAttrJs','aplicarTema','toggleTema'];
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
function preview(url){
  const baseline=url.searchParams.has('baseline');
  let html=original.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*href="https:[^>]*>/gi,'');
  if(baseline)html=html.replace(/<link[^>]*budget-dark.css[^>]*>/,'');
  return html.replace('</body>',`<script>
  window.fetch=()=>Promise.reject(new Error('Prueba sin red'));
  const TEMA_KEY='cicsa_preview_budget_theme';
  const params=new URLSearchParams(location.search);
  let currentRole=params.get('role')==='operativo'?'operativo':'admin';
  const unlocked=params.get('state')==='edit';
  let _presupDesbloqueadoHasta=Date.now()+600000,_presupGastadoPeriodo=0;
  const currentNombre='Vista de prueba';
  const budget={'Cárnicos':80000,'Frutas y Verduras':30000,'Congelados':12000,'Abarrotes / Secos':20000,'Nómina / Personal':60000,'Desechables':8000};
  const data=[['Cárnicos',92400,'Proveedor de prueba A','efectivo'],['Frutas y Verduras',18500,'Proveedor de prueba B','transferencia'],['Congelados',9500,'Proveedor de prueba C','credito'],['Abarrotes / Secos',14000,'Proveedor de prueba D','efectivo'],['Nómina / Personal',54900,'Nómina de ejemplo','efectivo']].map((r,i)=>({id:String(i),categoria:r[0],importe:r[1],proveedor:r[2],formaPago:r[3],fecha:'2026-09-24',factura:'DEMO-'+(i+1)}));
  const state={budget,budgetObjetivo:220000,weeks:[{id:'demo',label:'21 al 27 sep 2026',ini:'2026-09-21',fin:'2026-09-27'}]};
  if(params.get('state')==='excess')state.budgetObjetivo=150000;
  const catsActuales=()=>Object.keys(budget),presupDesbloqueado=()=>unlocked;
  const getPeriodoSP=()=>({modo:'semana',weekId:'demo',label:'21 al 27 sep 2026'}),getPeriodoSPRaw=()=>({});
  const gastosDelPeriodoSP=()=>params.get('state')==='empty'?[]:data;
  const totalesPorCatPeriodo=()=>Object.fromEntries(gastosDelPeriodoSP().map(g=>[g.categoria,g.importe]));
  const factorPresupuestoPeriodo=()=>({factor:1,esRango:false,dias:7});
  const presupCatPeriodo=(cat,f)=>(budget[cat]||0)*f;
  const fmt=x=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(x),fmtDate=x=>x;
  const permisosDetalle=()=>({formaPago:currentRole==='admin'}),formaPagoLabel=g=>g.formaPago;
  const fechaCorteDatos=()=>'',semanaCalendario=()=>({ini:'2026-09-21',fin:'2026-09-27'});
  const FORMA_PAGO_COLORES={efectivo:{bg:'#E8F5E9',border:'#66BB6A',color:'#1B5E20'},transferencia:{bg:'#E3F2FD',border:'#42A5F5',color:'#0D47A1'},credito:{bg:'#FFF3E0',border:'#FB8C00',color:'#8A5300'}};
  ${names.map(extractFunction).join('\n')}
  function noGuardar(){alert('Vista de prueba: no se guardan datos ni se exportan archivos.');}
  for(const n of ['guardarObjetivoPresupuesto','saveSingleBudget','guardarPresupuesto','resetPresupuesto','exportarExcel','exportarPDF','verEnGastos','editarGastosCategoria','cambiarFormaPagoReporte','agregarCategoria','unificarVariantesCategorias','restaurarCategorias','renombrarCategoria','eliminarCategoria','onCambioPeriodoSP'])window[n]=noGuardar;
  window.desbloquearPresupuesto=()=>location.search='?state=edit';window.bloquearPresupuesto=()=>location.search='';
  document.getElementById('loginScreen').remove();
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-presupuesto'));
  document.querySelectorAll('.nav-btn').forEach(el=>{el.removeAttribute('onclick');el.classList.toggle('active',el.textContent.includes('Presupuesto'));});
  document.getElementById('buildBadge').textContent='PRUEBA LOCAL · sin publicar';
  const note=document.createElement('div');note.style='padding:14px 18px;font:14px system-ui;background:#E6DBC2;color:#172F26;line-height:1.8';
  note.innerHTML='<strong>Prueba de Presupuesto · datos ficticios · sin guardado</strong><br><a href="?">Bloqueado</a> · <a href="?state=edit">Edición</a> · <a href="?role=operativo">Operativo</a> · <a href="?state=excess">Excedido</a> · <a href="?state=empty">Sin gastos</a> · <button onclick="toggleTema()">Alternar claro / oscuro</button>';
  document.getElementById('page-presupuesto').prepend(note);
  aplicarTema(params.get('theme')==='light'?'light':'dark');
  pintarSelectorPeriodoSP('presupPeriodoSel','renderPresupuesto');renderPresupuesto();
  </script></body>`);
}
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(preview(u));}
  if(!u.pathname.startsWith('/assets/')){res.writeHead(404);return res.end();}
  const file=path.resolve(root,'.'+u.pathname);
  if(!file.startsWith(path.join(root,'assets')+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':{'.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(4181,'127.0.0.1',()=>console.log('http://127.0.0.1:4181'));
