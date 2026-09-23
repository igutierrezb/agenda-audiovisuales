# Agenda de salas audiovisuales

Proyecto independiente, creado desde cero. No utiliza archivos, configuración ni almacenamiento de Consulta DIN.

## Uso

Selecciona una sala y semana. Pulsa un horario vacío o **Nueva reservación**, completa los datos y guarda. Selecciona una tarjeta para ver los detalles, editar o eliminar. **Administrar salas** permite crear, renombrar y eliminar salas; eliminar una sala también elimina sus reservaciones, previa confirmación explícita.

La agenda cubre lunes a sábado, de 07:00 a 22:00, con intervalos de 30 minutos. En celular se selecciona un día. La vista de todas las salas separa las reservas en columnas por sala. Los detalles completos siempre están disponibles al seleccionar una tarjeta.

## Almacenamiento y límites

Los datos se guardan en IndexedDB, en una base propia llamada `agenda-audiovisuales-independent-v1`. Sobreviven al cierre y a la recarga en el mismo navegador y origen. No se envían a GitHub ni están incluidos en el repositorio. Borrar los datos del navegador o usar navegación privada puede eliminarlos. La vista local y la URL publicada tienen almacenamientos separados.

Esta versión no sincroniza entre equipos y no incluye cuentas o permisos. No debe interpretarse como una agenda compartida: cada navegador tiene sus propios datos. Las operaciones usan una transacción de lectura/escritura para impedir empalmes incluso entre pestañas del mismo navegador.

`storage.js` separa el almacenamiento de la interfaz. Para compartir datos posteriormente, se puede sustituir `repository` por un servicio con base central, autenticación y validación atómica de empalmes en el servidor. Mantener únicamente comprobaciones en el navegador no sería suficiente para uso concurrente entre equipos. GitHub Pages seguirá alojando la interfaz.

## Publicación en GitHub Pages

1. Crear un repositorio independiente llamado `agenda-audiovisuales`.
2. Subir este proyecto a su rama `main`.
3. En **Settings → Pages**, elegir **Deploy from a branch**, rama **main**, carpeta **/ (root)** y guardar.
4. GitHub mostrará la URL definitiva cuando termine la publicación.

No necesita compilación, paquetes externos, claves ni servicios de pago. Todos los recursos usan rutas relativas compatibles con una URL de proyecto de Pages. `.nojekyll` evita procesar los archivos con Jekyll.

## Desarrollo

Servir esta carpeta con cualquier servidor estático HTTP; los módulos JavaScript requieren HTTP, no abrir `index.html` con doble clic. Se puede usar `node preview.mjs` y entrar a `http://127.0.0.1:4173`.

Ejecutar `npm test` para revisar la lógica crítica de empalmes, horarios y fechas. No requiere instalar dependencias.

Archivos: `index.html` (interfaz), `styles.css` (diseño adaptable), `app.js` (interacciones), `core.js` (fechas y reglas), `storage.js` (persistencia).
