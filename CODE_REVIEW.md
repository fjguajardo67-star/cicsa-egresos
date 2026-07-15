# Code Review — CICSA Control de Egresos

**Fecha:** 2026-07-15 · **Alcance:** repo completo (`index.html`, `servidor_cicsa.py`, `gmail_cicsa.py`, `generar_token_gmail.py`, configuración) · **Build revisado:** `2026-07-15-a` → correcciones aplicadas en `2026-07-15-b`

---

## 1. Qué se revisó

| Componente | Descripción | Líneas |
|---|---|---|
| `index.html` | Frontend completo (SPA de archivo único): captura de gastos, semanas, presupuesto, Caja, Pagos, reportes, conciliación SAT, catálogo de productos, sync a Menú, Gmail | ~5,000 |
| `servidor_cicsa.py` | Backend Flask (Railway): lectura de documentos con IA, Gmail, estado local, SAT | 618 |
| `gmail_cicsa.py` | Módulo Gmail (scan de facturas en correo) | 275 |
| `generar_token_gmail.py` | Utilidad local de OAuth | 46 |

**Arquitectura:** frontend estático en GitHub Pages que habla directo con Firestore (REST, estado completo serializado en un documento `estado/cicsa`) y con el Flask de Railway para las funciones de IA/Gmail. No hay build system ni framework — todo es un solo HTML con CRLF (convención del repo, preservada).

---

## 2. Cobertura de pruebas — antes / después

| | Antes | Después |
|---|---|---|
| Pruebas JS (lógica financiera) | **0** | **24** (`tests/run_js_tests.js`) |
| Pruebas Python (helpers Gmail) | **0** | **10** (`tests/test_gmail_cicsa.py`) |

Las pruebas JS **extraen las funciones reales de `index.html`** (brace-matching + sandbox `vm`), así que prueban siempre el código vigente sin copias. Cubren: `precioPorUnidadBase`/`contenidoTotalGramos` (todas las unidades base, merma, exclusiones), `esGastoEfectivo`, `formaPagoLabel`, `partidasExpandidas`, `saldoInicialSemana`, `calcularSaldoAntesDe`, `findDuplicate`, `conciliarSAT`, `posibleMismoIngrediente`, `dedupeProductos`, `diaSemanaLabel`, `todayStr`, `diasRestantes`.

**Correr:** `node tests/run_js_tests.js` y `python3 tests/test_gmail_cicsa.py` (los stubs evitan instalar las libs de Google). Estado final: **34/34 verdes**, también bajo `TZ=America/Mexico_City`.

> No hay métrica de line-coverage instrumentada (la arquitectura de archivo único no lo facilita); la cobertura es cualitativa sobre las funciones de dinero/fechas, que son las de mayor riesgo.

---

## 3. Hallazgos

### ✅ CORREGIDOS en esta revisión (commit `fixes`)

| # | Sev. | Archivo | Problema | Fix |
|---|---|---|---|---|
| F1 | **Alta** | `index.html` (12 sitios) | **Bug de zona horaria:** `todayStr()` y todos los defaults de "hoy" usaban `toISOString()` (fecha **UTC**). En México (UTC-6/7), cualquier gasto/corte/vencimiento capturado después de ~6pm quedaba fechado **mañana**; rangos de reporte/SAT igual. | Nuevo `fechaLocalStr()`; reemplazados los 12 usos basados en "ahora". Los 2 restantes son conversión de seriales de Excel (correctos en UTC, intocados). |
| F2 | **Alta** | `index.html` `diasRestantes()` | **Off-by-one en vencimientos** (descubierto por la suite nueva): `Math.round(±0.5)` hacía que una factura que vence HOY mostrara "1d" y una vencida AYER diera 0 — nunca entraba al filtro Vencidas (`d<0`). Todos los créditos corridos un día. | `Math.floor` (días completos restantes). |
| F3 | **Crítica** | `servidor_cicsa.py` | `/load-state` y `/save-state` **sin autenticación en la URL pública de Railway**: cualquiera podía descargar TODO el estado financiero o sobreescribirlo (y `initState` prefiere el estado del servidor si trae ≥ gastos → envenenamiento). | Deshabilitados cuando `RAILWAY_ENVIRONMENT` está presente (404). En producción la fuente durable es Firestore (con auth); el frontend ya toleraba la ausencia (timeout + fallback). Uso local intacto. |
| F4 | **Alta** | `servidor_cicsa.py` | La ruta estática `/<filename>` servía **cualquier archivo del directorio**: `cicsa_data.json` (estado financiero completo), `gmail_seen.json`, el propio código fuente. | Whitelist de extensiones de assets (`.html .css .js .png .jpg .jpeg .ico .svg .webp`); todo lo demás 404. |
| F5 | **Media** | `index.html` Gmail | **XSS almacenado vía correo:** asunto/remitente/nombre de archivo se inyectaban en `innerHTML` sin escapar — un correo malicioso podía ejecutar JS en la sesión (que tiene token de Firebase). | Helper `esc()` aplicado a todos los campos de origen externo en `renderGmailInbox()`. |
| F6 | **Media** | `servidor_cicsa.py` | Sin límite de tamaño de request → cualquiera podía postear GB y llenar el disco. | `MAX_CONTENT_LENGTH = 32MB` (los payloads legítimos son PDFs base64 de pocos MB). |
| F7 | **Media** | `index.html` `fbListCollection` | El catálogo se **truncaba silenciosamente en 300 documentos** (sin seguir `nextPageToken`) — el producto 301+ simplemente no aparecía. | Bucle de paginación. |
| F8 | **Media** | `index.html` | La página pesaba **6.2 MB**: el logo (un PNG de 2.9 MB) estaba embebido **dos veces** (login + topbar). | El topbar copia el src del login por JS al cargar. **6.2 MB → 3.26 MB (−47%)**. |
| F9 | Baja | `index.html` `openWeekModal` | Crash si una semana venía sin arreglo `gastos` (datos remotos viejos). | `(w.gastos\|\|[])` defensivo. |
| F10 | Baja | `index.html` `guardarProducto` | Merma negativa o ≥100% se guardaba sin validar (negativa "abarata" el producto; 100 divide entre cero). | Validación 0–99.9% con alerta. |
| F11 | Baja | `servidor_cicsa.py` | `/` local no servía `index.html` (lista de nombres de archivo obsoleta). | `index.html` agregado a los candidatos. |

