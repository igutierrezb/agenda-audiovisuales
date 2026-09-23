export const INITIAL_ROOMS = [
  { id: 'alta-f', name: 'Audiovisual Planta Alta F' },
  { id: 'baja-f', name: 'Audiovisual Planta Baja F' }
];
export function minutes(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
export function timeLabel(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
export function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function parseDate(key) { return new Date(`${key}T12:00:00`); }
export function monday(date) { const d = new Date(date); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; }
export function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
export function overlaps(a, b) { return a.id !== b.id && a.roomId === b.roomId && a.date === b.date && minutes(a.start) < minutes(b.end) && minutes(a.end) > minutes(b.start); }
export function validateBooking(booking, state) {
  if (!state.rooms.some(r => r.id === booking.roomId)) throw new Error('Selecciona una sala disponible.');
  const date = parseDate(booking.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date) || Number.isNaN(date.getTime()) || dateKey(date) !== booking.date) throw new Error('Selecciona una fecha válida.');
  if (date.getDay() === 0) throw new Error('Selecciona un día de lunes a sábado.');
  if (![booking.teacher, booking.group, booking.activity].every(v => typeof v === 'string' && v.trim())) throw new Error('Completa el maestro, grupo y actividad.');
  if (![booking.start, booking.end].every(t => /^\d{2}:(00|30)$/.test(t))) throw new Error('Selecciona horarios en intervalos de 30 minutos.');
  if (minutes(booking.start) < 420 || minutes(booking.end) > 1320 || minutes(booking.start) >= minutes(booking.end)) throw new Error('La hora final debe ser posterior a la inicial, entre 07:00 y 22:00.');
  if (state.bookings.some(b => overlaps(booking, b))) throw new Error('La sala ya se encuentra ocupada durante parte de este horario.');
}
