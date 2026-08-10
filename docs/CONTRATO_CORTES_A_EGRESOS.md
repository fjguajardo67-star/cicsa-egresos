# Contrato de datos — Manejo de Cortes → CICSA Egresos

**Versión del contrato:** 2
**Fecha:** 09/08/2026
**Apps:** `cicsa-cortes-caja.web.app` (origen) → `cicsa-egresos.cicsacomedores.com.mx` (destino)

> **Cambios de v1 a v2** — tras el reporte de estado de Manejo de Cortes:
> - Se **acepta `clase`** en los egresos (§3.2). Tenían razón: es dato capturado, no criterio.
> - `saldoInicial` **puede ser negativo** y es un dato válido (§3.5).
> - Entrega: se confirma **descarga + arrastre**, y Egresos archiva en su propio Storage (§9).
> - Folios históricos: **no hacen falta** (§8).

---

## 1. El principio: Cortes reporta, Egresos concilia

Hoy la información de los cortes se captura **dos veces**: una en Manejo de Cortes y otra a mano
en Egresos. Eso cuesta tiempo cada semana y es donde se cuelan los errores. La idea es que
Manejo de Cortes entregue un archivo con los datos que ya tiene, y Egresos lo importe.

**Manejo de Cortes reporta fielmente lo que el usuario capturó. Nada más.**

No clasifica, no juzga, no decide si algo cuadra. Si el usuario capturó siete egresos y contó
$3,925 en billetes, eso es lo que va en el archivo — tal cual.

**La conciliación es trabajo de Egresos.** Ahí es donde se arma el balance, y si algo no cuadra,
Egresos lo señala y el usuario resuelve su parte. Ese es el lugar correcto para esa conversación,
porque es donde está el resto de la información: las facturas de Gmail, los CFDI del SAT, los
gastos capturados por otras vías.

Esto no es un detalle de estilo. Determina qué campos van en el archivo y cuáles no:

| | dónde vive |
|---|---|
| Qué se cobró, quién y cuándo | **Cortes** — es el dato |
| Qué se pagó del concentrado y quién lo autorizó | **Cortes** — es el dato |
| Cuántos billetes de cada denominación se contaron | **Cortes** — es el dato |
| Si un egreso es gasto de operación o retiro | **Egresos** — es criterio |
| Si esa compra ya entró por factura | **Egresos** — solo ahí se sabe |
| Si el efectivo cuadra con lo contado | **Egresos** — es conciliación |

---

## 2. Formato: JSON (no CSV)

El reporte son **dos tablas distintas más el conteo**. En CSV harían falta varios archivos, todo
llegaría como texto (`"$1,234.00"` habría que reparsearlo) y la estructura se perdería.

En JSON es **un archivo**, los montos ya son números, y la forma se explica sola. Como Manejo de
Cortes es JavaScript, es un `JSON.stringify` y ya.

---

## 3. La estructura

```json
{
  "version": 2,
  "app": "cicsa-cortes-caja",
  "periodo": { "ini": "2026-08-01", "fin": "2026-08-04" },
  "emitido": "2026-08-05T18:24:00.000Z",
  "saldoInicial": 9983.42,

  "cortes":  [ /* ver 3.1 */ ],
  "egresos": [ /* ver 3.2 */ ],
  "conteo":  { /* ver 3.3 — opcional */ },
  "totales": { /* ver 3.5 — opcional */ }
}
```

### 3.1 `cortes[]` — el efectivo que entra

Un objeto por renglón de la tabla de entregas.

| campo | tipo | obligatorio | notas |
|---|---|---|---|
| `folio` | string | **sí** | El que ya usan: `"RCE-2026-00123"` |
| `fecha` | string | **sí** | `AAAA-MM-DD` |
| `cajera` | string | no | `"JANE"` |
| `turno` | string | no | `"1ERO"`, `"2DO"`, `"3ERO"`, `"RUTA 1"`… |
| `boletos25` | número | **sí** | Columna *Bol. +$25* |
| `contratistas` | número | **sí** | Columna *Contratistas* |
| `otrosIngresos` | número | **sí** | Columna *Otros Ing.* |
| `terminal` | número | **sí** | Columna *Terminal*. Va a banco — ver 4.4 |
| `total` | número | no | Egresos lo recalcula; si viene, se compara |

