import {
  INITIAL_ROOMS,
  DEFAULT_SETTINGS,
  minutes,
  normalizeSettings,
  validateBooking
} from './core.js?v=6.5.1';

import {
  db,
  OWNER_EMAIL,
  INITIAL_AUTHORIZED_USERS
} from './firebase.js?v=6.5.1';

import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const roomsCollection = collection(db, 'rooms');
const bookingsCollection = collection(db, 'bookings');
const usersCollection = collection(db, 'authorizedUsers');
const locksCollection = collection(db, 'locks');
const hourLocksCollection = collection(db, 'hourLocks');
const auditCollection = collection(db, 'auditLogs');
const blocksCollection = collection(db, 'roomBlocks');

const settingsRef = doc(db, 'settings', 'main');
const installationRef = doc(db, 'system', 'installation');

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

  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .slice(0, 5)
    .toUpperCase() || 'SALA';
}

function normalizeRoom(room) {
  return {
    ...room,
    short: defaultRoomShort(room),
    active: room?.active !== false,
    status: room?.status || 'available',
    building: cleanText(room?.building),
    floor: cleanText(room?.floor),
    capacity: Number(room?.capacity) || '',
    equipment: Array.isArray(room?.equipment) ? room.equipment : [],
    notes: cleanText(room?.notes)
  };
}

function roomDisplayRank(room) {
  const text = `${room?.id || ''} ${room?.name || ''} ${room?.short || ''}`
    .toLocaleLowerCase('es-MX');

  if (text.includes('planta baja') || text.includes('baja-f') || /\bpb\b/.test(text)) return 0;
  if (text.includes('planta alta') || text.includes('alta-f') || /\bpa\b/.test(text)) return 1;
  return 2;
}

function compareRooms(a, b) {
  return roomDisplayRank(a) - roomDisplayRank(b) ||
    String(a.name).localeCompare(String(b.name), 'es');
}

function normalizeBooking(booking) {
  return {
    ...booking,
    status: booking?.status === 'cancelled' ? 'cancelled' : 'active',
    colorKey: cleanText(booking?.colorKey)
  };
}

function normalizeUser(user) {
  return {
    ...user,
    active: user?.active !== false
  };
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
    colorKey: cleanText(booking.colorKey),
    seriesId: cleanText(booking.seriesId)
  };
}

function blockShape(block) {
  return {
    id: cleanText(block.id),
    roomId: cleanText(block.roomId),
    date: cleanText(block.date),
    start: cleanText(block.start),
    end: cleanText(block.end),
    reason: cleanText(block.reason)
  };
}

function slotMinutes(item) {
  const values = [];
  for (let value = minutes(item.start); value < minutes(item.end); value += 30) {
    values.push(value);
  }
  return values;
}

function legacyLockId(roomId, date, minute) {
  return `${roomId}__${date}__${minute}`;
}

function hourLockId(roomId, date, hourStart) {
  return `${roomId}__${date}__H${String(Math.floor(hourStart / 60)).padStart(2, '0')}`;
}

function hourLockGroups(item) {
  const groups = new Map();

  for (const value of slotMinutes(item)) {
    const hourStart = Math.floor(value / 60) * 60;
    const id = hourLockId(item.roomId, item.date, hourStart);
    const slot = value % 60 === 0 ? '00' : '30';

    if (!groups.has(id)) {
      groups.set(id, {
        id,
        roomId: item.roomId,
        date: item.date,
        hourStart,
        slots: new Set()
      });
    }

    groups.get(id).slots.add(slot);
  }

  return groups;
}

function slotOwner(type, entityId) {
  return type === 'roomBlock'
    ? { type, blockId: entityId }
    : { type: 'booking', bookingId: entityId };
}

function sameOwner(value, type, entityId) {
  if (!value) return false;
  return type === 'roomBlock'
    ? value.type === 'roomBlock' && value.blockId === entityId
    : value.type !== 'roomBlock' && value.bookingId === entityId;
}

function cloneSlots(source) {
  return { ...(source || {}) };
}

