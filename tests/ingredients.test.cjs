const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../assets/ingredients-core.js');
const createStore=require('../assets/ingredients-store.js');
const product=(changes={})=>({id:'a',nombre_comercial:'Arroz bolsa 3kg',ingrediente_generico:'Arroz',proveedor_nombre:'Proveedor A',estado:'validado',contenido_cantidad:3,contenido_unidad:'kg',unidad_base:'kg',merma_pct:0,precio_actual:81.84,fecha_precio:'2026-09-01',factura_origen:'F-1',...changes});
const price=p=>C.priceForGroup(C.groups([p])[0]);
// Explicar en un comentario por qué algo se retiró no es volver a hacerlo. Se quitan los dos
// tipos: bloques /* */ y líneas // ENTERAS — cortar desde '//' a media línea se come las URLs.
const sinComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');

test('se registra TODO lo comprado: ya no hay prefiltro por categoría ni por nombre',()=>{
  // Antes esto dejaba fuera 391 de 736 productos. Para un historial de compras la regla estorba:
  // el precio del detergente sube igual que el del aceite y hay que poder verlo.
  for(const name of ['Detergente 5 L','Servilletas','Vasos desechables','Refresco Pepsi 2L','Papel higiénico',
                     'Sal','Salsa catsup','Aceite vegetal','Leche 1L','Limón'])
    assert.equal(C.destination(product({nombre_comercial:name})).include,true,name);
  for(const categoria of ['Refrescos / Pepsi','Limpieza','Desechables','Combustible','Nomina Fiscal'])
    assert.equal(C.destination(product({categoria})).include,true,categoria);
  // El destino guardado para FORX tampoco decide nada: ya no hay a dónde mandar un producto.
  assert.equal(C.destination(product({forx_destino:'excluir'})).include,true);
});
test('lo único que sale de la lista es lo que alguien omitió a mano, y se puede recuperar',()=>{
  assert.equal(C.destination(product({estado:'ignorado'})).include,false);
  assert.match(C.destination(product({estado:'ignorado'})).reason,/mano/i);
});
test('fecha real y ausencia de fechas: no se usa la fecha de carga',()=>{
  assert.equal(C.date('2026-02-30'),'');
  assert.equal(C.date('09/01/2026'),'');
  assert.equal(price(product({fecha_precio:''})).state,'pendiente');
  const p=C.recordPurchase(product(),{id:'old',fecha:'2026-07-01',precio:30,origen:'factura'});
  // El precio del grupo es el de la factura más reciente, sin convertir a por-kilo.
  assert.equal(p.precio_actual,81.84);assert.equal(price(p).winner.precio,81.84);
});
test('compra posterior prevalece; compra repetida no duplica; XML completa evidencia',()=>{
  const o={id:'x',fecha:'2026-09-10',precio:90,origen:'factura',evidencia:'lectura'};
  let p=C.recordPurchase(product(),o);p=C.recordPurchase(p,o);
  assert.equal(p.compras_forx.length,2);assert.equal(price(p).winner.precio,90);
  p=C.recordPurchase(p,{...o,precio:93,evidencia:'xml'});
  assert.equal(p.compras_forx.length,2);assert.equal(price(p).winner.precio,93,'el XML corrige la lectura');
  assert.deepEqual(C.recordPurchase(p,{...o,precio:999}),p);
});
test('homologar mantiene las compras separadas y toma la última del grupo',()=>{
  const a=product(),b=product({id:'b',nombre_comercial:'Arroz caja',ingrediente_generico:'Arroz blanco',contenido_cantidad:10,precio_actual:400,fecha_precio:'2026-09-10'});
  const rows=C.homologate([a,b],'a','b');
  assert.equal(C.groups(rows).length,1);assert.equal(rows[0].contenido_cantidad,3);assert.equal(rows[1].contenido_cantidad,10);
  assert.equal(C.priceForGroup(C.groups(rows)[0]).winner.precio,400,'la compra más reciente, tal como se facturó');
  assert.equal(a.ingrediente_id,undefined,'no muta el catálogo original');
  assert(rows[0].sinonimos_menu.includes('Arroz'));
});
test('no reaparece una relación rechazada y no hay sugerencias para lo omitido',()=>{
  const a=product({nombre_comercial:'Aderezo ranch 3.8L',ingrediente_generico:'Aderezo'}),b=product({id:'b',nombre_comercial:'Aderezo ranch 1L',ingrediente_generico:'Aderezo ranch'});
  assert.equal(C.suggest([a,b],a).length,1);
  assert.equal(C.suggest([{...a,forx_distintos:['b']},b],{...a,forx_distintos:['b']}).length,0);
  assert.equal(C.suggest([a,b],{...a,estado:'ignorado'}).length,0,'un omitido no sugiere homologaciones');
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
test('búsqueda manual encuentra nombres distintos sin convertirlos en coincidencias automáticas',()=>{
  const a=product({nombre_comercial:'Aderezo para untar',ingrediente_generico:'Mayonesa'}),b=product({id:'b',nombre_comercial:'Aderezo BC 3.8L',ingrediente_generico:'Aderezo'});
  const ignored={...b,id:'ignored',ingrediente_id:'ignored',estado:'ignorado'},sameGroup={...b,id:'same'};
  assert.equal(C.suggest([a,b],a).length,0);
  assert.equal(C.manualTargets([a,b,ignored,sameGroup],'a','aderezo').length,1);
  assert.equal(C.manualTargets([a,b],'a','a').length,0);
  assert.equal(C.manualTargets([a,b],'a','sin resultados').length,0);
  assert.equal(C.manualTargets([a,b],'missing','aderezo').length,0);
  assert.equal(C.manualTargets([{...a,estado:'ignorado'},b],'a','aderezo').length,0);
  assert.equal(C.manualTargets([a,{...b,forx_distintos:['a']}],'a','aderezo')[0].targetId,'b','decisión explícita puede revisar un No anterior');
});
test('cinco nombres elegidos manualmente conservan cada compra y la fecha más reciente',()=>{
  const names=['Aderezo','Aderezo para untar','Aderezo BC','Salsa para untar','Aderezo de mayonesa'];
  let rows=names.map((name,i)=>product({id:String(i),nombre_comercial:name,ingrediente_generico:name,ingrediente_id:String(i),precio_actual:90+i*3,fecha_precio:'2026-09-'+String(i+1).padStart(2,'0')}));
  for(let i=1;i<5;i++){
    const changed=C.homologate(rows,String(i),'0'),byId=new Map(changed.map(p=>[p.id,p]));rows=rows.map(p=>byId.get(p.id)||p);
  }
  assert.equal(rows.length,5);assert.equal(C.groups(rows).length,1);
  assert.deepEqual(rows.map(p=>p.nombre_comercial),names);
  assert(rows.every(p=>p.compras_forx.length===1&&p.estado==='validado'));
  assert.equal(C.priceForGroup(C.groups(rows)[0]).winner.precio,102,'la compra más reciente de las cinco');
});
test('un mismo nombre de proveedores distintos no reutiliza una conversión sin aprobar',()=>{
  const a=product();assert.equal(C.findProduct([a],{nombre:a.nombre_comercial,proveedor:'Proveedor B'}),null);
  assert.equal(C.findProduct([a],{nombre:a.nombre_comercial,proveedor:'Proveedor A'}).id,'a');
  assert.equal(C.findProduct([a,{...a,id:'b'}],{nombre:a.nombre_comercial,proveedor:'Proveedor A'}),null);
});
test('dos compras el mismo día ya no piden elegir: se muestran las dos y gana la posterior',()=>{
  // Antes esto era un 'conflicto' que alguien tenía que romper a mano, porque había que decidir
  // QUÉ precio publicar a FORX. Un historial no publica: lista las dos y toma la más reciente.
  let p=C.recordPurchase(product(),{id:'tie',fecha:'2026-09-01',precio:90,origen:'factura'});
  const result=price(p);
  assert.equal(result.state,'listo');
  assert.equal(result.candidates.length,2,'las dos del mismo día siguen a la vista');
  p=C.recordPurchase(p,{id:'later',fecha:'2026-09-02',precio:99,origen:'factura'});
  assert.equal(price(p).winner.precio,99,'una factura posterior manda');
});
test('no inventa orden cuando una factura solo tiene día; con dos horas conocidas sí compara',()=>{
  let p=C.recordPurchase(product(),{id:'hour',fecha:'2026-09-01T14:00:00',precio:90});
  // Una trae hora y la otra no: no se asume que la que la trae sea posterior.
  assert.equal(price(p).candidates.length,2);
  p=product({compras_forx:[{id:'early',fecha:'2026-09-01T09:00:00',precio:60},{id:'late',fecha:'2026-09-01T14:00:00',precio:90}]});
  assert.equal(price(p).winner.precio,90,'con las dos horas conocidas sí se compara');
});
test('una factura vieja gana a un precio consultado en internet, aunque sea más nuevo',()=>{
  // Un precio de 'web' es provisional: alguien lo buscó, nadie lo compró. Mientras haya factura,
  // manda la factura aunque sea anterior.
  const p=C.recordPurchase(product({precio_origen:'web',precio_fuente:'tienda',fecha_precio:'2026-09-10'}),{id:'invoice',fecha:'2026-09-01',precio:60,origen:'factura'});
  assert.equal(price(p).winner.precio,60);
  assert.equal(price(p).winner.origen,'factura');
});
test('fechas imposibles y corrección explícita trazable',()=>{
  // La mitad de esta prueba comprobaba que una conversión vieja quedara congelada aunque se
  // cambiara el contenido de la presentación. Sin conversión no hay nada que congelar; lo que
  // sigue importando es que una corrección deje rastro de lo que decía antes.
  let p=C.recordPurchase(product(),{id:'xml',precio:90,fecha:'2026-09-10',evidencia:'xml'});
  p=C.recordPurchase(p,{id:'new',precio:120,fecha:'2026-09-11'});
  assert.equal(price(p).winner.precio,120);
  p=C.recordPurchase(p,{id:'xml',precio:99,fecha:'2026-09-10',evidencia:'manual',correcciones:[{precio:90}]});
  assert.equal(p.compras_forx.find(o=>o.id==='xml').precio,99);
  assert.equal(p.compras_forx.find(o=>o.id==='xml').correcciones[0].precio,90);
  for(const s of ['2026-09-11T24:01','2026-09-11T10:61','2026-09-11T12:00:60'])assert.equal(C.date(s),'');
});
test('No se conserva aunque una presentación se homologue con otra',()=>{
  const a=product({id:'a',ingrediente_generico:'Arroz',forx_distintos:['b']}),b=product({id:'b',ingrediente_generico:'Arroz integral'}),c=product({id:'c',ingrediente_generico:'Arroz entero'});
  const merged=C.homologate([a,b,c],'b','c');
  assert.equal(C.suggest([a,...merged],a).length,0);
});
test('XML y lectura de la misma factura: prevalece XML sin perder la evidencia original',()=>{
  let p=C.recordPurchase(product(),{id:'ocr',folio:'UUID-1',precio:999,fecha:'2026-09-11',evidencia:'lectura'});
  p=C.recordPurchase(p,{id:'xml',folio:'uuid-1',precio:90,fecha:'2026-09-11',evidencia:'xml'});
  assert.equal(price(p).winner.precio,90);assert.equal(p.precio_actual,90);assert.equal(p.compras_forx.length,3);
  // Un producto sin nombre de ingrediente de FORX ya NO queda pendiente: esa exigencia se retiró.
  assert.equal(price(product({ingrediente_generico:''})).state,'listo');
  assert.equal(price(product({precio_actual:null,compras_forx:[]})).state,'pendiente','sin compras sí');
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
test('el producto y su marca se guardan en un solo commit',async()=>{
  // La segunda mitad de esta prueba comprobaba la publicación a datos/precios con CAS. Se retiró
  // con la publicación; lo que queda —una sola escritura, no dos viajes— sigue importando.
  const m=memory();await m.store.save([product()],{a:null});
  const writes=JSON.parse(m.calls.find(c=>c.path===':commit').options.body).writes;assert.equal(writes.length,2);
  assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  assert.equal(m.docs.has('datos/precios'),false,'guardar un producto no escribe el documento de FORX');
});
test('edición obsoleta no destruye el cambio de otro usuario',async()=>{
  const m=memory();await m.store.save([product()]);
  await assert.rejects(m.store.save([product({precio_actual:999})],{a:{precio_actual:1}}),/Otro usuario/);
  assert.equal(m.docs.get('productos_comerciales/a').data.precio_actual,81.84);
});
test('la API ya no ofrece conversión a precio por kilo',()=>{
  assert.equal(typeof C.conversion,'undefined','convertía el precio de factura a por-kilo con merma');
  assert.equal(typeof C.observationPrice,'undefined');
  assert.equal(typeof C.priceForGroup,'function','el precio del grupo sigue, pero sin convertir');
});
test('un producto sin verificar y sin nombre de ingrediente ya tiene precio',()=>{
  // La compuerta de «validado» exigía unidad de costeo, conversión, fecha y nombre de FORX para
  // dar por bueno un producto. Es lo que producía los «Por verificar». Comprar algo no necesita
  // que nadie lo apruebe.
  const crudo={id:'x',nombre_comercial:'Lo que sea',estado:'pendiente',ingrediente_generico:'',
    precio_actual:50,fecha_precio:'2026-09-01',proveedor_nombre:'P'};
  const r=C.priceForGroup(C.groups([crudo])[0]);
  assert.equal(r.state,'listo');
  assert.equal(r.winner.precio,50);
});
test('guardar un producto no exige conversión ni nombre de FORX',()=>{
  const b=sinComentarios(fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8'));
  const editor=b.slice(b.indexOf('async function saveEditor('),b.indexOf('async function ingestXml('));
  assert.equal(/C\.conversion\(/.test(editor),false,'volvió la conversión al guardado');
  assert.equal(/ingrediente de FORX/.test(editor),false,'volvió la exigencia del nombre de FORX');
  assert.equal(/estado==='validado'/.test(editor),false,'volvió la compuerta de validado');
});
test('el formulario del producto ya no pregunta por recetas, porciones ni merma',()=>{
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  // El corte termina en faltantesModal, el siguiente modal del documento: pasarse de ahí
  // arrastra marcado de otras ventanas y la prueba acaba revisando un formulario que no es.
  const ini=html.indexOf('id="productoModal"'),fin=html.indexOf('id="faltantesModal"');
  assert(ini>0&&fin>ini,'cambiaron de orden los modales; hay que rehacer el corte');
  const modal=html.slice(ini,fin);
  for(const campo of ['pcCosteo','pcContCantidad','pcPiezasPorPresentacion','pcPorcionValor','pcMermaPct','pcCalcPreview'])
    assert.equal(modal.includes(campo),false,'quedó el campo '+campo);
  // pcGenerico se queda: es lo que agrupa las presentaciones de un mismo producto bajo un
  // renglón, y eso le sirve al historial. Lo que no puede quedar es que hable de recetas o de
  // Menú, porque ya no alimenta ninguno.
  assert(modal.includes('pcGenerico'),'el nombre que agrupa presentaciones sigue haciendo falta');
  // Los comentarios HTML sí nombran lo retirado —para eso están—, pero nadie los lee en pantalla.
  const visible=modal.replace(/<!--[\s\S]*?-->/g,'');
  assert.equal(/recetas|Menú|FORX/i.test(visible),false,'el formulario sigue hablando de recetas o de Menú');
  assert.equal(/validar/i.test(visible),false,'volvió el botón de validar, y ya no hay nada que validar');
});
test('la pantalla abre en Productos, no en una pestaña vacía',()=>{
  // Sin la compuerta de validado, «Por revisar» solo junta lo que no tiene compras o tiene una
  // homologación sugerida. Abrir ahí hacía parecer que la pantalla estaba rota.
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/view='ingredientes'/);
  assert.equal(/let cached=new Map\(\),view='revision'/.test(src),false);
});

test('ningún camino de los assets escribe datos/precios',()=>{
  // Es el documento que FORX lee. Egresos dejó de publicar, pero el documento NO se borró: queda
  // congelado con sus últimos valores para que lo que todavía lo lea no se quede sin nada. Un
  // publish que vuelva por la puerta de atrás reabriría la escritura sin que nadie lo note — y
  // ahora mandaría también detergentes y refrescos, que ya no se filtran.
  for(const f of ['ingredients-core.js','ingredients-store.js','ingredients.js']){
    const src=fs.readFileSync(require('node:path').join(__dirname,'../assets',f),'utf8');
    const vivo=sinComentarios(src);
    assert.equal(/datos\/precios/.test(vivo),false,f+' volvió a nombrar datos/precios');
  }
});
test('la API pública ya no ofrece publish',()=>{
  const core=require('node:path').join(__dirname,'../assets/ingredients-core.js');
  delete require.cache[require.resolve(core)];
  assert.equal(typeof require(core).publication,'undefined','publication() se retiró del dominio');
  const store=createStore({base:'x',key:'k',fetcher:async()=>({ok:true,json:async()=>({})}),headers:async()=>({}),core:C,session:()=>'u'});
  assert.equal(typeof store.publish,'undefined','la tienda ya no sabe publicar');
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/window\.CicsaCatalog=\{[^}]*\}/);
  assert.equal(/window\.CicsaCatalog=\{[^}]*\bpublish\b/.test(src),false,'CicsaCatalog exportaba publish');
});
test('la pantalla no dice que es de FORX, porque ya no lo es',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  const markup=sinComentarios(src.slice(src.indexOf('function markup('),src.indexOf('async function render(')));
  assert.equal(/FORX/.test(markup),false,'quedó FORX en lo que se pinta');
  assert.match(markup,/Productos comprados/);
  assert.equal(/Solo Egresos/.test(markup),false,'la pestaña de 391 excluidos se retiró');
});
test('el modal viejo de sincronizar a Menú no tiene por dónde abrirse',()=>{
  // index.html todavía sabe escribir datos/precios desde ese modal. Se le quitó el botón que lo
  // abría y la función que lo abría quedó tapiada; si alguna de las dos cosas se deshace, la
  // publicación vuelve por la puerta de atrás.
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert.equal(/onclick="abrirSyncMenuModal\(\)"/.test(html),false,'volvió el botón que abre el modal');
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/abrirSyncMenuModal=function/,'la función de index.html sigue tapiada desde aquí');
  assert.match(src,/confirmarSyncMenu=\(\)=>\{status\(/,'confirmar ya no publica');
});

test('scripts compilan y el HTML carga el flujo nuevo sin modificar reglas de acceso',()=>{
  for(const file of ['ingredients-core.js','ingredients-store.js','ingredients.js'])new vm.Script(fs.readFileSync(require('node:path').join(__dirname,'../assets',file),'utf8'));
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert(html.includes('ingredients.js?v=20261016-recuperar1'));assert(html.includes('window.CicsaCatalog.saveEditor'));assert(html.includes('fecha:primerGasto?.fecha||""'));
  for(const file of ['ingredients.css','ingredients-core.js','ingredients-store.js','ingredients.js']){
    const content=fs.readFileSync(require('node:path').join(__dirname,'../assets',file));
    const hash='sha384-'+require('node:crypto').createHash('sha384').update(content).digest('base64');
    const tag=html.split('\n').find(line=>line.includes('assets/'+file+'?'));assert(tag.includes('integrity="'+hash+'"'));
  }
});

function integration(m){
  const nodes=new Map(),element=id=>{
    if(!nodes.has(id))nodes.set(id,{value:id==='pcForxDestino'?'auto':'',innerHTML:'',textContent:'',style:{},classList:{toggle(){},contains(){return false;}},listeners:{},focus(){this.focused=true;},addEventListener(type,fn){this.listeners[type]=fn;}});
    return nodes.get(id);
  };
  const context={CicsaIngredients:C,CicsaIngredientStore:()=>m.store,FB_BASE:'demo',FB_KEY:'demo',fetch:()=>{throw Error('No live network');},fbAuthHeader:async()=>({}),
    auth:{currentUser:{uid:'test-user'},onAuthStateChanged(){}},_catalogoProductos:[],_catalogoProveedores:[],_catalogoCargado:false,_cfdisStore:[],PROVEEDORES_COL:'proveedores',CATALOGO_COL:'productos_comerciales',
    fbListCollection:async()=>[],esc:x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    rfcPropio:()=> 'EMPRESA123',unidadDesdeClaveSAT:x=>x,document:{getElementById:element,addEventListener(){}},crypto:require('node:crypto').webcrypto,
    TextEncoder,structuredClone,setTimeout:()=>1,clearTimeout(){},addEventListener(){},console};
  for(const name of ['cargarCatalogo','fbUpdateDoc','fbCreateDoc','abrirEditorProducto','guardarCfdisEnStore','renderCatalogoProductos','setCatProdFiltro','abrirSyncMenuModal','confirmarSyncMenu','cambiarEstadoRapido','actualizarCalculoPorcion','closeProductoModal'])context[name]=()=>{};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8'),context);
  const click=async(action,id,extra={})=>{const b={dataset:{action,id,...extra},disabled:false};await element('page-catalogo-productos').listeners.click({target:{closest:()=>b}});return b;};
  const input=value=>element('page-catalogo-productos').listeners.input({target:{id:'ingManualSearch',value}});
  return {app:context.CicsaCatalog,context,element,click,input};
}
test('omitir desde la tarjeta conserva producto e historial, persiste y se puede recuperar',async()=>{
  const m=memory();await m.store.save([product({estado:'pendiente'})]);
  const ui=integration(m);await ui.app.load();await ui.app.render();
  assert(ui.element('page-catalogo-productos').innerHTML.includes('data-action="omit"'));
  const before=structuredClone(m.docs.get('productos_comerciales/a').data);
  await ui.click('omit','a');
  assert.deepEqual(m.docs.get('productos_comerciales/a').data,{...before,estado:'ignorado'});
  assert.equal(C.destination(m.docs.get('productos_comerciales/a').data).include,false);
  await ui.app.ingest([{nombre:before.nombre_comercial,precio:99}],'Proveedor A','NEW',{fecha:'2026-09-12'});
  assert.equal(m.docs.get('productos_comerciales/a').data.estado,'ignorado','una compra no reactiva el omitido');
  const reloaded=integration(m);await reloaded.app.load();await reloaded.click('view','',{view:'omitidos'});
  assert(reloaded.element('page-catalogo-productos').innerHTML.includes('Recuperar para revisión'));
  await reloaded.click('include','a');
  assert.equal(m.docs.get('productos_comerciales/a').data.estado,'pendiente');
  assert.equal(m.docs.get('productos_comerciales/a').data.compras_forx.length,2);
});
test('fallo al omitir no elimina ni cambia el producto local o remoto',async()=>{
  const m=memory();await m.store.save([product()]);const ui=integration(m);await ui.app.load();
  const before=structuredClone([...m.docs]);m.setFail(403);
  await ui.click('omit','a');assert.deepEqual([...m.docs],before);
  assert.equal(ui.context._catalogoProductos[0].estado,'validado');
  assert(ui.element('ingStatus').textContent);
});
test('una presentación omitida de grupo activo aparece y se recupera en Omitidos sin romper el vínculo',async()=>{
  const a=product({ingrediente_id:'grupo',nombre_comercial:'Arroz bolsa 3kg'}),b=product({id:'b',ingrediente_id:'grupo',nombre_comercial:'Arroz caja 10kg',contenido_cantidad:10,precio_actual:400});
  const m=memory();await m.store.save([a,b]);const ui=integration(m);await ui.app.load();
  await ui.click('omit','a');await ui.click('view','',{view:'omitidos'});
  let html=ui.element('page-catalogo-productos').innerHTML;
  assert(html.includes('Arroz bolsa 3kg'));assert(!html.includes('Arroz caja 10kg'));
  assert(html.includes('Recuperar para revisión'));
  assert.equal(m.docs.get('productos_comerciales/b').data.estado,'validado');
  await ui.click('include','a');await ui.click('view','',{view:'ingredientes'});
  html=ui.element('page-catalogo-productos').innerHTML;
  assert(html.includes('2 presentación(es) vinculada(s)'));
  assert.equal(m.docs.get('productos_comerciales/a').data.ingrediente_id,'grupo');
  assert.equal(m.docs.get('productos_comerciales/a').data.estado,'pendiente');
});
test('manual: buscar, elegir y cancelar no escriben; confirmar vincula los grupos explícitamente',async()=>{
  const m=memory();await m.store.save([product({nombre_comercial:'Aderezo',ingrediente_generico:'Aderezo',forx_distintos:['b']}),product({id:'b',nombre_comercial:'Salsa para untar',ingrediente_generico:'Mayonesa'})]);
  const ui=integration(m);await ui.app.load();await ui.click('view','',{view:'ingredientes'});m.calls.length=0;
  await ui.click('manual-open','a');ui.input('mayonesa');
  assert(ui.element('ingManualResults').innerHTML.includes('Elegir Mayonesa'));
  await ui.click('manual-select','a',{other:'b'});
  let html=ui.element('page-catalogo-productos').innerHTML;assert(html.includes('Antes marcaste'));assert(html.includes('Se vincularán 2 presentaciones'));
  await ui.click('manual-cancel','a');assert(!m.calls.some(c=>c.path===':commit'));
  await ui.click('manual-open','a');ui.input('mayonesa');await ui.click('manual-select','a',{other:'b'});
  await ui.click('manual-confirm','a',{other:'b'});
  assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  assert.equal(m.docs.get('productos_comerciales/a').data.ingrediente_generico,'Mayonesa');
  assert.equal(m.docs.get('productos_comerciales/a').data.nombre_comercial,'Aderezo');
  assert.equal(m.docs.get('productos_comerciales/a').data.estado,'validado');
});
test('manual: rechaza confirmar sin seleccionar y conserva selección ante error de guardado',async()=>{
  const m=memory();await m.store.save([product(),product({id:'b',nombre_comercial:'Arroz entero',ingrediente_generico:'Arroz entero'})]);
  const ui=integration(m);await ui.app.load();await ui.click('view','',{view:'ingredientes'});m.calls.length=0;
  await ui.click('manual-confirm','a',{other:'b'});assert(!m.calls.some(c=>c.path===':commit'));
  await ui.click('manual-open','a');ui.input('arroz');await ui.click('manual-select','a',{other:'b'});
  m.setFail(503);const b=await ui.click('manual-confirm','a',{other:'b'});
  assert.equal(b.disabled,false);assert(ui.element('ingManualError').textContent);
  assert(ui.element('page-catalogo-productos').innerHTML.includes('Confirmar homologación'));
  assert.equal(m.docs.get('productos_comerciales/a').data.ingrediente_id,undefined);
  m.setFail(0);await ui.click('manual-confirm','a',{other:'b'});
  assert.equal(m.docs.get('productos_comerciales/a').data.ingrediente_generico,'Arroz entero');
});
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
  const ui=integration(m);await ui.app.load();await ui.app.render();
  // La vista arranca en «Productos»; la sugerencia de homologar vive en «Por revisar», que ahora
  // significa exactamente eso: lo que pide una decisión. El contador la anuncia desde la pestaña.
  assert.match(ui.element('page-catalogo-productos').innerHTML,/data-view="revision"[^>]*>Por revisar <span>1<\/span>/);
  await ui.click('view','',{view:'revision'});
  const html=ui.element('page-catalogo-productos').innerHTML;
  assert(html.includes('Sí, homologar'),html);assert(html.includes('No, son distintos'));
  assert.equal((html.match(/data-action="merge"/g)||[]).length,1);
});
test('integración: factura mixta, un solo commit, repetición idempotente y precio por fecha',async()=>{
  const m=memory();await m.store.save([product()]);m.calls.length=0;
  const {app}=integration(m);
  const items=[{nombre:'Arroz bolsa 3kg',precio:120},{nombre:'Detergente 1L',precio:60,categoria:'Limpieza'}];
  const result=await app.ingest(items,'Proveedor A','F-NEW',{fecha:'2026-09-11'});
  // El detergente ya no se ignora: entra al historial como cualquier otra compra.
  assert.equal(result.ignorados.length,0);assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  const count=m.docs.size;await app.ingest(items,'Proveedor A','F-NEW',{fecha:'2026-09-11'});assert.equal(m.docs.size,count);
  assert.equal(m.calls.filter(c=>c.path===':commit').length,1);
  await app.ingest([{nombre:'Arroz bolsa 3kg',precio:30}],'Proveedor A','F-OLD',{fecha:'2026-07-01'});
  assert.equal(m.docs.get('productos_comerciales/a').data.precio_actual,120);
  assert.equal(m.docs.has('datos/precios'),false,'ingerir facturas no publica nada a FORX');
  const detergente=[...m.docs].find(([k,v])=>/detergente/i.test(v.data.nombre_comercial||''));
  assert(detergente,'el detergente se registra como producto, con su compra');
  assert.equal(detergente[1].data.compras_forx.length,1);
});
test('integración: XML solo de compras propias, guarda hora real y no genera duplicados',async()=>{
  const m=memory(),{app}=integration(m);
  const xml={uuid:'UUID-DEMO',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02',conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]};
  await app.ingestXml([{...xml,tipo:'P'},{...xml,rfcReceptor:'AJENO'},xml]);
  let products=(await m.store.list()).filter(x=>!x.data._internal);assert.equal(products.length,1);assert.equal(products[0].data.fecha_precio,xml.fecha_hora);
  await app.ingestXml([xml]);products=(await m.store.list()).filter(x=>!x.data._internal);assert.equal(products[0].data.compras_forx.length,1);
});
test('integración: cada compra guarda su cantidad y el SKU del proveedor',async()=>{
  // Sin cantidad, un histórico solo dice qué precio tuvo algo, no cuánto se compró — y la mitad
  // del valor de la consulta es ver que de 40 kg en agosto se pasó a 12 en septiembre.
  // El SKU (NoIdentificacion del CFDI) es lo único que identifica el renglón sin depender de
  // cómo esté escrita la descripción.
  const m=memory(),{app}=integration(m);
  const xml={uuid:'UUID-CANT',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',
    fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02',
    conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg',cantidad:40,sku:'000075056656001'}]};
  await app.ingestXml([xml]);
  const compras=(await m.store.list()).filter(x=>!x.data._internal)[0].data.compras_forx;
  assert.equal(compras.length,1);
  assert.equal(compras[0].cantidad,40);
  assert.equal(compras[0].codigo_proveedor,'000075056656001');
  assert.equal(compras[0].evidencia,'xml');
});
test('integración: el historial MUESTRA la cantidad y el SKU, no solo los guarda',async()=>{
  // Guardarlos sin pintarlos deja al usuario sin forma de comprobar que la captura sirvió: la
  // línea del historial decía solo fecha · precio · folio · proveedor.
  const m=memory(),ui=integration(m);
  const xml={uuid:'UUID-VER',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',
    fecha:'2026-08-15',fecha_hora:'2026-08-15T10:00:00',
    conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg',cantidad:40,sku:'000075056656001'}]};
  await ui.app.ingestXml([xml]);await ui.app.render(true);
  const html=ui.element('page-catalogo-productos').innerHTML;
  assert.match(html,/40 kg/,'la cantidad con su unidad');
  assert.match(html,/SKU 000075056656001/,'el SKU del proveedor');
  assert.match(html,/por presentación/,'y lo que ya estaba sigue ahí');
});
test('integración: una compra sin cantidad ni SKU no pinta huecos',async()=>{
  const m=memory(),ui=integration(m);
  const xml={uuid:'UUID-VER2',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',
    fecha:'2026-08-15',fecha_hora:'2026-08-15T10:00:00',conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]};
  await ui.app.ingestXml([xml]);await ui.app.render(true);
  const html=ui.element('page-catalogo-productos').innerHTML;
  assert.equal(/· SKU /.test(html),false,'sin SKU no se escribe la etiqueta vacía en el renglón');
  assert.equal(/· undefined/.test(html),false,'ni un undefined en la línea');
  assert.match(html,/por presentación/);
});
test('integración: lo que no viene en el XML queda AUSENTE, no en cero',async()=>{
  // Un cero se suma y se promedia; un campo ausente se ve como lo que es: no se sabe. Los CFDI
  // guardados antes de capturar NoIdentificacion no traen SKU, y no deben inventar uno vacío.
  const m=memory(),{app}=integration(m);
  const xml={uuid:'UUID-SIN',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',
    fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02',conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]};
  await app.ingestXml([xml]);
  const c=(await m.store.list()).filter(x=>!x.data._internal)[0].data.compras_forx[0];
  assert.equal(Object.hasOwn(c,'cantidad'),false,'sin cantidad no se escribe cantidad:0');
  assert.equal(Object.hasOwn(c,'codigo_proveedor'),false,'sin SKU no se escribe uno vacío');
  assert.equal(c.precio,90,'lo que sí venía sigue ahí');
});
test('integración: reprocesar el mismo XML rellena la compra que ya estaba, sin duplicarla',async()=>{
  // Es cómo se recupera el histórico viejo: los CFDI ya guardados traen cantidad aunque la
  // ingesta la tiraba. Volver a procesarlos la rellena en su sitio, no agrega una compra nueva.
  const m=memory(),{app}=integration(m);
  const base={uuid:'UUID-RE',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',
    fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02'};
  await app.ingestXml([{...base,conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]}]);
  await app.ingestXml([{...base,conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg',cantidad:40,sku:'SKU-1'}]}]);
  const compras=(await m.store.list()).filter(x=>!x.data._internal)[0].data.compras_forx;
  assert.equal(compras.length,1,'la misma factura no se cuenta dos veces');
  assert.equal(compras[0].cantidad,40);
  assert.equal(compras[0].codigo_proveedor,'SKU-1');
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

// ─── Fase D: la consulta del historial de compras ────────────────────────────
const compra=(changes={})=>({id:'o1',precio:90,fecha:'2026-09-11',folio:'F-9',proveedor:'Proveedor A',origen:'factura',evidencia:'xml',...changes});
const conCompras=(obs,changes={})=>product({compras_forx:obs,precio_actual:null,fecha_precio:null,...changes});

test('la consulta aplana las compras sin inventar lo que la factura no trae',()=>{
  const rows=C.purchaseRows([conCompras([
    compra({id:'o1',precio:90,cantidad:40,codigo_proveedor:'SKU-1',unidad:'kg'}),
    compra({id:'o2',precio:95,fecha:'2026-10-02'}),
  ])]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].dia,'2026-10-02','ordena de la más reciente a la más vieja');
  const [nueva,vieja]=rows;
  assert.equal(vieja.cantidad,40);
  assert.equal(vieja.importe,3600,'importe = precio × cantidad, el Importe del renglón del CFDI');
  assert.equal(vieja.sku,'SKU-1');
  // Ausente no es cero: un renglón sin cantidad no vale «compré cero», vale «no se sabe».
  assert.equal(nueva.cantidad,null);
  assert.equal(nueva.importe,null);
  assert.equal(nueva.sku,'','sin SKU en la factura, el renglón no hereda el del producto');
});
test('el SKU del producto sirve para buscar, pero no se le pega al renglón que no lo traía',()=>{
  const rows=C.purchaseRows([conCompras([compra()],{codigo_proveedor:'SKU-HOY'})]);
  assert.equal(rows[0].sku,'','el renglón conserva lo que decía SU factura');
  assert.equal(rows[0].skuProducto,'SKU-HOY');
  assert.equal(C.filterPurchases(rows,{texto:'SKU-HOY'}).length,1,'buscar por el SKU de hoy encuentra su historial');
});
test('lo omitido a mano no entra a la consulta',()=>{
  assert.equal(C.purchaseRows([conCompras([compra()],{estado:'ignorado'})]).length,0);
});
test('una compra sin fecha o sin precio válido no entra: no se puede ni ordenar ni graficar',()=>{
  assert.equal(C.purchaseRows([conCompras([compra({fecha:''}),compra({id:'o2',precio:0}),compra({id:'o3',fecha:'2026-13-40'})])]).length,0);
});
test('los filtros se acumulan: proveedor, rango de fechas y texto',()=>{
  const rows=C.purchaseRows([
    conCompras([compra({id:'o1',fecha:'2026-08-01'}),compra({id:'o2',fecha:'2026-09-15'})]),
    conCompras([compra({id:'o3',fecha:'2026-09-20',proveedor:'Proveedor B'})],{id:'b',nombre_comercial:'Aceite 20L',ingrediente_generico:'Aceite',proveedor_nombre:'Proveedor B'}),
  ]);
  assert.equal(rows.length,3);
  assert.equal(C.filterPurchases(rows,{proveedor:'Proveedor B'}).length,1);
  assert.equal(C.filterPurchases(rows,{desde:'2026-09-01'}).length,2);
  assert.equal(C.filterPurchases(rows,{hasta:'2026-09-16'}).length,2);
  assert.equal(C.filterPurchases(rows,{desde:'2026-09-01',hasta:'2026-09-16'}).length,1);
  assert.equal(C.filterPurchases(rows,{texto:'aceite'}).length,1);
  assert.equal(C.filterPurchases(rows,{texto:'arroz',proveedor:'Proveedor B'}).length,0,'los filtros se suman, no se reemplazan');
  assert.equal(C.filterPurchases(rows,{}).length,3);
  // Una fecha a medio escribir no debe vaciar la pantalla de golpe.
  assert.equal(C.filterPurchases(rows,{desde:'0002-01'}).length,3,'una fecha inválida no filtra');
});
test('buscar por acentos, mayúsculas y varias palabras sueltas',()=>{
  const rows=C.purchaseRows([conCompras([compra()],{nombre_comercial:'Jalapeño en Rajas 2.8 KG',ingrediente_generico:'Jalapeño'})]);
  for(const q of ['jalapeno','JALAPEÑO','rajas jalapeno','2.8'])
    assert.equal(C.filterPurchases(rows,{texto:q}).length,1,q);
  assert.equal(C.filterPurchases(rows,{texto:'jalapeno chipotle'}).length,0,'todas las palabras tienen que estar');
});
test('la gráfica lleva una línea por presentación, no por producto',()=>{
  // Una caja de 3 kg y un frasco de 1 kg del mismo arroz cuestan distinto porque son cosas
  // distintas. Meterlos en una línea dibujaría un desplome de precio que nunca ocurrió.
  const series=C.priceSeries(C.purchaseRows([
    conCompras([compra({id:'o1',precio:90})],{id:'a',nombre_comercial:'Arroz 3kg'}),
    conCompras([compra({id:'o2',precio:31})],{id:'b',nombre_comercial:'Arroz 1kg'}),
  ]));
  assert.equal(series.length,2);
  assert.deepEqual(series.map(s=>s.productoId),['a','b']);
});
test('varias compras el mismo día se promedian pesando por cantidad, y se guarda el rango',()=>{
  const series=C.priceSeries(C.purchaseRows([conCompras([
    compra({id:'o1',precio:90,cantidad:40}),
    compra({id:'o2',precio:120,cantidad:1}),
  ])]));
  const [punto]=series[0].puntos;
  assert.equal(punto.compras,2);
  // 40 cajas a 90 pesan más que 1 a 120: (90·40 + 120·1) / 41.
  assert.ok(Math.abs(punto.precio-(90*40+120)/41)<1e-9,'promedio ponderado por cantidad');
  assert.equal(punto.min,90);
  assert.equal(punto.max,120,'el rango del día se conserva: hubo dos precios, no uno');
});
test('el color de una línea no depende de cuántas compras tenga ni de cuántas la acompañen',()=>{
  // Si el color se asignara por ranking, acotar las fechas repintaría las líneas que quedan y
  // quien aprendió «el frasco es azul» leería mal la gráfica siguiente.
  const productos=[
    conCompras([compra({id:'o1',fecha:'2026-08-01'}),compra({id:'o2',fecha:'2026-09-01'})],{id:'b',nombre_comercial:'Frasco'}),
    conCompras([compra({id:'o3',fecha:'2026-09-01'})],{id:'a',nombre_comercial:'Caja'}),
  ];
  const todo=C.priceSeries(C.purchaseRows(productos));
  assert.deepEqual(todo.map(s=>s.productoId),['a','b'],'orden estable por id, no por número de compras');
  const acotado=C.priceSeries(C.filterPurchases(C.purchaseRows(productos),{desde:'2026-09-01'}));
  assert.deepEqual(acotado.map(s=>s.productoId),['a','b'],'acotar fechas no reordena las que sobreviven');
});
test('la lista de proveedores sale de las compras, sin repetidos ni vacíos',()=>{
  const rows=C.purchaseRows([
    conCompras([compra({id:'o1'}),compra({id:'o2',proveedor:''})]),
    conCompras([compra({id:'o3',proveedor:'Zeta'})],{id:'b'}),
    conCompras([compra({id:'o4',proveedor:'Beta'})],{id:'c'}),
  ]);
  assert.deepEqual(C.supplierList(rows),['Beta','Proveedor A','Zeta']);
});
test('la pantalla tiene la pestaña Consulta con sus filtros y su tabla',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/consulta:'Consulta'/,'falta la pestaña');
  for(const id of ['ingDesde','ingHasta','ingProveedor'])
    assert.match(src,new RegExp(id),'falta el filtro '+id);
  assert.match(src,/data-action="limpiar"/,'sin forma de limpiar, los filtros son una trampa');
});
test('la gráfica usa el palette validado y no se pasa de tres líneas',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Validado con scripts/validate_palette.js sobre fondo #fff, --pairs all: pasa los cinco
  // controles. Cambiar un hex sin volver a correrlo es como cambiarlo a ojo.
  assert.match(src,/SERIE_COLOR=\['#2a78d6','#eb6834','#1baf7a'\]/,'cambió el palette sin revalidarlo');
  assert.match(src,/SERIE_TOPE=3/);
  // La identidad no puede depender solo del color: leyenda siempre, y etiqueta al final de
  // cada línea. Tres de los hex quedan bajo 3:1 contra el blanco y la tabla es el relevo.
  assert.match(src,/ing-legend/,'falta la leyenda');
  assert.match(src,/ing-table/,'falta la tabla, que es el relevo de la gráfica');
});
test('el importe se declara por lo que es: ni «total», ni completo si no lo está',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Lo que importa no es la redacción exacta sino que la cifra no se pueda confundir con el
  // total del gasto: va sin IVA y dice sobre cuántos renglones de cuántos se sumó.
  assert.match(src,/sin IVA/,'llamarle «total» a esto lo haría pasar por el total del gasto');
  assert.match(src,/plural\(conImporte\.length,'renglón','renglones'\)/,'hay que decir sobre cuántos renglones se sumó');
  assert.match(src,/conImporte\.length<rows\.length\?' de '\+rows\.length/,'y de cuántos en total, cuando faltan');
});

// ─── El desplegable de producto y la tabla sin desborde ──────────────────────
test('el desplegable separa los productos que la búsqueda revuelve',()=>{
  // Buscar «papa» traía Papa, Papaya, Puré de papa y Papa Casera en una sola lista.
  const rows=C.purchaseRows([
    conCompras([compra({id:'o1'}),compra({id:'o2',fecha:'2026-10-01'})],{id:'a',nombre_comercial:'Papa Lisa 2.5 kg',ingrediente_generico:'PAPA'}),
    conCompras([compra({id:'o3'})],{id:'b',nombre_comercial:'PAPA',ingrediente_generico:'PAPA'}),
    conCompras([compra({id:'o4'})],{id:'c',nombre_comercial:'Papaya',ingrediente_generico:'Papaya'}),
    conCompras([compra({id:'o5'})],{id:'d',nombre_comercial:'Puré de papa',ingrediente_generico:'Puré de papa'}),
  ]);
  const lista=C.productList(rows);
  assert.deepEqual(lista.map(g=>g.nombre),['PAPA','Papaya','Puré de papa'],'ordenado por nombre, un renglón por producto');
  const papa=lista.find(g=>g.nombre==='PAPA');
  assert.equal(papa.compras,3,'suma las compras de sus dos presentaciones');
  assert.equal(papa.presentaciones,2);
});
test('elegir un producto deja solo sus compras',()=>{
  const rows=C.purchaseRows([
    conCompras([compra({id:'o1'})],{id:'a',ingrediente_generico:'PAPA'}),
    conCompras([compra({id:'o2'})],{id:'b',ingrediente_generico:'Papaya'}),
  ]);
  const papa=C.productList(rows).find(g=>g.nombre==='PAPA');
  const solo=C.filterPurchases(rows,{grupo:papa.grupoId});
  assert.equal(solo.length,1);
  assert.equal(solo[0].producto,'PAPA');
  assert.equal(C.filterPurchases(rows,{grupo:'no-existe'}).length,0);
});
test('el desplegable se arma sin su propio filtro, para poder cambiar de producto',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Si se armara con el filtro puesto, elegir un producto dejaría una sola opción en la lista
  // y no habría forma de cambiarse a otro sin limpiar todo.
  assert.match(src,/const base=C\.filterPurchases\(todas,\{\.\.\.consulta,producto:'',grupo:'',texto:query\}\)/);
  assert.match(src,/productos\.some\(x=>x\.grupoId===consulta\.producto\)\?consulta\.producto:''/,'un producto que ya no está entre las opciones debe ignorarse, no vaciar la pantalla');
});
test('la gráfica no se dibuja con muchos productos revueltos',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/\(grupos\.size===1\|\|series\.length<=SERIE_TOPE\)\?chart\(series\)/,'tres líneas entre trece son ruido con pinta de dato');
  assert.match(src,/Elige un producto para ver la gráfica/);
});
test('la tabla no repite el nombre en dos columnas ni deja que se desborde',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  const css=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.css'),'utf8');
  const encabezados=src.match(/\['Fecha',[^\]]*\]/)[0];
  assert.equal(/'Presentación'/.test(encabezados),false,'Producto y Presentación traían el mismo texto y se encimaban');
  assert.match(encabezados,/'Producto'/);
  // table-layout:fixed es lo que obliga al texto largo a partirse DENTRO de su celda; sin eso
  // el nombre se salía por encima de la columna de al lado.
  assert.match(css,/\.ing-table\{[^}]*table-layout:fixed/);
  assert.match(css,/\.ing-table th,\.ing-table td\{[^}]*overflow-wrap:anywhere/);
  // Una cifra partida a la mitad («$2,520.0 / 0») es ilegible.
  assert.match(css,/\.ing-table \.ing-num\{[^}]*white-space:nowrap/);
});
test('el eje nunca rotula «-$0»',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Math.ceil de un negativo chico devuelve -0, e Intl lo formatea como «-$0».
  assert.match(src,/out\.push\(v===0\?0:v\)/,'volvió el -0 del eje');
  assert.equal(Object.is(Math.ceil(-9.6/50)*50,-0),true,'si esto deja de ser -0, el guardia de arriba sobra');
});
test('las cantidades se pluralizan: «6 piezas», no «6 pieza»',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/unitN=\(x,n\)=>n===1\?unit\(x\):/);
  assert.match(src,/unitN\(r\.unidad,r\.cantidad\)/);
});

