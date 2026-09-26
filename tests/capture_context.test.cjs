// Funciones reales de captura, sin red ni escrituras a cuentas de producción.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const classification=require('../assets/expense-classification.js');
const harness=fs.readFileSync(path.join(__dirname,'run_js_tests.js'),'utf8');
const setup=harness.slice(harness.indexOf('\n')+1,harness.indexOf('let pass = 0, fail = 0;'));
function fixture(){
  const {S,extractFunction}=new Function('require','__dirname',setup+'\nreturn {S,extractFunction};')(require,__dirname);
  const fields=new Map(),alerts=[],saved=[],callbacks=[],uploads=[],products=[],listeners=new Map();
  const element=()=>({value:'',style:{},dataset:{},hidden:false,selectedIndex:0,options:[],
    add(option){this.options.push(option);},classList:{add(){},remove(){}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},
    append(child){child.parentElement=this;},appendChild(child){child.parentElement=this;},before(){},focus(){},scrollIntoView(){}});
  const field=id=>{
    if(!fields.has(id)) fields.set(id,element());
    return fields.get(id);
  };
  Object.assign(S,{
    CicsaExpenseClassification:classification,_normCat:classification.norm,Option:class {constructor(text,value){this.text=text;this.value=value;}},
    _capturaRevision:0,capturedFile:null,capturedB64:null,capturedDataURL:null,splitData:null,
    _cfdiGmail:null,_cfdiOrigen:null,_esComplementoIA:false,_productosPreleidos:null,
    _fechaAsumida:false,_gmailPendienteCaptura:null,satCFDIs:[],_cfdisStore:[],gmailItems:[],
    document:{getElementById:field,createElement:element,
      addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
      dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);}},window:{scrollTo(){}},
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},SERVER:'https://invalid.test',catsActuales:()=>[],
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
    'handleFile','_optimizarCaptura','checkFormaPago','categoriasCaptura','prepararRevisionProductos',
    'incorporarCongelados','splitGuardar','openSplitModal','closeSplitModal','renderSplitRows','updateSplitDiff',
    'splitGuardarUno','cambiarClasificacionSplit']) vm.runInContext(extractFunction(name),S);
  function installUI(){
    const source=fs.readFileSync(path.join(__dirname,'../assets/workspace.js'),'utf8');
    const start=source.indexOf("  const extracted=document.getElementById('extractedCard');");
    const end=source.indexOf('  // El idioma del control nativo');
    assert(start>=0&&end>start);
    const grid=element(),help=element(),steps={children:[element(),element(),element()]};
    let completion,update;
    S.document.createElement=()=>completion=element();
    Object.assign(S,{grid,help,steps,actualizarEstadoCaptura(){},
      MutationObserver:class {constructor(fn){update=fn;} observe(){}}});
    field('extractedCard').style.display='none';
    grid.append(field('extractedCard'));
    vm.runInContext('(()=>{'+source.slice(start,end)+'})()',S);
    return {grid,steps,get completion(){return completion;},flush:()=>update()};
  }
  function openSAT(tipo='I'){
    S.satCFDIs=[{uuid:'TEST-UUID',tipo,folio:'SAT-123',total:120,fecha:'2026-09-15'}];
    S.preLlenarCaptura('PROVEEDOR DE PRUEBA','2026-09-15','SAT-123',120,'test-uuid');
  }
  return {S,field,alerts,saved,callbacks,uploads,products,openSAT,installUI};
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

