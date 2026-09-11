# [CRITICAL] C02 — Autorización del backend

Fecha: 11 de septiembre de 2026.

El servidor verifica la firma y el proyecto del ID token de Firebase y consulta
`usuarios/{uid}` en cada petición protegida. Una cuenta autenticada sin registro
no recibe acceso. Los campos `activo` y `rol` presentes deben tener tipos y valores
válidos; se deniegan registros desactivados o malformados. Los registros anteriores
sin esos campos conservan el rol operativo. El UID propietario mantiene únicamente
la excepción de arranque ante un 404 explícito; un 403 o fallo de red no concede acceso.

Renovar, depurar y restablecer el historial local de Gmail requieren administrador.
La consulta de estado de Gmail y los endpoints de estado local también requieren
sesión. Los permisos no se almacenan en caché, por lo que desactivar o quitar un rol
se refleja en la siguiente solicitud. La autorización tiene timeout y no sigue
redirecciones. Los errores del servicio de autorización se presentan sin detalles internos.

## Verificación

- 18 pruebas con rutas Flask reales y respuestas simuladas de Firebase, sin datos
  fiscales, credenciales o llamadas a Gmail/IA. Cubren usuarios válidos, denegados,
  desactivados, administrador, degradación de rol, caída de Firebase y ambos modos
  de ejecución (local y Railway).
- Instalación completa de `requirements.txt` y `pip check` en Python 3.14.6/macOS.
- CI usa Python 3.14 e instala el mismo archivo completo de dependencias en Linux.
- `/status` informa `security_release: authorization-v1` para identificar el código
  que realmente sirve Railway; una publicación en GitHub no demuestra despliegue.

## Límites y pendientes

Las pruebas de autorización simulan identidades: falta comprobar un usuario aprobado
en la versión de Railway desplegada. No se crean cuentas en producción para probar.
La confianza en `usuarios/{uid}` requiere que las reglas de Firestore permitan
modificar esos registros exclusivamente a administradores. Revisar y validar esas
reglas, y la denegación de inactivos al acceder directamente a Firestore/Storage,
es el siguiente bloque. Esta corrección no cambia reglas, datos ni credenciales.
Los restantes hallazgos conservan sus estados anteriores, incluido SAT PDF.