// ─── Importe del CFDI y gasto por producto / proveedor ───────────────────────
test('el importe sale del renglón del CFDI, no de una multiplicación nuestra',()=>{
  // El Importe viene en el XML y es lo que se pagó por esa partida. Multiplicar precio ×
  // cantidad da lo mismo cuando ambos están, pero cuando el XML trae el importe es el dato
  // bueno y hay que usarlo: arrastra el redondeo del proveedor, no el nuestro.
  const rows=C.purchaseRows([conCompras([
    compra({id:'o1',precio:18.2,importe:910.07}),
    compra({id:'o2',precio:20,cantidad:5,fecha:'2026-09-28'}),
    compra({id:'o3',precio:21,fecha:'2026-09-29'}),
  ])]);
  const porId=Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(porId.o1.importe,910.07,'el importe de la factura manda');
  assert.equal(porId.o1.importeOrigen,'factura');
  assert.equal(porId.o2.importe,100,'sin importe en la factura se calcula precio × cantidad');
  assert.equal(porId.o2.importeOrigen,'calculado');
  assert.equal(porId.o3.importe,null,'sin importe ni cantidad no se inventa un número');
  assert.equal(porId.o3.importeOrigen,'');
});
test('un importe de cero o negativo no se toma por bueno',()=>{
  const rows=C.purchaseRows([conCompras([compra({importe:0,precio:20,cantidad:3}),compra({id:'o2',importe:-5,precio:10,fecha:'2026-09-28'})])]);
  const porId=Object.fromEntries(rows.map(r=>[r.id,r]));
  assert.equal(porId.o1.importe,60,'importe 0 en el XML no vale: se calcula');
  assert.equal(porId.o2.importe,null);
});
test('el gasto se agrupa por producto y por proveedor, con su cobertura',()=>{
  const rows=C.purchaseRows([
    conCompras([compra({id:'o1',importe:900}),compra({id:'o2',importe:600,fecha:'2026-09-20'}),compra({id:'o3',fecha:'2026-09-21'})],
      {id:'a',nombre_comercial:'Papa',ingrediente_generico:'PAPA'}),
    conCompras([compra({id:'o4',importe:2000,proveedor:'Beta'})],{id:'b',nombre_comercial:'Papaya',ingrediente_generico:'Papaya',proveedor_nombre:'Beta'}),
  ]);
  const porProducto=C.spendBy(rows,'producto');
  assert.deepEqual(porProducto.map(x=>[x.nombre,x.importe]),[['Papaya',2000],['PAPA',1500]],'de mayor a menor gasto');
  const papa=porProducto.find(x=>x.nombre==='PAPA');
  assert.equal(papa.compras,3);
  assert.equal(papa.conImporte,2,'hay que poder decir que el total deja fuera una compra');
  const porProveedor=C.spendBy(rows,'proveedor');
  assert.deepEqual(porProveedor.map(x=>[x.nombre,x.importe]),[['Beta',2000],['Proveedor A',1500]]);
});
test('el gasto por proveedor junta las grafías del mismo proveedor',()=>{
  // «ANA KAREM HUERTA DIAZ» y «ANA KAREM HUERTA DÍAZ» son el mismo, y partirle el gasto en dos
  // renglones haría parecer que se le compró la mitad.
  const rows=C.purchaseRows([conCompras([
    compra({id:'o1',importe:100,proveedor:'ANA KAREM HUERTA DIAZ'}),
    compra({id:'o2',importe:150,proveedor:'ANA KAREM HUERTA DÍAZ',fecha:'2026-09-20'}),
  ])]);
  const porProveedor=C.spendBy(rows,'proveedor');
  assert.equal(porProveedor.length,1,'una sola fila');
  assert.equal(porProveedor[0].importe,250);
  assert.deepEqual(C.supplierList(rows).length,1,'y una sola opción en el desplegable');
});
test('el desplegable de proveedores se queda con la grafía más usada',()=>{
  const rows=C.purchaseRows([conCompras([
    compra({id:'o1',proveedor:'ANA KAREM HUERTA DIAZ'}),
    compra({id:'o2',proveedor:'ANA KAREM HUERTA DIAZ',fecha:'2026-09-20'}),
    compra({id:'o3',proveedor:'ANA KAREM HUERTA DÍAZ',fecha:'2026-09-21'}),
  ])]);
  assert.deepEqual(C.supplierList(rows),['ANA KAREM HUERTA DIAZ']);
});
test('sin ningún importe, la pantalla lo dice en vez de enseñar $0.00',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // «$0.00» se lee como «no gastaste nada», y lo que pasa es que falta el dato.
  assert.match(src,/\$\{conImporte\.length\?e\(money\(importe\)\):'—'\}/,'volvió el $0.00 engañoso');
  assert.match(src,/ningún renglón trae con qué calcularlo/);
  assert.match(src,/Vuelve a subir los XML/,'hay que decir cómo se arregla');
});
test('el XML ya no tira el Importe del renglón',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/importe:k\.importe/,'el mapeo de conceptos volvió a perderlo');
  assert.match(src,/Number\.isFinite\(importe\)&&importe>0\?\{importe\}:\{\}/);
});
test('integración: reprocesar un XML rellena el importe que faltaba',async()=>{
  const m=memory(),{app}=integration(m);
  const base={uuid:'UUID-IMP',tipo:'I',rfcReceptor:'EMPRESA123',rfc:'PROVEEDOR',proveedor:'Proveedor A',fecha:'2026-09-11',fecha_hora:'2026-09-11T15:04:02'};
  await app.ingestXml([{...base,conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg'}]}]);
  await app.ingestXml([{...base,conceptos:[{desc:'Arroz 3kg',precio:90,unidad:'kg',cantidad:40,importe:3600}]}]);
  const compras=(await m.store.list()).filter(x=>!x.data._internal)[0].data.compras_forx;
  assert.equal(compras.length,1,'la misma factura no se cuenta dos veces');
  assert.equal(compras[0].importe,3600,'volver a subir el XML rellena el importe');
});

// ─── Racimos de duplicados y fusión en bloque ────────────────────────────────
// Así llegan de verdad los productos del XML: con nombre comercial y SIN ingrediente_generico,
// que es lo que los deja a cada uno en su propio grupo. Ponérselo aquí los agruparía solo,
// y la prueba diría que no hay duplicados cuando en la app sí los hay.
const prod=(id,nombre,changes={})=>product({id,nombre_comercial:nombre,ingrediente_generico:'',compras_forx:[compra({id:'c'+id})],precio_actual:null,fecha_precio:null,...changes});

test('los racimos juntan lo que solo cambia en mayúsculas o acentos',()=>{
  const racimos=C.duplicateClusters([
    prod('a','Papa delgada europea bol 2.5 kg'),
    prod('b','PAPA DELGADA EUROPEA BOL 2.5 KG'),
    prod('c','Papaya'),
  ]);
  assert.equal(racimos.length,1);
  assert.equal(racimos[0].nivel,'exacto','solo cambian mayúsculas: no hay nada que juzgar');
  assert.deepEqual(racimos[0].miembros.map(g=>g.nombre).sort(),['PAPA DELGADA EUROPEA BOL 2.5 KG','Papa delgada europea bol 2.5 kg']);
});
test('los racimos marcan como probable lo que cambia de redacción',()=>{
  const racimos=C.duplicateClusters([
    prod('a','Puré de papa instantáneo 2.5 kg (HOP)'),
    prod('b','Puré de Papa Instantáneo 2.5kg HOP'),
  ]);
  assert.equal(racimos.length,1);
  assert.equal(racimos[0].nivel,'probable','no es el mismo texto: lo confirma una persona');
});
test('lo que cambia de calificativo no se propone siquiera',()=>{
  // «procesado», «(botana)» y «de pollo» pueden ser productos distintos. Esa decisión no es
  // de la máquina, así que ni aparecen como racimo.
  for(const [a,b] of [['MM Queso Americano','MM Queso Americano procesado'],
                      ['Pulpa de pechuga','Pulpa de pechuga de pollo'],
                      ['Pierna sin Hueso de Cerdo','Pierna sin Hueso Frontera de Cerdo']])
    assert.deepEqual(C.duplicateClusters([prod('a',a),prod('b',b)]),[],a+' / '+b);
});
test('un «son distintos» de antes se respeta y saca a los dos del racimo',()=>{
  const racimos=C.duplicateClusters([
    prod('a','Pepsi 12 OZ Lata 24',{forx_distintos:['b']}),
    prod('b','Pepsi 12 oz lata 24'),
  ]);
  assert.deepEqual(racimos,[],'volver a proponer lo ya rechazado es ignorar una decisión tomada');
});
test('un producto omitido no entra a los racimos',()=>{
  assert.deepEqual(C.duplicateClusters([prod('a','Papa Lisa'),prod('b','PAPA LISA',{estado:'ignorado'})]),[]);
});
test('los racimos ponen primero los seguros y los que más compras arrastran',()=>{
  const racimos=C.duplicateClusters([
    prod('a','Puré HOP'),prod('b','Pure hop 2.5kg'),
    prod('c','Arroz Grano Largo'),prod('d','ARROZ GRANO LARGO'),
  ]);
  assert.deepEqual(racimos.map(r=>r.nivel),['exacto','probable']);
});
test('fusionar en bloque conserva todas las presentaciones y su historial',()=>{
  const productos=[
    prod('a','Papa Lisa',{compras_forx:[compra({id:'c1',precio:111}),compra({id:'c2',precio:98,fecha:'2026-08-26'})]}),
    prod('b','PAPA LISA',{compras_forx:[compra({id:'c3',precio:119})]}),
    prod('c','papa lisa',{compras_forx:[compra({id:'c4',precio:120})]}),
  ];
  const [racimo]=C.duplicateClusters(productos);
  assert.equal(racimo.miembros.length,3);
  const destino=racimo.miembros.find(g=>g.nombre==='Papa Lisa');
  const cambios=C.homologateMany(productos,racimo.miembros.map(g=>g.id),destino.id);
  assert.equal(cambios.length,3,'los tres quedan en el mismo grupo');
  assert.equal(new Set(cambios.map(p=>p.ingrediente_id)).size,1);
  for(const p of cambios) assert.equal(p.ingrediente_nombre,'Papa Lisa','queda el nombre del destino');
  // Ninguna compra se pierde: 2 + 1 + 1.
  assert.equal(cambios.reduce((n,p)=>n+C.observations(p).length,0),4);
  // Y después de fusionar ya no hay racimo que proponer.
  const despues=productos.map(p=>cambios.find(c=>c.id===p.id)||p);
  assert.deepEqual(C.duplicateClusters(despues),[]);
});
test('fusionar exige al menos dos, y que el nombre que queda sea uno de ellos',()=>{
  const productos=[prod('a','Papa Lisa'),prod('b','PAPA LISA')];
  const [racimo]=C.duplicateClusters(productos);
  assert.throws(()=>C.homologateMany(productos,[racimo.miembros[0].id],racimo.miembros[0].id),/al menos dos/);
  assert.throws(()=>C.homologateMany(productos,racimo.miembros.map(g=>g.id),'ing:otro'),/tiene que ser uno de los que se fusionan/);
});

// ─── La unidad de factura volvió a tener campo ───────────────────────────────
test('el formulario deja decir en qué unidad factura el proveedor',()=>{
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  const modal=html.slice(html.indexOf('id="productoModal"'),html.indexOf('id="faltantesModal"'));
  // La fase C se llevó los controles de costeo y con ellos el único sitio donde se decía «esto
  // se factura por litro». El dato siguió vivo —el XML lo trae y pinta «$20.12 / L»— pero un
  // producto capturado a mano se quedaba sin él, sin forma de verlo ni corregirlo.
  assert.match(modal,/id="pcUnidad"/,'no hay dónde poner la unidad');
  for(const u of ['kg','lt','pz','cja','paq'])
    assert.match(modal,new RegExp('<option value="'+u+'"'),'falta la unidad '+u);
  // Presentación es el formato, no la unidad: la gasolina es granel Y por litro.
  assert.match(modal,/id="pcPresentacion"/,'la presentación sigue siendo su propio campo');
  assert.equal(/<option value="litro"/.test(modal),false,'la unidad no se mete entre las presentaciones');
});
test('la unidad se lee y se guarda, en los dos campos que la usan',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert.match(src,/getElementById\("pcUnidad"\)\.value = p\?\.unidad_compra \|\| p\?\.unidad_factura \|\| ""/,'el editor tiene que mostrar la que ya trae');
  // unidad_compra es la que leen el historial y findProduct; unidad_factura la de los productos
  // viejos. Guardar solo una las desincroniza y el «/ L» deja de salir.
  assert.match(src,/unidad_compra: document\.getElementById\("pcUnidad"\)\.value/);
  assert.match(src,/unidad_factura: document\.getElementById\("pcUnidad"\)\.value/);
});
test('una unidad puesta a mano aparece en el historial de compras',()=>{
  // Sin unidad en la observación, purchaseRows cae en la del producto. Es el caso de todo lo
  // capturado a mano, que es justo lo que el campo nuevo permite arreglar.
  const [row]=C.purchaseRows([conCompras([compra({unidad:''})],{unidad_compra:'lt'})]);
  assert.equal(row.unidad,'lt');
});
test('las cajas y los paquetes ya no se pintan crudos',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // unidadDesdeClaveSAT devuelve cja y paq; unit() no los conocía y salía «6 cja».
  assert.match(src,/cja:'caja',paq:'paquete'/);
  assert.match(src,/cja:'cajas',paq:'paquetes'/);
});

// ─── La pantalla de fusión ───────────────────────────────────────────────────
test('la pantalla de fusión existe, con sus dos caminos',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/fusion:'Fusionar'/,'falta la pestaña');
  assert.match(src,/data-action="fusionar"/,'falta fusionar un racimo');
  assert.match(src,/data-action="fusionar-exactos"/,'falta fusionar los seguros de un golpe');
  assert.match(src,/data-destino=/,'sin elegir qué nombre queda, la fusión decide por ti');
  // Lo que más miedo da de una fusión es perder historial. Hay que decirlo donde se decide.
  assert.match(src,/conserva todas las presentaciones y todo su historial/i);
  assert.match(src,/Separar presentación/,'hay que decir cómo se deshace');
});
test('el botón de «todos los exactos» solo sale cuando hay más de uno',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Con un solo racimo seguro el botón de arriba y el de la tarjeta harían lo mismo.
  assert.match(src,/exactos\.length>1\?/);
});
test('fusionar recalcula los racimos en vez de confiar en el botón',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // Entre que se pintó la pantalla y el clic, otro usuario pudo cambiar el catálogo.
  assert.match(src,/const racimos=C\.duplicateClusters\(_catalogoProductos\);[\s\S]{0,400}const elegidos=action==='fusionar'/);
  assert.match(src,/Ese grupo ya no existe/);
});
test('la fusión en bloque se corta antes del límite del store',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  // El store rechaza más de 400 productos por operación. Media fusión guardada y media
  // perdida sería peor que no empezar, así que se corta antes y se dice cuántos quedan.
  assert.match(src,/const TOPE=300;/);
  assert.match(src,/cambios\.size\+parciales\.length>TOPE&&cambios\.size\)break/);
  assert.match(src,/Quedan \$\{restantes\} por fusionar/);
});
test('integración: fusionar un racimo deja una sola identidad y conserva las compras',async()=>{
  const m=memory();
  const prodXml=(id,nombre,precios)=>({id,nombre_comercial:nombre,nombre_normalizado:nombre,alias_factura:[nombre],
    ingrediente_generico:'',proveedor_nombre:'ONUS',estado:'pendiente',unidad_compra:'pz',
    compras_forx:precios.map((x,i)=>({id:id+'-'+i,precio:x,fecha:'2026-09-1'+i,folio:'F'+id+i,proveedor:'ONUS',origen:'factura',evidencia:'xml'}))});
  for(const p of [prodXml('a','Papa delgada europea bol 2.5 kg',[74.9,76.5]),
                  prodXml('b','PAPA DELGADA EUROPEA BOL 2.5 KG',[74.9])]) await m.store.save([p]);
  const {app,context,click}=integration(m);
  await app.load();
  const [racimo]=C.duplicateClusters(context._catalogoProductos);
  assert.equal(racimo.nivel,'exacto');
  await click('fusionar',null,{identity:racimo.identity});
  const guardados=(await m.store.list()).filter(x=>!x.data._internal);
  assert.equal(guardados.length,2,'no se borra ningún producto');
  assert.equal(new Set(guardados.map(x=>x.data.ingrediente_id)).size,1,'quedan en un solo grupo');
  // Las tres compras siguen ahí: 2 + 1.
  assert.equal(guardados.reduce((n,x)=>n+C.observations({...x.data,id:x.id}).length,0),3);
  // Y ya no hay nada que proponer.
  assert.deepEqual(C.duplicateClusters(context._catalogoProductos),[]);
});
test('integración: un fallo de red al fusionar no deja el catálogo a medias',async()=>{
  const m=memory();
  const prodXml=(id,nombre)=>({id,nombre_comercial:nombre,nombre_normalizado:nombre,alias_factura:[nombre],
    ingrediente_generico:'',proveedor_nombre:'ONUS',estado:'pendiente',
    compras_forx:[{id:id+'-0',precio:50,fecha:'2026-09-11',folio:'F'+id,proveedor:'ONUS',origen:'factura',evidencia:'xml'}]});
  for(const p of [prodXml('a','Papa Lisa'),prodXml('b','PAPA LISA')]) await m.store.save([p]);
  const {app,context,element,click}=integration(m);
  await app.load();
  const [racimo]=C.duplicateClusters(context._catalogoProductos);
  m.setFail(503);
  await click('fusionar',null,{identity:racimo.identity});
  m.setFail(0);   // se restablece la red para poder leer de vuelta lo que quedó guardado
  // Y se tiene que NOTAR. Un «listo» falso sobre datos contables es peor que el fallo: el
  // usuario se va creyendo que fusionó y el catálogo sigue duplicado.
  const aviso=element('ingStatus').textContent;
  assert.match(aviso,/No se pudo guardar/,'el fallo tiene que decirse');
  assert.equal(/fusion/i.test(aviso),false,'no puede anunciar una fusión que no ocurrió');
  // Nada se guardó, y la memoria quedó como estaba: el racimo se sigue pudiendo fusionar.
  const guardados=(await m.store.list()).filter(x=>!x.data._internal);
  assert.equal(guardados.every(x=>!x.data.ingrediente_id),true,'no se escribió nada a medias');
  assert.equal(context._catalogoProductos.every(p=>!p.ingrediente_id),true,'la memoria tampoco se tocó');
});
test('integración: se conserva el nombre que ELIGES, no el predeterminado',async()=>{
  // Sin esto, elegir en el desplegable sería decorativo: el código podía quedarse siempre con
  // el de más compras y nadie se enteraría hasta ver el catálogo renombrado al revés.
  const m=memory();
  const prodXml=(id,nombre,n)=>({id,nombre_comercial:nombre,nombre_normalizado:nombre,alias_factura:[nombre],
    ingrediente_generico:'',proveedor_nombre:'ONUS',estado:'pendiente',
    compras_forx:Array.from({length:n},(_,i)=>({id:id+'-'+i,precio:50+i,fecha:'2026-09-1'+i,folio:'F'+id+i,proveedor:'ONUS',origen:'factura',evidencia:'xml'}))});
  for(const p of [prodXml('a','Papa delgada europea bol 2.5 kg',2),
                  prodXml('b','PAPA DELGADA EUROPEA BOL 2.5 KG',1)]) await m.store.save([p]);
  const {app,context,element,click}=integration(m);
  await app.load();
  const [racimo]=C.duplicateClusters(context._catalogoProductos);
  const [porDefecto,otro]=racimo.miembros;
  assert.equal(porDefecto.nombre,'Papa delgada europea bol 2.5 kg','el predeterminado es el de más compras');
  // Se elige el OTRO por el mismo camino que el usuario: el evento change del desplegable.
  element('page-catalogo-productos').listeners.change({target:{dataset:{destino:racimo.identity},value:otro.id}});
  await click('fusionar',null,{identity:racimo.identity});
  const nombres=new Set((await m.store.list()).filter(x=>!x.data._internal).map(x=>x.data.ingrediente_nombre));
  assert.deepEqual([...nombres],['PAPA DELGADA EUROPEA BOL 2.5 KG'],'quedó el nombre elegido, no el predeterminado');
});

