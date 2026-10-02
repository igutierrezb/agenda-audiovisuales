import { getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';

import {
  getDatabase,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  onChildAdded,
  onChildChanged,
  onDisconnect,
  query,
  orderByChild,
  startAt,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

// V6.5 · Realtime Database se usa EXCLUSIVAMENTE para presencia y señales efímeras.
// Firestore continúa siendo la única fuente de verdad de reservaciones y bloqueos.
// Si tu Realtime Database fue creada en otra región y Firebase muestra una URL distinta,
// cambia únicamente esta constante por la URL exacta indicada en Firebase Console.
export const REALTIME_DATABASE_URL =
  'https://agenda-audiovisuales-din-default-rtdb.firebaseio.com';

const IDLE_MS = 150000; // 2 min 30 s
const RESUME_SKEW_MS = 5000;

let db = null;
try {
  db = getDatabase(getApp(), REALTIME_DATABASE_URL);
} catch (error) {
  console.warn('Realtime Database no disponible:', error);
}

let user = null;
let sessionId = '';
let sessionRef = null;
let presenceUnsub = null;
let connectionUnsub = null;
let signalUnsubs = [];
let idleTimer = null;
let localActive = false;
let peerCount = 0;
let visibleDates = [];
let pausedAt = Date.now();
let signalSince = Date.now() - RESUME_SKEW_MS;
let seenSignals = new Map();
let callbacks = {
  onPeerCount: () => {},
  onActiveChange: () => {},
  onSignal: () => {},
  onError: () => {}
};

function safeCallback(name, ...args) {
  try {
    callbacks[name]?.(...args);
  } catch (error) {
    console.warn(`Error en callback ${name}:`, error);
  }
}

function cleanDates(values) {
  return [...new Set((values || [])
    .map(value => String(value || '').trim())
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))];
}

function stopSignals() {
  for (const unsub of signalUnsubs) {
    try { unsub?.(); } catch {}
  }
  signalUnsubs = [];
}

function signalKey(date, snapshot) {
  return `${date}/${snapshot.key || ''}`;
}

function deliverSignal(date, snapshot) {
  const value = snapshot.val();
  if (!value || value.actorUid === user?.uid) return;

  const revision = Number(value.ts) || 0;
  const key = signalKey(date, snapshot);
  const previous = seenSignals.get(key) || 0;
  if (revision && revision <= previous) return;
  seenSignals.set(key, revision || Date.now());

  safeCallback('onSignal', {
    ...value,
    signalDate: date,
    signalKey: snapshot.key || ''
  });
}

function startSignals() {
  stopSignals();
  if (!db || !user || !localActive || peerCount < 1 || !visibleDates.length) return;

  const since = Math.max(0, Number(signalSince) || Date.now() - RESUME_SKEW_MS);

  for (const date of visibleDates) {
    const dayQuery = query(
      ref(db, `agendaSignals/${date}`),
      orderByChild('ts'),
      startAt(since)
    );

    signalUnsubs.push(
      onChildAdded(
        dayQuery,
        snapshot => deliverSignal(date, snapshot),
        error => safeCallback('onError', error)
      )
    );

    signalUnsubs.push(
      onChildChanged(
        dayQuery,
        snapshot => deliverSignal(date, snapshot),
        error => safeCallback('onError', error)
      )
    );
  }
}


async function catchUpSignals(since) {
  if (!db || !user || !visibleDates.length) return;
  const threshold = Math.max(0, Number(since) || Date.now() - RESUME_SKEW_MS);

  try {
    const snapshots = await Promise.all(
      visibleDates.map(date => get(query(
        ref(db, `agendaSignals/${date}`),
        orderByChild('ts'),
        startAt(threshold)
      )))
    );

    snapshots.forEach((snapshot, index) => {
      const date = visibleDates[index];
      snapshot.forEach(child => deliverSignal(date, child));
    });
  } catch (error) {
    safeCallback('onError', error);
  }
}

function setPeerCount(nextCount) {
  const next = Math.max(0, Number(nextCount) || 0);
  if (next === peerCount) return;
  peerCount = next;
  safeCallback('onPeerCount', peerCount);

  if (localActive && peerCount > 0) startSignals();
  else stopSignals();
}

function startPresenceListener() {
  if (!db || !user || presenceUnsub) return;

  presenceUnsub = onValue(
    ref(db, 'presence'),
    snapshot => {
      const all = snapshot.val() || {};
      const peers = new Set();

      for (const [uid, sessions] of Object.entries(all)) {
        if (uid === user.uid || !sessions || typeof sessions !== 'object') continue;
        const hasActiveSession = Object.values(sessions).some(item => item?.active === true);
        if (hasActiveSession) peers.add(uid);
      }

      setPeerCount(peers.size);
    },
    error => safeCallback('onError', error)
  );
}

function stopPresenceListener() {
  try { presenceUnsub?.(); } catch {}
  presenceUnsub = null;
  setPeerCount(0);
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!localActive) return;

  idleTimer = setTimeout(() => {
    void setLocalActive(false);
  }, IDLE_MS);
}

