import { INITIAL_ROOMS, validateBooking } from './core.js';

// Una sola transacción de lectura/escritura serializa cambios entre pestañas,
// incluyendo la validación de empalmes.
const connection = new Promise((resolve, reject) => {
  const request = indexedDB.open('agenda-audiovisuales-independent-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('agenda');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento. Permite guardar datos en este navegador.'));
});

const initial = () => ({ rooms: structuredClone(INITIAL_ROOMS), bookings: [] });

function defaultRoomShort(room) {
  const existing = String(room?.short || '').trim();
  if (existing) return existing.toUpperCase();
  if (room?.id === 'alta-f') return 'PA F';
  if (room?.id === 'baja-f') return 'PB F';

  const name = String(room?.name || '').trim();
  const lower = name.toLocaleLowerCase('es-MX');
  const building = name.match(/(?:edificio\s+)?([A-ZÁÉÍÓÚÑ0-9]{1,4})\s*$/i)?.[1]?.toUpperCase() || '';
  if (lower.includes('planta alta')) return `PA${building ? ` ${building}` : ''}`;
  if (lower.includes('planta baja')) return `PB${building ? ` ${building}` : ''}`;

  const ignored = new Set(['sala', 'salas', 'audiovisual', 'audiovisuales', 'edificio', 'de', 'del', 'la', 'el']);
  const initials = name
    .split(/\s+/)
    .filter(word => word && !ignored.has(word.toLocaleLowerCase('es-MX')))
    .map(word => word[0])
    .join('')
    .slice(0, 5)
    .toUpperCase();

  return initials || 'SALA';
}

function normalizeState(state) {
  if (!Array.isArray(state.rooms)) state.rooms = structuredClone(INITIAL_ROOMS);
  if (!Array.isArray(state.bookings)) state.bookings = [];

  state.rooms = state.rooms.map(room => ({
    ...room,
    short: defaultRoomShort(room)
  }));

  return state;
}

function conflictLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

async function transact(change) {
  const db = await connection;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('agenda', 'readwrite');
    const store = tx.objectStore('agenda');
    let result;
    let failure;
    const request = store.get('state');

    request.onsuccess = () => {
      try {
        result = normalizeState(request.result || initial());
        if (change) change(result);
        normalizeState(result);
        store.put(result, 'state');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };

    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure || new Error('No se pudieron guardar los datos. Revisa el espacio y los permisos del navegador.'));
  });
}

export const repository = {
  read: () => transact(),

  saveBooking: booking => transact(state => {
    if (booking.id && !state.bookings.some(b => b.id === booking.id)) {
      throw new Error('Esta reservación ya fue eliminada. Cierra y vuelve a intentarlo.');
    }

    validateBooking(booking, state);

    if (booking.id) {
      const previous = state.bookings.find(b => b.id === booking.id);
      state.bookings = state.bookings.map(b => b.id === booking.id ? { ...previous, ...booking } : b);
    } else {
      state.bookings.push({ ...booking, id: crypto.randomUUID() });
    }
  }),

  saveBookings: bookings => transact(state => {
    if (!Array.isArray(bookings) || !bookings.length) {
      throw new Error('No hay reservaciones para guardar.');
    }

    for (const source of bookings) {
      const booking = {
        ...source,
        id: crypto.randomUUID()
      };

      try {
        validateBooking(booking, state);
      } catch (error) {
        throw new Error(`${conflictLabel(booking.date)}: ${error.message}`);
      }

      state.bookings.push(booking);
    }
  }),

  deleteBooking: id => transact(state => {
    state.bookings = state.bookings.filter(b => b.id !== id);
  }),

  saveRoom: (id, name, short) => transact(state => {
    name = String(name || '').trim();
    short = String(short || '').trim().toUpperCase();

    if (!name) throw new Error('Escribe el nombre de la sala.');
    if (!short) throw new Error('Escribe una abreviatura para la sala.');
    if (short.length > 12) throw new Error('La abreviatura debe tener máximo 12 caracteres.');
    if (id && !state.rooms.some(r => r.id === id)) throw new Error('Esta sala ya fue eliminada.');

    if (state.rooms.some(r => r.id !== id && r.short.toUpperCase() === short)) {
      throw new Error('Ya existe una sala con esa abreviatura.');
    }

    if (id) {
      state.rooms = state.rooms.map(r => r.id === id ? { ...r, name, short } : r);
    } else {
      state.rooms.push({ id: crypto.randomUUID(), name, short });
    }
  }),

  deleteRoom: id => transact(state => {
    state.rooms = state.rooms.filter(r => r.id !== id);
    state.bookings = state.bookings.filter(b => b.roomId !== id);
  })
};