```json
{
  "folio": "RCE-2026-00123",
  "fecha": "2026-08-01",
  "cajera": "JANE",
  "turno": "1ERO",
  "boletos25": 2725.00,
  "contratistas": 960.00,
  "otrosIngresos": 3065.00,
  "terminal": 100.00,
  "total": 6750.00
}
```

### 3.2 `egresos[]` — el efectivo que sale del concentrado

**Tal como se capturaron.** Sin clasificar.

| campo | tipo | obligatorio | notas |
|---|---|---|---|
| `folio` | string | **sí** | `"EGR-2026-00005"` — ya implementado en Cortes, ver 4.1 |
| `fecha` | string | **sí** | `AAAA-MM-DD` |
| `concepto` | string | **sí** | `"COMPRAS SAMS"` |
| `comprobante` | string | no | `"ICAJG469779"` — más útil de lo que parece, ver 5 |
| `autoriza` | string | no | `"XAVIER MINJAREZ"` |
| `monto` | número | **sí** | **Positivo**, sin paréntesis ni signo |
| `clase` | string | no | `"gasto"` \| `"deposito"` — tal como lo eligió el usuario |

```json
{
  "folio": "EGR-2026-00005",
  "fecha": "2026-08-03",
  "concepto": "COMPRAS SAMS",
  "comprobante": "ICAJG469779",
  "autoriza": "XAVIER MINJAREZ",
  "monto": 29487.00,
  "clase": "gasto"
}
```

**Sobre `clase`** (agregado en v2, a propuesta de Manejo de Cortes): la v1 excluía cualquier
clasificación por considerarla criterio contable. Estaba mal aplicado. El usuario **ya elige**
entre *Gasto* y *Depósito/Retiro* con un botón dedicado al capturar: eso es dato, no juicio, y
cae de lleno en el principio de la sección 1. Que viaje.

Qué hace Egresos con él: **preseleccionar**, no decidir.

| `clase` en el archivo | qué queda marcado en Egresos |
|---|---|
| `"gasto"` | Gasto en efectivo (falta escoger categoría) |
| `"deposito"` | Retiro de caja |
| ausente | nada preseleccionado |

**No lleva `tipo` ni `categoria`.** La categoría del gasto y el tercer caso —*"esto ya entró como
factura por Gmail o por el CFDI"*— siguen resolviéndose en Egresos, porque dependen de
información que solo existe de este lado. `clase` ahorra el trabajo de los otros dos casos.

### 3.3 `conteo` — los billetes que se contaron (opcional pero muy recomendable)

Lo que el usuario contó físicamente. **Sin veredicto.**

```json
"conteo": {
  "capturado": true,
  "denominaciones": [
    { "denominacion": 500, "cantidad": 6, "total": 3000.00 },
    { "denominacion": 200, "cantidad": 3, "total": 600.00 },
    { "denominacion": 100, "cantidad": 3, "total": 300.00 },
    { "denominacion": 20,  "cantidad": 1, "total": 20.00 },
    { "denominacion": 5,   "cantidad": 1, "total": 5.00 }
  ],
  "monedasSueltas": 0.42,
  "total": 3929.42
}
```

**`capturado` es el campo importante.** Distingue *"se contó y dio cero"* de *"nadie llenó el
conteo"*. Sin esa bandera, un conteo vacío se ve idéntico a un faltante total — ver sección 7.

Si `capturado` es `false`, las demás llaves pueden ir vacías o ausentes.

### 3.4 `saldoInicial` — puede ser negativo

Es el saldo que se arrastró del período anterior. **Un valor negativo es un dato válido**, no un
archivo corrupto: significa que en ese período salió más efectivo del que había.

Egresos lo importa tal cual y lo muestra como viene. Si el negativo es correcto o hay que
resolverlo es justamente la conversación que toca tener **después** de conciliar, no una razón
para rechazar el archivo.

