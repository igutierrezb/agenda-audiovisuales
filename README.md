# Agenda de Salas Audiovisuales DIN · V6.5

Agenda web de la División Industrial · Turno Matutino.

## Arquitectura

- **Firestore**: reservaciones, `hourLocks`, bloqueos de sala, salas, usuarios, configuración y auditoría.
- **Realtime Database**: presencia y señales efímeras de cambio entre usuarios.
- **GitHub Pages**: interfaz estática.

V6.5 conserva los datos existentes y evita recargar semanas completas cuando otro usuario modifica un evento: el cliente receptor consulta únicamente el documento afectado.

## Actualización

Lee `INSTRUCCIONES_V6.5.txt` y `CONFIGURAR_REALTIME_DATABASE_V6.5.txt`.

`firebase.js`, `core.js`, `firestore.rules` y `.github/workflows/deploy-pages.yml` no requieren cambios respecto a V6.4.1.
