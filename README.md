# Agenda de Salas Audiovisuales DIN · V6.5.2

Agenda web de la División Industrial · Turno Matutino.

## Arquitectura

- **Firestore**: reservaciones, `hourLocks`, bloqueos de sala, salas, usuarios, configuración y auditoría.
- **Realtime Database**: presencia y señales efímeras de cambio entre usuarios.
- **GitHub Pages**: interfaz estática.

V6.5 conserva los datos existentes y evita recargar semanas completas cuando otro usuario modifica un evento: el cliente receptor consulta únicamente el documento afectado.

## Actualización

Lee `INSTRUCCIONES_V6.5.txt` y `CONFIGURAR_REALTIME_DATABASE_V6.5.txt`.

`firebase.js`, `core.js`, `firestore.rules` y `.github/workflows/deploy-pages.yml` no requieren cambios respecto a V6.4.1.


## Identidad visual V6.5.2

Los recursos visuales se cargan exclusivamente desde `assets/` (logo DIN, iconos y favicons). Esta revisión cambia presentación y contraste; no modifica el modelo de datos ni la lógica de Firestore/Realtime Database.
