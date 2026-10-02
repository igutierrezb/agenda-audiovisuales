## Hotfix V6.4.1

Este paquete corrige el bloqueo de acceso por permisos en el subsistema auxiliar de presencia. La agenda ya no activa presence al iniciar; solo después de una operación de agenda confirmada. No migra ni elimina datos.

# Agenda Audiovisuales · V6.4

Versión acumulativa preparada directamente sobre el código publicado que se entregó para esta revisión.

## Objetivo

Reducir lecturas y escrituras de Firestore sin perder reservaciones, historial, auditoría, usuarios, salas ni protección contra empalmes.

## Cambios principales

- La agenda se carga únicamente por la semana visible mediante lecturas puntuales.
- Se eliminaron los listeners permanentes de la semana, salas y configuración.
- V6.4 usa una presencia ligera separada de la agenda para saber cuántos usuarios están activos. No usa heartbeat periódico.
- Con un solo usuario activo, la agenda NO mantiene un listener de reservaciones/bloqueos en tiempo real.
- Al detectar dos o más usuarios activos, se abre un canal de cambios puntuales de `bookings` y `roomBlocks`; nunca se vuelve a descargar la semana completa por un cambio remoto.
- La actividad del mouse/teclado solo reinicia un temporizador local: no genera lecturas ni escrituras.
- Tras 2 minutos 30 segundos sin actividad, la presencia local pasa a inactiva y se cierran presencia y cambios puntuales. Si ya está inactiva, un clic aislado no la reactiva; una operación de guardar/modificar sí.
- Los candados V6.4 se agrupan por hora en `hourLocks`, con dos posiciones internas (`00` y `30`) para conservar precisión de media hora.
- Los candados antiguos de 30 minutos se conservan y se verifican de forma progresiva, solo cuando una hora aún no ha sido validada por V6.4.
- Guardar, mover, cancelar o restaurar actualiza la vista local con el resultado confirmado; no relee toda la semana.
- Los bloqueos de sala se retiran de forma lógica (`active=false`) en vez de borrarse físicamente.
- El respaldo incorpora `hourLocks` y `legacyLocks`.

## Cambios visuales

- Botón central de navegación: `Semana` en lugar de `Hoy`.
- Mayor diferenciación visual entre Planta Alta y Planta Baja.
- Sábado con gris ligeramente más oscuro.
- Línea horizontal a las 15:00 para separar turno matutino y vespertino.
- Campo: `Maestro / persona a quien se le apartará`.
- La persona a quien se le apartó usa un color de contraste distinto al nombre del evento.

## Archivos a publicar

- `index.html`
- `app.js`
- `styles.css`
- `storage.js`
- `core.js`
- `firebase.js`
- `firestore.rules`

Consulta `INSTRUCCIONES_V6.4.txt` antes de publicar.