> Manejo de Cortes reportó un caso real: el período 05–07/08 cerró en −$15,563.83 porque la
> nómina se cubrió con efectivo que entró de fuera (un retiro bancario) y hoy **no hay forma de
> registrar ese ingreso** — los dos botones disponibles restan. Es un hueco del modelo, no del
> archivo. Cuando Cortes pueda registrar entradas externas, este contrato necesitará un lugar
> para ellas; se define cuando exista, no antes.

### 3.5 `totales` — lo que imprimió el reporte (opcional)

Los mismos números que ya salen en el PDF.

```json
"totales": {
  "boletos25": 31000.00, "contratistas": 11440.00,
  "otrosIngresos": 13627.00, "terminal": 1050.00,
  "efectivo": 56067.00, "egresos": 62121.00,
  "efectivoAEntregar": 3929.42
}
```

**No son una regla, son un dato.** Egresos calcula sus propios totales desde los renglones. Si
estos vienen y no coinciden, casi siempre significa que **el archivo llegó incompleto** (se cortó
en la transferencia, faltaron renglones). Egresos lo avisa; no es un juicio sobre nadie.

Si resulta más simple no mandarlos, no pasa nada.

---

## 4. Las cuatro reglas que sí importan

### 4.1 Cada renglón lleva `folio`, y tiene que ser estable — ✅ resuelto

**Es el único requisito verdaderamente crítico.** Es lo que permite reimportar la misma semana sin
duplicar: Egresos compara folios y salta los que ya tiene.

Los cortes siempre lo trajeron (`RCE-…`). Los egresos del concentrado no lo tenían; **Manejo de
Cortes ya lo implementó** (`EGR-2026-00001`), derivándolo del folio más alto existente en vez de
un contador aparte — así no se reutilizan aunque se borre un movimiento. Es la decisión correcta.

Los ~60 movimientos históricos no llevan folio, pero no importa: no se van a exportar (ver §8).

### 4.2 Fechas en `AAAA-MM-DD`

`"2026-08-01"`, no `"01/08/2026"`. Toda la app de Egresos ordena y compara fechas así.

### 4.3 Montos: número, positivo, sin formato

`100.00` — no `"$100.00"`, no `"($100.00)"`, no `"100,00"`. Punto decimal.

Los egresos van **positivos**; que sean una salida lo dice el arreglo en el que están.

### 4.4 `terminal` va aparte y NO se suma al efectivo

Ese dinero va a banco, no a la caja. El reporte ya lo maneja bien —el subtotal de $56,067 lo
excluye, y los totales por renglón también—. El archivo debe conservar esa separación.

---

## 5. Por qué `comprobante` vale la pena mandarlo

No es clasificar; es un dato que el usuario ya capturó. Pero en Egresos hace mucho:

Un egreso con comprobante tipo `"ICAJG469779"` casi seguro tiene factura, y esa factura **ya
entró a Egresos** por Gmail o por el CFDI del SAT. Uno con `"0001"` es un folio interno de vale.

Egresos usa esa pista para buscar el gasto que ya existe y avisar *"ojo, esto parece que ya está
capturado"* — en vez de que alguien tenga que acordarse cada semana. La decisión sigue siendo del
usuario; el dato solo se la pone enfrente.

---

## 6. Qué hace Egresos al importar

**Nada bloquea salvo que el archivo esté roto.** Todo lo demás se muestra y el usuario decide.

**Se rechaza el archivo** solo si:
- `version` no se reconoce, o
- falta `periodo`, o
- algún renglón no trae `folio`, `fecha` válida o `monto`/columnas numéricas, o
- hay `folio` repetido dentro del mismo archivo.

Eso no es auditar: es que el archivo no se puede leer.

**Se muestra y el usuario resuelve:**
- Folios que ya estaban importados → se saltan, y se dice cuáles.
- `totales` que no coinciden con la suma de los renglones → aviso de archivo posiblemente incompleto.
- Cada egreso, para clasificarlo: **gasto en efectivo** (con categoría) · **retiro de caja** ·
  **ya está capturado, ignorar**. Con la pista del `comprobante` y el detector de duplicados que
  Egresos ya tiene.
- Si viene `conteo.capturado: true` y `conteo.total` ≠ efectivo calculado → se muestra la
  diferencia, para que el usuario la resuelva. Si es `false`, no se dice nada.