async function loadHourLockStates(transaction, groups) {
  const states = new Map();

  for (const group of groups.values()) {
    const ref = doc(db, 'hourLocks', group.id);
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists() ? snapshot.data() : {};

    states.set(group.id, {
      ...group,
      ref,
      slots: cloneSlots(data.slots),
      legacyChecked: data.legacyChecked === true
    });
  }

  for (const state of states.values()) {
    if (state.legacyChecked) continue;

    for (const offset of [0, 30]) {
      const legacyMinute = state.hourStart + offset;
      const legacyRef = doc(
        db,
        'locks',
        legacyLockId(state.roomId, state.date, legacyMinute)
      );
      const legacySnap = await transaction.get(legacyRef);
      if (!legacySnap.exists()) continue;

      const legacy = legacySnap.data();
      const slot = offset === 0 ? '00' : '30';
      if (!state.slots[slot]) {
        state.slots[slot] = legacy.type === 'roomBlock'
          ? { type: 'roomBlock', blockId: legacy.blockId || '', legacy: true }
          : { type: 'booking', bookingId: legacy.bookingId || '', legacy: true };
      }
    }

    state.legacyChecked = true;
  }

  return states;
}

function writeHourLockState(transaction, state) {
  transaction.set(state.ref, {
    roomId: state.roomId,
    date: state.date,
    hourStart: state.hourStart,
    slots: state.slots,
    legacyChecked: true,
    updatedAt: serverTimestamp()
  });
}


function docData(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function auditPayload(action, actor, extra = {}) {
  const now = new Date();
  const createdDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    action,
    actorEmail: actor,
    actorLabel: actor.split('@')[0],
    createdDate,
    createdAt: serverTimestamp(),
    ...extra
  };
}

async function writeChunks(operations) {
  for (let i = 0; i < operations.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of operations.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
}

async function getSettings() {
  const snapshot = await getDoc(settingsRef);
  return normalizeSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SETTINGS);
}

async function queryByDate(collectionRef, from, to) {
  const q = query(
    collectionRef,
    where('date', '>=', from),
    where('date', '<=', to)
  );
  return getDocs(q);
}

function activeRoomOrThrow(room) {
  if (!room) throw new Error('La sala seleccionada ya no existe.');
  if (room.active === false) throw new Error('La sala seleccionada está archivada.');
  if (room.status === 'maintenance') throw new Error('La sala se encuentra en mantenimiento.');
  if (room.status === 'out_of_service') throw new Error('La sala se encuentra fuera de servicio.');
}

