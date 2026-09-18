// Funciones reales de captura, sin red ni escrituras a cuentas de producción.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const harness=fs.readFileSync(path.join(__dirname,'run_js_tests.js'),'utf8');
const setup=harness.slice(harness.indexOf('\n')+1,harness.indexOf('let pass = 0, fail = 0;'));
function fixture(){
  const {S,extractFunction}=new Function('require','__dirname',setup+'\nreturn {S,extractFunction};')(require,__dirname);
  const fields=new Map(),alerts=[],saved=[],callbacks=[],uploads=[],products=[];
  const field=id=>{
    if(!fields.has(id)) fields.set(id,{value:'',style:{},classList:{remove(){}},removeAttribute(k){delete this[k];},selectedIndex:0});
    return fields.get(id);
  };
  Object.assign(S,{
    _capturaRevision:0,capturedFile:null,capturedB64:null,capturedDataURL:null,splitData:null,
    _cfdiGmail:null,_cfdiOrigen:null,_esComplementoIA:false,_productosPreleidos:null,
    _fechaAsumida:false,_gmailPendienteCaptura:null,satCFDIs:[],_cfdisStore:[],gmailItems:[],
    document:{getElementById:field,dispatchEvent(){}},window:{scrollTo(){}},
    CustomEvent:class {},SERVER:'https://invalid.test',catsActuales:()=>[],
    showPage(){},checkDuplicateForm(){},checkOtro(){},guardarGmailItemsLocal(){},
    setTimeout:fn=>callbacks.push(fn),alert:m=>alerts.push(m),confirm:()=>true,
    setStatus:(id,msg)=>{field(id).textContent=msg;field(id).style.display='block';},
    setStatusHTML:(id,msg)=>{field(id).textContent=msg;field(id).style.display='block';},
    findDuplicate:()=>null,canonizarCategoria:x=>x,canonizarProveedor:x=>x,
    getActiveWeek:()=>({gastos:saved}),save(){},
    extraerProductosEnSegundoPlano:(...args)=>products.push(args),
    subirRespaldoAStorage:(...args)=>uploads.push(args),
    registrarGmailRevisado(){throw new Error('No marcar un correo anterior como capturado');},
    esc:String,fmt:String,fmtDate:String,avisoGastoFueraDeVista:()=>'',
  });
  for(const name of ['limpiarCaptura','preLlenarCaptura','guardarGasto','bloqueoComplementoPago',
    '_cfdiUuidDeEsteFormulario','leerDocumento','datosDeCaptura','analizarDivision','gmailProcessItem',
    'handleFile','_optimizarCaptura']) vm.runInContext(extractFunction(name),S);
  function openSAT(tipo='I'){
    S.satCFDIs=[{uuid:'TEST-UUID',tipo,folio:'SAT-123',total:120,fecha:'2026-09-15'}];
    S.preLlenarCaptura('PROVEEDOR DE PRUEBA','2026-09-15','SAT-123',120,'test-uuid');
  }
  return {S,field,alerts,saved,callbacks,uploads,products,openSAT};
}
test('SAT tipo I después de Gmail tipo P guarda la factura nueva sin adjunto ni productos anteriores',()=>{
  const f=fixture(),{S}=f;
  Object.assign(S,{_cfdiGmail:{tipo:'P',folio:'P-ANTERIOR'},_esComplementoIA:true,
    capturedFile:{name:'anterior.pdf',_gmailMsgId:'correo-anterior'},capturedB64:'anterior',
    capturedDataURL:'data:anterior',_productosPreleidos:[{nombre:'Anterior'}],
    _gmailPendienteCaptura:{msg_id:'correo-anterior'},_fechaAsumida:true,splitData:{total:999}});
  for(const id of ['fNotas','fOtro','fVencimiento']) f.field(id).value='anterior';
  f.openSAT();
  assert.equal(S._cfdiGmail.tipo,'I');
  for(const key of ['capturedFile','capturedB64','capturedDataURL','_productosPreleidos','_gmailPendienteCaptura','splitData']) assert.equal(S[key],null,key);
  assert.equal(S._esComplementoIA,false);
  assert.equal(S._fechaAsumida,false);
  for(const id of ['fNotas','fOtro','fVencimiento']) assert.equal(f.field(id).value,'');
  for(const id of ['statusLectura','statusGuardar','dupWarning']) assert.equal(f.field(id).style.display,'none');
  f.field('fCategoria').value='Abarrotes';
  S.guardarGasto();
  assert.equal(f.alerts.length,0);
  assert.equal(f.saved.length,1);
  assert.equal(f.saved[0].factura,'SAT-123');
  assert.equal(f.saved[0].importe,120);
  assert.equal(f.saved[0].cfdiUuid,'test-uuid');
  assert.equal(f.saved[0]._gmailMsgId,null);
  assert.equal(f.uploads[0][1],null);
  assert.equal(f.products[0][1],null);
});
test('un verdadero tipo P seleccionado desde SAT sigue bloqueado aunque se escriba un importe',()=>{
  const f=fixture(); f.openSAT('P'); f.S.guardarGasto();
  assert.equal(f.saved.length,0);
  assert.match(f.alerts[0],/SAT-123.*COMPLEMENTO DE PAGO/);
});
test('SAT sin XML disponible no hereda el tipo P anterior',()=>{
  const f=fixture(); f.S._cfdiGmail={tipo:'P'};
  f.S.preLlenarCaptura('PRUEBA','2026-09-15','SIN-XML',120,'LEGADO');
  assert.equal(f.S._cfdiGmail,null);
  f.S.guardarGasto(); assert.equal(f.saved.length,1);
});
test('una respuesta de IA atrasada no modifica la factura SAT',async()=>{
  const f=fixture(); let resolve;
  f.S.capturedFile={type:'application/pdf'}; f.S.capturedB64='anterior';
  f.S.fetch=()=>new Promise(r=>{resolve=r;});
  const pending=f.S.leerDocumento(); f.openSAT();
  resolve({ok:true,status:200,json:async()=>({factura:'VIEJA',es_complemento_pago:true,productos:[{}]})});
  await pending;
  assert.equal(f.field('fFactura').value,'SAT-123');
  assert.equal(f.S._esComplementoIA,false);
  assert.equal(f.S._productosPreleidos,null);
  assert.equal(f.field('btnLeer').disabled,true);
});
test('un error tardío de IA tampoco reemplaza la fecha SAT',async()=>{
  const f=fixture(); let reject;
  f.S.capturedFile={type:'application/pdf'}; f.S.capturedB64='anterior';
  f.S.fetch=()=>new Promise((_,r)=>{reject=r;});
  const pending=f.S.leerDocumento(); f.openSAT(); reject(new Error('lectura anterior'));
  await pending;
  assert.equal(f.field('fFecha').value,'2026-09-15');
  assert.equal(f.field('statusLectura').style.display,'none');
});
test('la división pendiente no reaparece después de abrir SAT',async()=>{
  const f=fixture(); let resolve;
  f.S.capturedB64='anterior'; f.S.fetch=()=>new Promise(r=>{resolve=r;});
  const pending=f.S.analizarDivision(); f.openSAT();
  resolve({ok:true,json:async()=>({total:999,partidas:[{}]})}); await pending;
  assert.equal(f.S.splitData,null);
  assert.equal(f.field('btnLeer').disabled,true);
});
test('el temporizador de Gmail no vuelve a mostrar el aviso del complemento anterior',async()=>{
  const f=fixture();
  f.S.gmailItems=[{mime_type:'application/xml',filename:'p.xml',msg_id:'m',cfdi:{tipo:'P',folio:'P-ANTERIOR'}}];
  await f.S.gmailProcessItem(0); f.openSAT(); await f.callbacks[0]();
  assert.equal(f.field('statusLectura').style.display,'none');
  assert.equal(f.field('fFactura').value,'SAT-123');
  assert.equal(f.S._gmailPendienteCaptura,null);
});
test('la optimización de una imagen anterior no restaura su adjunto',async()=>{
  const f=fixture(); let resolve;
  f.S._redimensionarDataURL=()=>new Promise(r=>{resolve=r;});
  const pending=f.S._optimizarCaptura('data:image/jpeg;base64,old','old.jpg');
  f.openSAT(); resolve(null); await pending;
  assert.equal(f.S.capturedFile,null); assert.equal(f.S.capturedB64,null);
});
test('una lectura vigente conserva los datos de su XML y los productos extraídos',async()=>{
  const f=fixture();
  f.S.capturedFile={type:'application/pdf'}; f.S.capturedB64='vigente';
  f.S._cfdiGmail={tipo:'I',proveedor:'XML',fecha:'2026-09-15',folio:'XML-123',total:120};
  f.S.fetch=async()=>({ok:true,status:200,json:async()=>({proveedor:'IA',factura:'IA-999',importe:999,productos:[{nombre:'Arroz'}]})});
  await f.S.leerDocumento();
  assert.equal(f.field('fFactura').value,'XML-123');
  assert.equal(f.field('fImporte').value,120);
  assert.equal(f.S._productosPreleidos[0].nombre,'Arroz');
  assert.equal(f.field('btnLeer').disabled,false);
});
test('Gmail tipo P vigente continúa bloqueando el guardado',async()=>{
  const f=fixture();
  f.S.gmailItems=[{mime_type:'application/xml',filename:'p.xml',msg_id:'m',cfdi:{tipo:'P',folio:'P-VIGENTE',proveedor:'PRUEBA'}}];
  await f.S.gmailProcessItem(0); await f.callbacks[0]();
  f.field('fImporte').value='120'; f.S.guardarGasto();
  assert.equal(f.saved.length,0); assert.match(f.alerts[0],/P-VIGENTE.*COMPLEMENTO DE PAGO/);
});
