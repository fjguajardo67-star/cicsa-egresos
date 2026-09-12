const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../assets/ingredients-core.js');
const createStore=require('../assets/ingredients-store.js');
const product=(changes={})=>({id:'a',nombre_comercial:'Arroz bolsa 3kg',ingrediente_generico:'Arroz',proveedor_nombre:'Proveedor A',estado:'validado',contenido_cantidad:3,contenido_unidad:'kg',unidad_base:'kg',merma_pct:0,precio_actual:81.84,fecha_precio:'2026-09-01',factura_origen:'F-1',...changes});
const price=p=>C.priceForGroup(C.groups([p])[0]);

test('prefiltro por partida y excepción individual, sin contaminar otros productos',()=>{
  for(const name of ['Detergente 5 L','Servilletas','Vasos desechables','Refresco Pepsi 2L','Papel higiénico'])assert.equal(C.destination(product({nombre_comercial:name})).include,false,name);
  for(const name of ['Sal','Salsa catsup','Aceite vegetal','Leche 1L','Limón'])assert.equal(C.destination(product({nombre_comercial:name})).include,true,name);
  assert.equal(C.destination(product({categoria:'Refrescos / Pepsi',forx_destino:'incluir'})).include,true);
  assert.equal(C.destination(product({categoria:'Refrescos / Pepsi'})).include,false);
  assert.equal(C.destination(product({forx_destino:'excluir'})).include,false);
});
test('conversiones de peso, volumen, piezas y porciones sin suponer cantidad uno',()=>{
  assert.equal(C.conversion(product()).price,27.28);
  assert.equal(C.conversion(product({nombre_comercial:'Aceite 3L',unidad_base:'lt',contenido_unidad:'lt'})).price,27.28);
  assert.equal(C.conversion(product({unidad_base:'pz',piezas_por_presentacion:12,precio_actual:120})).price,10);
  assert.equal(C.conversion(product({unidad_base:'porcion',porcion_valor:100,porcion_unidad:'g',precio_actual:300})).price,10);
  for(const changes of [{contenido_cantidad:0},{precio_actual:null},{precio_actual:Infinity},{merma_pct:-1},{merma_pct:100},{unidad_base:'pz',piezas_por_presentacion:0},{unidad_base:'porcion',porcion_valor:100,porcion_unidad:'ml'},{nombre_comercial:'Aderezo BC 3.8L'}])assert.equal(C.conversion(product(changes)).ok,false,JSON.stringify(changes));
});
test('fecha real y ausencia de fechas: no se usa la fecha de carga',()=>{
  assert.equal(C.date('2026-02-30'),'');
  assert.equal(C.date('09/01/2026'),'');
  assert.equal(price(product({fecha_precio:''})).state,'pendiente');
  const p=C.recordPurchase(product(),{id:'old',fecha:'2026-07-01',precio:30,origen:'factura'});
  assert.equal(p.precio_actual,81.84);assert.equal(price(p).winner.calc.price,27.28);
});
test('compra posterior prevalece; compra repetida no duplica; XML completa evidencia',()=>{
  const o={id:'x',fecha:'2026-09-10',precio:90,origen:'factura',evidencia:'lectura'};
  let p=C.recordPurchase(product(),o);p=C.recordPurchase(p,o);
  assert.equal(p.compras_forx.length,2);assert.equal(price(p).winner.calc.price,30);
  p=C.recordPurchase(p,{...o,precio:93,evidencia:'xml'});
  assert.equal(p.compras_forx.length,2);assert.equal(price(p).winner.calc.price,31);
  assert.deepEqual(C.recordPurchase(p,{...o,precio:999}),p);
});
test('homologar mantiene compras y conversiones separadas, calcula el último precio del grupo',()=>{
  const a=product(),b=product({id:'b',nombre_comercial:'Arroz caja',ingrediente_generico:'Arroz blanco',contenido_cantidad:10,precio_actual:400,fecha_precio:'2026-09-10'});
  const rows=C.homologate([a,b],'a','b');
  assert.equal(C.groups(rows).length,1);assert.equal(rows[0].contenido_cantidad,3);assert.equal(rows[1].contenido_cantidad,10);
  assert.equal(C.priceForGroup(C.groups(rows)[0]).winner.calc.price,40);
  assert.equal(a.ingrediente_id,undefined,'no muta el catálogo original');
  assert(rows[0].sinonimos_menu.includes('Arroz'));
});
test('no reaparece una relación rechazada y no hay sugerencias para Solo Egresos',()=>{
  const a=product({nombre_comercial:'Aderezo ranch 3.8L',ingrediente_generico:'Aderezo'}),b=product({id:'b',nombre_comercial:'Aderezo ranch 1L',ingrediente_generico:'Aderezo ranch'});
  assert.equal(C.suggest([a,b],a).length,1);
  assert.equal(C.suggest([{...a,forx_distintos:['b']},b],{...a,forx_distintos:['b']}).length,0);
  assert.equal(C.suggest([a,b],{...a,forx_destino:'excluir'}).length,0);
});
const matchPair=(left,right)=>{
  const a=product({ingrediente_generico:'',...left,id:'a',ingrediente_id:'group-a'});
  const b=product({ingrediente_generico:'',...right,id:'b',ingrediente_id:'group-b'});
  return [C.suggest([a,b],a).length,C.suggest([a,b],b).length];
};
test('regresión: Aceituna 3kg y Pasta codo 3kg no son el mismo ingrediente',()=>{
  const left={nombre_comercial:'Aceituna 3kg',ingrediente_generico:'Aceituna',proveedor_nombre:'NUEVA WAL MART DE MEXICO'};
  const right={nombre_comercial:'Pasta codo 3kg',proveedor_nombre:left.proveedor_nombre};
  assert.deepEqual(matchPair(left,right),[0,0]);
  assert.equal(C.ingredientIdentity(left),'aceituna');assert.equal(C.ingredientIdentity(right),'pasta codo');
});
test('peso, volumen, número de piezas y empaque no aportan identidad',()=>{
  for(const size of ['3kg','3 KG','3.8L','3,8 lt','500ml','500 g','12 pzas','2x3kg','2 × 3 KG','12 bolsas']){
    assert.equal(C.ingredientIdentity({nombre_comercial:'Aceituna '+size}),'aceituna',size);
    assert.deepEqual(matchPair({nombre_comercial:'Aceituna '+size},{nombre_comercial:'Pasta codo '+size}),[0,0],size);
  }
  for(const name of ['3kg','Caja de 3 kg','12 bolsas','12345','Aderezo','Salsa','Aceite'])assert.equal(C.ingredientIdentity({nombre_comercial:name}),'',name);
});
test('exige el nombre completo y conserva tipo, preparación, con/sin y porcentajes',()=>{
  for(const [a,b] of [
    ['Arroz blanco 3kg','Arroz integral 3kg'],['Aderezo ranch 3.8L','Aderezo mayonesa 3.8L'],
    ['Pasta codo 3kg','Pasta espagueti 3kg'],['Aceitunas verdes 3kg','Aceitunas negras 3kg'],
    ['Aceitunas con hueso 3kg','Aceitunas sin hueso 3kg'],['Leche 1% 1L','Leche 3% 1L'],
    ['Chile jalapeño fresco 3kg','Chile jalapeño en vinagre 3kg'],['Aderezo 3kg','Aderezo ranch 3kg'],
    ['Arroz 3kg','Arroz blanco 3kg'],['Salsa tomate 3kg','Tomate en salsa 3kg'],
    ['Suplemento B12 500g','Suplemento B6 500g'],['Harina tipo 1 3kg','Harina tipo 2 3kg']
  ])assert.deepEqual(matchPair({nombre_comercial:a,ingrediente_generico:'Ingrediente'},{nombre_comercial:b,ingrediente_generico:'Ingrediente'}),[0,0],a+' / '+b);
});
test('mismo alimento explícito sí se propone entre presentaciones, acentos y plurales conocidos',()=>{
  for(const [a,b] of [
    ['Aceituna 3kg','Aceitunas frasco 1 kg'],['CHILE JALAPEÑO 3kg','Chiles jalapenos 500 g'],
    ['Arroz blanco bolsa 3kg','Arroz blanco caja 10kg'],['Aderezo ranch 3.8L','Aderezo ranch botella 1 lt'],
    ['Leche 1,5% 1L','Leche 1.5 % 500ml']
  ])assert.deepEqual(matchPair({nombre_comercial:a},{nombre_comercial:b}),[1,1],a+' / '+b);
});
test('proveedor, marca y categoría no bastan; solo se omite la marca registrada en el nombre',()=>{
  const metadata={marca:'Marca Ejemplo',proveedor_nombre:'Proveedor A',categoria:'Alimentos'};
  assert.deepEqual(matchPair({...metadata,nombre_comercial:'Aceituna Marca Ejemplo 3kg'},{...metadata,nombre_comercial:'Pasta codo Marca Ejemplo 3kg'}),[0,0]);
  assert.deepEqual(matchPair({...metadata,nombre_comercial:'Aceituna Marca Ejemplo 3kg'},{marca:'Otra Marca',nombre_comercial:'Aceitunas Otra Marca frasco 1kg'}),[1,1]);
  assert.equal(C.ingredientIdentity({...metadata,nombre_comercial:'Marca Ejemplo caja 3kg'}),'');
});
test('un mismo nombre de proveedores distintos no reutiliza una conversión sin aprobar',()=>{
  const a=product();assert.equal(C.findProduct([a],{nombre:a.nombre_comercial,proveedor:'Proveedor B'}),null);
  assert.equal(C.findProduct([a],{nombre:a.nombre_comercial,proveedor:'Proveedor A'}).id,'a');
  assert.equal(C.findProduct([a,{...a,id:'b'}],{nombre:a.nombre_comercial,proveedor:'Proveedor A'}),null);
});
test('empates verdaderos requieren elección y una factura posterior invalida la preferencia',()=>{
  let p=C.recordPurchase(product(),{id:'tie',fecha:'2026-09-01',precio:90,origen:'factura'});
  let result=price(p);assert.equal(result.state,'conflicto');
  p.forx_preferido={id:'tie',fecha:'2026-09-01',candidatos:result.candidates.map(c=>c.id+':'+c.calc.price).join('|')};
  assert.equal(price(p).winner.calc.price,30);
  p=C.recordPurchase(p,{id:'later',fecha:'2026-09-02',precio:99,origen:'factura'});assert.equal(price(p).winner.calc.price,33);
});
test('no inventa orden cuando una factura solo tiene día; con dos horas conocidas sí compara',()=>{
  let p=C.recordPurchase(product(),{id:'hour',fecha:'2026-09-01T14:00:00',precio:90});
  assert.equal(price(p).state,'conflicto');
  p=product({compras_forx:[{id:'early',fecha:'2026-09-01T09:00:00',precio:60},{id:'late',fecha:'2026-09-01T14:00:00',precio:90}]});
  assert.equal(price(p).winner.calc.price,30);
});
test('no mezcla unidades; factura prevalece sobre provisional, sin dejar huecos silenciosos',()=>{
  const rows=C.homologate([product(),product({id:'b',nombre_comercial:'Arroz envase',ingrediente_generico:'Arroz preparado',unidad_base:'lt',contenido_unidad:'lt'})],'a','b');
  assert.equal(C.priceForGroup(C.groups(rows)[0]).state,'conflicto');
  const p=C.recordPurchase(product({precio_origen:'web',precio_fuente:'tienda',fecha_precio:'2026-09-10'}),{id:'invoice',fecha:'2026-09-01',precio:60,origen:'factura'});
  assert.equal(price(p).winner.calc.price,20);
});
test('publicador conserva llaves ajenas y anteriores ante conflicto; retira solo las administradas',()=>{
  const previous={Ajeno:{precio:1},Viejo:{precio:2},Arroz:{precio:28}};
  const p=product();const plan=C.publication([p],previous,['Viejo','Arroz']);
  assert.equal(plan.prices.Ajeno.precio,1);assert.equal(plan.prices.Viejo,undefined);assert.equal(plan.prices.Arroz.precio,27.28);
  const conflicted=C.recordPurchase(p,{id:'tie',fecha:p.fecha_precio,precio:90});
  assert.equal(C.publication([conflicted],previous,['Arroz']).prices.Arroz.precio,28);
  const excluded=C.publication([{...p,forx_destino:'excluir'}],previous,['Arroz']);assert.equal(excluded.prices.Arroz,undefined);
});
test('colisiones entre grupos no se resuelven por orden del arreglo',()=>{
  const a=product({ingrediente_id:'one'}),b=product({id:'b',ingrediente_id:'two',precio_actual:300});
  const p=C.publication([a,b],{Arroz:{precio:17}},['Arroz']);assert.equal(p.prices.Arroz.precio,17);assert.equal(p.conflicts.length,2);
});