export const repository = {

  async bootstrapOwner(email) {
    const actor = cleanEmail(email);
    if (actor !== OWNER_EMAIL) return;

    const installed = await getDoc(installationRef);
    if (installed.exists() && installed.data()?.initialized === true) return;

    // Compatibilidad segura con una instalación que ya tiene datos:
    // solo se siembra una colección si realmente está vacía.
    const [roomSnap, userSnap] = await Promise.all([
      getDocs(roomsCollection),
      getDocs(usersCollection)
    ]);

    const operations = [];

    if (roomSnap.empty) {
      for (const room of INITIAL_ROOMS) {
        operations.push(batch => batch.set(
          doc(db, 'rooms', room.id),
          {
            ...room,
            short: defaultRoomShort(room),
            active: true,
            status: 'available'
          },
          { merge: true }
        ));
      }
    }

    if (userSnap.empty) {
      for (const user of INITIAL_AUTHORIZED_USERS) {
        const normalizedEmail = cleanEmail(user.email);
        operations.push(batch => batch.set(
          doc(db, 'authorizedUsers', normalizedEmail),
          {
            name: user.name,
            email: normalizedEmail,
            active: true
          },
          { merge: true }
        ));
      }
    }

    operations.push(batch => batch.set(
      installationRef,
      {
        initialized: true,
        initializedAt: serverTimestamp(),
        initializedByEmail: actor
      },
      { merge: true }
    ));

    await writeChunks(operations);
  },

  async isAuthorized(email) {
    const actor = cleanEmail(email);
    if (!actor) return false;
    if (actor === OWNER_EMAIL) return true;

    const snapshot = await getDoc(doc(db, 'authorizedUsers', actor));
    if (!snapshot.exists()) return false;
    return snapshot.data()?.active !== false;
  },

  async getSettings() {
    return getSettings();
  },

  async loadStatic() {
    const [roomsSnapshot, settingsSnapshot] = await Promise.all([
      getDocs(roomsCollection),
      getDoc(settingsRef)
    ]);

    return {
      rooms: roomsSnapshot.docs
        .map(docData)
        .map(normalizeRoom)
        .sort(compareRooms),
      settings: normalizeSettings(
        settingsSnapshot.exists() ? settingsSnapshot.data() : DEFAULT_SETTINGS
      )
    };
  },

  async loadRange({ from, to }) {
    const [bookingsSnapshot, blocksSnapshot] = await Promise.all([
      queryByDate(bookingsCollection, from, to),
      queryByDate(blocksCollection, from, to)
    ]);

    return {
      bookings: bookingsSnapshot.docs
        .map(docData)
        .map(normalizeBooking)
        .sort((a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          minutes(a.start) - minutes(b.start)
        ),
      blocks: blocksSnapshot.docs
        .map(docData)
        .sort((a, b) =>
          String(a.date).localeCompare(String(b.date)) ||
          minutes(a.start) - minutes(b.start)
        )
    };
  },


  async getBooking(id) {
    const snapshot = await getDoc(doc(db, 'bookings', cleanText(id)));
    if (!snapshot.exists()) return null;
    return normalizeBooking({ id: snapshot.id, ...snapshot.data() });
  },

  async getRoomBlock(id) {
    const snapshot = await getDoc(doc(db, 'roomBlocks', cleanText(id)));
    if (!snapshot.exists()) return null;
    return { id: snapshot.id, ...snapshot.data() };
  },

  async queryBookingsRange(from, to) {
    const snapshot = await queryByDate(bookingsCollection, from, to);
    return snapshot.docs
      .map(docData)
      .map(normalizeBooking)
      .sort((a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        minutes(a.start) - minutes(b.start)
      );
  },

  async queryBlocksRange(from, to) {
    const snapshot = await queryByDate(blocksCollection, from, to);
    return snapshot.docs.map(docData);
  },

  async saveBooking(source, actorEmail, settingsSource = null) {
    const actor = cleanEmail(actorEmail);
    if (!actor) throw new Error('No se pudo identificar al usuario.');

    const booking = bookingShape(source);
    const settings = normalizeSettings(settingsSource || DEFAULT_SETTINGS);
    const existingId = booking.id;
    const bookingRef = existingId
      ? doc(db, 'bookings', existingId)
      : doc(bookingsCollection);
    const bookingId = bookingRef.id;

    return runTransaction(db, async transaction => {
      const roomRef = doc(db, 'rooms', booking.roomId);
      const roomSnap = await transaction.get(roomRef);
      activeRoomOrThrow(roomSnap.exists() ? normalizeRoom(roomSnap.data()) : null);

      let previous = null;
      if (existingId) {
        const previousSnap = await transaction.get(bookingRef);
        if (!previousSnap.exists()) throw new Error('Esta reservación ya no existe.');
        previous = normalizeBooking({ id: previousSnap.id, ...previousSnap.data() });
        if (previous.status === 'cancelled') {
          throw new Error('La reservación está cancelada. Restáurala antes de editarla.');
        }
      }

      validateBooking(booking, {
        rooms: [{ id: booking.roomId, ...roomSnap.data() }],
        bookings: []
      }, settings);

      const newGroups = hourLockGroups(booking);
      const oldGroups = previous ? hourLockGroups(previous) : new Map();
      const combined = new Map([...oldGroups, ...newGroups]);
      const states = await loadHourLockStates(transaction, combined);

      for (const [id, group] of newGroups) {
        const state = states.get(id);
        for (const slot of group.slots) {
          const owner = state.slots[slot];
          if (owner && !sameOwner(owner, 'booking', bookingId)) {
            throw new Error('La sala ya se encuentra ocupada durante parte de este horario.');
          }
        }
      }

      for (const [id, group] of oldGroups) {
        const state = states.get(id);
        for (const slot of group.slots) {
          if (sameOwner(state.slots[slot], 'booking', bookingId)) {
            delete state.slots[slot];
          }
        }
      }

      for (const [id, group] of newGroups) {
        const state = states.get(id);
        for (const slot of group.slots) {
          state.slots[slot] = slotOwner('booking', bookingId);
        }
      }

      for (const state of states.values()) writeHourLockState(transaction, state);

      const createdByEmail = previous?.createdByEmail || actor;
      const createdByLabel = previous?.createdByLabel || actor.split('@')[0];
      const saved = {
        ...booking,
        id: bookingId,
        status: 'active',
        createdByEmail,
        createdByLabel,
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0],
        createdAt: previous?.createdAt || null
      };

      transaction.set(bookingRef, {
        roomId: booking.roomId,
        date: booking.date,
        start: booking.start,
        end: booking.end,
        teacher: booking.teacher,
        group: booking.group,
        activity: booking.activity,
        colorKey: booking.colorKey || previous?.colorKey || '',
        seriesId: booking.seriesId || previous?.seriesId || '',
        status: 'active',
        createdByEmail,
        createdByLabel,
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0],
        createdAt: previous?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      const moved = previous && (
        previous.roomId !== booking.roomId ||
        previous.date !== booking.date ||
        previous.start !== booking.start ||
        previous.end !== booking.end
      );
      const action = previous
        ? (moved ? 'MOVE_BOOKING' : 'UPDATE_BOOKING')
        : 'CREATE_BOOKING';

      transaction.set(doc(auditCollection), auditPayload(action, actor, {
        bookingId,
        roomId: booking.roomId,
        before: previous || null,
        after: saved
      }));

      return { booking: saved, before: previous };
    });
  },

  async saveBookings(sources, actorEmail, settingsSource = null) {
    const actor = cleanEmail(actorEmail);
    if (!actor) throw new Error('No se pudo identificar al usuario.');

    const prepared = sources.map(bookingShape);
    if (!prepared.length) throw new Error('No hay reservaciones para guardar.');

    const settings = normalizeSettings(settingsSource || DEFAULT_SETTINGS);
    const seriesId = crypto.randomUUID();
    const refs = prepared.map(() => doc(bookingsCollection));

    const allGroups = new Map();
    const requestedSlots = new Set();

    for (let index = 0; index < prepared.length; index++) {
      const booking = prepared[index];
      const groups = hourLockGroups(booking);
      for (const [id, group] of groups) {
        if (!allGroups.has(id)) allGroups.set(id, { ...group, slots: new Set() });
        for (const slot of group.slots) {
          const key = `${id}:${slot}`;
          if (requestedSlots.has(key)) {
            throw new Error(`${booking.date}: hay un empalme dentro de la repetición solicitada.`);
          }
          requestedSlots.add(key);
          allGroups.get(id).slots.add(slot);
        }
      }
    }

    const totalWrites = prepared.length + allGroups.size + 2;
    if (totalWrites > 380) {
      throw new Error('La repetición es demasiado amplia. Reduce el periodo y vuelve a intentarlo.');
    }

    return runTransaction(db, async transaction => {
      const roomIds = [...new Set(prepared.map(item => item.roomId))];
      const roomSnapshots = new Map();

      for (const roomId of roomIds) {
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await transaction.get(roomRef);
        activeRoomOrThrow(roomSnap.exists() ? normalizeRoom(roomSnap.data()) : null);
        roomSnapshots.set(roomId, roomSnap);
      }

      for (const booking of prepared) {
        validateBooking(booking, {
          rooms: [{ id: booking.roomId, ...roomSnapshots.get(booking.roomId).data() }],
          bookings: []
        }, settings);
      }

      const states = await loadHourLockStates(transaction, allGroups);
      for (const [id, group] of allGroups) {
        const state = states.get(id);
        for (const slot of group.slots) {
          if (state.slots[slot]) {
            const date = group.date;
            throw new Error(`${date}: la sala ya se encuentra ocupada durante parte de este horario.`);
          }
        }
      }

      const savedBookings = [];
      for (let index = 0; index < prepared.length; index++) {
        const booking = prepared[index];
        const bookingRef = refs[index];
        const groups = hourLockGroups(booking);
        for (const [id, group] of groups) {
          const state = states.get(id);
          for (const slot of group.slots) {
            state.slots[slot] = slotOwner('booking', bookingRef.id);
          }
        }

        const saved = {
          ...booking,
          id: bookingRef.id,
          seriesId,
          status: 'active',
          createdByEmail: actor,
          createdByLabel: actor.split('@')[0],
          updatedByEmail: actor,
          updatedByLabel: actor.split('@')[0]
        };
        savedBookings.push(saved);

        transaction.set(bookingRef, {
          roomId: booking.roomId,
          date: booking.date,
          start: booking.start,
          end: booking.end,
          teacher: booking.teacher,
          group: booking.group,
          activity: booking.activity,
          colorKey: booking.colorKey || '',
          seriesId,
          status: 'active',
          createdByEmail: actor,
          createdByLabel: actor.split('@')[0],
          updatedByEmail: actor,
          updatedByLabel: actor.split('@')[0],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      for (const state of states.values()) writeHourLockState(transaction, state);

      transaction.set(doc(auditCollection), auditPayload('CREATE_SERIES', actor, {
        seriesId,
        bookingIds: refs.map(ref => ref.id),
        count: refs.length,
        after: {
          firstDate: prepared[0].date,
          lastDate: prepared[prepared.length - 1].date
        }
      }));

      return { seriesId, bookings: savedBookings };
    });
  },

  async cancelBooking(id, actorEmail) {
    const actor = cleanEmail(actorEmail);
    const bookingRef = doc(db, 'bookings', id);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(bookingRef);
      if (!snapshot.exists()) throw new Error('La reservación ya no existe.');

      const booking = normalizeBooking({ id: snapshot.id, ...snapshot.data() });
      if (booking.status === 'cancelled') return { booking };

      const groups = hourLockGroups(booking);
      const states = await loadHourLockStates(transaction, groups);
      for (const [groupId, group] of groups) {
        const state = states.get(groupId);
        for (const slot of group.slots) {
          if (sameOwner(state.slots[slot], 'booking', id)) delete state.slots[slot];
        }
      }
      for (const state of states.values()) writeHourLockState(transaction, state);

      const cancelled = {
        ...booking,
        status: 'cancelled',
        cancelledByEmail: actor,
        cancelledByLabel: actor.split('@')[0],
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0]
      };

      transaction.update(bookingRef, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledByEmail: actor,
        cancelledByLabel: actor.split('@')[0],
        updatedAt: serverTimestamp(),
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0]
      });

      transaction.set(doc(auditCollection), auditPayload('CANCEL_BOOKING', actor, {
        bookingId: id,
        roomId: booking.roomId,
        before: booking,
        after: cancelled
      }));

      return { booking: cancelled };
    });
  },

  async cancelSeries(seriesId, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (!seriesId) throw new Error('Esta reservación no pertenece a una serie.');

    const snapshot = await getDocs(
      query(bookingsCollection, where('seriesId', '==', seriesId))
    );

    const cancelledBookings = [];
    for (const bookingDoc of snapshot.docs) {
      const booking = normalizeBooking({ id: bookingDoc.id, ...bookingDoc.data() });
      if (booking.status === 'cancelled') continue;
      const result = await this.cancelBooking(booking.id, actor);
      if (result?.booking) cancelledBookings.push(result.booking);
    }

    return { count: cancelledBookings.length, bookings: cancelledBookings };
  },

  async restoreBooking(id, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) {
      throw new Error('Solo el administrador puede restaurar reservaciones canceladas.');
    }

    const bookingRef = doc(db, 'bookings', id);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(bookingRef);
      if (!snapshot.exists()) throw new Error('La reservación ya no existe.');

      const booking = normalizeBooking({ id: snapshot.id, ...snapshot.data() });
      if (booking.status !== 'cancelled') {
        throw new Error('La reservación ya se encuentra activa.');
      }

      const roomRef = doc(db, 'rooms', booking.roomId);
      const roomSnap = await transaction.get(roomRef);
      activeRoomOrThrow(roomSnap.exists() ? normalizeRoom(roomSnap.data()) : null);

      const groups = hourLockGroups(booking);
      const states = await loadHourLockStates(transaction, groups);
      for (const [groupId, group] of groups) {
        const state = states.get(groupId);
        for (const slot of group.slots) {
          const owner = state.slots[slot];
          if (owner && !sameOwner(owner, 'booking', id)) {
            throw new Error('No se puede restaurar: el horario ya está ocupado.');
          }
        }
      }

      for (const [groupId, group] of groups) {
        const state = states.get(groupId);
        for (const slot of group.slots) state.slots[slot] = slotOwner('booking', id);
      }
      for (const state of states.values()) writeHourLockState(transaction, state);

      const restored = {
        ...booking,
        status: 'active',
        cancelledAt: undefined,
        cancelledByEmail: undefined,
        cancelledByLabel: undefined,
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0]
      };

      transaction.update(bookingRef, {
        status: 'active',
        cancelledAt: deleteField(),
        cancelledByEmail: deleteField(),
        cancelledByLabel: deleteField(),
        updatedAt: serverTimestamp(),
        updatedByEmail: actor,
        updatedByLabel: actor.split('@')[0]
      });

      transaction.set(doc(auditCollection), auditPayload('RESTORE_BOOKING', actor, {
        bookingId: id,
        roomId: booking.roomId,
        before: booking,
        after: restored
      }));

      return { booking: restored };
    });
  },

  async saveRoom(roomId, source, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) throw new Error('Solo el administrador puede modificar salas.');

    const name = cleanText(source.name);
    const short = cleanText(source.short).toUpperCase();

    if (!name) throw new Error('Escribe el nombre de la sala.');
    if (!short) throw new Error('Escribe la abreviatura.');

    const roomRef = roomId
      ? doc(db, 'rooms', roomId)
      : doc(roomsCollection);

    const previousSnap = roomId ? await getDoc(roomRef) : null;
    const previous = previousSnap?.exists()
      ? normalizeRoom({ id: previousSnap.id, ...previousSnap.data() })
      : null;

    const payload = {
      name,
      short,
      building: cleanText(source.building),
      floor: cleanText(source.floor),
      capacity: Math.max(0, Number(source.capacity) || 0),
      equipment: Array.isArray(source.equipment)
        ? source.equipment.map(cleanText).filter(Boolean)
        : cleanText(source.equipment).split(',').map(cleanText).filter(Boolean),
      status: ['available', 'maintenance', 'out_of_service'].includes(source.status)
        ? source.status
        : 'available',
      notes: cleanText(source.notes),
      active: previous?.active !== false,
      updatedAt: serverTimestamp(),
      updatedByEmail: actor
    };

    if (!previous) {
      payload.createdAt = serverTimestamp();
      payload.createdByEmail = actor;
    }

    const batch = writeBatch(db);
    batch.set(roomRef, payload, { merge: true });
    batch.set(doc(auditCollection), auditPayload(
      previous ? 'ROOM_UPDATED' : 'ROOM_CREATED',
      actor,
      {
        roomId: roomRef.id,
        before: previous,
        after: {
          id: roomRef.id,
          name,
          short,
          building: cleanText(source.building),
          floor: cleanText(source.floor),
          capacity: Math.max(0, Number(source.capacity) || 0),
          equipment: Array.isArray(source.equipment)
            ? source.equipment.map(cleanText).filter(Boolean)
            : cleanText(source.equipment).split(',').map(cleanText).filter(Boolean),
          status: payload.status,
          notes: cleanText(source.notes),
          active: previous?.active !== false
        }
      }
    ));
    await batch.commit();

    return normalizeRoom({
      id: roomRef.id,
      ...previous,
      ...payload,
      active: previous?.active !== false
    });
  },

  async setRoomActive(roomId, active, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) throw new Error('Solo el administrador puede archivar salas.');

    const roomRef = doc(db, 'rooms', roomId);
    const snapshot = await getDoc(roomRef);
    if (!snapshot.exists()) throw new Error('La sala ya no existe.');

    const previous = normalizeRoom({ id: snapshot.id, ...snapshot.data() });
    const batch = writeBatch(db);

    batch.set(roomRef, active
      ? {
          active: true,
          archivedAt: deleteField(),
          archivedByEmail: deleteField(),
          updatedAt: serverTimestamp(),
          updatedByEmail: actor
        }
      : {
          active: false,
          archivedAt: serverTimestamp(),
          archivedByEmail: actor,
          updatedAt: serverTimestamp(),
          updatedByEmail: actor
        },
      { merge: true }
    );

    batch.set(doc(auditCollection), auditPayload(
      active ? 'ROOM_ENABLED' : 'ROOM_DISABLED',
      actor,
      {
        roomId,
        before: previous,
        after: { ...previous, active }
      }
    ));

    await batch.commit();

    return normalizeRoom({
      ...previous,
      active,
      updatedByEmail: actor
    });
  },

  async listRooms() {
    const snapshot = await getDocs(roomsCollection);
    return snapshot.docs
      .map(docData)
      .map(normalizeRoom)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  },

  async listAuthorizedUsers() {
    const snapshot = await getDocs(usersCollection);
    return snapshot.docs
      .map(docData)
      .map(normalizeUser)
      .sort((a, b) =>
        String(a.name || a.email).localeCompare(String(b.name || b.email), 'es')
      );
  },

  async saveAuthorizedUser(name, email, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) throw new Error('Solo el administrador puede autorizar usuarios.');

    name = cleanText(name);
    email = cleanEmail(email);

    if (!name) throw new Error('Escribe el nombre de la persona.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error('Escribe un correo válido.');
    }

    const userRef = doc(db, 'authorizedUsers', email);
    const previousSnap = await getDoc(userRef);
    const previous = previousSnap.exists()
      ? normalizeUser({ id: previousSnap.id, ...previousSnap.data() })
      : null;

    const batch = writeBatch(db);
    batch.set(userRef, {
      name,
      email,
      active: true,
      revokedAt: deleteField(),
      revokedByEmail: deleteField(),
      updatedAt: serverTimestamp(),
      updatedByEmail: actor
    }, { merge: true });

    batch.set(doc(auditCollection), auditPayload(
      previous ? 'USER_REACTIVATED' : 'USER_GRANTED',
      actor,
      {
        targetEmail: email,
        before: previous,
        after: { name, email, active: true }
      }
    ));

    await batch.commit();
  },

  async setAuthorizedUserActive(email, active, actorEmail) {
    const actor = cleanEmail(actorEmail);
    email = cleanEmail(email);

    if (actor !== OWNER_EMAIL) {
      throw new Error('Solo el administrador puede modificar accesos.');
    }

    if (email === OWNER_EMAIL && !active) {
      throw new Error('La cuenta administradora principal no puede perder su acceso.');
    }

    const userRef = doc(db, 'authorizedUsers', email);
    const snapshot = await getDoc(userRef);
    if (!snapshot.exists()) throw new Error('El usuario no existe.');

    const previous = normalizeUser({ id: snapshot.id, ...snapshot.data() });
    const batch = writeBatch(db);

    batch.set(userRef, active
      ? {
          active: true,
          revokedAt: deleteField(),
          revokedByEmail: deleteField(),
          updatedAt: serverTimestamp(),
          updatedByEmail: actor
        }
      : {
          active: false,
          revokedAt: serverTimestamp(),
          revokedByEmail: actor,
          updatedAt: serverTimestamp(),
          updatedByEmail: actor
        },
      { merge: true }
    );

    batch.set(doc(auditCollection), auditPayload(
      active ? 'USER_REACTIVATED' : 'USER_REVOKED',
      actor,
      {
        targetEmail: email,
        before: previous,
        after: { ...previous, active }
      }
    ));

    await batch.commit();
  },

  async saveRoomBlocks(sources, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (!actor) throw new Error('No se pudo identificar al usuario.');

    const saved = [];
    for (const source of sources) {
      saved.push(await this.saveRoomBlock(source, actor));
    }
    return saved;
  },

  async saveRoomBlock(source, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (!actor) throw new Error('No se pudo identificar al usuario.');

    const block = blockShape(source);
    if (!block.roomId || !block.date || !block.start || !block.end || !block.reason) {
      throw new Error('Completa sala, fecha, horario y motivo.');
    }
    if (minutes(block.start) >= minutes(block.end)) {
      throw new Error('La hora final debe ser posterior a la inicial.');
    }

    const blockRef = block.id
      ? doc(db, 'roomBlocks', block.id)
      : doc(blocksCollection);

    return runTransaction(db, async transaction => {
      const roomRef = doc(db, 'rooms', block.roomId);
      const roomSnap = await transaction.get(roomRef);
      activeRoomOrThrow(roomSnap.exists() ? normalizeRoom(roomSnap.data()) : null);

      let previous = null;
      if (block.id) {
        const previousSnap = await transaction.get(blockRef);
        if (!previousSnap.exists()) throw new Error('El bloqueo ya no existe.');
        previous = { id: previousSnap.id, ...previousSnap.data() };
      }

      const newGroups = hourLockGroups(block);
      const oldGroups = previous ? hourLockGroups(previous) : new Map();
      const combined = new Map([...oldGroups, ...newGroups]);
      const states = await loadHourLockStates(transaction, combined);

      for (const [groupId, group] of newGroups) {
        const state = states.get(groupId);
        for (const slot of group.slots) {
          const owner = state.slots[slot];
          if (owner && !sameOwner(owner, 'roomBlock', blockRef.id)) {
            throw new Error('No se puede bloquear: existe una reservación o bloqueo en ese horario.');
          }
        }
      }

      for (const [groupId, group] of oldGroups) {
        const state = states.get(groupId);
        for (const slot of group.slots) {
          if (sameOwner(state.slots[slot], 'roomBlock', blockRef.id)) delete state.slots[slot];
        }
      }
      for (const [groupId, group] of newGroups) {
        const state = states.get(groupId);
        for (const slot of group.slots) state.slots[slot] = slotOwner('roomBlock', blockRef.id);
      }
      for (const state of states.values()) writeHourLockState(transaction, state);

      const saved = {
        ...block,
        id: blockRef.id,
        active: true,
        createdByEmail: previous?.createdByEmail || actor,
        updatedByEmail: actor
      };

      transaction.set(blockRef, {
        roomId: block.roomId,
        date: block.date,
        start: block.start,
        end: block.end,
        reason: block.reason,
        active: true,
        createdAt: previous?.createdAt || serverTimestamp(),
        createdByEmail: previous?.createdByEmail || actor,
        updatedAt: serverTimestamp(),
        updatedByEmail: actor
      }, { merge: true });

      transaction.set(doc(auditCollection), auditPayload(
        previous ? 'ROOM_BLOCK_UPDATED' : 'ROOM_BLOCK_CREATED',
        actor,
        { roomId: block.roomId, blockId: blockRef.id, before: previous, after: saved }
      ));

      return saved;
    });
  },

  async deleteRoomBlock(id, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) throw new Error('Solo el administrador puede quitar bloqueos.');

    const blockRef = doc(db, 'roomBlocks', id);

    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(blockRef);
      if (!snapshot.exists()) return null;

      const block = { id: snapshot.id, ...snapshot.data() };
      const groups = hourLockGroups(block);
      const states = await loadHourLockStates(transaction, groups);

      for (const [groupId, group] of groups) {
        const state = states.get(groupId);
        for (const slot of group.slots) {
          if (sameOwner(state.slots[slot], 'roomBlock', id)) delete state.slots[slot];
        }
      }
      for (const state of states.values()) writeHourLockState(transaction, state);

      const removed = {
        ...block,
        active: false,
        updatedByEmail: actor
      };

      transaction.update(blockRef, {
        active: false,
        removedAt: serverTimestamp(),
        removedByEmail: actor,
        updatedAt: serverTimestamp(),
        updatedByEmail: actor
      });

      transaction.set(doc(auditCollection), auditPayload('ROOM_BLOCK_REMOVED', actor, {
        roomId: block.roomId,
        blockId: id,
        before: block,
        after: removed
      }));

      return removed;
    });
  },

  async listAuditLogs(from = '', to = '') {
    let snapshot;

    if (from && to) {
      snapshot = await getDocs(query(
        auditCollection,
        where('createdDate', '>=', from),
        where('createdDate', '<=', to)
      ));
    } else {
      snapshot = await getDocs(auditCollection);
    }

    return snapshot.docs
      .map(docData)
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() || 0;
        const bMs = b.createdAt?.toMillis?.() || 0;
        return bMs - aMs;
      });
  },

  async saveSettings(source, actorEmail) {
    const actor = cleanEmail(actorEmail);
    if (actor !== OWNER_EMAIL) throw new Error('Solo el administrador puede modificar la configuración.');

    const settings = normalizeSettings({
      startTime: source.startTime,
      endTime: source.endTime,
      enabledDays: source.enabledDays,
      blockMinutes: Number(source.blockMinutes),
      repeatLimitDays: Number(source.repeatLimitDays),
      allowSaturday: source.enabledDays?.includes?.(6) ?? true
    });

    if (minutes(settings.startTime) >= minutes(settings.endTime)) {
      throw new Error('La hora de cierre debe ser posterior a la hora de apertura.');
    }

    const before = await getSettings();

    const batch = writeBatch(db);
    batch.set(settingsRef, {
      ...settings,
      updatedAt: serverTimestamp(),
      updatedByEmail: actor
    }, { merge: true });

    batch.set(doc(auditCollection), auditPayload('SETTINGS_UPDATED', actor, {
      before,
      after: settings
    }));

    await batch.commit();
    return settings;
  },

  async downloadBackupData() {
    const [rooms, bookings, users, settings, blocks, hourLocks, legacyLocks] = await Promise.all([
      getDocs(roomsCollection),
      getDocs(bookingsCollection),
      getDocs(usersCollection),
      getDoc(settingsRef),
      getDocs(blocksCollection),
      getDocs(hourLocksCollection),
      getDocs(locksCollection)
    ]);

    return {
      format: 'agenda-audiovisuales-backup-v6.4',
      generatedAt: new Date().toISOString(),
      projectId: 'agenda-audiovisuales-din',
      rooms: rooms.docs.map(docData),
      bookings: bookings.docs.map(docData),
      authorizedUsers: users.docs.map(docData),
      settings: settings.exists() ? settings.data() : normalizeSettings(),
      roomBlocks: blocks.docs.map(docData),
      hourLocks: hourLocks.docs.map(docData),
      legacyLocks: legacyLocks.docs.map(docData)
    };
  }
};
