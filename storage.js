import { INITIAL_ROOMS, minutes, parseDate, dateKey, validateBooking } from './core.js';
import { db, OWNER_EMAIL, INITIAL_AUTHORIZED_USERS } from './firebase.js';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const roomsCollection = collection(db, 'rooms');
const bookingsCollection = collection(db, 'bookings');
const usersCollection = collection(db, 'authorizedUsers');
const locksCollection = collection(db, 'locks');

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanText(value) {
  return String(value || '').trim();
}

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
  return name.split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 5).toUpperCase() || 'SALA';
}

function bookingShape(booking) {
  return {
    id: cleanText(booking.id),
    roomId: cleanText(booking.roomId),
    date: cleanText(booking.date),
    start: cleanText(booking.start),
    end: cleanText(booking.end),
    teacher: cleanText(booking.teacher),
    group: cleanText(booking.group),
    activity: cleanText(booking.activity),
    seriesId: cleanText(booking.seriesId)
  };
}

function validateShape(booking) {
  validateBooking(booking, {
    rooms: [{ id: booking.roomId }],
    bookings: []
  });
}

function slotMinutes(booking) {
  const values = [];
  for (let value = minutes(booking.start); value < minutes(booking.end); value += 30) values.push(value);
  return values;
}

function lockId(roomId, date, minute) {
  return `${roomId}__${date}__${minute}`;
}