async function registerDisconnect() {
  if (!sessionRef) return;
  try {
    await onDisconnect(sessionRef).remove();
  } catch (error) {
    safeCallback('onError', error);
  }
}

async function setLocalActive(next) {
  if (!db || !user || !sessionRef) return;
  const desired = next === true;

  if (desired === localActive) {
    if (desired) armIdleTimer();
    return;
  }

  if (!desired) {
    pausedAt = Date.now();
    localActive = false;
    stopSignals();
    stopPresenceListener();
    clearTimeout(idleTimer);
    idleTimer = null;

    try {
      await update(sessionRef, {
        active: false,
        lastActive: serverTimestamp()
      });
    } catch (error) {
      safeCallback('onError', error);
    }

    safeCallback('onActiveChange', false);
    return;
  }

  signalSince = Math.max(0, pausedAt - RESUME_SKEW_MS);
  localActive = true;

  try {
    await set(sessionRef, {
      active: true,
      lastActive: serverTimestamp()
    });
    await registerDisconnect();
  } catch (error) {
    localActive = false;
    safeCallback('onError', error);
    safeCallback('onActiveChange', false);
    return;
  }

  startPresenceListener();
  armIdleTimer();
  safeCallback('onActiveChange', true);

  // Recupera únicamente entidades que cambiaron durante la pausa.
  // No vuelve a leer la semana completa de Firestore.
  await catchUpSignals(signalSince);

  if (peerCount > 0) startSignals();
}

function subscribeConnectionState() {
  if (!db || connectionUnsub) return;
  connectionUnsub = onValue(
    ref(db, '.info/connected'),
    snapshot => {
      if (snapshot.val() === true && localActive && sessionRef) {
        void set(sessionRef, {
          active: true,
          lastActive: serverTimestamp()
        })
          .then(registerDisconnect)
          .catch(error => safeCallback('onError', error));
      }
    },
    error => safeCallback('onError', error)
  );
}

function safeSignalId(entity, id) {
  return `${entity}_${String(id || '')}`.replace(/[.#$\[\]\/]/g, '_');
}

export const collaboration = {
  available() {
    return Boolean(db);
  },

  async start(nextUser, nextCallbacks = {}) {
    await this.stop();
    if (!db || !nextUser?.uid) return false;

    user = nextUser;
    sessionId = crypto.randomUUID();
    sessionRef = ref(db, `presence/${user.uid}/${sessionId}`);
    callbacks = { ...callbacks, ...nextCallbacks };
    pausedAt = Date.now();
    signalSince = Date.now() - RESUME_SKEW_MS;
    seenSignals = new Map();

    subscribeConnectionState();
    await setLocalActive(true);
    return localActive;
  },

  noteActivity() {
    if (!db || !user) return;
    if (!localActive) {
      void setLocalActive(true);
      return;
    }
    armIdleTimer();
  },

  setVisibleDates(dates, { fresh = false } = {}) {
    visibleDates = cleanDates(dates);
    if (fresh) signalSince = Date.now() - RESUME_SKEW_MS;
    if (localActive && peerCount > 0) startSignals();
  },

  peerCount() {
    return peerCount;
  },

  isActive() {
    return localActive;
  },

  async broadcast({ entity, id, date, previousDate = '', action = 'update', roomId = '' } = {}) {
    if (!db || !user || !localActive || peerCount < 1) return false;
    if (!['booking', 'roomBlock'].includes(entity) || !id || !date) return false;

    const dates = cleanDates([date, previousDate]);
    if (!dates.length) return false;

    const key = safeSignalId(entity, id);
    const updates = {};
    for (const targetDate of dates) {
      updates[`${targetDate}/${key}`] = {
        entity,
        id: String(id),
        date: String(date),
        previousDate: previousDate ? String(previousDate) : '',
        action: String(action || 'update'),
        roomId: String(roomId || ''),
        actorUid: user.uid,
        ts: serverTimestamp()
      };
    }

    try {
      await update(ref(db, 'agendaSignals'), updates);
      armIdleTimer();
      return true;
    } catch (error) {
      safeCallback('onError', error);
      return false;
    }
  },

  async stop() {
    clearTimeout(idleTimer);
    idleTimer = null;
    stopSignals();
    stopPresenceListener();
    try { connectionUnsub?.(); } catch {}
    connectionUnsub = null;

    if (sessionRef) {
      try { await remove(sessionRef); } catch {}
    }

    user = null;
    sessionId = '';
    sessionRef = null;
    localActive = false;
    peerCount = 0;
    visibleDates = [];
    callbacks = {
      onPeerCount: () => {},
      onActiveChange: () => {},
      onSignal: () => {},
      onError: () => {}
    };
  }
};
