import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, setLogLevel, writeBatch } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import financial from '../../assets/financial-access.js';
import ingredientCore from '../../assets/ingredients-core.js';
import ingredientStore from '../../assets/ingredients-store.js';
import { ref, uploadBytes, getMetadata, updateMetadata, deleteObject, listAll } from 'firebase/storage';

const PROJECT = 'demo-cicsa-rules';
const OWNER = 'NVapfgY8pshXwYbMq7Wz28ry3pC3';
let env;
let sequence = 0;
const record = { json: '{"weeks":[]}', ts: '2026-09-11T00:00:00Z' };
const users = {
  staff: { rol: 'operativo', activo: true },
  admin: { rol: 'admin', activo: true },
  legacy: { nombre: 'Usuario de prueba' },
  inactive: { rol: 'operativo', activo: false },
  inactiveAdmin: { rol: 'admin', activo: false },
  badActive: { rol: 'admin', activo: 'true' },
  numericActive: { rol: 'admin', activo: 1 },
  nullActive: { rol: 'admin', activo: null },
  badRole: { rol: 'root', activo: true }
};
const context = uid => uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
const db = uid => context(uid).firestore();
const storage = uid => context(uid).storage(`gs://${PROJECT}.appspot.com`);
const upload = (uid, path, type = 'application/pdf', bytes = new Uint8Array([1, 2, 3])) =>
  uploadBytes(ref(storage(uid), path), bytes, { contentType: type });
const file = (folder = 'facturas') => `${folder}/prueba-${++sequence}.pdf`;

before(async () => {
  setLogLevel('silent'); // Las denegaciones esperadas se verifican con assertFails.
  // Evitar toda posibilidad de ejecutar esta batería contra datos reales.
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):8180$/);
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):9299$/);
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8180, rules: readFileSync('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9299, rules: readFileSync('storage.rules', 'utf8') }
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    for (const [uid, profile] of Object.entries(users)) await setDoc(doc(c.firestore(), 'usuarios', uid), profile);
    for (const path of ['estado/cicsa', 'datos/precios', 'datos/privado', 'cfdis/demo', 'gmail_revisados/demo',
      'productos_comerciales/demo', 'proveedores/demo', 'respaldos/copia', 'respaldos/_indice', 'actividad/staff']) {
      await setDoc(doc(c.firestore(), path), record);
    }
    await setDoc(doc(c.firestore(), 'chat/demo'), { uid: 'staff', texto: 'Prueba' });
  });
});
after(async () => { if (env) await env.cleanup(); });

test('Ingredientes: transporte real, pendiente atómico, CAS y permisos existentes',async()=>{
  const store=uid=>ingredientStore({base:`http://127.0.0.1:8180/v1/projects/${PROJECT}/databases/(default)/documents`,key:'demo-key',core:ingredientCore,fetcher:fetch,session:()=>uid,
    headers:async()=>({Authorization:'Bearer '+createMockUserToken({sub:uid},PROJECT)})});
  const staff=store('staff');
  const p={id:'ingrediente-prueba',nombre_comercial:'Arroz 3kg',ingrediente_generico:'Arroz de prueba',estado:'validado',precio_actual:90,fecha_precio:'2026-09-11',unidad_base:'kg',contenido_cantidad:3,contenido_unidad:'kg'};
  await staff.save([p],{[p.id]:null});
  assert.equal((await staff.get(staff.markerPath)).data.pending,true);
  const first=await staff.publish();assert.equal(first.state,'publicado');
  assert.equal((await staff.get('datos/precios')).data['Arroz de prueba'].precio,30);
  const {id,...before}=p;
  await staff.save([{...p,notas:'Sin cambio del precio'}],{[id]:before});
  // La rama sin cambios utiliza una escritura verify con precondición real.
  assert.equal((await staff.publish()).plan.changed,false);
  await assert.rejects(staff.save([{...p,precio_actual:999}],{[id]:before}),/Otro usuario/);
  await assert.rejects(store('outsider').save([{...p,id:'intruso'}]),e=>e.status===403);
  assert.equal((await staff.get('datos/precios')).data['Arroz de prueba'].precio,30);
});

