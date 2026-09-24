# Análisis y plan de mejora V7.0
## Agenda de Reservación de Salas Audiovisuales · División Industrial

## 1. Criterio general
La aplicación ya dejó de ser un prototipo: contiene datos reales, usuarios reales y un flujo operativo diario. Por ello, el criterio de evolución cambia. A partir de esta etapa, la prioridad no debe ser “agregar funciones rápidamente”, sino mantener cuatro propiedades: **integridad de datos, estabilidad, trazabilidad y legibilidad operativa**.

La V7 parte de la V6 y evita cualquier migración destructiva. No cambia el proyecto Firebase, credenciales, Authentication, nombres de colecciones ni IDs de documentos. Tampoco toca `firebase.js`.

## 2. Riesgos principales detectados
### 2.1. Riesgo de regresión por configuración futura
La V6 permite modificar `blockMinutes`. Eso introduce un riesgo poco visible: una reservación histórica de 30 minutos o con hora `:30` puede quedar fuera de las opciones del formulario si en el futuro se configura una cuadrícula de 60 minutos. También el drag & drop podía recalcular la duración utilizando la cuadrícula actual en vez de conservar la duración original.

**V7 lo corrige:** cuando se edita un registro histórico, sus horas existentes se insertan temporalmente en los selectores aunque ya no formen parte de la cuadrícula actual. Al arrastrar, se conserva la duración exacta del evento original.

### 2.2. Filtro rápido “Hoy”
La implementación V6 del filtro rápido establecía `selectedDay = 0`, por lo que en una vista de un solo día podía terminar mostrando el primer día habilitado, no necesariamente el día actual.

**V7 lo corrige:** se calcula el índice real del día dentro de `enabledDays`. Si hoy no está habilitado, se muestra la semana y se informa al usuario.

### 2.3. Historial de bloqueos administrativos
Las reservaciones y salas ya evolucionaron a modelos no destructivos, pero quitar un bloqueo de mantenimiento todavía eliminaba físicamente el documento `roomBlocks`.

**V7 lo corrige:** se liberan únicamente los `locks` y el bloqueo se conserva con `active:false`, `removedAt`, `removedByEmail`, `updatedAt` y `updatedByEmail`. La vista operativa ignora los inactivos; el respaldo los conserva.

### 2.4. Capacidad de soporte
Cuando una aplicación se usa durante años, un fallo silencioso de JavaScript es más costoso que un error visible. También es importante distinguir si la página realmente recibió información reciente.

**V7 añade:** una banda de error para fallos JavaScript no controlados y una marca de “última sincronización” junto al estado en tiempo real.

## 3. Arquitectura de datos: evaluación
La arquitectura actual es adecuada para el tamaño y finalidad del proyecto:

- `rooms`: catálogo de salas y estado operativo.
- `bookings`: reservaciones históricas y activas.
- `authorizedUsers`: lista explícita de acceso.
- `locks`: exclusión por bloques de tiempo.
- `roomBlocks`: mantenimiento/bloqueo administrativo.
- `auditLogs`: bitácora inmutable desde el cliente.
- `settings/main`: configuración operativa.
- `system/installation`: marcador de inicialización.

La decisión correcta para largo plazo es **no reemplazar Firestore por otra tecnología**. El punto crítico es limitar lecturas por rango y conservar documentos históricos; V6 ya dio ese salto y V7 lo mantiene.

## 4. Escalabilidad
La vista semanal utiliza suscripciones por rango de fecha, no la colección completa de `bookings`. Ésta es la mejora arquitectónica más importante para que 2026, 2027, 2030 y años posteriores puedan coexistir sin que cada apertura del calendario descargue todo el historial.

Los procesos que sí pueden consultar colecciones completas son deliberados y administrativos, como el respaldo integral. Es razonable porque no se ejecutan en cada carga de página.

### Recomendación futura
Cuando la bitácora o las reservaciones alcancen decenas de miles de documentos, convendrá separar “respaldo cotidiano JSON” de un “respaldo institucional” realizado mediante herramientas administrativas de Firebase/Google Cloud. No se implementa ahora para evitar introducir infraestructura y permisos nuevos innecesariamente.

## 5. Integridad y trazabilidad
La política recomendada es:

- Una reservación no se elimina: se cancela.
- Una sala no se elimina: se archiva.
- Un usuario no se elimina: se revoca.
- Un bloqueo administrativo no se elimina: se desactiva.
- La bitácora no se edita ni se borra desde la aplicación.

Con ello, el sistema deja de depender de “recordar qué pasó” y conserva evidencia operativa.

V7 completa ese enfoque para `roomBlocks`.

## 6. Seguridad
Las reglas continúan separando:

- administrador principal;
- usuarios autorizados activos;
- operaciones administrativas;
- operaciones ordinarias de agenda;
- bitácora;
- configuración.

V7 endurece `roomBlocks`: ya no se permite `delete` desde el cliente. El administrador puede crearlos y actualizarlos, pero al retirarlos la aplicación cambia su estado.

No se modifican credenciales, dominio autorizado, provider de Google ni `firebase.js`.

## 7. Experiencia de escritorio (90% del uso)
La prioridad visual debe ser **superficie útil**. En una agenda, la función dominante es ver horarios, no una portada grande.

V7 realiza estos cambios:

- encabezado superior ligeramente más compacto;
- portada/intro más contenida;
- mayor altura disponible para el calendario;
- calendario de escritorio con altura adaptada a la ventana;
- controles con jerarquía más clara;
- color base verde petróleo/gris azulado de baja saturación;
- fondos muy suaves para no competir con las reservaciones pastel;
- día actual y sábado diferenciados sin colorear excesivamente la cuadrícula;
- Planta Alta y Planta Baja conservan tintes apenas perceptibles;
- hover de reservación más claro en equipos con ratón;
- panel administrativo más ancho y apropiado para escritorio.

## 8. Experiencia móvil (10% o menos)
No se intenta comprimir la interfaz de escritorio completa. Se mantiene el comportamiento responsivo existente y se evita que los nuevos elementos reduzcan el área táctil. El selector de fecha aumenta a tamaño cómodo en pantallas pequeñas y el indicador de sincronización secundario se oculta cuando el espacio es escaso.

## 9. Navegación temporal
Conforme pasen los años, las flechas semana anterior/siguiente dejan de ser suficientes. V7 incorpora **Ir a fecha**. La fecha elegida calcula la semana y selecciona el día correspondiente sin consultar el historial completo.

## 10. Posicionamiento inicial
En el primer render de una semana que contiene hoy, el calendario se desplaza cerca de la hora actual. Esto reduce desplazamiento manual durante el uso diario. Después de que el usuario comienza a navegar, V7 respeta el scroll y no intenta “corregirlo” continuamente.

## 11. Respaldo
El respaldo V6 incluía los datos operativos principales. V7 amplía el JSON con:

- rooms;
- bookings;
- authorizedUsers;
- settings;
- roomBlocks;
- auditLogs;
- system/installation;
- `schemaVersion`;
- `manifest` con conteos.

El respaldo sigue siendo de solo lectura. No existe botón de restauración automática, decisión intencional para evitar que una carga accidental pueda sobrescribir producción.

## 12. Administración
La estructura por pestañas es apropiada y se conserva. El administrador principal se muestra en Usuarios incluso si su privilegio proviene directamente de `OWNER_EMAIL` y no existe un documento equivalente en `authorizedUsers`.

Esta decisión evita una contradicción visual: el administrador puede operar el sistema aunque no aparezca en la lista.

## 13. Calidad de captura
Se añaden límites amplios de longitud en campos de texto. No son límites estrechos de negocio; su objetivo es impedir pegados accidentales de cantidades enormes de texto. No se reescriben registros ya existentes.

## 14. Observabilidad
V7 añade tres elementos de mantenimiento:

1. `v7.0 · esquema 7` en el pie.
2. Última hora de sincronización confirmada.
3. Banda visible ante errores JavaScript no controlados.

Para una aplicación que se pretende mantener durante años, estos tres elementos reducen mucho el tiempo de diagnóstico.

## 15. Pruebas realizadas antes de empaquetar
Se ejecutaron comprobaciones locales sin escribir en Firebase:

- `node --check app.js`;
- `node --check storage.js`;
- `node --check core.js`;
- prueba funcional de utilidades de `core.js`;
- detección de empalme básica;
- validación de ida y vuelta de fechas;
- comparación de IDs DOM utilizados por JavaScript contra `index.html`;
- verificación de IDs HTML duplicados;
- verificación de nombres de campos usados en formularios;
- comprobación de imports y versiones `?v=7.0`;
- escaneo para confirmar que no hay eliminación física de bookings en `storage.js`;
- comprobación de que `roomBlocks` no permite delete en reglas V7;
- balance básico de llaves en `firestore.rules`.

No se realizaron escrituras de prueba sobre la base productiva.

## 16. Mejoras futuras recomendadas, pero NO necesarias para actualizar a V7
### Fase futura A · entorno de pruebas
Crear un proyecto Firebase separado de pruebas únicamente cuando la agenda se vuelva crítica para varias divisiones. No es necesario ahora y por eso V7 no crea ninguno.

### Fase futura B · pruebas automatizadas de navegador
Incorporar Playwright contra un entorno de pruebas para validar login simulado, creación, edición, cancelación y drag & drop antes de publicar versiones.

### Fase futura C · respaldo institucional
Si el volumen crece mucho, utilizar exportaciones administrativas de Firestore/Google Cloud además del JSON manual.

### Fase futura D · roles adicionales
Sólo si aparece una necesidad real, separar “administrador”, “operador” y “consulta”. Hoy el modelo propietario + autorizado es más sencillo y menos propenso a errores.

### Fase futura E · métricas históricas
Si se requieren decisiones de infraestructura, crear reportes de ocupación trimestral/anual con agregaciones precomputadas. No conviene hacerlo antes de que exista una necesidad real.

## 17. Criterio de publicación
La actualización debe ser conservadora:

1. Publicar primero `firestore.rules` V7.
2. Sustituir los cinco archivos web modificados.
3. No tocar `firebase.js`.
4. Esperar despliegue de GitHub Pages.
5. Recargar con Ctrl+F5.
6. Verificar datos históricos antes de crear información nueva.
7. Descargar un respaldo V7 después de validar acceso.

## 18. Conclusión
La mejor evolución no es añadir más pantallas al calendario, sino fortalecer la aplicación que ya existe. V7 prioriza correcciones silenciosas de compatibilidad, trazabilidad, soporte y superficie útil. El resultado mantiene la misma base de datos y experiencia de operación, pero reduce riesgos acumulativos que normalmente aparecen después de varios años de uso.