for(const mime of ['image/jpeg','application/pdf','application/xml']){
  test(`guardar y abrir Gmail ${mime} restaura formulario y pago sin guardar automáticamente`,async()=>{
    const f=fixture(),{S}=f,ui=f.installUI();
    f.openSAT();f.field('fCategoria').value='Abarrotes';S.guardarGasto();
    assert.equal(ui.grid.hidden,true);
    assert.equal(ui.completion.hidden,false);
    S._redimensionarDataURL=async()=>null;
    S._b64ABytes=()=>new Uint8Array();
    const canvas={getContext:()=>({}),toDataURL:()=> 'data:image/jpeg;base64,preview'};
    S.document.createElement=()=>canvas;
    S.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
      getPage:async()=>({getViewport:()=>({width:10,height:20}),render:()=>({promise:Promise.resolve()})}),destroy:async()=>{}})})};
    S.gmailItems=[{mime_type:mime,filename:'nueva',msg_id:'nuevo',data_b64:'test',
      cfdi:{tipo:'I',folio:'NUEVA',proveedor:'PRUEBA',fecha:'2026-09-26',total:240}}];
    S.fetch=async()=>({ok:true,status:200,json:async()=>({proveedor:'PRUEBA',importe:240})});
    await S.gmailProcessItem(0);await f.callbacks[0]();ui.flush();
    assert.equal(ui.grid.hidden,false,'el padre del formulario debe estar visible');
    assert.equal(ui.completion.hidden,true,'no mostrar éxito de la factura anterior');
    assert.equal(f.field('extractedCard').style.display,'block');
    assert.equal(ui.steps.children[1]['aria-current'],'step');
    assert.equal(f.field('statusGuardar').parentElement,f.field('extractedCard'));
    assert.equal(f.field('imgPreview').style.display,mime==='application/xml'?'none':'block');
    assert.equal(f.saved.length,1,'abrir/leer no registra otro gasto');
    f.field('fFormaPago').value='credito';S.checkFormaPago();
    f.field('fVencimiento').value='2026-10-26';
    assert.equal(f.field('fVencimientoWrap').style.display,'block');
    S.registrarGmailRevisado=()=>{};
    S.guardarGasto();
    assert.equal(f.saved.length,2);
    assert.equal(f.saved[1].factura,'NUEVA');
    assert.equal(f.saved[1].formaPago,'credito');
    assert.equal(f.saved[1].estadoPago,'pendiente');
    assert.equal(f.saved[1]._gmailMsgId,'nuevo');
    assert.equal(ui.completion.hidden,false);
  });
}
test('guardar y abrir SAT también restaura el contenedor de revisión',()=>{
  const f=fixture(),ui=f.installUI();f.openSAT();f.S.guardarGasto();
  f.openSAT();ui.flush();
  assert.equal(ui.grid.hidden,false);assert.equal(ui.completion.hidden,true);
  assert.equal(f.field('extractedCard').style.display,'block');
});
test('una carga de archivo atrasada no oculta el formulario de una captura posterior',async()=>{
  const f=fixture();let resolve;
  f.S._leerArchivoDataURL=()=>new Promise(r=>{resolve=r;});
  const ui=f.installUI();
  const pending=f.S.handleFile({type:'image/jpeg',name:'anterior.jpg'});
  f.openSAT();resolve('data:image/jpeg;base64,old');await pending;ui.flush();
  assert.equal(f.field('extractedCard').style.display,'block');
  assert.equal(f.field('fFactura').value,'SAT-123');
});
test('Capturar otra factura limpia datos y reinicia la presentación sin guardar',()=>{
  const f=fixture(),ui=f.installUI();f.openSAT();f.S.guardarGasto();
  f.field('captureAnother').onclick();ui.flush();
  assert.equal(ui.grid.hidden,false);assert.equal(ui.completion.hidden,true);
  assert.equal(f.field('extractedCard').style.display,'none');
  assert.equal(ui.steps.children[0]['aria-current'],'step');
  assert.equal(f.field('fFactura').value,'');assert.equal(f.saved.length,1);
});
test('PDF sin vista previa y error de IA dejan la captura accesible, sin éxito falso',async()=>{
  const f=fixture(),ui=f.installUI();f.openSAT();f.S.guardarGasto();
  f.S.gmailItems=[{mime_type:'application/pdf',filename:'ilegible.pdf',msg_id:'nuevo',data_b64:'test'}];
  f.S.pdfjsLib={GlobalWorkerOptions:{},getDocument(){throw new Error('PDF ilegible');}};
  f.S._b64ABytes=()=>new Uint8Array();
  f.S.fetch=async()=>{throw new Error('Sin conexión');};
  await f.S.gmailProcessItem(0);await f.callbacks[0]();ui.flush();
  assert.equal(ui.grid.hidden,false);assert.equal(ui.completion.hidden,true);
  assert.equal(f.field('imgPreview').style.display,'none');
  assert.match(f.field('statusLectura').textContent,/Sin conexión/);
  assert.equal(f.field('btnLeer').disabled,false);assert.equal(f.saved.length,1);
});
test('subir un archivo nuevo después de guardar reinicia la captura inmediatamente',async()=>{
  const f=fixture(),ui=f.installUI();f.openSAT();f.S.guardarGasto();
  let resolve;
  f.S._leerArchivoDataURL=()=>new Promise(r=>{resolve=r;});
  f.S._optimizarCaptura=async raw=>{f.S.capturedDataURL=raw;};
  const pending=f.S.handleFile({type:'image/jpeg',name:'nueva.jpg'});
  assert.equal(ui.grid.hidden,false);assert.equal(ui.completion.hidden,true);
  resolve('data:image/jpeg;base64,new');await pending;
  assert.equal(f.field('imgPreview').style.display,'block');
  assert.equal(f.field('btnLeer').disabled,false);
});