test('conversión histórica congelada, fechas imposibles y corrección explícita trazable',()=>{
  let p=C.recordPurchase(product(),{id:'xml',precio:90,fecha:'2026-09-10',evidencia:'xml'});
  const older=C.observations(p)[0];p={...p,contenido_cantidad:6};
  assert.equal(C.observationPrice(p,older).price,27.28);
  p=C.recordPurchase(p,{id:'new',precio:120,fecha:'2026-09-11'});
  assert.equal(price(p).winner.calc.price,20);
  p=C.recordPurchase(p,{id:'xml',precio:99,fecha:'2026-09-10',evidencia:'manual',correcciones:[{precio:90}]});
  assert.equal(p.compras_forx.find(o=>o.id==='xml').precio,99);
  assert.equal(p.compras_forx.find(o=>o.id==='xml').correcciones[0].precio,90);
  for(const s of ['2026-09-11T24:01','2026-09-11T10:61','2026-09-11T12:00:60'])assert.equal(C.date(s),'');
  assert.equal(C.conversion(product({unidad_base:'g'})).ok,false);
});
test('exclusiones heredadas retiran solo sus llaves y respetan excepciones activas',()=>{
  const p=product({nombre_comercial:'Pepsi 2L',ingrediente_generico:'Refresco',categoria:'Refrescos'});
  const previous={Refresco:{precio:20},Ajeno:{precio:17}};
  assert.equal(C.publication([p],previous).prices.Refresco,undefined);
  assert.equal(C.publication([p],previous).prices.Ajeno.precio,17);
  const exception={...p,id:'b',ingrediente_id:'b',forx_destino:'incluir',nombre_comercial:'Pepsi 3L',contenido_unidad:'lt',unidad_base:'lt'};
  assert.equal(C.publication([p,exception],previous).prices.Refresco.precio,27.28);
});
test('publicación compatible: fecha de compra separada y vigencia de provisionales',()=>{
  const p=product({precio_origen:'web',precio_fuente:'Consulta manual',fecha_precio:'2026-01-01'});
  const out=C.publication([p],{},[],'2026-09-11').prices.Arroz;
  assert.equal(out.fecha_precio,'2026-01-01');assert.equal(out.fecha,'11/09/2026');assert.equal(out.provisional,true);assert.equal(out.revaluar,true);
});
test('No se conserva aunque una presentación se homologue con otra',()=>{
  const a=product({id:'a',ingrediente_generico:'Arroz',forx_distintos:['b']}),b=product({id:'b',ingrediente_generico:'Arroz integral'}),c=product({id:'c',ingrediente_generico:'Arroz entero'});
  const merged=C.homologate([a,b,c],'b','c');
  assert.equal(C.suggest([a,...merged],a).length,0);
});
test('XML y lectura de la misma factura: prevalece XML sin perder la evidencia original',()=>{
  let p=C.recordPurchase(product(),{id:'ocr',folio:'UUID-1',precio:999,fecha:'2026-09-11',evidencia:'lectura'});
  p=C.recordPurchase(p,{id:'xml',folio:'uuid-1',precio:90,fecha:'2026-09-11',evidencia:'xml'});
  assert.equal(price(p).winner.calc.price,30);assert.equal(p.precio_actual,90);assert.equal(p.compras_forx.length,3);
  assert.equal(price(product({ingrediente_generico:''})).state,'pendiente');
});