// ─── Fase E: comparar precio entre proveedores ───────────────────────────────
const cmp=(id,precio,fecha,prov,unidad,extra={})=>compra({id:String(id),precio,fecha,proveedor:prov,unidad,...extra});
const prov=(id,nombre,p,unidad,compras)=>product({id,nombre_comercial:nombre,ingrediente_generico:'Aceite',
  proveedor_nombre:p,unidad_compra:unidad,compras_forx:compras,precio_actual:null,fecha_precio:null});

test('kilo y litro se comparan directo; pieza, caja y paquete dependen del empaque',()=>{
  for(const [unidad,esperado] of [['kg',true],['lt',true],['pz',false],['cja',false],['paq',false],['',false]]){
    const [b]=C.supplierComparison(C.purchaseRows([
      prov('a','X','Alfa',unidad,[cmp(1,10,'2026-09-01','Alfa',unidad)]),
      prov('b','X','Beta',unidad,[cmp(2,12,'2026-09-02','Beta',unidad)]),
    ]));
    assert.equal(b.comparable,esperado,'unidad '+JSON.stringify(unidad));
  }
});
test('nunca se convierte entre unidades: cada una es su propio bloque',()=>{
  // Convertir de pieza a litro exigiría saber cuánto trae el empaque, que es justo lo que se
  // retiró en la fase C. Mezclarlas en un solo ranking inventaría una comparación.
  const bloques=C.supplierComparison(C.purchaseRows([
    prov('a','Aceite granel','Alfa','lt',[cmp(1,40,'2026-09-01','Alfa','lt')]),
    prov('b','Aceite granel','Beta','lt',[cmp(2,42,'2026-09-02','Beta','lt')]),
    prov('c','Aceite caja 20 L','Beta','pz',[cmp(3,820,'2026-09-03','Beta','pz')]),
    prov('d','Aceite caja 24 L','Gama','pz',[cmp(4,999,'2026-09-04','Gama','pz')]),
  ]));
  assert.deepEqual(bloques.map(b=>b.unidad),['lt','pz']);
  // Y los comparables van primero: es el bloque en el que se puede confiar sin pensar.
  assert.deepEqual(bloques.map(b=>b.comparable),[true,false]);
});
test('un solo proveedor no es una comparación',()=>{
  assert.deepEqual(C.supplierComparison(C.purchaseRows([prov('a','X','Alfa','kg',[cmp(1,10,'2026-09-01','Alfa','kg')])])),[]);
});
test('ordena por último precio y mide la diferencia contra el más barato',()=>{
  const [b]=C.supplierComparison(C.purchaseRows([
    prov('a','X','Caro','kg',[cmp(1,50,'2026-09-01','Caro','kg')]),
    prov('b','X','Barato','kg',[cmp(2,40,'2026-09-02','Barato','kg')]),
    prov('c','X','Medio','kg',[cmp(3,44,'2026-09-03','Medio','kg')]),
  ]));
  assert.deepEqual(b.proveedores.map(x=>x.nombre),['Barato','Medio','Caro']);
  assert.equal(b.barato,C.norm('Barato'));
  const caro=b.proveedores.find(x=>x.nombre==='Caro');
  assert.equal(caro.sobreprecio,10);
  assert.equal(Math.round(caro.sobreprecioPct*10)/10,25);
  assert.equal(b.proveedores[0].sobreprecio,0,'el más barato no se cobra sobreprecio a sí mismo');
});
test('el promedio pesa por cantidad, y puede contradecir al último precio',()=>{
  // Caso real: un proveedor con el último precio más alto puede haber sido más barato en
  // conjunto. Las dos cifras se muestran porque contestan preguntas distintas.
  const [b]=C.supplierComparison(C.purchaseRows([
    prov('a','X','Alfa','kg',[cmp(1,38,'2026-09-01','Alfa','kg',{cantidad:200}),cmp(2,41,'2026-10-02','Alfa','kg',{cantidad:10})]),
    prov('b','X','Beta','kg',[cmp(3,40,'2026-10-03','Beta','kg',{cantidad:100})]),
  ]));
  const alfa=b.proveedores.find(x=>x.nombre==='Alfa');
  assert.equal(alfa.ultimo.precio,41,'el último es el más reciente, no el más bajo');
  assert.ok(Math.abs(alfa.promedio-(38*200+41*10)/210)<1e-9,'promedio ponderado por cantidad');
  assert.ok(alfa.promedio<40,'su promedio es mejor que el último de Beta');
  assert.equal(b.barato,C.norm('Beta'),'pero el ranking va por último precio');
});
test('las grafías del mismo proveedor no se cuentan como dos',()=>{
  const [b]=C.supplierComparison(C.purchaseRows([
    prov('a','X','ANA KAREM HUERTA DIAZ','kg',[cmp(1,40,'2026-09-01','ANA KAREM HUERTA DIAZ','kg')]),
    prov('b','X','ANA KAREM HUERTA DÍAZ','kg',[cmp(2,44,'2026-09-02','ANA KAREM HUERTA DÍAZ','kg')]),
    prov('c','X','Otro','kg',[cmp(3,50,'2026-09-03','Otro','kg')]),
  ]));
  assert.equal(b.proveedores.length,2,'partirlo en dos haría parecer que hay más opciones');
  assert.equal(b.proveedores[0].compras,2);
});
test('se mide el desfase entre el precio más nuevo y el más viejo del cuadro',()=>{
  // Un precio de hace meses puede verse más barato solo por ser viejo.
  const [b]=C.supplierComparison(C.purchaseRows([
    prov('a','X','Viejo','kg',[cmp(1,30,'2026-06-01','Viejo','kg')]),
    prov('b','X','Nuevo','kg',[cmp(2,40,'2026-10-01','Nuevo','kg')]),
  ]));
  assert.equal(b.desfase,122);
});
test('cada proveedor lleva sus presentaciones, que es lo que permite juzgar el empaque',()=>{
  const [b]=C.supplierComparison(C.purchaseRows([
    prov('a','Aceite caja 20 L','Alfa','pz',[cmp(1,820,'2026-09-01','Alfa','pz')]),
    prov('b','Aceite caja 24 L','Beta','pz',[cmp(2,999,'2026-09-02','Beta','pz')]),
  ]));
  assert.deepEqual(b.proveedores.map(x=>x.presentaciones),[['Aceite caja 20 L'],['Aceite caja 24 L']]);
});
test('la comparación solo sale con UN producto elegido, y lo dice',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/const comparacion=\(grupos\.size===1&&series\.length\)\?comparativa\(rows\):''/,'comparar proveedores de 370 productos revueltos no contesta nada');
  assert.match(src,/solo se compara si el empaque es del mismo tamaño/,'falta la advertencia del empaque');
  assert.match(src,/sin convertir entre ellas/,'hay que decir que no se convierte');
  assert.match(src,/b\.desfase>60\?/,'falta avisar cuando los precios son de fechas lejanas');
});
test('el bloque comparable va primero aunque llegue después en los datos',()=>{
  // La prueba de arriba pasaba por casualidad: con «lt» y «pz», el desempate alfabético pone
  // el litro arriba de todos modos, así que no distinguía la regla. Con «cja» y «kg» el
  // alfabeto dice lo CONTRARIO —cja va antes que kg—, y además las cajas son las compras más
  // recientes, que es el orden en que llegan. Solo la regla de «comparable primero» puede
  // poner el kilo arriba.
  const bloques=C.supplierComparison(C.purchaseRows([
    prov('a','Queso caja 10 pz','Alfa','cja',[cmp(1,820,'2026-10-05','Alfa','cja')]),
    prov('b','Queso caja 12 pz','Beta','cja',[cmp(2,999,'2026-10-04','Beta','cja')]),
    prov('c','Queso granel','Alfa','kg',[cmp(3,180,'2026-09-02','Alfa','kg')]),
    prov('d','Queso granel','Beta','kg',[cmp(4,192,'2026-09-01','Beta','kg')]),
  ]));
  assert.deepEqual(bloques.map(b=>b.unidad),['kg','cja']);
  assert.deepEqual(bloques.map(b=>b.comparable),[true,false]);
});