function frozenFixture(){
  const f=fixture();
  f.S.state={weeks:[],budget:{},categorias:['Frutas y Verduras','Otro']};
  f.S.capturedFile={type:'application/pdf',_gmailMsgId:'m',name:'factura.pdf'};
  f.S.capturedB64='test';
  f.S._cfdiGmail={tipo:'I',proveedor:'Proveedor A',fecha:'2026-09-26',folio:'XML-REAL',total:140};
  f.S.fetch=async()=>({ok:true,status:200,json:async()=>({proveedor:'IA',fecha:'2026-01-01',factura:'IA-ERR',importe:999,mixto:true,
    productos:[{nombre:'Papa lisa europea',categoria:'Frutas y Verduras',importe:100,precio_unitario:50},
      {nombre:'Zanahoria fresca',categoria:'Frutas y Verduras',importe:40,precio_unitario:20}]})});
  return f;
}
test('división conserva XML y recuerda papa congelada sin mover la verdura fresca ni cambiar precios',async()=>{
  const f=frozenFixture();await f.S.leerDocumento();
  assert.equal(f.S.splitData.proveedor,'Proveedor A');assert.equal(f.S.splitData.factura,'XML-REAL');
  assert.equal(f.S.splitData.total,140);assert.equal(f.S.splitData.fecha,'2026-09-26');
  f.S.splitData.partidas[0].categoria='Congelados';f.S.splitData.partidas[0]._recordar=true;
  f.field('fFormaPago').value='credito';f.field('fVencimiento').value='2026-10-26';
  f.S.splitGuardar();
  assert.equal(f.saved.length,1);assert.equal(f.saved[0].importe,140);
  assert.equal(f.saved[0]._partidas.find(p=>p.categoria==='Congelados').importe,100);
  assert.equal(f.saved[0]._partidas.find(p=>p.categoria==='Frutas y Verduras').importe,40);
  assert.equal(f.saved[0].formaPago,'credito');assert.equal(f.saved[0]._clasificacionProductos[0].nombre,'Papa lisa europea');
  const rules=f.S.state.reglasClasificacionProductos;
  assert.equal(Object.values(rules).length,1);assert.equal(Object.values(rules)[0].categoria,'Congelados');
  assert.equal(f.S.state.categorias.includes('Congelados'),true);
  const g=frozenFixture();g.S.state.reglasClasificacionProductos=rules;await g.S.leerDocumento();
  assert.equal(g.S.splitData.partidas[0].categoria,'Congelados');
  assert.equal(g.S.splitData.partidas[1].categoria,'Frutas y Verduras');
  assert.equal(g.S._productosPreleidos[0].precio_unitario,50);
});
test('cerrar sin guardar y descartar división no persisten reglas ni gastos',async()=>{
  const f=frozenFixture();await f.S.leerDocumento();f.S.splitData.partidas[0]._recordar=true;
  f.S.closeSplitModal();assert.equal(f.S.state.reglasClasificacionProductos,undefined);assert.equal(f.saved.length,0);
  f.S.splitGuardarUno();assert.equal(f.S.splitData,null);assert.equal(f.S.state.reglasClasificacionProductos,undefined);
});
test('diferencia fiscal o importe vacío bloquea guardado y aprendizaje de la regla',async()=>{
  const f=frozenFixture();await f.S.leerDocumento();f.S.splitData.partidas[0]._recordar=true;
  f.S.splitData.total=150;f.S.splitGuardar();
  assert.equal(f.saved.length,0);assert.equal(f.S.state.reglasClasificacionProductos,undefined);
  assert.match(f.field('splitError').textContent,/no suman/);
  f.S.splitData.partidas[0].importe=null;f.S.splitGuardar();assert.equal(f.saved.length,0);
});
test('botón principal abre revisión en vez de ignorar categorías por producto',async()=>{
  const f=frozenFixture();await f.S.leerDocumento();let opened=false;
  f.S.openSplitModal=()=>{opened=true;};f.S.guardarGasto();
  assert.equal(opened,true);assert.equal(f.saved.length,0);
});
test('complementos de pago y sesión no verificada no guardan división ni reglas',async()=>{
  const f=frozenFixture();await f.S.leerDocumento();
  f.S._cfdiGmail.tipo='P';f.S.splitGuardar();assert.equal(f.saved.length,0);
  f.S._cfdiGmail.tipo='I';f.S._financialReady=false;f.S.splitGuardar();assert.equal(f.saved.length,0);
});