### 📋 PROPUESTOS — requieren tu decisión (NO aplicados)

| # | Sev. | Problema | Recomendación |
|---|---|---|---|
| P1 | **Crítica** | **Firestore de Menú abierto a escritura pública:** `confirmarSyncMenu`/`confirmarExportMenu` escriben `datos/precios` del proyecto `sistema-menu-cicsa` solo con API key, sin token de usuario → las reglas de ese proyecto necesariamente permiten escritura anónima. Cualquiera puede corromper los precios que costean tus recetas. | El fix vive en el **proyecto de Menú** (reglas + auth), no en este repo. Llévalo a la sesión de Menú: exigir auth en las reglas y que Egresos mande el idToken (aquí ya existe `fbAuthHeader()` — sería agregarlo a esas 2 llamadas cuando Menú lo exija). |
| P2 | **Alta** | **Resto de endpoints Flask sin auth:** `/gmail-fetch` entrega las facturas reales (base64) a quien tenga la URL; `/leer-*` y `/sat-leer-cfdi` queman tokens de Anthropic de tu cuenta; `/gmail-renovar` y `/gmail-reset-seen` son operables por terceros. | Middleware que verifique el **ID token de Firebase** (el frontend ya inicia sesión). Requiere `firebase-admin` en requirements + cambio coordinado de frontend. Puedo implementarlo cuando lo apruebes. |
| P3 | Media | **Último-en-escribir-gana** en `estado/cicsa`: dos dispositivos guardando a la vez pueden pisarse gastos sin aviso (el estado completo viaja como un solo blob). | Opciones: documento por semana, o merge por id antes de escribir. Cambio arquitectónico — decidir si el riesgo real (¿cuántas personas capturan a la vez?) lo amerita. |
| P4 | Media | **Importes negativos permitidos** en `guardarGasto`/`guardarManual`/edición inline. ¿Es intencional (notas de crédito/devoluciones)? Si no, un typo con signo distorsiona totales y presupuesto. | Confirmar la regla de negocio; si no se usan negativos, bloquear con validación. |
| P5 | Baja | **Función muerta:** la vista de aprobación Sheets llama a `aprobarGasto()` que está **vacía** (los botones Aprobar/Rechazar no hacen nada), y `sheets_cicsa.py` no existe en el repo. | Quitar la UI de Sheets o completar el módulo. |
| P6 | Baja | `/precios-ingredientes` (Flask) expone públicamente gasto por proveedor y quedó **superseded** por el sync de catálogo vía Firestore. | Eliminarlo si Menú ya no lo consume (verificar en la sesión de Menú). |
| P7 | Baja | El logo sigue siendo un PNG de 2.9 MB (una vez). Recomprimido a ~100 KB la página bajaría a ~400 KB. | Recomprimir el PNG (herramienta de imagen; no lo hice para no alterar un asset de marca sin verlo). |
| P8 | Baja | CDNs: pdf.js 3.11.174 (major viejo), Firebase compat 9.22.0, jsPDF 2.5.1, XLSX 0.18.5. Sin vulnerabilidades explotables conocidas en el uso actual, pero van quedando atrás. `requirements.txt` sin pins de versión (reproducibilidad). | Actualizar con calma y probando; pinnear requirements. |
| P9 | Info | Dinero en punto flotante (Number de JS) — posible deriva de centavos en sumas largas. | Aceptable a esta escala; el fix real (centavos enteros) sería un refactor amplio. |

### Supuestos de comportamiento (verificados como intencionales, no bugs)

- **Las "semanas" son bolsas de captura, no rangos de calendario** — una factura puede vivir en una semana cuyo rango no contiene su fecha (documentado en el código).
- **Caja tiene dos saldos iniciales distintos a propósito:** por orden de creación de semanas (modo "Semana activa") y por fecha estricta (modo "Rango") — consistentes cada uno consigo mismo.
- La conciliación SAT tolera ±$1 y ±3 días, y matchea folios por los primeros 8 caracteres — heurística aceptada.
- La merma se aplica en el Catálogo (Egresos) y **nunca** en Menú — regla de negocio confirmada con la sesión de Menú.
- Las API keys de Firebase en el HTML son claves web públicas por diseño; la seguridad depende de las reglas (las de Egresos exigen auth — revisadas antes en esta sesión; las de Menú son el hueco → P1).

---

## 4. Cómo quedó

- **34/34 pruebas verdes** después de los fixes (también bajo TZ de México).
- Sintaxis validada: `node --check` (JS extraído) y `py_compile` (los 3 .py). CRLF de `index.html` preservado.
- `index.html`: 6.2 MB → **3.26 MB**.
- Todo está en la rama `claude/cicsa-egresos-debugging-wx1jq6` — **sin mergear a `main`** hasta que lo pruebes (nota: F3/F4/F6 requieren que Railway redeploye, lo cual ocurre al mergear porque Railway sigue `main`).
