// Lee reglas y comprueba el IAM usado por Storage. Nunca imprime objetos de sesión.
// Usa la misma sesión y cliente HTTP de Firebase CLI; no recibe claves ni tokens.
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const testRequire = createRequire(path.join(__dirname, '../tests/firebase/package.json'));
const { getProjectDefaultAccount } = testRequire('firebase-tools/lib/auth');
const { requireAuth } = testRequire('firebase-tools/lib/requireAuth');
const rules = testRequire('firebase-tools/lib/gcp/rules');
const { getProjectNumber } = testRequire('firebase-tools/lib/getProjectNumber');
const { serviceAccountHasRoles } = testRequire('firebase-tools/lib/gcp/resourceManager');
const { Client } = testRequire('firebase-tools/lib/apiv2');
const { firebaseStorageOrigin } = testRequire('firebase-tools/lib/api');

const project = 'cicsa-egresos';
const expectedBucket = 'cicsa-egresos.firebasestorage.app';
const expectedReleases = new Map([
  [`projects/${project}/releases/cloud.firestore`, 'firestore.rules'],
  [`projects/${project}/releases/firebase.storage/${expectedBucket}`, 'storage.rules']
]);
const sha256 = s => createHash('sha256').update(s).digest('hex');
let stage = 'sesion';

(async () => {
  const account = getProjectDefaultAccount(path.resolve(__dirname, '..'));
  if (!account) throw new Error('LOGIN_REQUIRED');
  const options = { project, nonInteractive: true, user: account.user, tokens: account.tokens };
  await requireAuth(options);
  stage = 'reglas';
  const releases = (await rules.listAllReleases(project)).filter(r => expectedReleases.has(r.name));
  if (releases.length !== 2) throw new Error('EXPECTED_RELEASES_MISSING');
  stage = 'bucket';
  // GET directo: el helper de despliegue también puede habilitar APIs.
  const storageClient = new Client({ urlPrefix: firebaseStorageOrigin(), apiVersion: 'v1alpha' });
  const bucketResponse = await storageClient.get(`/projects/${project}/defaultBucket`);
  const bucket = bucketResponse.body?.bucket?.name?.split('/').pop();
  if (bucket !== expectedBucket) throw new Error('BUCKET_MISMATCH');
  stage = 'numero_proyecto';
  const number = await getProjectNumber(options);
  stage = 'iam';
  const crossServiceIam = await serviceAccountHasRoles(number,
    `service-${number}@gcp-sa-firebasestorage.iam.gserviceaccount.com`,
    ['roles/firebaserules.firestoreServiceAgent'], true);
  stage = 'fuentes';
  const output = [];
  for (const release of releases) {
    const files = await rules.getRulesetContent(release.rulesetName);
    const localPath = expectedReleases.get(release.name);
    const localHash = sha256(readFileSync(localPath, 'utf8'));
    output.push({ release: release.name, ruleset: release.rulesetName,
      files: files.map(f => ({ name: f.name, sha256: sha256(f.content),
        matchesLocal: sha256(f.content) === localHash,
        ...(process.argv.includes('--verify') ? {} : { content: f.content }) })) });
  }
  console.log(JSON.stringify({ project, bucket, crossServiceIam, releases: output }, null, 2));
  if (process.argv.includes('--verify') && (!crossServiceIam || output.some(r => r.files.length !== 1 || !r.files[0].matchesLocal))) {
    process.exitCode = 1;
  }
})().catch(error => {
  const safe = ['LOGIN_REQUIRED', 'BUCKET_MISMATCH', 'EXPECTED_RELEASES_MISSING'];
  console.error(safe.includes(error.message) ? error.message : `No se pudo verificar Firebase: etapa ${stage}, código ${Number(error.status || error.context?.response?.statusCode || error.context?.response?.status || 0)}. Comprueba sesión y permisos de administración.`);
  process.exitCode = 1;
});