---

## 7. Una petición aparte, sobre el reporte impreso

El mismo período impreso dos veces dio **dos documentos distintos**:

| emisión | conteo de efectivo |
|---|---|
| 05/08/2026 12:24 | lleno — $500×6, $200×3, $100×3, $20×1, $5×1… |
| 09/08/2026 16:47 | **en blanco**, `TOTAL CONTEO $0.00` |

El conteo no sobrevive a la reimpresión. Y como la segunda versión ve un conteo en cero, imprime
en rojo:

> **Diferencia conteo: FALTANTE ($3,929.42)**

Ese faltante no existe: el efectivo se contó y se entregó completo, como consta en la impresión
del 05/08. Pero el documento lleva espacios de *ENTREGÓ / RECIBIÓ* para firma.

Dos cosas, en orden de importancia:

1. **Guardar el conteo junto con el período**, para que reimprimir dé el mismo documento.
2. **No imprimir un veredicto de FALTANTE cuando el conteo está vacío** — decir *"conteo no
   capturado"*. Va en la misma línea del principio de arriba: el reporte muestra lo que se
   capturó; quien concilia es Egresos.

---

## 8. Estado de los puntos abiertos

| | punto | estado |
|---|---|---|
| 1 | Folio propio y estable en los egresos | ✅ **hecho** — desplegado en Cortes |
| 2 | `conteo` con la bandera `capturado` | ⏳ bloqueado: el conteo no se persiste |
| 3 | Que la reimpresión conserve el conteo | ⏳ mismo bloqueo |
| 4 | Numerar los egresos históricos | ❌ **no hace falta** — ver abajo |

**Folios históricos: no se migran.** Egresos solo va a importar del período corriente en
adelante. Lo anterior a junio de 2026 ya se cuadró en otra aplicación, y Egresos además tiene una
fecha de corte que oculta ese histórico. No vale la pena una migración sobre registros contables
para exportar períodos que nadie va a importar.

Si algún día hiciera falta un período viejo, se captura a mano — son pocos renglones.

---

## 9. Cómo se entrega el archivo — **decidido: descarga + arrastre**

Un botón en Manejo de Cortes dentro de REPORTE: *"Exportar corte a Egresos"*, que baje el `.json`.
En Egresos se arrastra a la pantalla de Caja, igual que hoy se arrastran los XML del SAT.

**Por qué no ir directo a Storage**, aunque sea lo que se pidió:

Son proyectos de Firebase distintos y la sesión no cruza — el reporte de Cortes lo diagnosticó
bien. Las tres salidas posibles cuestan: un segundo login (fricción semanal y hay que abrir la
regla de Storage de Egresos, que acaba de cerrarse con una lista blanca de UIDs), o una Cloud
Function (hay que programarla y desplegarla).

Y sobre todo: **el proceso es semanal y ya lo hace una persona.** Alguien imprime, cuenta, firma y
entrega. Arrastrar un archivo en ese mismo rato no agrega trabajo; resolver autenticación entre
proyectos para ahorrarlo, sí.

**El archivo igual queda en Storage — pero lo sube Egresos.** Al importar, Egresos guarda el
`.json` en su propio bucket:

```
cicsa-egresos.firebasestorage.app  →  cortes/2026-08-01_2026-08-04.json
```

Así queda el archivo histórico de cada período —que es lo que se quería— sin que Cortes necesite
credenciales del otro proyecto. Lo escribe el lado que ya tiene la sesión abierta.

**Si más adelante se quiere automático**, el contrato no cambia: el mismo JSON, subido por una
Cloud Function en Egresos que valide identidad. Se puede hacer después sin rehacer nada.

---

## 10. Ejemplo completo (datos reales del 01–04 ago 2026)

Recortado a 3 de los 23 cortes para que se lea; el archivo real los lleva todos.

