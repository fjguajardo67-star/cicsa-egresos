# Corrección de captura desde Gmail — 26 de septiembre de 2026

## Causa

El rediseño `81abb95` del 11 de septiembre añadió una pantalla de finalización
que oculta el contenedor del documento y del formulario después de guardar.
Solo el botón «Capturar otra factura» y la carga de archivos restablecían esa
presentación. Gmail y SAT limpiaban los datos, pero conservaban oculto el
contenedor. Volver a consultar el buzón no reiniciaba ese estado.

La vista previa de Gmail tenía además una condición anterior al rediseño:
generaba la primera página del PDF, pero solo mostraba imágenes originales.
El mensaje «Datos sincronizados» indicaba sincronización general, no el
guardado de la factura recién abierta.

## Cambio

- `limpiarCaptura` notifica el reinicio a la presentación para todas las entradas.
- La finalización anterior desaparece y los avisos de guardado regresan al formulario.
- Una carga de archivo atrasada no vuelve a ocultar una captura posterior.
- Gmail muestra la imagen renderizada del PDF y distingue abrir de guardar.
- La ayuda integrada explica que leer con IA requiere revisión y guardado explícito.
- Se actualizan la versión visible, la URL del módulo y su integridad SRI.

No se cambian registros históricos, conciliación, reglas de acceso ni el
criterio fiscal que impide guardar complementos de pago como nuevos gastos.

## Verificación

Antes de corregir, cinco regresiones reprodujeron el contenedor oculto y la
respuesta de archivo atrasada. Después de corregir:

- 18 pruebas de contexto de captura: Gmail con imagen, PDF y XML; SAT;
  crédito y vencimiento; errores de IA/PDF; reinicio; respuestas obsoletas.
- 76 pruebas `node --test tests/*.test.cjs`, incluidas las 18 anteriores.
- 709 pruebas de lógica del frontend y 12 comprobaciones de sincronización/SRI.
- 17 pruebas de Gmail en Python.
- Prueba de navegador aislada con HTML, CSS y controladores reales: guardar
  una factura XML de prueba, abrir la siguiente PDF, ver su documento y
  formulario, elegir crédito y guardar. Sin errores JavaScript. Gmail, IA y
  persistencia simulados; no se escribieron gastos reales.

## Uso

En Gmail, elegir «Leer con IA», revisar documento y datos, seleccionar categoría
y forma de pago y pulsar «Guardar gasto». La siguiente factura abre una captura
nueva automáticamente. Un XML sin PDF o imagen no tiene vista previa visual.

La versión corregida es `2026-09-26-egresos-v1`. Tras su publicación, recargar
la aplicación y comprobar esa versión en la esquina inferior derecha.
