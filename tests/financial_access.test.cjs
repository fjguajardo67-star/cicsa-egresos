const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const F=require('../assets/financial-access.js');
const fixture=()=>({weeks:[{id:'w1',label:'Semana',ini:'2026-09-01',fin:'2026-09-07',
  gastos:[{id:'g1',importe:55}],cortes:[{id:'c1',importe:500}],retiros:[],aportaciones:[]}],
  activeWeek:'w1',budget:{Gas:400},budgetObjetivo:600,cajaSaldoInicial:{septiembre:{valor:100}},
  cortesIgnorados:['x'],cortesImportaciones:[{id:'i1'}],categorias:['Gas']});
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const extract=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>0&&b>a);return html.slice(a,b);};
const plain=x=>JSON.parse(JSON.stringify(x));
function sandbox(role='admin'){
  const m=new Map();
  const context={CicsaFinancialAccess:F,currentUser:{uid:'u1'},currentRole:role,
    _sessionGeneration:1,_financialReady:false,_syncBase:null,_syncPending:false,_syncing:false,_restoring:false,
    _legacyRecovery:null,state:{weeks:[],budget:{}},console,
    localStorage:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)},
    programarSync:()=>{context._syncPending=true;},respaldoAutomatico:()=>{},
    descargarRecuperacionLocal:()=>{},alert:()=>{},_anotarFallo:()=>{},
    refrescarVistaActual:()=>{},pintarSyncBadge:()=>{},Date,JSON,Map,Set};
  vm.createContext(context);
  vm.runInContext(extract('function guardarCacheOperativa()', '\nfunction descargarRecuperacionLocal'),context);
  vm.runInContext(extract('function fusionTresVias(', '\nasync function ejecutarSync()'),context);
  vm.runInContext(extract('async function initState()', '\n// Renombra categorías'),context);
  vm.runInContext(extract('function save()', '\nsetInterval'),context);
  return {context,m};
}
test('separación reversible conserva gastos, Caja, presupuesto y campos desconocidos privados',()=>{
  const original=fixture();original.futuroPrivado={valor:10};
  const parts=F.split(original);
  assert.deepEqual(F.compose(parts.operation,parts.budget,parts.cash),original);
  assert.equal(parts.operation.cajaSaldoInicial,undefined);
  assert.equal(parts.operation.budget,undefined);
  assert.equal(parts.operation.weeks[0].cortes,undefined);
  assert.equal(parts.operation.futuroPrivado,undefined);
});
test('campos protegidos falsificados en JSON operativo nunca se usan',()=>{
  const parts=F.split(fixture());
  const forged={...parts.operation,budget:{Gas:1},cajaSaldoInicial:{x:999},secreto:'x'};
  forged.weeks[0].cortes=[{id:'falso'}];
  const operator=F.compose(forged,parts.budget,null);
  assert.equal(operator.budget.Gas,400);
  assert.equal(operator.cajaSaldoInicial,undefined);
  assert.equal(operator.secreto,undefined);
  assert.equal(operator.weeks[0].cortes,undefined);
});
test('borrar semana pública no elimina ni mueve sus cortes privados',()=>{
  const parts=F.split(fixture());parts.operation.weeks=[];
  const st=F.compose(parts.operation,parts.budget,parts.cash);
  assert.equal(st.weeks[0].cortes[0].id,'c1');
  assert.equal(st.weeks[0].ini,'2026-09-01');
});
test('faltante de presupuesto o documento operativo bloquea el arranque',()=>{
  assert.throws(()=>F.compose({weeks:[]},{},null));
  assert.throws(()=>F.compose(null,{budget:{}},null));
});
test('arranque sin nube no guarda, no crea semana y no habilita captura',async()=>{
  const {context:c,m}=sandbox();c._financialStore={read:async()=>{throw Error('403');}};
  await assert.rejects(c.initState(),/403/);
  assert.equal(c._financialReady,false);assert.equal(m.size,0);
});
test('arranque frío toma presupuesto remoto y no lo reemplaza por valores de fábrica',async()=>{
  const {context:c,m}=sandbox();const st=fixture(),parts=F.split(st);
  c._financialStore={read:async()=>({data:st,parts})};
  await c.initState();
  assert.equal(c.state.budget.Gas,400);assert.equal(c._financialReady,true);
  const cached=JSON.parse(m.get('cicsa_operacion_v2_u1'));
  assert.equal(cached.data.cajaSaldoInicial,undefined);
  assert.equal(cached.base.weeks[0].cortes,undefined);
  assert.equal(m.has('cicsa_egresos'),false);
});
test('captura offline con base se fusiona sin pisar un cambio remoto distinto',async()=>{
  const {context:c,m}=sandbox();const st=fixture(),base=F.operational(st),local=F.clone(base);
  local.weeks[0].gastos.push({id:'g2',importe:10});st.weeks[0].gastos[0].importe=60;
  m.set('cicsa_operacion_v2_u1',JSON.stringify({version:2,uid:'u1',base,data:local}));
  c._financialStore={read:async()=>({data:st,parts:F.split(st)})};
  await c.initState();assert.equal(c.state.weeks[0].gastos.length,2);
  assert.equal(c.state.weeks[0].gastos[0].importe,60);assert.equal(c._syncPending,true);
});
test('conflicto offline no sustituye la caché pendiente',async()=>{
  const {context:c,m}=sandbox();const st=fixture(),base=F.operational(st),local=F.clone(base);
  local.weeks[0].gastos[0].importe=1;st.weeks[0].gastos[0].importe=60;
  const raw=JSON.stringify({version:2,uid:'u1',base,data:local});m.set('cicsa_operacion_v2_u1',raw);
  c._financialStore={read:async()=>({data:st,parts:F.split(st)})};
  await assert.rejects(c.initState(),/conflicto/);
  assert.equal(m.get('cicsa_operacion_v2_u1'),raw);assert.equal(c._financialReady,false);
});
test('operativo no recupera Caja desde una caché antigua y no cambia presupuesto con save()',async()=>{
  const {context:c,m}=sandbox('operativo');const st=fixture(),parts=F.split(st);
  m.set('cicsa_egresos',JSON.stringify(st));
  c._financialStore={read:async()=>({data:F.compose(parts.operation,parts.budget,null),parts:{operation:parts.operation,budget:parts.budget}})};
  await c.initState();assert.equal(c.state.cajaSaldoInicial,undefined);
  assert.equal(c._legacyRecovery.cajaSaldoInicial,undefined);assert.equal(m.has('cicsa_egresos'),false);
  c.state.budget.Gas=1;c.state.cajaSaldoInicial={fraude:2};c.save();
  assert.equal(c.state.budget.Gas,400);assert.equal(c.state.cajaSaldoInicial,undefined);
});
test('sesión cambiada durante lectura no restaura los datos del usuario anterior',async()=>{
  const {context:c}=sandbox();
  c._financialStore={read:async()=>{c._sessionGeneration++;return {data:fixture()};}};
  await assert.rejects(c.initState(),/sesión cambió/);assert.equal(c._financialReady,false);
});
test('save antes de verificar permisos rechaza la captura',()=>{
  const {context:c,m}=sandbox();assert.throws(()=>c.save(),/verificación/);assert.equal(m.size,0);
});
test('rutas locales no se usan como fuente alternativa y SRI del módulo financiero coincide',()=>{
  assert(!extract('async function initState()', '\n// Renombra categorías').includes('/load-state'));
  assert(!extract('function save()', '\nsetInterval').includes('/save-state'));
  const hash=require('node:crypto').createHash('sha384').update(fs.readFileSync(require('node:path').join(__dirname,'../assets/financial-access.js'))).digest('base64');
  assert(html.includes('sha384-'+hash));
});