> Los `clase` del ejemplo son **ilustrativos**: solo Manejo de Cortes sabe qué eligió el usuario
> en cada caso. Van todos como `"gasto"` porque ninguno es un depósito bancario. Nótese que el
> vuelo y la renta llegan como `"gasto"` y aun así Egresos puede marcarlos como retiro — el
> campo preselecciona, no decide.
>
> El renglón de `$2 × 2` del conteo es un **supuesto**: en el escaneo del reporte impreso las
> denominaciones de $2 y $1 quedaron abajo del borde. Lo que sí se lee suma $3,925.42, y para
> llegar a los $3,929.42 del *efectivo a entregar* faltan $4.00. Se puso ahí para que el ejemplo
> cuadre consigo mismo; el dato real lo tiene Manejo de Cortes.

```json
{
  "version": 2,
  "app": "cicsa-cortes-caja",
  "periodo": { "ini": "2026-08-01", "fin": "2026-08-04" },
  "emitido": "2026-08-05T18:24:00.000Z",
  "saldoInicial": 9983.42,

  "cortes": [
    { "folio": "RCE-2026-00123", "fecha": "2026-08-01", "cajera": "JANE",
      "turno": "1ERO", "boletos25": 2725.00, "contratistas": 960.00,
      "otrosIngresos": 3065.00, "terminal": 100.00, "total": 6750.00 },
    { "folio": "RCE-2026-00124", "fecha": "2026-08-01", "cajera": "KIKE",
      "turno": "RUTA 1", "boletos25": 925.00, "contratistas": 240.00,
      "otrosIngresos": 5.00, "terminal": 0, "total": 1170.00 },
    { "folio": "RCE-2026-00145", "fecha": "2026-08-04", "cajera": "CLAUDIA",
      "turno": "3ERO", "boletos25": 475.00, "contratistas": 320.00,
      "otrosIngresos": 0, "terminal": 0, "total": 795.00 }
  ],

  "egresos": [
    { "folio": "EGR-2026-00001", "fecha": "2026-08-01",
      "concepto": "RECARGA CELULAR OFICINA", "comprobante": "0001",
      "autoriza": "DIANA IBARRA", "monto": 100.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00002", "fecha": "2026-08-01",
      "concepto": "GASOLINA URVAN RENTA", "comprobante": "0001",
      "autoriza": "DIANA IBARRA", "monto": 400.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00003", "fecha": "2026-08-01",
      "concepto": "PAGO VUELO XAVIER MINJAREZ", "comprobante": "0001",
      "autoriza": "FRANCISCO GUAJARDO", "monto": 10876.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00004", "fecha": "2026-08-03",
      "concepto": "PAGO LIQUIDACION WENDI RUBI ANTUNEZ VALDESPINO",
      "comprobante": "0003", "autoriza": "DIANA IBARRA", "monto": 3119.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00005", "fecha": "2026-08-03",
      "concepto": "COMPRAS SAMS", "comprobante": "ICAJG469779",
      "autoriza": "XAVIER MINJAREZ", "monto": 29487.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00006", "fecha": "2026-08-03",
      "concepto": "PAGO RENTA CASA ING FRANCISCO", "comprobante": "0003",
      "autoriza": "FRANCISCO GUAJARDO", "monto": 15555.00,
      "clase": "gasto" },
    { "folio": "EGR-2026-00007", "fecha": "2026-08-04",
      "concepto": "COMPRA ML ABANICOS MOSCAS", "comprobante": "0004",
      "autoriza": "FRANCISCO GUAJARDO", "monto": 2584.00,
      "clase": "gasto" }
  ],

  "conteo": {
    "capturado": true,
    "denominaciones": [
      { "denominacion": 500, "cantidad": 6, "total": 3000.00 },
      { "denominacion": 200, "cantidad": 3, "total": 600.00 },
      { "denominacion": 100, "cantidad": 3, "total": 300.00 },
      { "denominacion": 20,  "cantidad": 1, "total": 20.00 },
      { "denominacion": 5,   "cantidad": 1, "total": 5.00 },
      { "denominacion": 2,   "cantidad": 2, "total": 4.00 }
    ],
    "monedasSueltas": 0.42,
    "total": 3929.42
  },

  "totales": {
    "boletos25": 31000.00,
    "contratistas": 11440.00,
    "otrosIngresos": 13627.00,
    "terminal": 1050.00,
    "efectivo": 56067.00,
    "egresos": 62121.00,
    "efectivoAEntregar": 3929.42
  }
}
```