function memory(){
  const docs=new Map(),calls=[];let serial=0,fail=0,hook=null;
  const base='https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents';
  const put=(path,data)=>docs.set(path,{data:structuredClone(data),version:String(++serial)});
  const encode=(path,x)=>({name:'projects/demo/databases/(default)/documents/'+path,fields:{json:{stringValue:JSON.stringify(x.data)}},updateTime:x.version});
  const response=(status,data)=>({ok:status<300,status,json:async()=>data});
  const fetcher=async(url,options)=>{
    const path=url.split('/documents')[1].split('?')[0];calls.push({path,options});
    if(fail)return response(fail,{});
    if(path===':commit'){
      const writes=JSON.parse(options.body).writes;
      if(hook){const fn=hook;hook=null;fn();}
      for(const w of writes){const name=(w.update?.name||w.verify).split('/documents/')[1],doc=docs.get(name),pre=w.currentDocument;if(pre.exists===false&&doc||pre.updateTime&&pre.updateTime!==doc?.version)return response(409,{});}
      for(const w of writes)if(w.update)put(w.update.name.split('/documents/')[1],JSON.parse(w.update.fields.json.stringValue));
      return response(200,{});
    }
    if(path==='/productos_comerciales')return response(200,{documents:[...docs].filter(([p])=>p.startsWith('productos_comerciales/')).map(([p,x])=>encode(p,x))});
    const doc=docs.get(path.slice(1));return doc?response(200,encode(path.slice(1),doc)):response(404,{});
  };
  const store=createStore({base,key:'test',fetcher,headers:async()=>({Authorization:'Bearer TEST'}),core:C,session:()=> 'test-user'});
  return {docs,calls,store,put,setFail:x=>fail=x,setHook:fn=>hook=fn};
}
test('producto y pendiente se guardan en un mismo commit; publicación confirmada con CAS',async()=>{
  const m=memory();await m.store.save([product()],{a:null});
  assert(m.docs.get('productos_comerciales/_forx_sync').data.pending);
  const writes=JSON.parse(m.calls.find(c=>c.path===':commit').options.body).writes;assert.equal(writes.length,2);
  const result=await m.store.publish();assert.equal(result.state,'publicado');assert.equal(m.docs.get('datos/precios').data.Arroz.precio,27.28);
  assert.equal(m.docs.get('productos_comerciales/_forx_sync').data.pending,false);
});
test('rechazo HTTP conserva el pendiente y nunca informa publicado',async()=>{
  const m=memory();await m.store.save([product()]);m.setFail(403);
  await assert.rejects(m.store.publish(),/autorizar/);
  assert.equal(m.docs.get('productos_comerciales/_forx_sync').data.pending,true);
  assert.equal(m.docs.has('datos/precios'),false);
});
test('cambio concurrente de precio se vuelve a leer; el reintento viejo no sobrescribe el nuevo',async()=>{
  const m=memory();await m.store.save([product()]);
  m.setHook(()=>{m.put('productos_comerciales/a',(()=>{const {id,...data}=product({precio_actual:150,fecha_precio:'2026-09-11'});return data;})());const meta=m.docs.get('productos_comerciales/_forx_sync').data;m.put('productos_comerciales/_forx_sync',{...meta,pending:true,revision:meta.revision+1});});
  await m.store.publish();assert.equal(m.docs.get('datos/precios').data.Arroz.precio,50);
});
test('edición obsoleta no destruye el cambio de otro usuario',async()=>{
  const m=memory();await m.store.save([product()]);
  await assert.rejects(m.store.save([product({precio_actual:999})],{a:{precio_actual:1}}),/Otro usuario/);
  assert.equal(m.docs.get('productos_comerciales/a').data.precio_actual,81.84);
});
test('scripts compilan y el HTML carga el flujo nuevo sin modificar reglas de acceso',()=>{
  for(const file of ['ingredients-core.js','ingredients-store.js','ingredients.js'])new vm.Script(fs.readFileSync(require('node:path').join(__dirname,'../assets',file),'utf8'));
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert(html.includes('ingredients.js?v=20260912-ingredientes2'));assert(html.includes('window.CicsaCatalog.saveEditor'));assert(html.includes('fecha:primerGasto?.fecha||""'));
  for(const file of ['ingredients.css','ingredients-core.js','ingredients-store.js','ingredients.js']){
    const content=fs.readFileSync(require('node:path').join(__dirname,'../assets',file));
    const hash='sha384-'+require('node:crypto').createHash('sha384').update(content).digest('base64');
    const tag=html.split('\n').find(line=>line.includes('assets/'+file+'?'));assert(tag.includes('integrity="'+hash+'"'));
  }
});

