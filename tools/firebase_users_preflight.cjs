// Revisión de compatibilidad: lee solo rol/activo y muestra cifras agregadas.
const { createRequire } = require('node:module');
const path = require('node:path');
const testRequire = createRequire(path.join(__dirname, '../tests/firebase/package.json'));
const { getProjectDefaultAccount } = testRequire('firebase-tools/lib/auth');
const { requireAuth } = testRequire('firebase-tools/lib/requireAuth');
const { Client } = testRequire('firebase-tools/lib/apiv2');
const { firestoreOrigin } = testRequire('firebase-tools/lib/api');

(async () => {
  const account = getProjectDefaultAccount(path.resolve(__dirname, '..'));
  if (!account) throw new Error('LOGIN_REQUIRED');
  const project = 'cicsa-egresos';
  await requireAuth({ project, nonInteractive: true, user: account.user, tokens: account.tokens });
  const client = new Client({ urlPrefix: firestoreOrigin(), apiVersion: 'v1' });
  const counts = { total: 0, activeAdmins: 0, activeStaff: 0, inactive: 0, malformed: 0, legacy: 0, owner: 'missing' };
  let pageToken;
  do {
    const queryParams = new URLSearchParams({ pageSize: '100' });
    queryParams.append('mask.fieldPaths', 'rol');
    queryParams.append('mask.fieldPaths', 'activo');
    if (pageToken) queryParams.set('pageToken', pageToken);
    const response = await client.get(`/projects/${project}/databases/(default)/documents/usuarios`, {
      queryParams,
      skipLog: { resBody: true }
    });
    for (const document of response.body.documents || []) {
      counts.total++;
      const fields = document.fields || {};
      const active = fields.activo ?? { booleanValue: true };
      const role = fields.rol ?? { stringValue: 'operativo' };
      const malformed = (Object.keys(active).length !== 1 || typeof active.booleanValue !== 'boolean' ||
        Object.keys(role).length !== 1 || !['admin', 'operativo'].includes(role.stringValue));
      const owner = document.name.endsWith('/NVapfgY8pshXwYbMq7Wz28ry3pC3');
      if (!fields.activo || !fields.rol) counts.legacy++;
      if (malformed) counts.malformed++;
      else if (!active.booleanValue) counts.inactive++;
      else if (owner || role.stringValue === 'admin') counts.activeAdmins++;
      else counts.activeStaff++;
      if (owner) counts.owner = malformed ? 'malformed' : active.booleanValue ? 'active' : 'inactive';
    }
    pageToken = response.body.nextPageToken;
  } while (pageToken);
  console.log(JSON.stringify(counts));
  if (counts.malformed || ['malformed', 'inactive'].includes(counts.owner)) process.exitCode = 1;
})().catch(error => {
  console.error(`No se pudo comprobar la compatibilidad de perfiles: ${error.name}, código ${Number(error.status || error.context?.response?.statusCode || error.context?.response?.status || 0)}. No se muestran credenciales ni registros.`);
  process.exitCode = 1;
});
