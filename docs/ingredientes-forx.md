# Egresos: ingredientes y precios para FORX

Estado: comparador estricto desplegado en `main` (`2cbe440`); extensión de omisión y homologación manual preparada en `feat/ingredientes-forx`.
Versión visible de esta extensión: `2026-09-12-egresos-v3`.
Las siguientes versiones se identifican como Egresos; FORX solo se menciona en la integración, no en el distintivo de versión.

## Omitir y homologar manualmente (v3)

- **Omitir** aparece directamente en la tarjeta de un producto. En grupos con varias presentaciones, cada una tiene su botón dentro de los detalles; no se omite todo el grupo por accidente.
- Omitir marca `estado: ignorado`, igual que el editor, y lo deja en **Solo Egresos**. No borra factura, producto ni historial. Nuevas compras del mismo producto conservan la omisión.
- Para deshacerlo: **Solo Egresos → Ver presentaciones, proveedor e historial → Recuperar para revisión**. También aparecen allí las presentaciones omitidas de un grupo que sigue activo; se conserva su vínculo al recuperarlas. Regresa pendiente de validar y se autoriza individualmente para recetas.
- **Homologar manualmente** está disponible desde la tarjeta, tanto en Por revisar como en Ingredientes. Busca el nombre de destino (por ejemplo, Mayonesa), pulsa **Elegir**, revisa todos los miembros y el precio resultante y pulsa **Confirmar homologación**.
- Para cinco nombres del mismo alimento, repite la vinculación hacia el mismo ingrediente principal. Cada operación une los grupos completos y conserva sus presentaciones, compras y conversiones. No marca productos pendientes como validados.
- La búsqueda manual admite nombres distintos, pero no es una sugerencia de equivalencia. No incluye grupos completamente omitidos ni el grupo de origen. Si antes se marcaron como distintos, la confirmación lo advierte.
- Se muestra el cálculo según la última compra válida; ante conflicto de precios o unidades no se promete una publicación nueva. Elegir y Cancelar no escriben. Un fallo mantiene la selección y permite reintentar; las escrituras conservan las precondiciones contra ediciones concurrentes.
- La lógica automática estricta de v2 y los permisos financieros no se modifican.

## Flujo implementado

1. La factura completa permanece en Egresos. Cada partida se clasifica de forma independiente.
2. Limpieza, desechables, refrescos y categorías de operación van a **Solo Egresos**, sin solicitar rechazos diarios.
3. **Usar en FORX** autoriza una excepción individual y persistente, por ejemplo un refresco utilizado en Grill Express. No habilita su categoría completa.
4. Una descripción conocida, con proveedor y unidad compatibles, reutiliza la presentación. Las ambigüedades no se fusionan automáticamente.
5. **Sí, homologar** vincula las presentaciones a un ingrediente común. Conserva descripciones originales, conversiones, compras y nombres anteriores como sinónimos de receta.
6. **No, son distintos** recuerda la decisión, incluso si luego se homologa alguna presentación. **Comparar detalles** amplía información en la misma pantalla.
7. El precio de la compra más reciente verificable prevalece, según fecha/hora de factura y costo normalizado. Subir una factura antigua no rejuvenece su precio. Dos precios diferentes del mismo día sin orden comprobable requieren una elección.
8. Guardar cambios crea, en el mismo commit, el pendiente de publicación. El publicador actualiza la fuente compartida que consume FORX.

La lista agrupa ingredientes, muestra una propuesta por grupo y evita repetir el mismo par. Búsqueda y vistas: Por revisar, Ingredientes y Solo Egresos. La edición conserva el estilo CICSA, muestra solamente los campos necesarios y no inventa un kilo/pieza cuando falta la conversión.

## Sugerencias estrictas de homologación (v2)

- Ya no se acepta una coincidencia parcial de palabras. Se exige igualdad del nombre comercial completo normalizado, conservando orden, tipo y preparación.
- Cantidades con unidad, empaques, proveedor y marca registrada no aportan evidencia de identidad. `Aceituna 3kg` y `Pasta codo 3kg` no se proponen como equivalentes.
- Se normalizan mayúsculas, acentos y una lista acotada de plurales. `Aceituna 3kg` y `Aceitunas frasco 1kg` sí pueden proponerse.
- Se conservan calificativos, «con/sin», porcentajes y códigos no reconocidos como cantidades: arroz blanco/integral, ranch/mayonesa y leche 1%/3% permanecen distintos. Nombres amplios como «Aderezo» no bastan.
- El nombre genérico no borra las diferencias de la descripción comercial. Las decisiones «No, son distintos» siguen vigentes.
- Se prioriza evitar falsos positivos: descripciones abreviadas, sinónimos o nombres incompletos pueden requerir revisión manual. Esto no es una clasificación semántica ni garantiza equivalencia culinaria.
- La sugerencia nunca homologa sola. Esta corrección no modifica ingredientes ya vinculados, compras, precios, conversiones, filtros de Solo Egresos ni permisos.

Regresión cubierta en pruebas de dominio y del catálogo: el par reportado no muestra el botón de homologar, consultar no escribe datos y un par válido conserva la decisión explícita Sí/No.

## Datos y compatibilidad

