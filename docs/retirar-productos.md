# El catálogo de productos: qué pasó y qué queda por retirar

**El plan cambió.** La versión anterior de este documento planeaba *amputar* el
subsistema de productos, porque ForX/Menú ya lee sus propios XML y dejó de
consumir nada de Egresos. No se amputó: se **reconvirtió**. El mismo código que
clasificaba productos para alimentar recetas ahora lleva el **historial de
compras de Egresos** — qué se compró, a quién, a qué precio y en qué cantidad.

Lo que sí hay que retirar es la **tubería hacia ForX**, que quedó sin un extremo.
Ese es el inventario de abajo.

Medido el **2026-10-15**, sobre `2026-10-14-egresos-v29`, con `index.html` en
15,296 líneas y 639 líneas en `assets/ingredients*`.

## Por qué se reconvirtió en vez de borrarse

La pregunta del dueño fue: *«quisiera hacer una base de datos de las compras,
donde se pueda realizar la consulta por proveedor, sku, producto, que nos de un
histórico de cantidad, precio»*. Esa base de datos **ya existía** dentro del
catálogo — le faltaban el SKU y la cantidad, y le sobraban tres cosas de ForX.
Reconvertirlo costó tres fases; construirlo de cero habría costado mucho más.

| Fase | Qué quitó o agregó |
|---|---|
| A | Agregó el SKU (`NoIdentificacion` del CFDI) y la cantidad al historial |
| B | Quitó la publicación a `datos/precios` y las reglas de qué producto «cuenta» |
| C | Quitó la conversión por porción/merma y la compuerta de `validado` |

Después de la fase C, `destination()` solo distingue entre *registrado* y
*omitido a mano*. No hay nada que validar, nada que convertir y nada que
publicar.

## Qué es dato y qué es código

La distinción importa porque el código se recupera de `git`; los datos no.

**Datos — irreversible, respaldar antes y aparte:**

- Colección Firestore `productos_comerciales` (`CATALOGO_COL`) — **ya no es
  descartable: es el historial de compras.** No se toca.
- Colección Firestore `proveedores` (`PROVEEDORES_COL`) — sigue en uso.
- El documento `datos/precios`, que publicaba precios para ForX. **Egresos ya no
  lo escribe** (fase B). Quién lo lee hoy es asunto de ForX; antes de borrarlo
  hay que preguntárselo a ForX, no suponerlo.

Ninguna de las dos colecciones está dentro del documento de 1 MiB: son
colecciones aparte, así que borrarlas no liberaría espacio del medidor.

**Código muerto que queda por retirar — reversible, `git` lo conserva:**

Son dos grupos. El primero es la tubería a ForX, **sellada pero presente**:
`assets/ingredients.js` sombrea `abrirSyncMenuModal` y `confirmarSyncMenu` con
versiones inofensivas *a propósito*, porque las originales de `index.html` sí
saben escribir `datos/precios`. Dejarlas al descubierto reabriría la publicación
por la puerta de atrás, así que **el sombreado no se quita antes que las
funciones**.

```
index.html:2138  fetchMenuPrecios              index.html:10688 construirMapaPreciosMenu
index.html:2150  normalizarPreciosUnidadBase   index.html:10725 confirmarSyncMenu
index.html:2174  escribirPrecios               index.html:10774 abrirFaltantes
index.html:10243 precioPorUnidadBase           index.html:10923 closeSyncMenuModal
index.html:10284 abrirSyncMenuModal
```

Y su marcado: los modales `syncMenuModal` y `faltantesModal`.

El segundo grupo es marcado inalcanzable dentro de `page-catalogo-productos`:
`render()` hace `page.innerHTML=markup()` y **reemplaza todo lo que hay dentro
de ese `<div>`**. La fila de filtros (`✅ Validado`, `🔗 Faltantes de Menú`) y la
tabla con sus badges de estado se ven una fracción de segundo y desaparecen.
El `productoModal` **no** está ahí dentro: es hermano del `<div>`, sobrevive al
reemplazo y es el formulario de verdad. Esa es la línea que separa lo borrable
de lo vivo.

También siguen `puedeValidarse` (10930) y `motivoNoValidable` (10941), tras un
`if(window.CicsaCatalog)` que hoy siempre es verdadero.

## La trampa

Un barrido por «qué funciones mencionan productos» devuelve decenas. **No son
decenas de funciones borrables.** Al menos nueve son de Egresos y solo tocan
productos en una o dos líneas; borrarlas rompe la captura:

```
handleFile · leerDocumento · splitGuardar · limpiarCaptura · sincronizarAhora
checkServer · fbAuthHeader · bloqueoComplementoPago · checkFormaPagoManual
```

En ésas se editan líneas, no se borra la función.

`sincronizarAhora` llama a `cargarCatalogo(true)` — que hoy es `load` del asset,
no la función original. Ya **no** es código muerto: baja el historial de compras.
Esa línea se queda.

## Orden sugerido

1. Retirar los nueve puntos de la tubería a ForX **junto con** el sombreado que
   los tapia, en un solo commit: quitar uno sin el otro reabre la publicación.
2. Retirar `syncMenuModal` y `faltantesModal`.
3. Retirar el marcado inalcanzable de `page-catalogo-productos` (fila de filtros
   y tabla), comprobando primero que `render()` lo reemplaza todo.
4. Retirar `puedeValidarse` y `motivoNoValidable`, y el `if(window.CicsaCatalog)`
   que los hace inalcanzables, en `guardarProducto`.
5. Retirar sus pruebas en el mismo commit que el código que prueban.
6. Decidir, por separado y preguntándole a ForX, qué pasa con `datos/precios`.

Los pasos 1 a 5 son reversibles con `git revert`. El 6 no.

## Cómo rehacer la medición

```bash
# Funciones que mencionan algo de la tubería a ForX
node -e '
const fs=require("fs");
const s=fs.readFileSync("index.html","utf8").match(/<script>([\s\S]*)<\/script>/)[1];
const marca=/datos\/precios|precioPorUnidadBase|construirMapaPreciosMenu|escribirPrecios|fetchMenuPrecios|puedeValidarse|unidad_base|merma_pct/;
const re=/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let m,p=[]; while((m=re.exec(s))) p.push([m[1],m.index]);
p.forEach(([n,i],k)=>{ const c=s.slice(i, k+1<p.length?p[k+1][1]:s.length);
  if(marca.test(c)) console.log(n, c.split("\n").length); });'
```
