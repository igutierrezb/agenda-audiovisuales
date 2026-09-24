export const APP_SCHEMA_VERSION = 7;

export const INITIAL_ROOMS = [
  { id: 'alta-f', name: 'Audiovisual Planta Alta F', short: 'PA F' },
  { id: 'baja-f', name: 'Audiovisual Planta Baja F', short: 'PB F' }
];

export const DEFAULT_SETTINGS = {
  startTime: '07:00',
  endTime: '22:00',
  enabledDays: [1, 2, 3, 4, 5, 6],
  blockMinutes: 30,
  repeatLimitDays: 365,
  allowSaturday: true
};

export function minutes(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
}

export function timeLabel(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(key) {
  return new Date(`${key}T12:00:00`);
}

export function monday(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function normalizeSettings(source = {}) {
  const enabledDays = Array.isArray(source.enabledDays)
    ? source.enabledDays.map(Number).filter(day => day >= 1 && day <= 6)
    : DEFAULT_SETTINGS.enabledDays;

  const blockMinutes = [30, 60].includes(Number(source.blockMinutes))
    ? Number(source.blockMinutes)
    : DEFAULT_SETTINGS.blockMinutes;

  const repeatLimitDays = Math.max(
    7,
    Math.min(730, Number(source.repeatLimitDays) || DEFAULT_SETTINGS.repeatLimitDays)
  );

  const startTime = /^\d{2}:\d{2}$/.test(String(source.startTime || ''))
    ? String(source.startTime)
    : DEFAULT_SETTINGS.startTime;

  const endTime = /^\d{2}:\d{2}$/.test(String(source.endTime || ''))
    ? String(source.endTime)
    : DEFAULT_SETTINGS.endTime;

  return {
    ...DEFAULT_SETTINGS,
    ...source,
    startTime,
    endTime,
    blockMinutes,
    repeatLimitDays,
    enabledDays: enabledDays.length ? enabledDays : DEFAULT_SETTINGS.enabledDays,
    allowSaturday: source.allowSaturday !== false
  };
}

export function bookingStatus(booking) {
  return booking?.status === 'cancelled' ? 'cancelled' : 'active';
}

export function roomIsActive(room) {
  return room?.active !== false;
}

export function userIsActive(user) {
  return user?.active !== false;
}

export function overlaps(a, b) {
  return a.id !== b.id &&
    a.roomId === b.roomId &&
    a.date === b.date &&
    minutes(a.start) < minutes(b.end) &&
    minutes(a.end) > minutes(b.start);
}

export function validateBooking(booking, state, rawSettings = DEFAULT_SETTINGS) {
  const settings = normalizeSettings(rawSettings);
  const rooms = state?.rooms || [];
  const bookings = state?.bookings || [];

  const room = rooms.find(r => r.id === booking.roomId);
  if (!room || room.active === false) {
    throw new Error('Selecciona una sala disponible.');
  }

  if (room.status === 'maintenance' || room.status === 'out_of_service') {
    throw new Error('La sala seleccionada no está disponible para nuevas reservaciones.');
  }

  const date = parseDate(booking.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date) ||
      Number.isNaN(date.getTime()) ||
      dateKey(date) !== booking.date) {
    throw new Error('Selecciona una fecha válida.');
  }

  const day = date.getDay();
  if (day === 0 || !settings.enabledDays.includes(day)) {
    throw new Error('Ese día no está habilitado para reservaciones.');
  }

  if (![booking.teacher, booking.group, booking.activity].every(v =>
    typeof v === 'string' && v.trim()
  )) {
    throw new Error('Completa el maestro, grupo y actividad.');
  }

  if (![booking.start, booking.end].every(t => /^\d{2}:(00|30)$/.test(t))) {
    throw new Error('Selecciona horarios válidos en intervalos de 30 minutos.');
  }

  if (minutes(booking.start) < minutes(settings.startTime) ||
      minutes(booking.end) > minutes(settings.endTime) ||
      minutes(booking.start) >= minutes(booking.end)) {
    throw new Error(`La hora final debe ser posterior a la inicial, entre ${settings.startTime} y ${settings.endTime}.`);
  }

  if (bookings.some(b => bookingStatus(b) === 'active' && overlaps(booking, b))) {
    throw new Error('La sala ya se encuentra ocupada durante parte de este horario.');
  }
}