- `productos_comerciales/{id}`: permanecen los campos heredados. Se agregan `ingrediente_id`, `ingrediente_nombre`, `forx_destino`, `forx_distintos`, `compras_forx` y, si se resuelve un empate, `forx_preferido`.
- `compras_forx`: evidencia identificable por compra, fecha, precio, proveedor y conversión histórica. Repetir la misma importación es idempotente. Cuando XML y lectura están identificados como la misma factura/producto, prevalece XML. Si no existe identificador compartido, no se afirma que sean la misma evidencia.
- Una corrección explícita de conversión se aplica a la compra mostrada y compras futuras, dejando constancia de la corrección. No recalcula silenciosamente todo el historial.
- `productos_comerciales/_forx_sync`: marcador privado con revisión, pendiente, llaves administradas y conflictos. No contiene tokens.
- `datos/precios`: conserva el contrato de precio, unidad, fecha de publicación y fecha real del precio; mantiene las señales de provisional/vigencia. Las facturas prevalecen sobre cotizaciones provisionales.
- Los precios anteriores se conservan ante conflictos. Las llaves ajenas al catálogo no se borran. Las exclusiones retiran solamente sus nombres identificados, sin eliminar documentos de compras.
- No se modifican Firestore Rules, Storage Rules, permisos de Caja, saldos iniciales, credenciales ni código de FORX.

## Seguridad y resiliencia

- Escritura atómica de cambios y marcador; control de versiones para no pisar una edición concurrente.
- Publicación con precondiciones sobre el marcador y el mapa de precios; hasta tres intentos por conflicto.
- Errores de autorización/red se muestran; un formulario fallido permanece abierto.
- Reintentos de publicación acotados y reanudación al volver a abrir Egresos o recuperar conexión.
- Lectura paginada con protección contra ciclos; límites explícitos de 400 productos por operación y 850 KB por documento. Al excederlos se rechaza la operación; no se recorta historial.
- Archivos nuevos con SRI. Sin librerías adicionales de producción.
- El cálculo inicial de sugerencias usa un índice reutilizable; en una prueba sintética local de 1,000 productos pasó de aproximadamente 1,434 ms a 111 ms. No es una garantía de latencia de producción.

## Verificación

- 39 pruebas de dominio e integración, incluyendo omisión recuperable dentro de grupos activos, persistencia tras nueva factura, cinco nombres, homologación manual, confirmación explícita, cancelación y fallos de guardado.
- 709 comprobaciones JavaScript heredadas.
- 12 comprobaciones de sincronización, PDF, sintaxis e integridad.
- 12 pruebas de separación financiera y 4 de iconos.
- 46 pruebas contra emuladores reales de Firestore/Storage, incluyendo transporte REST del nuevo publicador, precondiciones, escritura `verify` y rechazo de cuentas no autorizadas.
- 17 pruebas de Gmail y 20 de autorización de backend.
- Navegador con seis productos ficticios y red de producción bloqueada: homologación directa, rechazo persistente, precio posterior, excepción individual, validación de datos faltantes, formulario conservado ante HTTP 503 y adaptación a 390 y 1365 px. Sin desbordamiento horizontal; controles táctiles y diálogo dentro del ancho móvil.

## Límites y puesta en producción

**La versión inicial está publicada; no se ha confirmado recepción real en FORX.** La interfaz distingue “publicado para FORX” de “recibido por FORX”.

El pendiente queda en Firestore, pero el publicador corre en Egresos: con todas las pestañas cerradas no hay un worker de servidor ejecutándose. La siguiente sesión retoma el pendiente. Para garantías de entrega independiente del navegador y acuse de recepción se necesita completar la integración del consumidor/worker.

Antes del despliegue:

1. Respaldar el catálogo y el mapa de precios con una cuenta administrativa, sin incorporar el respaldo al repositorio.
2. Publicar juntos el HTML y los cuatro archivos nuevos de assets; desplegar el backend con la clasificación por partida.
3. Pedir a los usuarios recargar las sesiones antiguas. Los clientes heredados no conocen el marcador de publicación; no deben escribir durante el cambio.
4. Revisar datos heredados incompletos o con unidades inconsistentes. No hay migración destructiva ni fusiones masivas por parecido.
5. Probar en producción un ingrediente controlado: compra reciente, misma factura repetida, factura anterior y excepción individual. Confirmar el valor en FORX y cómo refresca su caché.
6. No volver a desplegar solamente el editor antiguo después de empezar a homologar: no conoce los grupos ni sus historiales. Ante una reversión, detener las escrituras y revisar el respaldo primero.

## Implementación

- `assets/ingredients-core.js`: reglas puras de clasificación, comparación, conversión e historial.
- `assets/ingredients-store.js`: persistencia y publicación con precondiciones.
- `assets/ingredients.js`: integración con captura, XML y catálogo existente.
- `assets/ingredients.css`: presentación adaptable, estados y controles.
- `index.html`: conexión del módulo, fechas de CFDI, errores de guardado y versión.
- `servidor_cicsa.py`: extracción fiel de descripción/presentación y categoría por partida.
- Pruebas incorporadas al flujo de CI.

La revisión con Impeccable se aplicó como ajuste de un producto operativo: menos decisiones repetidas, detalles progresivos, mensajes de error explícitos y conservación de la identidad CICSA.
