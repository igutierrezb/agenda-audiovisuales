import { INITIAL_ROOMS, validateBooking } from './core.js';

// One read/write transaction serializes changes across tabs, including overlap checks.
const connection = new Promise((resolve, reject) => {
  const request = indexedDB.open('agenda-audiovisuales-independent-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('agenda');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento. Permite guardar datos en este navegador.'));
});
const initial = () => ({ rooms: structuredClone(INITIAL_ROOMS), bookings: [] });
async function transact(change) {
  const db = await connection;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('agenda', 'readwrite');
    const store = tx.objectStore('agenda');
    let result, failure;
    const request = store.get('state');
    request.onsuccess = () => {
      try { result = request.result || initial(); if (change) change(result); store.put(result, 'state'); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(failure || new Error('No se pudieron guardar los datos. Revisa el espacio y los permisos del navegador.'));
  });
}
export const repository = {
  read: () => transact(),
  saveBooking: (booking) => transact(state => {
    if (booking.id && !state.bookings.some(b => b.id === booking.id)) throw new Error('Esta reservación ya fue eliminada. Cierra y vuelve a intentarlo.');
    validateBooking(booking, state);
    if (booking.id) state.bookings = state.bookings.map(b => b.id === booking.id ? booking : b);
    else state.bookings.push({ ...booking, id: crypto.randomUUID() });
  }),
  deleteBooking: (id) => transact(state => { state.bookings = state.bookings.filter(b => b.id !== id); }),
  saveRoom: (id, name) => transact(state => {
    name = name.trim();
    if (!name) throw new Error('Escribe el nombre de la sala.');
    if (id && !state.rooms.some(r => r.id === id)) throw new Error('Esta sala ya fue eliminada.');
    if (id) state.rooms = state.rooms.map(r => r.id === id ? { ...r, name } : r);
    else state.rooms.push({ id: crypto.randomUUID(), name });
  }),
  deleteRoom: (id) => transact(state => {
    state.rooms = state.rooms.filter(r => r.id !== id);
    state.bookings = state.bookings.filter(b => b.roomId !== id);
  })
};