function conflictDateLabel(key) {
  return parseDate(key).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function docData(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

async function readState() {
  const [roomSnap, bookingSnap] = await Promise.all([
    getDocs(roomsCollection),
    getDocs(bookingsCollection)
  ]);

  return {
    rooms: roomSnap.docs.map(docData).map(room => ({ ...room, short: defaultRoomShort(room) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')),
    bookings: bookingSnap.docs.map(docData)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || minutes(a.start) - minutes(b.start))
  };
}

async function writeChunks(operations) {
  for (let i = 0; i < operations.length; i += 450) {
    const batch = writeBatch(db);
    for (const op of operations.slice(i, i + 450)) op(batch);
    await batch.commit();
  }
}

export const repository = {
  read: readState,

  subscribe(callback, onError) {
    let rooms = [];
    let bookings = [];
    let roomsReady = false;
    let bookingsReady = false;

    const emit = () => {
      if (!roomsReady || !bookingsReady) return;
      callback({
        rooms: rooms.map(room => ({ ...room, short: defaultRoomShort(room) }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es')),
        bookings: [...bookings].sort((a, b) => String(a.date).localeCompare(String(b.date)) || minutes(a.start) - minutes(b.start))
      });
    };

    const unsubRooms = onSnapshot(roomsCollection, snapshot => {
      rooms = snapshot.docs.map(docData);
      roomsReady = true;
      emit();
    }, onError);

    const unsubBookings = onSnapshot(bookingsCollection, snapshot => {
      bookings = snapshot.docs.map(docData);
      bookingsReady = true;
      emit();
    }, onError);

    return () => {
      unsubRooms();
      unsubBookings();
    };
  },

  async isAuthorized(email) {
    email = cleanEmail(email);
    if (!email) return false;
    if (email === OWNER_EMAIL) return true;
    const snapshot = await getDoc(doc(db, 'authorizedUsers', email));
    return snapshot.exists();
  },

  async bootstrapOwner(email) {
    email = cleanEmail(email);
    if (email !== OWNER_EMAIL) return;

    const roomSnap = await getDocs(roomsCollection);
    const operations = [];

    if (roomSnap.empty) {
      for (const room of INITIAL_ROOMS) {
        const normalized = { ...room, short: defaultRoomShort(room) };
        operations.push(batch => batch.set(doc(db, 'rooms', room.id), normalized));
      }
    }

    for (const user of INITIAL_AUTHORIZED_USERS) {
      const normalizedEmail = cleanEmail(user.email);
      operations.push(batch => batch.set(
        doc(db, 'authorizedUsers', normalizedEmail),
        { name: user.name, email: normalizedEmail, active: true },
        { merge: true }
      ));
    }

    if (operations.length) await writeChunks(operations);
  },

  async saveBooking(source, actorEmail) {
    const actor = cleanEmail(actorEmail);
    const booking = bookingShape(source);
    validateShape(booking);

    const existingId = booking.id;
    const bookingRef = existingId ? doc(db, 'bookings', existingId) : doc(bookingsCollection);
    const bookingId = bookingRef.id;

    await runTransaction(db, async transaction => {
      const roomRef = doc(db, 'rooms', booking.roomId);
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) throw new Error('La sala seleccionada ya no existe.');

      let previous = null;
      if (existingId) {
        const previousSnap = await transaction.get(bookingRef);
        if (!previousSnap.exists()) throw new Error('Esta reservación ya fue eliminada.');
        previous = { id: previousSnap.id, ...previousSnap.data() };
      }

      const newLockRefs = slotMinutes(booking).map(value => doc(db, 'locks', lockId(booking.roomId, booking.date, value)));
      for (const lockRef of newLockRefs) {
        const lockSnap = await transaction.get(lockRef);
        if (lockSnap.exists() && lockSnap.data().bookingId !== bookingId) {
          throw new Error('La sala ya se encuentra ocupada durante parte de este horario.');
        }
      }

      if (previous) {
        for (const value of slotMinutes(previous)) {
          const oldRef = doc(db, 'locks', lockId(previous.roomId, previous.date, value));
          if (!newLockRefs.some(ref => ref.path === oldRef.path)) transaction.delete(oldRef);
        }
      }

      for (const lockRef of newLockRefs) {
        transaction.set(lockRef, {
          bookingId,
          roomId: booking.roomId,
          date: booking.date,
          updatedAt: serverTimestamp()
        });
      }

      const saved = {
        roomId: booking.roomId,
        date: booking.date,
        start: booking.start,
        end: booking.end,
        teacher: booking.teacher,
        group: booking.group,
        activity: booking.activity,
        seriesId: booking.seriesId || previous?.seriesId || '',
        createdByEmail: previous?.createdByEmail || actor,
        createdByLabel: previous?.createdByLabel || actor.split('@')[0],
        createdAt: previous?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      transaction.set(bookingRef, saved);
    });

    return readState();
  },

  async saveBookings(sources, actorEmail) {
    if (!Array.isArray(sources) || !sources.length) throw new Error('No hay reservaciones para guardar.');
    const actor = cleanEmail(actorEmail);
    const seriesId = crypto.randomUUID();
    const prepared = sources.map(source => ({ ...bookingShape(source), id: '', seriesId }));
    prepared.forEach(validateShape);

    const totalWrites = prepared.reduce((sum, booking) => sum + 1 + slotMinutes(booking).length, 0);
    if (totalWrites > 400) throw new Error('La repetición es demasiado amplia. Reduce el periodo y vuelve a intentarlo.');

    const refs = prepared.map(() => doc(bookingsCollection));

    await runTransaction(db, async transaction => {
      const roomRefs = [...new Set(prepared.map(item => item.roomId))].map(id => doc(db, 'rooms', id));
      for (const roomRef of roomRefs) {
        const roomSnap = await transaction.get(roomRef);
        if (!roomSnap.exists()) throw new Error('Una de las salas seleccionadas ya no existe.');
      }

      const seenLocks = new Set();
      for (let i = 0; i < prepared.length; i++) {
        const booking = prepared[i];
        for (const value of slotMinutes(booking)) {
          const id = lockId(booking.roomId, booking.date, value);
          if (seenLocks.has(id)) throw new Error(`${conflictDateLabel(booking.date)}: hay un empalme dentro de la repetición solicitada.`);
          seenLocks.add(id);

          const lockRef = doc(db, 'locks', id);
          const lockSnap = await transaction.get(lockRef);
          if (lockSnap.exists()) {
            throw new Error(`${conflictDateLabel(booking.date)}: la sala ya se encuentra ocupada durante parte de este horario.`);
          }
        }
      }

      for (let i = 0; i < prepared.length; i++) {
        const booking = prepared[i];
        const bookingRef = refs[i];
        for (const value of slotMinutes(booking)) {
          transaction.set(doc(db, 'locks', lockId(booking.roomId, booking.date, value)), {
            bookingId: bookingRef.id,
            roomId: booking.roomId,
            date: booking.date,
            updatedAt: serverTimestamp()
          });
        }

        transaction.set(bookingRef, {
          roomId: booking.roomId,
          date: booking.date,
          start: booking.start,
          end: booking.end,
          teacher: booking.teacher,
          group: booking.group,
          activity: booking.activity,
          seriesId,
          createdByEmail: actor,
          createdByLabel: actor.split('@')[0],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    });

    return readState();
  },

  async deleteBooking(id) {
    const bookingRef = doc(db, 'bookings', id);
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(bookingRef);
      if (!snapshot.exists()) return;
      const booking = snapshot.data();
      for (const value of slotMinutes(booking)) {
        transaction.delete(doc(db, 'locks', lockId(booking.roomId, booking.date, value)));
      }
      transaction.delete(bookingRef);
    });
    return readState();
  },

  async deleteSeries(seriesId) {
    if (!seriesId) throw new Error('Esta reservación no pertenece a una serie.');
    const snapshot = await getDocs(query(bookingsCollection, where('seriesId', '==', seriesId)));
    const operations = [];
    for (const bookingDoc of snapshot.docs) {
      const booking = bookingDoc.data();
      for (const value of slotMinutes(booking)) {
        operations.push(batch => batch.delete(doc(db, 'locks', lockId(booking.roomId, booking.date, value))));
      }
      operations.push(batch => batch.delete(bookingDoc.ref));
    }
    await writeChunks(operations);
    return readState();
  },

  async saveRoom(id, name, short) {
    name = cleanText(name);
    short = cleanText(short).toUpperCase();
    if (!name) throw new Error('Escribe el nombre de la sala.');
    if (!short) throw new Error('Escribe una abreviatura para la sala.');
    if (short.length > 12) throw new Error('La abreviatura debe tener máximo 12 caracteres.');

    const snapshot = await getDocs(roomsCollection);
    const duplicate = snapshot.docs.some(item => item.id !== id && String(item.data().short || '').toUpperCase() === short);
    if (duplicate) throw new Error('Ya existe una sala con esa abreviatura.');

    const roomRef = id ? doc(db, 'rooms', id) : doc(roomsCollection);
    await setDoc(roomRef, { name, short }, { merge: true });
    return readState();
  },

  async deleteRoom(id) {
    const snapshot = await getDocs(query(bookingsCollection, where('roomId', '==', id)));
    const operations = [];
    for (const bookingDoc of snapshot.docs) {
      const booking = bookingDoc.data();
      for (const value of slotMinutes(booking)) {
        operations.push(batch => batch.delete(doc(db, 'locks', lockId(booking.roomId, booking.date, value))));
      }
      operations.push(batch => batch.delete(bookingDoc.ref));
    }
    operations.push(batch => batch.delete(doc(db, 'rooms', id)));
    await writeChunks(operations);
    return readState();
  },

  async listAuthorizedUsers() {
    const snapshot = await getDocs(usersCollection);
    return snapshot.docs.map(docData).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email), 'es'));
  },

  async saveAuthorizedUser(name, email) {
    name = cleanText(name);
    email = cleanEmail(email);
    if (!name) throw new Error('Escribe el nombre de la persona.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Escribe un correo válido.');
    await setDoc(doc(db, 'authorizedUsers', email), { name, email, active: true }, { merge: true });
  },

  async deleteAuthorizedUser(email) {
    email = cleanEmail(email);
    if (email === OWNER_EMAIL) throw new Error('La cuenta administradora principal no se puede eliminar.');
    await deleteDoc(doc(db, 'authorizedUsers', email));
  }
};
