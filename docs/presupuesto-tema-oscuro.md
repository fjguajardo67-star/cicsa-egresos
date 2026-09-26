# Prueba de tema oscuro: Presupuesto

Piloto local, todavía sin publicar. El botón existente Tema claro / Tema oscuro
alterna la presentación. No cambia importes, presupuestos, permisos ni exportaciones.

Los estilos están en `assets/budget-dark.css`, dentro de `@media screen` y
limitados a `:root[data-theme="dark"] #page-presupuesto`. No se redefinen variables
globales. El modo claro y las otras páginas no reciben estas reglas.

La ayuda de uso aparece dentro de Presupuesto. El estilo cubre resumen, categorías,
detalle, campos y avisos de edición, descuadre y exceso.

## Vista previa segura

Ejecutar `node tests/preview_budget.cjs` y abrir `http://127.0.0.1:4181`.
Usa renderizadores y HTML reales, datos ficticios, sin scripts de Firebase ni APIs.
Los controles de guardado/exportación no realizan operaciones; solo avisan.
Las opciones de prueba permiten ver edición, bloqueo, operador, exceso y ausencia
de gastos. El botón de tema funciona solamente en esta vista local.

La barra lateral y el encabezado móvil usan el PNG negativo transparente proporcionado
por el usuario en modo oscuro, sin fondo blanco. En modo claro se conserva el logo
original. La vista previa reutiliza el bloque de identidad real de `workspace.js`.

## Comprobaciones

`node --test tests/budget_dark.test.cjs`: alcance de selectores y contraste.
Ejecutar también la suite financiera antes de publicar. Comparar claro/oscuro,
campos editables y solo lectura, estados de alerta y tabla de detalle.
No alterar el diseño móvil existente como parte de este piloto de color.
