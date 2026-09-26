# Congelados y reglas por producto/proveedor

Versión: `2026-09-26-egresos-v2`.

## Uso

1. Leer la factura con IA y abrir **Revisar productos y categorías**.
2. En el renglón de la papa, mezcla de verduras, fruta u otro producto, elegir
   **Congelados** cuando esa sea la presentación que realmente se compró.
3. Marcar **Recordar para este producto y proveedor** para compras futuras.
4. Revisar los importes y guardar las partidas. Se registra UNA factura, con
   un desglose por categoría; no un gasto duplicado por cada producto.

La regla se guarda junto con la factura. Esperar la sincronización normal
para que esté disponible en otros dispositivos. Cerrar/cancelar no persiste
reglas. Al volver a abrir la revisión en la misma captura se conserva el
borrador; cambiar de documento lo descarta.

Para cambiar una regla, corregir su categoría en una compra posterior y
mantener Recordar marcado. Para desactivarla, desmarcarlo y guardar la factura.
Desactivarla no reclasifica gastos anteriores. «Guardar como un solo gasto»
descarta este desglose y sus cambios de reglas tras una confirmación.

## Prioridad y alcance

1. Regla confirmada para ese proveedor y código propio del producto.
   Sin código, coincidencia exacta de descripción completa.
2. Indicación explícita de congelación: congelado, ultracongelado, frozen o IQF.
3. Sugerencia de IA.

Se normalizan mayúsculas, acentos y espacios, pero se conservan cifras,
presentaciones y puntuación. No se buscan nombres parecidos ni se aplica una
regla de un proveedor a otro. La ClaveProdServ genérica del SAT no es un SKU.
No hay reglas precargadas para «papa lisa europea» o «mezcla California» porque
esos nombres por sí solos no acreditan congelación. El usuario debe confirmarlo.

La categoría del gasto y el tipo de alimento se guardan por separado. Las
compras futuras pueden llevar esos metadatos al catálogo sin modificar
conversiones, homologaciones ni el cálculo de precios para FORX.

## Protección de importes y compatibilidad

- Reclasificar solo cambia la categoría del renglón, no su importe ni precio unitario.
- El total de la factura y sus datos de encabezado siguen priorizando el XML
  del correo también al preparar el desglose de una factura mixta.
- Se conserva la forma de pago elegida antes de abrir la revisión.
- Si los renglones no cuadran, revisar impuestos/descuentos e importes. No se
  inventan ni reparten diferencias automáticamente. El ajuste manual existente
  requiere confirmación explícita.
- Los complementos de pago XML tipo P no se registran como gastos divididos.
- No se modifican gastos históricos ni se crea un presupuesto para Congelados.
- Si una respuesta antigua solo trae categorías agrupadas, se permite
  corregir el grupo, pero NO aprender reglas de productos que no se identificaron.
  Las capturas sin productos individuales (por ejemplo solo encabezado XML)
  no generan reglas por producto.
- En listas personalizadas, Congelados se ofrece en revisión y se incorpora
  a la lista al guardar una factura que lo utiliza.

## Verificación

Pruebas automatizadas de identidad proveedor/SKU/descripción, frescos frente a
congelados, desactivación, decisiones contradictorias, importes, prioridad XML,
persistencia operativa separada de Caja y contratos de los prompts.

Prueba visual aislada con controladores reales: papa reclasificada y recordada,
zanahoria fresca sin cambios, fresas congeladas reconocidas por descripción,
total $200 conservado ($160 Congelados y $40 Frutas y Verduras), y aplicación
de la regla al abrir otra factura del mismo proveedor. Sin datos reales ni
llamadas a la IA. Controles de la revisión comprobados en escritorio y móvil.
