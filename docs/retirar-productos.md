# Retirar el subsistema de productos de Egresos

**Estado: no hacer todavía.** Esto es el inventario para cuando llegue el momento,
no una tarea pendiente.

Egresos se quedó con gastos, presupuestos, categorías y pagos. El catálogo de
productos existía para alimentar a Menú/ForX, que ahora lee sus propios XML con
su propio parser y ya no consume nada de Egresos. El código quedó **completo pero
inerte**: nada lo llama desde el camino de guardado, y nada se retiró.

Medido el **2026-10-02**, sobre `2026-10-02-egresos-v23`, con `index.html` en
15,453 líneas y 884 pruebas en verde.

## La precondición

**No se borra nada hasta que ForX haya corrido solo durante un cierre de periodo
completo.** Mientras tanto este código es el plan B. Si ForX falla en diciembre y
el catálogo ya no existe, no hay a qué volver.

Cuando se cumpla, anotar aquí la fecha en que ForX empezó a correr solo.

## Qué es dato y qué es código

La distinción importa porque el código se recupera de `git`; los datos no.

**Datos — irreversible, respaldar antes y aparte:**

- Colección Firestore `productos_comerciales` (`CATALOGO_COL`, index.html:2267)
- Colección Firestore `proveedores` (`PROVEEDORES_COL`, index.html:2268)
- El documento `datos/precios` que publicaba los precios para ForX

Estas colecciones **no** están dentro del documento de 1 MiB: son colecciones
aparte, así que borrarlas no libera espacio del medidor. Si no estorban, pueden
quedarse. Decidirlo explícitamente, no por omisión.

**Código — reversible, `git` lo conserva:**

- `index.html`: la página `page-catalogo-productos` y las funciones del catálogo
- `servidor_cicsa.py`: `/leer-productos` (618), `/identificar-productos` (679),
  `/precios-ingredientes` (742 y 785, la de OPTIONS)
- `tests/run_js_tests.js`: las pruebas del subsistema

## La trampa

Un barrido por "qué funciones mencionan productos" devuelve **37**. **No son 37
funciones borrables.** Al menos nueve son de Egresos y solo tocan productos en
una o dos líneas; borrarlas rompe la captura:

```
handleFile · leerDocumento · splitGuardar · limpiarCaptura · sincronizarAhora
checkServer · fbAuthHeader · bloqueoComplementoPago · checkFormaPagoManual
```

En ésas se editan líneas, no se borra la función. El resto sí son del catálogo.

Un punto de corte concreto ya identificado: **`sincronizarAhora` llama a
`cargarCatalogo(true)`** (index.html:3959). Va envuelto en `try/catch`, así que es
inofensivo, pero significa que cada sincronización todavía baja el catálogo. Esa
línea se va, y probablemente se note en el tiempo de sincronización.

## Lo que ya está verificado

Se simuló la amputación completa: neutralizar las 37 funciones y correr la
suite. Resultado: **762 pasaron, 75 fallaron, y las 75 fallas fueron causadas por
el propio subsistema retirado. Cero dependencias ocultas.**

Es decir: sale de un tirón sin tocar gastos, presupuestos, categorías ni pagos.
La limpieza es un PR aburrido, no una cirugía.

## Cómo rehacer la medición

El conteo de arriba envejece. Para repetirlo:

```bash
# Funciones que mencionan algo de productos (incluye las nueve que NO se borran)
node -e '
const fs=require("fs");
const s=fs.readFileSync("index.html","utf8").match(/<script>([\s\S]*)<\/script>/)[1];
const marca=/CATALOGO_COL|PROVEEDORES_COL|_productosPreleidos|leer-productos|identificar-productos|precios-ingredientes|cargarCatalogo\(|escribirPrecios\(/;
const re=/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let m,p=[]; while((m=re.exec(s))) p.push([m[1],m.index]);
p.forEach(([n,i],k)=>{ const c=s.slice(i, k+1<p.length?p[k+1][1]:s.length);
  if(marca.test(c)) console.log(n, c.split("\n").length); });'
```

## Orden sugerido

1. Medir el espacio **antes**: Resumen → «Espacio del archivo».
2. Quitar la llamada de `sincronizarAhora` a `cargarCatalogo`. Sola, en su commit.
3. Retirar la página y las funciones del catálogo; editar —no borrar— las nueve
   funciones de Egresos.
4. Retirar sus pruebas en el mismo commit que el código que prueban.
5. Retirar las rutas de Flask.
6. Medir el espacio **después** y anotarlo aquí.
7. Decidir, por separado y con respaldo, qué pasa con las dos colecciones.

Los pasos 2 a 5 son reversibles con `git revert`. El 7 no.
