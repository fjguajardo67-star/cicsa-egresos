// Migración acotada e idempotente. Usa la sesión CLI, nunca imprime datos ni tokens.
// --check (predeterminado): solo lectura. --apply: respaldo + separación + marcador atómicos.
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const testRequire = createRequire(path.join(__dirname, '../tests/firebase/package.json'));
const { getProjectDefaultAccount } = testRequire('firebase-tools/lib/auth');
const { requireAuth } = testRequire('firebase-tools/lib/requireAuth');
const { Client } = testRequire('firebase-tools/lib/apiv2');
const { firestoreOrigin } = testRequire('firebase-tools/lib/api');
const rules = testRequire('firebase-tools/lib/gcp/rules');
const financial = require('../assets/financial-access.js');
const project = 'cicsa-egresos';
const base = `projects/${project}/databases/(default)/documents`;
const digest = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const quiet = { skipLog: { body: true, resBody: true } };
let stage = 'sesion';
async function main() {
  if (process.argv.slice(2).some(a => !['--check', '--apply'].includes(a))) throw new Error('ARGUMENTOS');
  const account = getProjectDefaultAccount(path.resolve(__dirname, '..'));
  if (!account) throw new Error('LOGIN_REQUIRED');
  await requireAuth({ project, nonInteractive: true, user: account.user, tokens: account.tokens });
  const client = new Client({ urlPrefix: firestoreOrigin(), apiVersion: 'v1' });
  const get = async p => {
    try { return (await client.get(`/${base}/${p}`, quiet)).body; }
    catch (e) { if (e.status === 404 || e.context?.response?.statusCode === 404) return null; throw e; }
  };
  stage = 'lectura';
  const marker = await get(financial.PATHS.marker);
  if (marker) {
    if (marker.fields?.version?.integerValue !== '2') throw new Error('MARCADOR_INVALIDO');
    for (const p of ['operation', 'budget', 'cash']) {
      const doc = await get(financial.PATHS[p]);
      if (doc?.fields?.schema?.integerValue !== '2') throw new Error('DOCUMENTO_INCOMPLETO');
    }
    console.log(JSON.stringify({ project, status: 'migracion_ya_aplicada', writes: 0 }));
    return;
  }
  const legacy = await get('estado/cicsa');
  if (!legacy?.updateTime || !legacy.fields?.json?.stringValue) throw new Error('ORIGEN_INCOMPLETO');
  const original = JSON.parse(legacy.fields.json.stringValue);
  const parts = financial.split(original);
  const indexDoc = await get('respaldos/_indice');
  const previousIndex = indexDoc?.fields?.json?.stringValue ? JSON.parse(indexDoc.fields.json.stringValue) : [];
  if (!Array.isArray(previousIndex)) throw new Error('INDICE_INVALIDO');
  // Comparación por contenido, no por orden de propiedades.
  const { isDeepStrictEqual } = require('node:util');
  const roundtrip = financial.compose(parts.operation, parts.budget, parts.cash);
  if (!isDeepStrictEqual(original, roundtrip)) throw new Error('ROUNDTRIP_DIFERENTE');
  for (const p of ['operation', 'budget', 'cash']) {
    if (await get(financial.PATHS[p])) throw new Error('DESTINO_YA_EXISTE');
    if (Buffer.byteLength(JSON.stringify(parts[p])) > 990000) throw new Error('DOCUMENTO_DEMASIADO_GRANDE');
  }
  console.log(JSON.stringify({ project, status: 'preflight_correcto',
    sourceHash: digest(legacy.fields.json.stringValue),
    publicKeys: Object.keys(parts.operation), privateKeys: Object.keys(parts.cash),
    weekKeys: [...new Set(original.weeks.flatMap(w => Object.keys(w)))],
    weeks: original.weeks.length, gastos: original.weeks.reduce((n,w)=>n+(w.gastos||[]).length,0),
    cortes: original.weeks.reduce((n,w)=>n+(w.cortes||[]).length,0),
    bytes: Object.fromEntries(Object.entries(parts).map(([k,v])=>[k,Buffer.byteLength(JSON.stringify(v))])),
    roundtrip: true }));
  if (!process.argv.includes('--apply')) return;
  stage = 'verificar_reglas_publicadas';
  const releases = await rules.listAllReleases(project);
  for (const [suffix, file] of [['cloud.firestore','firestore.rules'],
    ['firebase.storage/cicsa-egresos.firebasestorage.app','storage.rules']]) {
    const release = releases.find(r => r.name === `projects/${project}/releases/${suffix}`);
    if (!release) throw new Error('REGLAS_NO_PUBLICADAS');
    const sources = await rules.getRulesetContent(release.rulesetName);
    if (sources.length !== 1 || digest(sources[0].content) !== digest(readFileSync(path.join(__dirname,'..',file),'utf8')))
      throw new Error('REGLAS_DIFERENTES');
  }
  stage = 'verificar_interfaz_publicada';
  const live = await fetch('https://cicsa-egresos.cicsacomedores.com.mx/?verify=finanzas-v2', { signal:AbortSignal.timeout(20000) });
  const html = await live.text();
  if (!live.ok || !html.includes('2026-09-11-finanzas-v2') || !html.includes('assets/financial-access.js'))
    throw new Error('INTERFAZ_NO_PUBLICADA');
  stage = 'commit_atomico';
  const ts = new Date().toISOString();
  const backup = `respaldos/respaldo-${ts.slice(0,10)}-antes-finanzas-v2`;
  const meta = { semanas:original.weeks.length,
    gastos:original.weeks.reduce((n,w)=>n+(w.gastos||[]).length,0),
    cortes:original.weeks.reduce((n,w)=>n+(w.cortes||[]).length,0),
    importe:Math.round(original.weeks.reduce((n,w)=>n+(w.gastos||[]).reduce((t,g)=>t+(parseFloat(g.importe)||0),0),0)*100)/100 };
  const indexEntry = { id:backup.split('/')[1], ts, ...meta };
  const writes = [{ verify: `${base}/estado/cicsa`, currentDocument:{updateTime:legacy.updateTime} },
    { update:{ name:`${base}/${backup}`, fields:{...legacy.fields,ts:{stringValue:ts},meta:{stringValue:JSON.stringify(meta)}} }, currentDocument:{exists:false} },
    { update:{name:`${base}/respaldos/_indice`,fields:{
      json:{stringValue:JSON.stringify([indexEntry,...previousIndex])},ts:{stringValue:ts}
    }},currentDocument:indexDoc ? {updateTime:indexDoc.updateTime} : {exists:false} },
    ...['operation','budget','cash'].map(scope=>({
      update:{name:`${base}/${financial.PATHS[scope]}`,fields:financial.envelope(parts[scope])},
      currentDocument:{exists:false}
    })),
    { update:{name:`${base}/${financial.PATHS.marker}`, fields:{
      version:{integerValue:'2'}, ts:{stringValue:ts}, sourceHash:{stringValue:digest(legacy.fields.json.stringValue)},
      sourceVersion:{stringValue:legacy.updateTime}, backup:{stringValue:backup}
    }}, currentDocument:{exists:false} }
  ];
  await client.post(`/${base}:commit`, { writes }, quiet);
  stage = 'verificar_respaldo';
  const saved = await get(backup);
  if (saved?.fields?.json?.stringValue !== legacy.fields.json.stringValue) throw new Error('RESPALDO_NO_COINCIDE');
  const active = await get(financial.PATHS.marker);
  if (active?.fields?.version?.integerValue !== '2') throw new Error('MARCADOR_NO_ACTIVO');
  console.log(JSON.stringify({ project, status:'migracion_aplicada', backup, backupExact:true,
    atomic:true, legacyDeleted:false, sourceHash:digest(legacy.fields.json.stringValue) }));
}
main().catch(error => {
  // No interpolar error.message: clientes HTTP pueden incluir cuerpos con información privada.
  console.error(JSON.stringify({status:'detenido',stage,code:Number(error.status || error.context?.response?.statusCode || 0),
    reason: /^[A-Z_]+$/.test(error.message || '') ? error.message : 'CONSULTAR_SIN_EXPONER_DATOS' }));
  process.exitCode=1;
});