for (const uid of [null, 'outsider', 'inactive', 'inactiveAdmin', 'badActive', 'numericActive', 'nullActive', 'badRole']) {
  test(`Firestore: ${uid ?? 'sin sesión'} no lee ni escribe finanzas`, async () => {
    for (const path of ['estado/cicsa', 'cfdis/demo', 'gmail_revisados/demo', 'productos_comerciales/demo',
      'proveedores/demo', 'respaldos/_indice', 'chat/demo', 'actividad/staff']) {
      await assertFails(getDoc(doc(db(uid), path)));
      await assertFails(setDoc(doc(db(uid), path), record));
    }
  });
  test(`Storage: ${uid ?? 'sin sesión'} no sube facturas`, async () => {
    await assertFails(upload(uid, file()));
  });
}

for (const uid of ['staff', 'admin', 'legacy', OWNER]) {
  test(`Firestore: ${uid} conserva captura, catálogo, conciliación XML e índice`, async () => {
    for (const path of ['estado/cicsa', 'cfdis/demo', 'gmail_revisados/demo', 'productos_comerciales/demo',
      'proveedores/demo', 'respaldos/_indice']) {
      await assertSucceeds(getDoc(doc(db(uid), path)));
      await assertSucceeds(setDoc(doc(db(uid), path), record));
    }
    await assertSucceeds(getDocs(collection(db(uid), 'cfdis')));
  });
  test(`Storage: ${uid} sube y consulta una factura`, async () => {
    const path = file();
    await assertSucceeds(upload(uid, path));
    await assertSucceeds(getMetadata(ref(storage(uid), path)));
  });
}

test('Precios: lectura pública solo del documento integrado con Menú', async () => {
  await assertSucceeds(getDoc(doc(db(null), 'datos/precios')));
  await assertFails(getDoc(doc(db(null), 'datos/privado')));
  await assertFails(getDocs(collection(db(null), 'datos')));
  await assertFails(setDoc(doc(db(null), 'datos/precios'), record));
  await assertSucceeds(setDoc(doc(db('staff'), 'datos/precios'), record));
  await assertFails(setDoc(doc(db('staff'), 'datos/otro'), record));
});

test('Perfiles: usuario lee su registro, incluso desactivado, pero no se da de alta ni cambia rol', async () => {
  await assertSucceeds(getDoc(doc(db('inactive'), 'usuarios/inactive')));
  await assertSucceeds(getDoc(doc(db('outsider'), 'usuarios/outsider')));
  await assertFails(setDoc(doc(db('outsider'), 'usuarios/outsider'), { rol: 'admin' }));
  await assertFails(updateDoc(doc(db('staff'), 'usuarios/staff'), { rol: 'admin' }));
  await assertFails(updateDoc(doc(db('inactive'), 'usuarios/inactive'), { activo: true }));
  await assertFails(getDoc(doc(db('staff'), 'usuarios/admin')));
  await assertFails(getDocs(collection(db('staff'), 'usuarios')));
  await assertFails(deleteDoc(doc(db('staff'), 'usuarios/staff')));
});

test('Perfiles: solo administrador activo administra roles válidos', async () => {
  await assertSucceeds(setDoc(doc(db('admin'), 'usuarios/nuevo'), { rol: 'operativo', activo: true }));
  await assertSucceeds(updateDoc(doc(db('admin'), 'usuarios/nuevo'), { rol: 'admin' }));
  await assertSucceeds(updateDoc(doc(db('admin'), 'usuarios/nuevo'), { activo: false }));
  await assertFails(updateDoc(doc(db('admin'), 'usuarios/nuevo'), { activo: 'false' }));
  await assertFails(updateDoc(doc(db('admin'), 'usuarios/nuevo'), { rol: 'root' }));
  await assertFails(setDoc(doc(db('inactiveAdmin'), 'usuarios/intruso'), { rol: 'admin' }));
  await assertSucceeds(getDocs(collection(db('admin'), 'usuarios')));
  await assertSucceeds(deleteDoc(doc(db('admin'), 'usuarios/nuevo')));
});

