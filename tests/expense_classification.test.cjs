const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../assets/expense-classification.js');
const F=require('../assets/financial-access.js');
const cats=['Frutas y Verduras','Cárnicos','Abarrotes / Secos','Otro'];
const papa={nombre:'Papa lisa europea 2.5 kg',categoria:'Frutas y Verduras',importe:100,tipo_alimento:'papa / verdura'};
const rules=(p=papa,supplier='Proveedor A')=>C.updateRules({},[{...p,_producto:true,_recordar:true,categoria:'Congelados'}],supplier,'2026-09-26','test');
test('Congelados es opción sin duplicar variantes ni mutar categorías del usuario',()=>{
  assert.equal(C.categories(cats).at(-1),'Congelados');assert.equal(cats.length,4);
  assert.deepEqual(C.categories(['CONGELADOS']),['CONGELADOS']);
});
test('descripción explícita, no nombre genérico, determina congelación',()=>{
  for(const nombre of ['Fresa congelada','Ajo congelado','Verduras IQF','Mezcla California congelada','Mezcla Primavera ultracongelada','Frozen berries']){
    assert.equal(C.classify({...papa,nombre},'A',{},cats).categoria,'Congelados',nombre);
  }
  for(const nombre of ['Papa lisa europea','Mezcla California','Mezcla Primavera','Fresa fresca','Ajo fresco','Fresa no congelada','Fresa sin congelar','not frozen berries','Congelador'])assert.equal(C.frozen(nombre),false,nombre);
});
test('corrección confirmada prevalece sobre IA y solo para el mismo proveedor',()=>{
  const saved=rules();assert.equal(C.classify(papa,'PROVEEDOR A',saved,cats).categoria,'Congelados');
  assert.equal(C.classify(papa,'Proveedor B',saved,cats).categoria,'Frutas y Verduras');
  assert.equal(C.classify({...papa,nombre:'Papa lisa europea fresca 2.5 kg'},'Proveedor A',saved,cats).fuente,'ia');
  assert.equal(C.classify({...papa,nombre:'Papa lisa europea 5 kg'},'Proveedor A',saved,cats).fuente,'ia');
});
test('SKU del proveedor es prioritario, conserva ceros y no usa ClaveProdServ SAT',()=>{
  const original={...papa,codigo_proveedor:'001-25'},saved=rules(original);
  assert.equal(C.classify({...original,nombre:'PAPA EUROPEA BOLSA'},'Proveedor A',saved,cats).fuente,'regla');
  assert.equal(C.classify({...original,codigo_proveedor:'1-25'},'Proveedor A',saved,cats).fuente,'ia');
  assert.equal(C.identity('A',{...papa,claveProdServ:'50101500'}),C.identity('A',papa));
  assert.equal(C.classify({...original,codigo_proveedor:'001-25'},'Proveedor B',saved,cats).fuente,'ia');
});
test('no aprende de una partida agrupada o de una corrección sin marcar',()=>{
  assert.deepEqual(C.updateRules({},[{...papa,_recordar:true}], 'A','now','u'),{});
  assert.deepEqual(C.updateRules({},[{...papa,_producto:true,_recordar:false}], 'A','now','u'),{});
  assert.throws(()=>C.updateRules({},[{...papa,_producto:true,_recordar:true}], '','now','u'),/proveedor/);
});
test('quitar Recordar desactiva una regla sin tocar facturas anteriores',()=>{
  const saved=rules(),r=C.rows([papa],'Proveedor A',saved,cats)[0];
  assert.equal(r._recordar,true);r._recordar=false;
  const next=C.updateRules(saved,[r],'Proveedor A','later','u');
  assert.equal(next[C.identity('Proveedor A',papa)].activa,false);
  assert.equal(saved[C.identity('Proveedor A',papa)].activa,true);
  assert.equal(C.classify(papa,'Proveedor A',next,cats).fuente,'ia');
});
test('dos decisiones incompatibles para un SKU no se guardan silenciosamente',()=>{
  const a={...papa,codigo_proveedor:'1',_producto:true,_recordar:true};
  assert.throws(()=>C.updateRules({},[a,{...a,categoria:'Congelados'}],'A','now','u'),/dos decisiones/);
});
test('reclasificar un producto no cambia el importe ni sus precios y agrupa por centavos',()=>{
  const input=[{...papa,precio_unitario:50,cantidad:2},{nombre:'Zanahoria fresca',categoria:'Frutas y Verduras',importe:40},
    {nombre:'Fresas congeladas',categoria:'Frutas y Verduras',importe:60}];
  const before=JSON.stringify(input),r=C.rows(input,'Proveedor A',rules(),cats),g=C.group(r);
  assert.equal(g.find(x=>x.categoria==='Congelados').importe,160);
  assert.equal(g.find(x=>x.categoria==='Frutas y Verduras').importe,40);
  assert.equal(r[0].precio_unitario,50);assert.equal(r[0].tipo_alimento,'papa / verdura');
  assert.equal(JSON.stringify(input),before);
});
test('importes fiscales de clasificación no sustituyen al precio comercial',()=>{
  const r=C.rows([{...papa,importe:100,importe_clasificacion:116,precio_unitario:50}], 'A',{},cats);
  assert.equal(r[0].importe,116);assert.equal(r[0].precio_unitario,50);
  assert.equal(C.group(r)[0].importe,116);
});
test('rechaza importes negativos, vacíos y no numéricos',()=>{
  for(const importe of [-1,null,'',NaN,Infinity])assert.throws(()=>C.group([{...papa,importe}]),/Revisa/);
});
test('reglas viajan como datos operativos sin exponer Caja a operadores',()=>{
  const s={weeks:[],budget:{Congelados:0},reglasClasificacionProductos:rules(),cajaSaldoInicial:900};
  const parts=F.split(s),oper=F.compose(parts.operation,parts.budget,null);
  assert.deepEqual(oper.reglasClasificacionProductos,s.reglasClasificacionProductos);
  assert.equal(oper.cajaSaldoInicial,undefined);assert.equal(parts.cash.reglasClasificacionProductos,undefined);
});
test('módulo de clasificación publicado conserva su integridad',()=>{
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const digest=crypto.createHash('sha384').update(fs.readFileSync(path.join(root,'assets/expense-classification.js'))).digest('base64');
  assert(html.includes('sha384-'+digest));
});