function integration(m){
  const nodes=new Map(),element=id=>{
    if(!nodes.has(id))nodes.set(id,{value:id==='pcForxDestino'?'auto':'',innerHTML:'',textContent:'',style:{},classList:{toggle(){},contains(){return false;}},addEventListener(){}});
    return nodes.get(id);
  };
  const context={CicsaIngredients:C,CicsaIngredientStore:()=>m.store,FB_BASE:'demo',FB_KEY:'demo',fetch:()=>{throw Error('No live network');},fbAuthHeader:async()=>({}),
    auth:{currentUser:{uid:'test-user'},onAuthStateChanged(){}},_catalogoProductos:[],_catalogoProveedores:[],_catalogoCargado:false,_cfdisStore:[],PROVEEDORES_COL:'proveedores',CATALOGO_COL:'productos_comerciales',
    fbListCollection:async()=>[],esc:x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    rfcPropio:()=> 'EMPRESA123',unidadDesdeClaveSAT:x=>x,document:{getElementById:element,addEventListener(){}},crypto:require('node:crypto').webcrypto,
    TextEncoder,structuredClone,setTimeout:()=>1,clearTimeout(){},addEventListener(){},console};
  for(const name of ['cargarCatalogo','fbUpdateDoc','fbCreateDoc','abrirEditorProducto','guardarCfdisEnStore','renderCatalogoProductos','setCatProdFiltro','abrirSyncMenuModal','confirmarSyncMenu','cambiarEstadoRapido','actualizarCalculoPorcion','closeProductoModal'])context[name]=()=>{};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8'),context);
  return {app:context.CicsaCatalog,context,element};
}
test('integración: el catálogo no muestra homologación por peso ni modifica los productos al consultar',async()=>{
  const m=memory();
  await m.store.save([
    product({id:'aceituna',nombre_comercial:'Aceituna 3kg',ingrediente_generico:'Aceituna'}),
    product({id:'pasta',nombre_comercial:'Pasta codo 3kg',ingrediente_generico:'',estado:'pendiente'})
  ]);
  const before=structuredClone([...m.docs]);m.calls.length=0;
  const {app,element}=integration(m);await app.load();await app.render();
  const html=element('page-catalogo-productos').innerHTML;
  assert(!html.includes('data-action="merge"'));assert(html.includes('Pasta codo 3kg'),html);
  assert.deepEqual([...m.docs],before);assert(!m.calls.some(c=>c.path===':commit'));
});
test('integración: una coincidencia de alimento conserva la decisión explícita Sí/No',async()=>{
  const m=memory();await m.store.save([
    product({nombre_comercial:'Aceituna 3kg',ingrediente_generico:'Aceituna'}),
    product({id:'b',nombre_comercial:'Aceitunas frasco 1kg',ingrediente_generico:'',estado:'pendiente'})
  ]);
  const {app,element}=integration(m);await app.load();await app.render();
  const html=element('page-catalogo-productos').innerHTML;
  assert(html.includes('Sí, homologar'),html);assert(html.includes('No, son distintos'));
  assert.equal((html.match(/data-action="merge"/g)||[]).length,1);
});
test('integración: factura mixta, un solo commit, repetición idempotente y precio por fecha',async()=>{
  const m=memory();await m.store.save([product()]);m.calls.length=0;
  const {app}=integration(m);
  const items=[{nombre:'Arroz bolsa 3kg',precio:120},{nombre:'Detergente 1L',precio:60,categoria:'Limpieza'}];
  const result=await app.ingest(items,'Proveedor A','F-NEW',{fecha:'2026-09-11'});
  assert.equal(result.ignorados.length,1);assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  const count=m.docs.size;await app.ingest(items,'Proveedor A','F-NEW',{fecha:'2026-09-11'});assert.equal(m.docs.size,count);
  assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  await app.ingest([{nombre:'Arroz bolsa 3kg',precio:30}],'Proveedor A','F-OLD',{fecha:'2026-07-01'});
  assert.equal(m.docs.get('productos_comerciales/a').data.precio_actual,120);
  await app.publish();assert.equal(m.docs.get('datos/precios').data.Arroz.precio,40);
  assert.equal(Object.keys(m.docs.get('datos/precios').data).some(k=>/detergente/i.test(k)),false);
});
test('integración: XML solo de compras propias, guarda hora real y no genera duplicados',async()=>{
  const m=memory(),{app}=integration(m);
  const xml={uuid:'UUID-DEMO',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02',conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]};
  await app.ingestXml([{...xml,tipo:'P'},{...xml,rfcReceptor:'AJENO'},xml]);
  let products=(await m.store.list()).filter(x=>!x.data._internal);assert.equal(products.length,1);assert.equal(products[0].data.fecha_precio,xml.fecha_hora);
  await app.ingestXml([xml]);products=(await m.store.list()).filter(x=>!x.data._internal);assert.equal(products[0].data.compras_forx.length,1);
});
test('integración: validación preserva hora XML y fallo de red no altera la memoria',async()=>{
  const m=memory(),p=product({fecha_precio:'2026-09-11T15:04:02'});await m.store.save([p]);
  const {app,context}=integration(m);await app.load();
  const {id,...data}=p;await app.saveEditor(id,{...data,fecha_precio:'2026-09-11'});
  assert.equal(m.docs.get('productos_comerciales/a').data.fecha_precio,p.fecha_precio);
  m.setFail(503);await assert.rejects(app.saveEditor(id,{...data,precio_actual:999}),/No se pudo guardar/);
  assert.equal(context._catalogoProductos[0].precio_actual,81.84);
  assert.equal(m.docs.get('productos_comerciales/a').data.precio_actual,81.84);
});