test('Respaldos: creación operativa, lectura administrativa, contenido inmutable', async () => {
  await assertSucceeds(setDoc(doc(db('staff'), 'respaldos/nuevo'), record));
  await assertFails(getDoc(doc(db('staff'), 'respaldos/nuevo')));
  await assertFails(getDocs(collection(db('staff'), 'respaldos')));
  await assertSucceeds(getDoc(doc(db('admin'), 'respaldos/nuevo')));
  await assertSucceeds(getDocs(collection(db('admin'), 'respaldos')));
  for (const uid of ['staff', 'admin', OWNER]) {
    await assertFails(setDoc(doc(db(uid), 'respaldos/nuevo'), { ...record, json: 'alterado' }));
  }
  await assertFails(deleteDoc(doc(db('staff'), 'respaldos/nuevo')));
  await assertSucceeds(deleteDoc(doc(db('admin'), 'respaldos/nuevo')));
});

test('CFDI y marcas Gmail: borrar requiere administrador', async () => {
  for (const collectionName of ['cfdis', 'gmail_revisados']) {
    const path = `${collectionName}/borrable`;
    await assertSucceeds(setDoc(doc(db('staff'), path), record));
    await assertFails(deleteDoc(doc(db('staff'), path)));
    await assertSucceeds(deleteDoc(doc(db('admin'), path)));
  }
});

test('Chat y actividad: operativo no suplanta a otro usuario', async () => {
  await assertSucceeds(setDoc(doc(db('staff'), 'chat/mio'), { uid: 'staff', texto: 'Prueba' }));
  await assertFails(setDoc(doc(db('staff'), 'chat/ajeno'), { uid: 'admin', texto: 'Prueba' }));
  await assertFails(updateDoc(doc(db('staff'), 'chat/demo'), { texto: 'Cambio' }));
  await assertSucceeds(setDoc(doc(db('staff'), 'actividad/staff'), record));
  await assertFails(setDoc(doc(db('staff'), 'actividad/admin'), record));
});

test('Rutas no declaradas y subcolecciones quedan denegadas', async () => {
  for (const uid of ['staff', 'admin', OWNER]) {
    await assertFails(setDoc(doc(db(uid), 'desconocida/documento'), record));
    await assertFails(setDoc(doc(db(uid), 'usuarios/staff/privado/documento'), record));
    await assertFails(upload(uid, 'desconocida/documento.pdf'));
    await assertFails(upload(uid, 'facturas/subcarpeta/documento.pdf'));
  }
});

test('Facturas: no se reemplazan bytes ni metadatos, ni por un administrador', async () => {
  const path = file();
  await assertSucceeds(upload('staff', path));
  for (const uid of ['staff', 'admin', OWNER]) {
    await assertFails(upload(uid, path));
    await assertFails(updateMetadata(ref(storage(uid), path), { customMetadata: { modificado: 'si' } }));
  }
  await assertFails(deleteObject(ref(storage('staff'), path)));
  await assertSucceeds(deleteObject(ref(storage('admin'), path)));
});

test('Facturas: las lecturas y listados exigen cuenta aprobada activa', async () => {
  const path = file();
  await assertSucceeds(upload('staff', path));
  for (const uid of [null, 'outsider', 'inactive', 'inactiveAdmin', 'badActive']) {
    await assertFails(getMetadata(ref(storage(uid), path)));
    await assertFails(listAll(ref(storage(uid), 'facturas')));
    await assertFails(deleteObject(ref(storage(uid), path)));
  }
  await assertSucceeds(listAll(ref(storage('staff'), 'facturas')));
});

test('Facturas: se admiten PDF e imágenes raster y se rechazan tipos activos o desconocidos', async () => {
  for (const mime of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/tiff', 'image/bmp']) {
    await assertSucceeds(upload('staff', file(), mime));
  }
  for (const mime of ['image/svg+xml', 'text/html', 'application/javascript', 'application/octet-stream']) {
    await assertFails(upload('staff', file(), mime));
  }
});

