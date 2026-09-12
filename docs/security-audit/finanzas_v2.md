# Separación de permisos financieros — CICSA

Fecha: 11 de septiembre de 2026. Versión de interfaz: `2026-09-11-finanzas-v2`.

## [WARNING] W12 — controles administrativos eludibles en el JSON compartido

Antes, `estado/cicsa` contenía gastos, presupuesto, saldos y movimientos de Caja.
Ocultar botones o pedir contraseña/PIN en JavaScript no limitaba una solicitud directa.

Corrección implementada:

| Documento/ruta | Operativo activo | Administrador activo |
| --- | --- | --- |
| `operacion/cicsa` | Leer y actualizar gastos | Leer y actualizar |
| `finanzas/presupuesto` | Leer | Leer y actualizar |
| `finanzas/caja` | Sin acceso | Leer y actualizar |
| `estado/*` después de migración | Sin acceso | Leer histórico; no escribir estado principal |
| `respaldos/*`, incluido índice | Sin acceso | Leer; crear copias inmutables |
| `respaldos_operacion/*` | Crear copia operativa inmutable | Leer y eliminar |
| Storage `cortes/*` | Sin acceso | Leer, importar y administrar |
| Storage `facturas/*` | Leer y crear sin reemplazar | Igual; además eliminar |

Ejemplo del control en Firebase, independiente de la interfaz:

```javascript
match /finanzas/{doc} {
  allow get: if finanzasSeparadas() &&
    ((doc == 'presupuesto' && esUsuario()) || (doc == 'caja' && esAdmin()));
  allow update: if doc in ['presupuesto', 'caja'] &&
    finanzasSeparadas() && esAdmin() && estadoV2();
}
```

`assets/financial-access.js` proyecta únicamente campos operativos permitidos.
Los campos `budget`, `cajaSaldoInicial`, `cortes`, `retiros` o `aportaciones` que alguien
inyecte en el JSON público no son fuentes autorizadas: se ignoran al reconstruir el estado.
La documentación no promete que un operativo no pueda deducir cifras a partir de gastos
que legítimamente puede consultar, ni que se puedan retirar copias descargadas anteriormente.

## [WARNING] Copias antiguas, enlaces de cortes y caché

Remedios:

- La activación del marcador bloquea clientes antiguos y sus lecturas/escrituras al estado anterior.
- El administrador conserva acceso al histórico. No se elimina el documento original.
- Los respaldos completos y sus índices quedan privados. El operativo genera una copia diaria
  de gastos en una colección separada; el respaldo completo diario requiere una sesión admin.
- Se retiran los tokens de descarga históricos de `cortes/`, sin borrar archivos y sin tocar `facturas/`.
- La caché v2 contiene solo operación y su versión base, asociadas al UID; nunca Caja.
- Una copia local antigua sin versión base no se fusiona a ciegas: se ofrece como descarga
  de recuperación. Un operativo solo recibe su proyección operativa.
- Cerrar sesión limpia memoria/DOM. Cerrar la ventana con cambios admin pendientes advierte
  antes de salir. La lectura inicial fallida no habilita captura ni crea un estado vacío.
- `/load-state` y `/save-state` locales exigen administrador; la app ya no los usa como
  fuente alternativa. En Railway siguen deshabilitados.

## [WARNING] Migración y concurrencia

El traslado se ejecuta con `node tools/migrate_financial_access.cjs --apply` únicamente tras
publicar las reglas exactas y la interfaz v2. El modo predeterminado `--check` no escribe.

La migración realiza una comparación reversible del estado y un único commit con:

1. Precondición de la versión del estado original.
2. Copia exacta e inmutable previa en `respaldos/`.
3. Creación de los tres documentos separados.
4. Creación del marcador de activación, no modificable desde navegadores.

Si otra persona guarda durante la preparación, la precondición cancela TODO el commit.
Reejecutar después de activarse no vuelve a migrar ni sobreescribe los datos nuevos.
En sincronización normal se usan lecturas transaccionales y commits atómicos con versiones.
Los conflictos se reintentan como máximo tres veces; un conflicto persistente conserva la
captura pendiente. El arranque usa fusión de tres vías cuando existe una base de caché v2.

No revertir publicando la interfaz/reglas antiguas: reabriría el acceso. Para recuperar datos,
un administrador debe revisar el respaldo previo y restaurar mediante el escritor v2,
manteniendo el marcador y las reglas actuales. No borrar los documentos nuevos ni el marcador.

## [SUGGESTION] Verificación y límites

Pruebas locales: 709 financieras, 12 de sincronización/PDF/integridad, 12 nuevas de aislamiento
y caché, 45 casos/subcasos con emuladores oficiales, 19 de autorización backend y 17 de Gmail.
Incluyen el transporte REST real usado por la app, presupuestos falsificados, lectura directa
de Caja como operativo, commits mixtos rechazados completos y conflicto de versiones.

Desplegado mediante `0381ad6b2f09594b4bceb42a5e7964bf1e0b9b0d`. CI de main
`34669127350`, GitHub Pages `34669126697` y Railway terminaron correctamente.
La interfaz publicada y el hash SRI de su módulo financiero coinciden.

- Firestore activo: `887786f5-c8e3-4405-8ab2-0acdbccf25d6`; SHA-256
  `b9bf532c228534aa8b0fc959e70b462ffe6a82bcb79e6a7dffb400edef3ff92d`.
- Storage activo: `7b0321f2-aa48-403c-bbf5-9d716efb6e50`; SHA-256
  `bc5ceaa38b8fda415c952ee734c97da19a34cdb04941e2d786e6ce2e68df4a30`.
- Ambas fuentes publicadas son idénticas a las locales; IAM entre servicios confirmado.
- Sin sesión, operación, presupuesto, Caja, estado anterior e índice responden 403.
  `datos/precios` sigue respondiendo 200 para conservar la integración con Menú.
- Migración activa: 12 semanas, 507 gastos, 356 cortes. Proyección operativa sin campos privados.
- Respaldo exacto: `respaldos/respaldo-2026-09-12-antes-finanzas-v2` (fecha UTC).
  SHA-256 del JSON original y respaldado:
  `7e7306af824411692181b0b9aa943b6e05b58c826f7e771d8361796af95bcae1`.
- Google devolvió un 500 transitorio al verificar después del commit; se consultó el marcador
  sin repetir escrituras y se verificó el respaldo exacto. El traslado no se ejecutó dos veces.
- Se retiraron seis tokens históricos de descarga de cortes y se comprobó la denegación
  de los seis enlaces anteriores. Los seis archivos permanecen; cero borrados.
- Arranque en navegador aislado con datos ficticios: admin ve Caja y sus cifras; operativo
  conserva gastos y presupuesto, sin Caja, Balance ni herramientas de administración.

Falta aceptación funcional de esta nueva versión con la sesión habitual del usuario en
producción. La prueba anterior de carga/visualización de factura sí fue confirmada por el usuario,
antes de esta separación. No se crearon usuarios ni registros contables ficticios en producción.
Recargar las pestañas antiguas: ya no se permite que guarden en el estado anterior.

Mejoras posteriores: respaldo completo programado fuera de sesiones de usuario; archivo por
periodos para dejar atrás el límite de 1 MiB por documento; autorización granular de edición
de gastos si se requiere. El PIN local no es una segunda barrera del servidor: la barrera real
de esta entrega es el rol administrativo validado en Firebase.

Referencias oficiales: [commits atómicos](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit),
[lecturas transaccionales](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet),
[reglas de Storage](https://firebase.google.com/docs/storage/security/rules-conditions).