// ─── El número de ticket no es parte del producto ────────────────────────────
test('el número de ticket o folio no convierte cada compra en un producto nuevo',()=>{
  // La gasolinera factura «87 Octanos (Ticket: 757265)» y cada carga trae el suyo. Sin esto,
  // cada carga del mes es un producto distinto que nunca se junta con los demás.
  const ids=['87 Octanos (Ticket: 757265)','87 Octanos (Ticket: 760670)','87 Octanos (TICKET 772490)',
             '87 Octanos Ticket: 781001','87 Octanos (Folio 9912)','87 Octanos (Referencia: A-4471)']
    .map(n=>C.ingredientIdentity({nombre_comercial:n}));
  assert.deepEqual([...new Set(ids)],['87 octanos'],'todas las cargas son el mismo combustible');
});
test('87 y 91 octanos siguen siendo combustibles distintos',()=>{
  assert.notEqual(C.ingredientIdentity({nombre_comercial:'87 Octanos (Ticket: 1)'}),
                  C.ingredientIdentity({nombre_comercial:'91 Octanos (Ticket: 2)'}));
});
test('solo se quita la referencia cuando trae número, y nada más',()=>{
  // «ticket» suelto no es una referencia, y un paréntesis que describe el producto se queda.
  assert.equal(C.ingredientIdentity({nombre_comercial:'Ticket de pavo'}),'ticket pavo');
  assert.equal(C.ingredientIdentity({nombre_comercial:'87 Octanos (gasolina)'}),'87 octanos gasolina');
  // Y no se come el tamaño de la presentación ni los descriptores de siempre.
  assert.equal(C.ingredientIdentity({nombre_comercial:'Papa Lisa Europea Bolsa 2.5 kg'}),'papa lisa europea');
  assert.equal(C.ingredientIdentity({nombre_comercial:'Queso Americano procesado'}),'queso americano procesado');
});
test('las cargas de gasolina se proponen como un solo racimo',()=>{
  const cargas=['87 Octanos (Ticket: 757265)','87 Octanos (Ticket: 760670)','87 Octanos (Ticket: 772490)']
    .map((n,i)=>prod('g'+i,n));
  const [racimo]=C.duplicateClusters(cargas);
  assert.equal(racimo.miembros.length,3,'las tres cargas en un solo grupo');
  assert.equal(racimo.nivel,'probable','los nombres sí difieren: lo confirma una persona');
});