test('Facturas: límites de tamaño y archivo vacío', async () => {
  await assertFails(upload('staff', file(), 'application/pdf', new Uint8Array(0)));
  await assertFails(upload('staff', file(), 'application/pdf', new Uint8Array(15 * 1024 * 1024)));
  await assertSucceeds(upload('staff', file(), 'application/pdf', new Uint8Array(15 * 1024 * 1024 - 1)));
});

test('Cortes: reimportación JSON permitida; borrado y formatos controlados', async () => {
  const path = 'cortes/2026-09-01_2026-09-07.json';
  await assertSucceeds(upload('admin', path, 'application/json'));
  await assertSucceeds(upload('admin', path, 'application/json'));
  for(const uid of ['staff','legacy',null,'outsider','inactiveAdmin']) {
    await assertFails(upload(uid,path,'application/json'));
    await assertFails(getMetadata(ref(storage(uid),path)));
    await assertFails(listAll(ref(storage(uid),'cortes')));
  }
  await assertFails(upload('admin', path, 'text/html'));
  await assertFails(upload('admin', path, 'application/json', new Uint8Array(5 * 1024 * 1024)));
  await assertFails(deleteObject(ref(storage('staff'), path)));
  await assertSucceeds(deleteObject(ref(storage('admin'), path)));
});

test('Desactivar cuenta aplica también al acceso directo a Storage', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'usuarios/temporal'), { activo: true, rol: 'operativo' }));
  const path = file();
  await assertSucceeds(upload('temporal', path));
  await assertSucceeds(updateDoc(doc(db('admin'), 'usuarios/temporal'), { activo: false }));
  await assertFails(getDoc(doc(db('temporal'), 'estado/cicsa')));
  await assertFails(getMetadata(ref(storage('temporal'), path)));
  await assertFails(upload('temporal', file()));
});

test('Dueño: excepción de arranque, pero no ignora desactivación explícita', async () => {
  await assertSucceeds(getDoc(doc(db(OWNER), 'estado/cicsa')));
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), `usuarios/${OWNER}`), { activo: false, rol: 'admin' }));
  await assertFails(getDoc(doc(db(OWNER), 'estado/cicsa')));
  await assertFails(upload(OWNER, file()));
  await assertFails(setDoc(doc(db(OWNER), 'usuarios/reactivado'), { rol: 'admin' }));
  await assertSucceeds(getDoc(doc(db(OWNER), `usuarios/${OWNER}`)));
});

