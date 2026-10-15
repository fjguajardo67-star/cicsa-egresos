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
  assert(html.includes('ingredients.js?v=20261014-historial4'));assert(html.includes('window.CicsaCatalog.saveEditor'));assert(html.includes('fecha:primerGasto?.fecha||""'));
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