// ─── Recuperar en bloque lo que se omitió por la regla vieja de FORX ─────────
test('la pestaña Omitidos ofrece recuperarlos en bloque, y explica por qué',()=>{
  const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/ingredients.js'),'utf8');
  assert.match(src,/data-action="recuperar-omitidos"/,'falta el botón');
  // Lo que importa es que diga POR QUÉ: se omitieron bajo una regla que ya no existe.
  assert.match(src,/recetas de FORX/,'hay que decir de dónde viene la omisión');
  assert.match(src,/hoy se registra todo lo comprado/);
  assert.match(src,/queda fuera del historial, del gasto y de la comparación/,'hay que decir qué cuesta dejarlo omitido');
  assert.match(src,/vuelven con todas sus compras/,'hay que decir que no se pierde nada');
  assert.match(src,/const TOPE=300,lote=omitidos\.slice\(0,TOPE\)/,'sin tope, el store rechaza la operación entera');
});
test('integración: recuperar en bloque devuelve las compras al historial',async()=>{
  const m=memory();
  const omitido=(id,nombre)=>({id,nombre_comercial:nombre,nombre_normalizado:nombre,alias_factura:[nombre],
    ingrediente_generico:'',proveedor_nombre:'PEMEX',estado:'ignorado',unidad_compra:'lt',
    compras_forx:[{id:id+'-0',precio:20.12,cantidad:40,importe:804.8,fecha:'2026-09-28',folio:'F'+id,proveedor:'PEMEX',unidad:'lt',origen:'factura',evidencia:'xml'}]});
  for(const p of [omitido('a','87 Octanos (Ticket: 757265)'),omitido('b','87 Octanos (Ticket: 760670)')])
    await m.store.save([p]);
  const {app,context,click}=integration(m);
  await app.load();
  // Omitido = fuera del historial de compras. Ése es el costo de dejarlos así.
  assert.deepEqual(C.purchaseRows(context._catalogoProductos),[]);
  await click('recuperar-omitidos');
  const guardados=(await m.store.list()).filter(x=>!x.data._internal);
  assert.equal(guardados.every(x=>x.data.estado==='pendiente'),true,'ninguno queda omitido');
  const filas=C.purchaseRows(context._catalogoProductos);
  assert.equal(filas.length,2,'sus compras vuelven al historial');
  assert.equal(filas.reduce((n,r)=>n+r.importe,0),1609.6,'y su gasto vuelve a contar');
  // Con el ticket ya fuera de la identidad, además se proponen como un solo producto.
  const [racimo]=C.duplicateClusters(context._catalogoProductos);
  assert.equal(racimo.miembros.length,2);
});
test('integración: recuperar no pisa nada más del producto',async()=>{
  const m=memory();
  await m.store.save([{id:'a',nombre_comercial:'Detergente 5 L',ingrediente_generico:'Detergente',
    proveedor_nombre:'ABARROTES',estado:'ignorado',unidad_compra:'lt',notas:'no tocar',
    compras_forx:[{id:'a-0',precio:120,fecha:'2026-09-01',folio:'F1',proveedor:'ABARROTES',origen:'factura',evidencia:'xml'}]}]);
  const {app,click}=integration(m);
  await app.load();
  await click('recuperar-omitidos');
  const [doc]=(await m.store.list()).filter(x=>!x.data._internal);
  assert.equal(doc.data.estado,'pendiente');
  assert.equal(doc.data.notas,'no tocar','recuperar solo cambia el estado');
  assert.equal(doc.data.compras_forx.length,1);
});
test('integración: tras recuperar, la pantalla deja de ofrecerlo',async()=>{
  // Sin repintar, se guardan los 313 pero la lista los sigue mostrando omitidos: parece que
  // falló y vuelves a dar clic. Guardar y no mostrarlo es, para quien lo usa, no haber hecho nada.
  const m=memory();
  await m.store.save([{id:'a',nombre_comercial:'87 Octanos (Ticket: 757265)',nombre_normalizado:'87 Octanos',
    alias_factura:['87 Octanos'],ingrediente_generico:'',proveedor_nombre:'PEMEX',estado:'ignorado',
    compras_forx:[{id:'a-0',precio:20.12,fecha:'2026-09-28',folio:'F1',proveedor:'PEMEX',origen:'factura',evidencia:'xml'}]}]);
  const {app,element,click}=integration(m);
  await app.load();
  await click('view',null,{view:'omitidos'});
  const antes=element('page-catalogo-productos').innerHTML;
  assert.match(antes,/data-action="recuperar-omitidos"/,'la pestaña Omitidos tiene que ofrecerlo');
  await click('recuperar-omitidos');
  const despues=element('page-catalogo-productos').innerHTML;
  assert.equal(/data-action="recuperar-omitidos"/.test(despues),false,'ya no queda nada que recuperar: la pantalla tiene que reflejarlo');
});