test('Finanzas v2: migración y permisos reales incluso saltándose la interfaz', async t => {
  const seed={weeks:[{id:'s1',label:'Semana',gastos:[{id:'g1',importe:10}],
    cortes:[{id:'c1',efectivo:90}],retiros:[],aportaciones:[]}],budget:{Gas:100},
    cajaSaldoInicial:{'2026-09-01':{valor:900}},cortesIgnorados:[],cortesImportaciones:[]};
  const parts=financial.split(seed);
  const record2=value=>({schema:2,json:JSON.stringify(value),ts:'2026-09-11'});
  await env.withSecurityRulesDisabled(async c=>{
    for(const scope of ['operation','budget','cash'])
      await setDoc(doc(c.firestore(),financial.PATHS[scope]),record2(parts[scope]));
    await setDoc(doc(c.firestore(),financial.PATHS.marker),{version:2});
    await setDoc(doc(c.firestore(),'estado/respaldo-antiguo'),record);
    await setDoc(doc(c.firestore(),`usuarios/${OWNER}`),{rol:'admin',activo:true});
  });
  await t.test('operativo lee presupuesto y gastos, no Caja ni histórico ni índices',async()=>{
    for(const uid of ['staff','legacy']){
      await assertSucceeds(getDoc(doc(db(uid),'operacion/cicsa')));
      await assertSucceeds(getDoc(doc(db(uid),'finanzas/presupuesto')));
      for(const p of ['finanzas/caja','estado/cicsa','estado/respaldo-antiguo','respaldos/_indice','respaldos/copia'])
        await assertFails(getDoc(doc(db(uid),p)));
      await assertFails(getDocs(collection(db(uid),'estado')));
      await assertFails(getDocs(collection(db(uid),'finanzas')));
    }
  });
  await t.test('operativo no cambia presupuesto, saldos ni marcador; tampoco borra y recrea',async()=>{
    for(const p of ['finanzas/caja','finanzas/presupuesto','configuracion/seguridadFinanciera','estado/cicsa']){
      await assertFails(setDoc(doc(db('staff'),p),record2({fraude:true})));
      await assertFails(deleteDoc(doc(db('staff'),p)));
    }
    await assertFails(deleteDoc(doc(db('staff'),'operacion/cicsa')));
    await assertFails(setDoc(doc(db('staff'),'operacion/otro'),record2(parts.operation)));
    await assertFails(setDoc(doc(db('staff'),'respaldos/falso-completo'),record));
    await assertFails(setDoc(doc(db('admin'),'estado/cicsa'),record));
    await assertFails(deleteDoc(doc(db('admin'),financial.PATHS.marker)));
  });
  await t.test('usuarios ajenos, inactivos y perfiles inválidos no leen v2',async()=>{
    for(const uid of [null,'outsider','inactive','inactiveAdmin','badRole','badActive'])
      for(const p of Object.values(financial.PATHS)){
        await assertFails(getDoc(doc(db(uid),p)));
        await assertFails(setDoc(doc(db(uid),p),record2(parts.operation)));
      }
  });
  await t.test('commit mixto no autorizado falla entero: ni gastos parciales',async()=>{
    const staff=db('staff'),batch=writeBatch(staff);
    batch.set(doc(staff,'operacion/cicsa'),record2({weeks:[]}));
    batch.set(doc(staff,'finanzas/caja'),record2({weeks:[]}));
    await assertFails(batch.commit());
    assert.equal((await getDoc(doc(staff,'operacion/cicsa'))).data().json,JSON.stringify(parts.operation));
  });
  await t.test('respaldo operativo separado e inmutable, completo solo admin',async()=>{
    await assertSucceeds(setDoc(doc(db('staff'),'respaldos_operacion/diario'),record2(parts.operation)));
    await assertFails(getDoc(doc(db('staff'),'respaldos_operacion/diario')));
    await assertSucceeds(getDoc(doc(db('admin'),'respaldos_operacion/diario')));
    await assertFails(setDoc(doc(db('staff'),'respaldos_operacion/diario'),record2({weeks:[]})));
    await assertSucceeds(setDoc(doc(db('admin'),'respaldos/completo-v2'),record));
  });
  await t.test('transporte REAL de la app: lectura transaccional, CAS y escritura por rol',async()=>{
    const store=uid=>financial.createStore({
      base:`http://127.0.0.1:8180/v1/projects/${PROJECT}/databases/(default)/documents`,key:'demo-key',
      headers:async()=>({Authorization:'Bearer '+createMockUserToken({sub:uid},PROJECT)}),isAdmin:()=>uid==='admin'
    });
    const admin=store('admin'),staff=store('staff');
    const a=await admin.read(),s=await staff.read();
    assert.deepEqual(a.data,seed);
    assert.equal(s.data.cajaSaldoInicial,undefined);
    assert.equal(s.data.weeks[0].cortes,undefined);
    const forged=financial.clone(s.data); forged.budget.Gas=1; forged.cajaSaldoInicial={fraude:999};
    forged.weeks[0].cortes=[{id:'falso'}]; forged.weeks[0].gastos.push({id:'g2',importe:20});
    await staff.write(forged,s);
    const saved=await admin.read();
    assert.equal(saved.data.budget.Gas,100);
    assert.equal(saved.data.cajaSaldoInicial['2026-09-01'].valor,900);
    assert.equal(saved.data.weeks[0].cortes[0].id,'c1');
    assert.equal(saved.data.weeks[0].gastos.length,2);
    await assert.rejects(admin.write(seed,a),e=>e.conflict);
    const modified=financial.clone(saved.data); modified.budget.Gas=200;
    modified.cajaSaldoInicial['2026-09-01'].valor=800;
    await admin.write(modified,saved);
    assert.equal((await staff.read()).data.budget.Gas,200);
    assert.equal((await admin.read()).data.cajaSaldoInicial['2026-09-01'].valor,800);
  });
});
