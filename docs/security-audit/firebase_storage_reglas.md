# Reglas de Firestore y Storage — correcciones y aceptación

Estado: publicadas en Firestore y Storage; verificadas contra las fuentes probadas.

## Evidencia de publicación

- Firebase CLI confirmó compilación y publicación correcta de ambas reglas.
- Las fuentes activas coinciden byte a byte con los archivos del repositorio.
- IAM entre Storage y Firestore confirmado antes y después del despliegue.
- Preflight de los cinco perfiles: dos administradores, tres operativos, ningún
  perfil inválido; los registros heredados siguen siendo compatibles.
- Comprobaciones HTTP sin sesión: `datos/precios` 200, `estado/cicsa` 403,
  listado `datos` 403 y listado de facturas de Storage 403.
- Ruleset Firestore: `7c98c756-806e-49cb-b79a-1e207e0fb5d1`.
- Ruleset Storage: `2392ea22-4b81-4542-b860-0d5be627cf0a`.
- Reversión disponible: rulesets anteriores Firestore
  `dd19a533-0dc3-4030-9648-da92566580fe` y Storage
  `e2d3c1f5-1806-4db3-a461-cf2c329cc91b`; fuentes guardadas como entregable local.

La sesión CLI administradora pertenece a `fjguajardo67@gmail.com` y quedó
seleccionada para esta carpeta de proyecto. La cuenta de importación Gmail sigue
siendo independiente. Falta la aceptación del flujo de captura/consulta de facturas
con una sesión real de la aplicación después del despliegue.

## [CRITICAL] Autorización coherente con el backend

La pertenencia se consulta en `usuarios/{uid}`. Las cuentas desactivadas, roles
desconocidos y valores malformados se deniegan tanto en Firestore como en Storage.
Las cuentas históricas sin `activo`/`rol` conservan acceso operativo, igual que en
`auth_cicsa.py`. El dueño solo tiene excepción de arranque cuando su registro no
existe; no se ignora una desactivación explícita. La lectura del perfil propio se
conserva para que la aplicación y el backend puedan informar la denegación.

Solo administradores activos crean, modifican o eliminan perfiles. Las escrituras
validan que `activo` sea booleano y `rol` sea `admin` u `operativo` cuando existan.

## [WARNING] W12 — respaldos e integridad financiera

El equipo puede crear respaldos diarios y mantener `_indice`. Las copias completas
solo las lee el administrador y no se pueden sobrescribir, ni siquiera por un
administrador. Borrar una copia requiere administrador.

El presupuesto todavía está dentro de `estado/cicsa.json`, compartido con la captura
operativa. Las reglas no pueden analizar ese JSON como campos. Su autorización
independiente sigue pendiente de migrar a documentos separados; W12 no está cerrado.
Se mantiene la reimportación de cortes JSON, requerida por la aplicación.

## [WARNING] W15 — Storage y archivos

Las facturas solo se crean si `resource == null`; se bloquean cambios de bytes y
metadatos posteriores. La prueba inicial detectó una repetición de subida aceptada
sin esa condición adicional. La versión corregida la rechaza. Borrar exige admin.

Se admiten PDF e imágenes raster declaradas, con menos de 15 MiB; se rechazan SVG,
HTML, JavaScript, formatos desconocidos y archivos vacíos. Cortes admite JSON con
menos de 5 MiB. El MIME es declarado por el cliente: esta política no sustituye
inspección del archivo ni parchea la librería PDF.js.

Storage consulta perfiles en Firestore y necesita el rol
`roles/firebaserules.firestoreServiceAgent` en su agente de servicio. El despliegue
debe comprobarlo; nunca sustituir la política por acceso a cualquier cuenta autenticada.

## [WARNING] W16 — precios públicos

Solo se permite la lectura anónima directa de `datos/precios`, utilizada por CICSA
Menú. No se permite listar `datos` ni leer otros documentos de esa colección.

## Pruebas y publicación

38 pruebas pasan usando Firebase Emulator Suite y el proyecto ficticio
`demo-cicsa-rules`; no cargan datos reales ni credenciales. Cubren permisos denegados
y permitidos, conciliación CFDI/XML, cuentas heredadas, revocación de permisos, roles,
respaldos, precios, chat, actividad, rutas desconocidas, tamaños y formatos de archivos.
La batería exige explícitamente emuladores en localhost antes de escribir cualquier dato.

```sh
npm --prefix tests/firebase ci --ignore-scripts
npm --prefix tests/firebase run test:rules
```

Java 21 y Node 22 se configuran en CI. Las dependencias de pruebas viven debajo de
`tests/firebase/` para no cambiar la detección de la aplicación Python de Railway.

Antes de publicar, con sesión administradora de Firebase CLI:

```sh
node tools/firebase_rules_snapshot.cjs
node tools/firebase_users_preflight.cjs
```

Conservar las fuentes y nombres de ruleset devueltos como respaldo; el script no
imprime objetos de sesión. Comparar la versión desplegada con la propuesta y comprobar
IAM antes de modificar las reglas. Publicar únicamente estas dos superficies:

```sh
./tests/firebase/node_modules/.bin/firebase deploy --project cicsa-egresos --only firestore:rules,storage
node tools/firebase_rules_snapshot.cjs --verify
```

`--verify` exige que ambos contenidos coincidan byte a byte y que IAM esté habilitado.
El código en GitHub no equivale a reglas activas en Firebase. Conservar los nombres de
ruleset anteriores permite revertir las releases si fuera necesario sin borrar datos.

Fuentes oficiales: [pruebas de reglas](https://firebase.google.com/docs/rules/unit-tests),
[gestión y despliegue](https://firebase.google.com/docs/rules/manage-deploy) y
[condiciones de Storage](https://firebase.google.com/docs/storage/security/rules-conditions).
