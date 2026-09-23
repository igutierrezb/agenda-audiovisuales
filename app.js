import { minutes, timeLabel, dateKey, parseDate, monday, addDays } from './core.js';
import { repository } from './storage.js?v=4.1';
import { authService, OWNER_EMAIL } from './firebase.js?v=4.1';

// Densidad visual del calendario: cada bloque representa 30 minutos.
const SLOT_HEIGHT = 48;
const HOUR_HEIGHT = SLOT_HEIGHT * 2;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const escape = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));
const fullDate = date => date.toLocaleDateString('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});

const USER_PALETTES = {
  'ivan.gutierrez@uteq.edu.mx': {
    bg: '#fff2b8',
    hover: '#ffe894',
    border: '#d5aa33',
    accent: '#b88716',
    ink: '#624b0c'
  },
  'monica.arellano@uteq.edu.mx': {
    bg: '#d7eee9',
    hover: '#c4e5de',
    border: '#58a092',
    accent: '#338678',
    ink: '#245a51'
  },
  'jorge.cervantes@uteq.edu.mx': {
    bg: '#dce8f6',
    hover: '#c8daf0',
    border: '#6a94c3',
    accent: '#4c7fb7',
    ink: '#2e527a'
  },
  'aurora.osornio@uteq.edu.mx': {
    bg: '#e9e0f2',
    hover: '#dcd0eb',
    border: '#9476b4',
    accent: '#7d5ba4',
    ink: '#563e72'
  },
  'karina.garcia@uteq.edu.mx': {
    bg: '#f3dce6',
    hover: '#ebc8d7',
    border: '#bd7895',
    accent: '#a65778',
    ink: '#6b3850'
  }
};

function userPalette(email) {
  email = String(email || '').trim().toLowerCase();
  if (USER_PALETTES[email]) return USER_PALETTES[email];

  let hash = 0;
  for (const char of email) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;

  return {
    bg: `hsl(${hue} 48% 88%)`,
    hover: `hsl(${hue} 48% 82%)`,
    border: `hsl(${hue} 40% 53%)`,
    accent: `hsl(${hue} 46% 43%)`,
    ink: `hsl(${hue} 42% 28%)`
  };
}

function bookingActor(booking) {
  const createdEmail = String(booking?.createdByEmail || '').toLowerCase();
  const updatedEmail = String(booking?.updatedByEmail || createdEmail).toLowerCase();

  const createdLabel = booking?.createdByLabel
    || (createdEmail.includes('@') ? createdEmail.split('@')[0] : '');

  const updatedLabel = booking?.updatedByLabel
    || (updatedEmail.includes('@') ? updatedEmail.split('@')[0] : createdLabel);

  return {
    createdEmail,
    updatedEmail,
    createdLabel,
    updatedLabel,
    editedByAnother: Boolean(updatedEmail && createdEmail && updatedEmail !== createdEmail)
  };
}

function bookingColorStyle(booking) {
  const actor = bookingActor(booking);
  const palette = userPalette(actor.updatedEmail || actor.createdEmail);

  return [
    `--booking-bg:${palette.bg}`,
    `--booking-hover:${palette.hover}`,
    `--booking-border:${palette.border}`,
    `--booking-accent:${palette.accent}`,
    `--booking-ink:${palette.ink}`
  ].join(';');
}

function bookingAuditHtml(booking) {
  const actor = bookingActor(booking);
  if (!actor.createdLabel && !actor.updatedLabel) return '';

  const created = actor.createdLabel
    ? `<small class="booked-by"><span class="user-dot"></span>por ${escape(actor.createdLabel)}</small>`
    : '';

  const edited = actor.editedByAnother
    ? `<small class="edited-by">editó ${escape(actor.updatedLabel)}</small>`
    : '';

  return `${created}${edited}`;
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

let state = { rooms: [], bookings: [] };
let week = monday(new Date());
let selectedDay = Math.min((new Date().getDay() + 6) % 7, 5);
let selectedRoom = 'all';
let currentBooking;
let confirmAction;
let noticeTimer;
let currentUser = null;
let unsubscribeRealtime = null;
let dragState = null;
let quickView = 'week';

function notice(message) {
  $('#notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $('#notice').textContent = '';
  }, 6500);
}

function roomById(id) {
  return state.rooms.find(r => r.id === id);
}

function roomName(id) {
  return roomById(id)?.name || 'Sala';
}

function roomShort(id) {
  const room = roomById(id);
  return room ? defaultRoomShort(room) : 'SALA';
}

function dates() {
  return Array.from({ length: 6 }, (_, i) => addDays(week, i));
}

function bookingConflict(roomId, date, start, end, excludeId = '') {
  const startMinutes = minutes(start);
  const endMinutes = minutes(end);

  return state.bookings.find(booking =>
    booking.id !== excludeId &&
    booking.roomId === roomId &&
    booking.date === date &&
    startMinutes < minutes(booking.end) &&
    endMinutes > minutes(booking.start)
  );
}

function updateAvailabilityStatus(roomId, date, start, end) {
  const status = $('#availability-status');
  const calendar = $('#calendar');
  if (!status || !roomId || !date || !start || !end) return null;

  const conflict = bookingConflict(roomId, date, start, end);

  calendar.classList.toggle('selection-busy', Boolean(conflict));
  calendar.classList.toggle('selection-free', !conflict);

  if (conflict) {
    status.className = 'availability-status busy';
    status.textContent = `Ocupado: ${conflict.teacher} · ${conflict.start}–${conflict.end}`;
  } else {
    status.className = 'availability-status available';
    status.textContent = `Disponible · ${roomShort(roomId)} · ${start}–${end}`;
  }

  return conflict;
}

function updateQuickFilterButtons() {
  for (const button of $$('#quick-filters [data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === quickView));
  }
}

function render() {
  if (selectedRoom !== 'all' && !state.rooms.some(r => r.id === selectedRoom)) {
    selectedRoom = 'all';
  }

  $('#new').disabled = !state.rooms.length;

  $('#room-tabs').innerHTML = [
    `<button data-room="all" aria-pressed="${selectedRoom === 'all'}">Todas las salas</button>`,
    ...state.rooms.map(r => `<button data-room="${escape(r.id)}" aria-pressed="${selectedRoom === r.id}">${escape(r.name)}</button>`)
  ].join('');

  updateQuickFilterButtons();

  const days = dates();
  const last = days[5];
  const now = new Date();
  const todayKey = dateKey(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentDayIndex = Math.min((now.getDay() + 6) % 7, 5);

  $('#period').textContent = week.getMonth() === last.getMonth()
    ? `${week.getDate()}–${last.getDate()} de ${last.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`
    : `${week.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  let visibleBookings = state.bookings.filter(b =>
    b.date >= dateKey(week) &&
    b.date <= dateKey(last) &&
    (selectedRoom === 'all' || b.roomId === selectedRoom)
  );

  if (quickView === 'mine') {
    const email = String(currentUser?.email || '').toLowerCase();
    visibleBookings = visibleBookings.filter(b =>
      String(b.createdByEmail || '').toLowerCase() === email
    );
  }

  if (quickView === 'today') {
    visibleBookings = visibleBookings.filter(b => b.date === todayKey);
  }

  const summaryLabel = quickView === 'today'
    ? 'hoy'
    : quickView === 'mine'
      ? 'tuyas esta semana'
      : 'esta semana';

  $('#summary').textContent =
    `${visibleBookings.length} ${visibleBookings.length === 1 ? 'reservación' : 'reservaciones'} ${summaryLabel}`;

  $('#day-picker').innerHTML = days.map((d, i) => `
    <button data-day="${i}" aria-pressed="${selectedDay === i}" aria-label="${escape(fullDate(d))}">
      ${escape(d.toLocaleDateString('es-MX', { weekday: 'short' }))}
      <strong>${d.getDate()}</strong>
    </button>
  `).join('');

  const calendar = $('#calendar');
  const scrollTop = calendar.scrollTop;
  calendar.classList.toggle('all-rooms', selectedRoom === 'all');
  calendar.classList.toggle('single-day', quickView === 'today');

  if (!state.rooms.length) {
    calendar.innerHTML = '<div class="empty">Agrega una sala para comenzar a reservar.</div>';
    return;
  }

  const rooms = selectedRoom === 'all'
    ? state.rooms
    : state.rooms.filter(r => r.id === selectedRoom);

  const roomHeaders = rooms.map(r => `
    <span title="${escape(r.name)}">${escape(defaultRoomShort(r))}</span>
  `).join('');

  const mobileWidth = Math.max(rooms.length * 125, 280);

  calendar.innerHTML = `
    <div class="week" style="--room-count:${rooms.length};--day-mobile-width:${mobileWidth}px">
      <div class="time-head">HORA</div>

      ${days.map((d, i) => {
        const key = dateKey(d);
        const current = key === todayKey;
        const saturday = d.getDay() === 6;
        return `
          <div class="day-head ${i === selectedDay ? 'selected' : ''} ${current ? 'current' : ''} ${saturday ? 'saturday' : ''}" style="--room-count:${rooms.length}">
            <div class="day-title">
              ${escape(d.toLocaleDateString('es-MX', { weekday: 'short' }))}
              <strong>${d.getDate()}</strong>
            </div>
            <div class="room-heads" aria-label="Salas para ${escape(fullDate(d))}">
              ${roomHeaders}
            </div>
          </div>
        `;
      }).join('')}

      <div class="time-axis">
        ${Array.from({ length: 16 }, (_, i) => `
          <span class="time-label" style="top:${i * HOUR_HEIGHT}px">${timeLabel(420 + i * 60)}</span>
        `).join('')}
      </div>

      ${days.map((d, i) => {
        const key = dateKey(d);
        const isToday = key === todayKey;
        const isSaturday = d.getDay() === 6;
        const nowLineVisible = isToday && currentMinutes >= 420 && currentMinutes <= 1320;
        const nowLineTop = ((currentMinutes - 420) / 30) * SLOT_HEIGHT;

        return `
          <div class="day-column ${i === selectedDay ? 'selected' : ''} ${isToday ? 'current-day' : ''} ${isSaturday ? 'saturday' : ''}">
            ${rooms.map(r => `
              <div class="lane" aria-label="${escape(r.name)} · ${escape(fullDate(d))}">
                ${Array.from({ length: 30 }, (_, n) => `
                  <button
                    class="slot"
                    data-date="${key}"
                    data-room="${escape(r.id)}"
                    data-start="${timeLabel(420 + n * 30)}"
                    aria-label="Reservar ${escape(r.name)}, ${escape(fullDate(d))}, ${timeLabel(420 + n * 30)}">
                  </button>
                `).join('')}

                ${visibleBookings
                  .filter(b => b.date === key && b.roomId === r.id)
                  .map(b => {
                    const duration = minutes(b.end) - minutes(b.start);
                    const audit = duration >= 60 ? bookingAuditHtml(b) : '';
                    return `
                      <button
                        class="booking ${duration <= 30 ? 'compact-booking' : ''}"
                        style="top:${(minutes(b.start) - 420) / 30 * SLOT_HEIGHT + 2}px;height:${Math.max(duration / 30 * SLOT_HEIGHT - 4, 24)}px;${bookingColorStyle(b)}"
                        data-booking="${escape(b.id)}"
                        aria-label="${escape(`${b.teacher}, ${b.group}, ${b.activity}, ${b.start} a ${b.end}, ${r.name}`)}"
                        title="${escape(`${r.name}\n${b.teacher} · ${b.group}\n${b.activity}\n${b.start}–${b.end}\nCreó: ${bookingActor(b).createdLabel || '—'}\nEditó: ${bookingActor(b).updatedLabel || '—'}`)}">
                        <span class="time">${escape(b.start)}–${escape(b.end)}</span>
                        <strong>${escape(b.teacher)}</strong>
                        <span class="booking-meta"><b>${escape(b.group)}</b>${b.activity ? ` · ${escape(b.activity)}` : ''}</span>
                        ${audit}
                      </button>
                    `;
                  }).join('')}
              </div>
            `).join('')}

            ${nowLineVisible ? `
              <div class="now-line" style="top:${nowLineTop}px" aria-hidden="true">
                <span>${timeLabel(currentMinutes)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  calendar.scrollTop = scrollTop;

  if (quickView === 'today') {
    selectedDay = currentDayIndex;
  }
}

function changed(nextState, message) {
  state = nextState;
  render();
  if (message) notice(message);
}

function setDefaultRepeatUntil(dateValue) {
  const input = $('#booking-form').elements.repeatUntil;
  if (!dateValue) return;
  const suggested = dateKey(addDays(parseDate(dateValue), 28));
  if (!input.value || input.value < dateValue) input.value = suggested;
  input.min = dateValue;
}

function ensureRepeatWeekday() {
  const form = $('#booking-form');
  const checked = Array.from(form.querySelectorAll('[name="repeatWeekdays"]:checked'));
  if (checked.length || !form.elements.date.value) return;

  const day = parseDate(form.elements.date.value).getDay();
  const input = form.querySelector(`[name="repeatWeekdays"][value="${day}"]`);
  if (input) input.checked = true;
}

function toggleRepeatOptions() {
  const form = $('#booking-form');
  const enabled = form.elements.repeatEnabled.checked;
  $('#repeat-options').hidden = !enabled;

  if (enabled) {
    setDefaultRepeatUntil(form.elements.date.value);
    ensureRepeatWeekday();
  }
}

function openBooking(values = {}) {
  const form = $('#booking-form');
  form.reset();
  $('#booking-error').textContent = '';

  form.elements.roomId.innerHTML = state.rooms.map(r => `
    <option value="${escape(r.id)}">${escape(r.name)} (${escape(defaultRoomShort(r))})</option>
  `).join('');

  for (const field of ['start', 'end']) {
    form.elements[field].innerHTML = Array.from({ length: 30 }, (_, i) => {
      const t = timeLabel(420 + (i + (field === 'end' ? 1 : 0)) * 30);
      return `<option value="${t}">${t}</option>`;
    }).join('');
  }

  const defaults = {
    id: '',
    roomId: selectedRoom === 'all' ? state.rooms[0]?.id : selectedRoom,
    date: dateKey(dates()[selectedDay]),
    start: '07:00',
    end: '08:00',
    teacher: '',
    group: '',
    activity: ''
  };

  const merged = { ...defaults, ...values };
  for (const [key, value] of Object.entries(merged)) {
    if (form.elements[key]) form.elements[key].value = value ?? '';
  }

  const editing = Boolean(values.id);
  $('#booking-title').textContent = editing ? 'Editar reservación' : 'Nueva reservación';
  $('#repeat-section').hidden = editing;
  form.elements.repeatEnabled.checked = false;
  $('#repeat-options').hidden = true;

  for (const checkbox of form.querySelectorAll('[name="repeatWeekdays"]')) {
    checkbox.checked = false;
  }

  if (!editing) setDefaultRepeatUntil(merged.date);

  $('#booking-dialog').showModal();
}

function details(id) {
  currentBooking = state.bookings.find(b => b.id === id);
  if (!currentBooking) return;

  const b = currentBooking;
  $('#detail-title').textContent = `${roomShort(b.roomId)} · ${roomName(b.roomId)}`;
  $('#details').innerHTML = [
    ['Maestro', b.teacher],
    ['Grupo', b.group],
    ['Actividad', b.activity],
    ['Fecha', fullDate(parseDate(b.date))],
    ['Horario', `${b.start}–${b.end}`],
    ['Apartado por', b.createdByLabel || (b.createdByEmail ? b.createdByEmail.split('@')[0] : '—')],
    ['Última edición por', b.updatedByLabel || (b.updatedByEmail ? b.updatedByEmail.split('@')[0] : (b.createdByLabel || (b.createdByEmail ? b.createdByEmail.split('@')[0] : '—')))]
  ].map(([label, value]) => `
    <div class="detail-row">
      <span>${escape(label)}</span>
      <strong>${escape(value)}</strong>
    </div>
  `).join('');

  $('#delete-series').hidden = !b.seriesId;
  $('#detail-dialog').showModal();
}

function confirmDelete(title, description, action) {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = description;
  $('#confirm-error').textContent = '';
  confirmAction = action;
  $('#confirm-dialog').showModal();
}

function renderRooms() {
  $('#rooms-list').innerHTML = state.rooms.map(r => `
    <form class="room-edit" data-id="${escape(r.id)}">
      <div class="form-row room-fields">
        <label>
          Nombre de la sala
          <input name="name" value="${escape(r.name)}" required>
        </label>
        <label>
          Abreviatura
          <input name="short" value="${escape(defaultRoomShort(r))}" required maxlength="12">
        </label>
      </div>
      <div class="actions">
        <button type="button" class="danger" data-remove-room="${escape(r.id)}">Eliminar</button>
        <button type="submit">Guardar cambios</button>
      </div>
    </form>
  `).join('');

  renderReportRoomOptions();
}

function createBookingSeries(form) {
  const data = new FormData(form);
  const booking = {
    id: String(data.get('id') || ''),
    roomId: String(data.get('roomId') || ''),
    date: String(data.get('date') || ''),
    start: String(data.get('start') || ''),
    end: String(data.get('end') || ''),
    teacher: String(data.get('teacher') || '').trim(),
    group: String(data.get('group') || '').trim(),
    activity: String(data.get('activity') || '').trim()
  };

  if (booking.id || !form.elements.repeatEnabled.checked) {
    return [booking];
  }

  const until = String(data.get('repeatUntil') || '');
  const weekdays = new Set(data.getAll('repeatWeekdays').map(Number));

  if (!until) throw new Error('Selecciona la fecha hasta la cual se repetirá la reservación.');
  if (until < booking.date) throw new Error('La fecha final de repetición no puede ser anterior a la fecha principal.');
  if (!weekdays.size) throw new Error('Selecciona al menos un día de repetición.');

  const bookings = [{ ...booking }];
  let cursor = addDays(parseDate(booking.date), 1);
  let safety = 0;

  while (dateKey(cursor) <= until) {
    if (weekdays.has(cursor.getDay())) {
      bookings.push({ ...booking, id: '', date: dateKey(cursor) });
    }

    cursor = addDays(cursor, 1);
    safety += 1;
    if (safety > 730) throw new Error('El periodo de repetición es demasiado amplio. Usa un máximo de dos años.');
  }

  return bookings;
}

function setupReportDefaults() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const first = `${month}-01`;
  const last = dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12));

  if (!$('#report-month').value) $('#report-month').value = month;
  if (!$('#report-year').value) $('#report-year').value = String(now.getFullYear());
  if (!$('#report-from').value) $('#report-from').value = first;
  if (!$('#report-to').value) $('#report-to').value = last;
}

function toggleReportPeriodFields() {
  const type = $('#report-period-type').value;
  $('#report-month-field').hidden = type !== 'monthly';
  $('#report-year-field').hidden = type !== 'annual';
  $('#report-custom-fields').hidden = type !== 'custom';
  updateReportPreview();
}

function renderReportRoomOptions() {
  const all = $('#report-all-rooms');
  all.checked = true;

  $('#report-room-options').innerHTML = state.rooms.map(room => `
    <label class="disabled">
      <input type="checkbox" name="reportRoom" value="${escape(room.id)}" checked disabled>
      <span><strong>${escape(defaultRoomShort(room))}</strong> · ${escape(room.name)}</span>
    </label>
  `).join('');

  updateReportPreview();
}

function syncReportRoomInputs() {
  const allChecked = $('#report-all-rooms').checked;

  for (const input of $$('#report-room-options input[name="reportRoom"]')) {
    input.disabled = allChecked;
    if (allChecked) input.checked = true;
    input.closest('label')?.classList.toggle('disabled', allChecked);
  }

  updateReportPreview();
}

function reportRange() {
  const type = $('#report-period-type').value;

  if (type === 'monthly') {
    const month = $('#report-month').value;
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Selecciona el mes del reporte.');
    const [year, monthNumber] = month.split('-').map(Number);
    return {
      from: `${month}-01`,
      to: dateKey(new Date(year, monthNumber, 0, 12)),
      label: new Date(year, monthNumber - 1, 1, 12).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
      file: month
    };
  }

  if (type === 'annual') {
    const year = Number($('#report-year').value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Escribe un año válido.');
    return {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `Año ${year}`,
      file: String(year)
    };
  }

  const from = $('#report-from').value;
  const to = $('#report-to').value;
  if (!from || !to) throw new Error('Selecciona las fechas inicial y final del reporte.');
  if (to < from) throw new Error('La fecha final del reporte no puede ser anterior a la fecha inicial.');

  return {
    from,
    to,
    label: `${from} a ${to}`,
    file: `${from}_a_${to}`
  };
}

function selectedReportRoomIds() {
  if ($('#report-all-rooms').checked) return state.rooms.map(r => r.id);

  const ids = $$('#report-room-options input[name="reportRoom"]:checked').map(input => input.value);
  if (!ids.length) throw new Error('Selecciona al menos una sala para el reporte.');
  return ids;
}

function reportData() {
  const range = reportRange();
  const roomIds = selectedReportRoomIds();
  const roomSet = new Set(roomIds);

  const bookings = state.bookings
    .filter(b => b.date >= range.from && b.date <= range.to && roomSet.has(b.roomId))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      minutes(a.start) - minutes(b.start) ||
      roomName(a.roomId).localeCompare(roomName(b.roomId), 'es')
    );

  return { range, roomIds, bookings };
}

function updateReportPreview() {
  const preview = $('#report-preview');
  if (!preview || !state.rooms.length) return;

  try {
    const { range, roomIds, bookings } = reportData();
    preview.textContent = `${bookings.length} ${bookings.length === 1 ? 'reservación' : 'reservaciones'} · ${roomIds.length} ${roomIds.length === 1 ? 'sala' : 'salas'} · ${range.label}`;
    $('#report-error').textContent = '';
  } catch (error) {
    preview.textContent = '';
  }
}

function excelRows(bookings) {
  return bookings.map(b => {
    const room = roomById(b.roomId) || { name: 'Sala eliminada', short: '—' };
    const day = parseDate(b.date).toLocaleDateString('es-MX', { weekday: 'long' });

    return {
      'Fecha': b.date,
      'Día': day,
      'Sala': room.name,
      'Abreviatura': defaultRoomShort(room),
      'Hora inicial': b.start,
      'Hora final': b.end,
      'Duración (min)': minutes(b.end) - minutes(b.start),
      'Maestro': b.teacher,
      'Grupo': b.group,
      'Actividad': b.activity,
      'Registrado por': b.createdByLabel || (b.createdByEmail ? b.createdByEmail.split('@')[0] : ''),
      'Última edición por': b.updatedByLabel || (b.updatedByEmail ? b.updatedByEmail.split('@')[0] : (b.createdByLabel || (b.createdByEmail ? b.createdByEmail.split('@')[0] : '')))
    };
  });
}

function downloadCsv(rows, fileName) {
  const headers = ['Fecha', 'Día', 'Sala', 'Abreviatura', 'Hora inicial', 'Hora final', 'Duración (min)', 'Maestro', 'Grupo', 'Actividad', 'Registrado por', 'Última edición por'];
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [
    headers.map(quote).join(','),
    ...rows.map(row => headers.map(header => quote(row[header])).join(','))
  ].join('\r\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportReport() {
  const { range, roomIds, bookings } = reportData();
  const rows = excelRows(bookings);
  const selectedRooms = roomIds.map(id => roomById(id)).filter(Boolean);
  const roomDescription = roomIds.length === state.rooms.length
    ? 'Todas las salas'
    : selectedRooms.map(defaultRoomShort).join(', ');

  const fileBase = `reporte_reservaciones_${range.file}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (!window.XLSX) {
    downloadCsv(rows, `${fileBase}.csv`);
    notice(`No se pudo cargar el generador XLSX. Se descargó un CSV compatible con Excel (${bookings.length} registros).`);
    return;
  }

  const headers = ['Fecha', 'Día', 'Sala', 'Abreviatura', 'Hora inicial', 'Hora final', 'Duración (min)', 'Maestro', 'Grupo', 'Actividad', 'Registrado por', 'Última edición por'];
  const dataSheet = rows.length
    ? window.XLSX.utils.json_to_sheet(rows, { header: headers })
    : window.XLSX.utils.aoa_to_sheet([headers]);

  dataSheet['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 34 }, { wch: 13 }, { wch: 13 },
    { wch: 13 }, { wch: 15 }, { wch: 30 }, { wch: 16 }, { wch: 44 }, { wch: 22 }, { wch: 22 }
  ];

  const summarySheet = window.XLSX.utils.aoa_to_sheet([
    ['Reporte de reservaciones de Salas Audiovisuales · División Industrial'],
    [],
    ['Periodo', range.label],
    ['Desde', range.from],
    ['Hasta', range.to],
    ['Salas', roomDescription],
    ['Total de reservaciones', bookings.length],
    ['Generado', new Date().toLocaleString('es-MX')],
    [],
    ['Elaborado desde la agenda de reservaciones de la División Industrial.']
  ]);

  summarySheet['!cols'] = [{ wch: 24 }, { wch: 70 }];

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');
  window.XLSX.utils.book_append_sheet(workbook, dataSheet, 'Reservaciones');
  window.XLSX.writeFile(workbook, `${fileBase}.xlsx`, { compression: true });

  notice(`Reporte descargado: ${bookings.length} ${bookings.length === 1 ? 'reservación' : 'reservaciones'}.`);
}

// Cierre general de diálogos.
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

$('#new').onclick = () => openBooking();

$('#room-tabs').onclick = event => {
  const button = event.target.closest('[data-room]');
  if (!button) return;
  selectedRoom = button.dataset.room;
  render();
};

$('#quick-filters').onclick = event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;

  quickView = button.dataset.view;

  if (quickView === 'today' || quickView === 'week') {
    const now = new Date();
    week = monday(now);
    selectedDay = Math.min((now.getDay() + 6) % 7, 5);
  }

  render();
};

$('#day-picker').onclick = event => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  selectedDay = Number(button.dataset.day);
  quickView = 'week';
  render();
};

$('#calendar').onclick = event => {
  const booking = event.target.closest('[data-booking]');
  if (booking) details(booking.dataset.booking);
};

function clearDragSelection() {
  document.querySelectorAll('.slot.drag-selected').forEach(slot => slot.classList.remove('drag-selected'));
  $('#calendar').classList.remove('dragging', 'selection-free', 'selection-busy');
}

function paintDragSelection() {
  clearDragSelection();
  if (!dragState) return;
  $('#calendar').classList.add('dragging');
  const [from, to] = [dragState.startIndex, dragState.endIndex].sort((a, b) => a - b);
  dragState.slots.forEach((slot, index) => {
    if (index >= from && index <= to) slot.classList.add('drag-selected');
  });
}

$('#calendar').addEventListener('pointerdown', event => {
  const slot = event.target.closest('.slot');
  if (!slot || event.button !== 0) return;
  event.preventDefault();

  const lane = slot.closest('.lane');
  const slots = Array.from(lane.querySelectorAll('.slot'));
  const index = slots.indexOf(slot);
  dragState = {
    pointerId: event.pointerId,
    lane, slots, startIndex: index, endIndex: index, moved: false,
    roomId: slot.dataset.room, date: slot.dataset.date
  };
  slot.setPointerCapture?.(event.pointerId);
  paintDragSelection();

  const start = timeLabel(420 + index * 30);
  const end = timeLabel(Math.min(420 + index * 30 + 60, 1320));
  updateAvailabilityStatus(dragState.roomId, dragState.date, start, end);
});

$('#calendar').addEventListener('pointermove', event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.slot');
  if (!target || target.closest('.lane') !== dragState.lane) return;
  const index = dragState.slots.indexOf(target);
  if (index < 0 || index === dragState.endIndex) return;
  dragState.endIndex = index;
  dragState.moved = dragState.moved || index !== dragState.startIndex;
  paintDragSelection();

  const [from, to] = [dragState.startIndex, dragState.endIndex].sort((a, b) => a - b);
  const start = timeLabel(420 + from * 30);
  const end = timeLabel(Math.min(420 + (to + 1) * 30, 1320));
  updateAvailabilityStatus(dragState.roomId, dragState.date, start, end);
});

window.addEventListener('pointerup', event => {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const active = dragState;
  const [from, to] = [active.startIndex, active.endIndex].sort((a, b) => a - b);
  const start = timeLabel(420 + from * 30);
  const end = active.moved
    ? timeLabel(Math.min(420 + (to + 1) * 30, 1320))
    : timeLabel(Math.min(420 + from * 30 + 60, 1320));
  const conflict = updateAvailabilityStatus(active.roomId, active.date, start, end);

  dragState = null;
  clearDragSelection();

  if (conflict) {
    notice(`Ese horario ya está ocupado por ${conflict.teacher} (${conflict.start}–${conflict.end}).`);
    return;
  }

  openBooking({ roomId: active.roomId, date: active.date, start, end });
});

window.addEventListener('pointercancel', () => { dragState = null; clearDragSelection(); });

$('#previous').onclick = () => {
  week = addDays(week, -7);
  quickView = 'week';
  render();
};

$('#next').onclick = () => {
  week = addDays(week, 7);
  quickView = 'week';
  render();
};

$('#today').onclick = () => {
  week = monday(new Date());
  selectedDay = Math.min((new Date().getDay() + 6) % 7, 5);
  quickView = 'today';
  render();
};

$('#booking-form').elements.start.onchange = event => {
  const end = $('#booking-form').elements.end;
  if (minutes(end.value) <= minutes(event.target.value)) {
    end.value = timeLabel(Math.min(minutes(event.target.value) + 60, 1320));
  }
};

$('#booking-form').elements.date.onchange = event => {
  const form = $('#booking-form');
  setDefaultRepeatUntil(event.target.value);
  if (form.elements.repeatEnabled.checked) ensureRepeatWeekday();
};

$('#repeat-enabled').onchange = toggleRepeatOptions;

$('#booking-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type=submit]');
  button.disabled = true;

  try {
    const bookings = createBookingSeries(form);
    const base = bookings[0];
    const next = bookings.length > 1
      ? await repository.saveBookings(bookings, currentUser?.email)
      : await repository.saveBooking(base, currentUser?.email);

    week = monday(parseDate(base.date));
    selectedDay = Math.min((parseDate(base.date).getDay() + 6) % 7, 5);
    selectedRoom = 'all';

    changed(
      next,
      bookings.length > 1
        ? `${bookings.length} reservaciones guardadas.`
        : 'Reservación guardada.'
    );

    $('#booking-dialog').close();
  } catch (error) {
    $('#booking-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$('#duplicate-booking').onclick = () => {
  if (!currentBooking) return;

  const copy = {
    id: '',
    roomId: currentBooking.roomId,
    date: currentBooking.date,
    start: currentBooking.start,
    end: currentBooking.end,
    teacher: currentBooking.teacher,
    group: currentBooking.group,
    activity: currentBooking.activity
  };

  $('#detail-dialog').close();
  openBooking(copy);
  $('#booking-title').textContent = 'Duplicar reservación';
};

$('#edit-booking').onclick = () => {
  $('#detail-dialog').close();
  openBooking(currentBooking);
};

$('#delete-booking').onclick = () => {
  const id = currentBooking.id;
  confirmDelete(
    '¿Eliminar esta reservación?',
    `${currentBooking.teacher} · ${currentBooking.start}–${currentBooking.end}`,
    async () => {
      changed(await repository.deleteBooking(id), 'Reservación eliminada.');
      $('#detail-dialog').close();
    }
  );
};

$('#delete-series').onclick = () => {
  if (!currentBooking?.seriesId) return;
  const seriesId = currentBooking.seriesId;
  confirmDelete(
    '¿Eliminar toda la serie?',
    'Se eliminarán todas las reservaciones creadas dentro de esta repetición.',
    async () => {
      changed(await repository.deleteSeries(seriesId), 'Serie de reservaciones eliminada.');
      $('#detail-dialog').close();
    }
  );
};

$('#cancel-delete').onclick = () => $('#confirm-dialog').close();

$('#confirm-delete').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await confirmAction();
    $('#confirm-dialog').close();
  } catch (error) {
    $('#confirm-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$('#manage').onclick = async () => {
  const owner = authService.isOwner(currentUser);

  setupReportDefaults();
  $('#room-error').textContent = '';
  $('#report-error').textContent = '';
  $('#user-error').textContent = '';

  // Solo la cuenta administradora gestiona salas y usuarios.
  $('#rooms-admin-section').hidden = !owner;
  $('#users-admin-section').hidden = !owner;

  if (owner) {
    renderRooms();
    await renderAuthorizedUsers();
    $('#rooms-title').textContent = 'Salas, usuarios y reportes';
  } else {
    // Los demás usuarios autorizados conservan acceso completo al concentrado.
    renderReportRoomOptions();
    $('#rooms-title').textContent = 'Reporte de reservaciones';
  }

  toggleReportPeriodFields();
  $('#rooms-dialog').showModal();
};

$('#room-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;

  try {
    changed(
      await repository.saveRoom(null, form.elements.name.value, form.elements.short.value),
      'Sala agregada.'
    );
    form.reset();
    renderRooms();
    $('#room-error').textContent = '';
  } catch (error) {
    $('#room-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$('#rooms-list').onsubmit = async event => {
  event.preventDefault();
  const form = event.target;

  try {
    changed(
      await repository.saveRoom(form.dataset.id, form.elements.name.value, form.elements.short.value),
      'Sala actualizada.'
    );
    renderRooms();
    $('#room-error').textContent = '';
  } catch (error) {
    $('#room-error').textContent = error.message;
  }
};

$('#rooms-list').onclick = event => {
  const button = event.target.closest('[data-remove-room]');
  if (!button) return;

  const id = button.dataset.removeRoom;
  const count = state.bookings.filter(b => b.roomId === id).length;

  confirmDelete(
    '¿Eliminar esta sala?',
    `${roomName(id)}. También se eliminarán todas sus reservaciones${count ? ` (${count} actualmente)` : ''}.`,
    async () => {
      changed(await repository.deleteRoom(id), 'Sala eliminada.');
      renderRooms();
    }
  );
};

$('#report-period-type').onchange = toggleReportPeriodFields;
$('#report-month').onchange = updateReportPreview;
$('#report-year').oninput = updateReportPreview;
$('#report-from').onchange = updateReportPreview;
$('#report-to').onchange = updateReportPreview;
$('#report-all-rooms').onchange = syncReportRoomInputs;

$('#report-room-options').onchange = event => {
  if (event.target.matches('input[name="reportRoom"]')) updateReportPreview();
};

$('#report-form').onsubmit = event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  $('#report-error').textContent = '';

  try {
    exportReport();
  } catch (error) {
    $('#report-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

async function renderAuthorizedUsers() {
  if (!authService.isOwner(currentUser)) return;
  const users = await repository.listAuthorizedUsers();
  $('#users-list').innerHTML = users.map(user => `
    <div class="user-row">
      <div>
        <strong>${escape(user.name || user.email)}</strong>
        <span>${escape(user.email)}</span>
      </div>
      ${user.email === OWNER_EMAIL
        ? '<span class="owner-badge">Administrador</span>'
        : `<button type="button" class="danger" data-remove-user="${escape(user.email)}">Eliminar</button>`}
    </div>
  `).join('');
}

$('#user-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  $('#user-error').textContent = '';
  try {
    await repository.saveAuthorizedUser(form.elements.name.value, form.elements.email.value);
    form.reset();
    await renderAuthorizedUsers();
    notice('Usuario autorizado agregado.');
  } catch (error) {
    $('#user-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$('#users-list').onclick = event => {
  const button = event.target.closest('[data-remove-user]');
  if (!button) return;
  const email = button.dataset.removeUser;
  confirmDelete(
    '¿Retirar acceso?',
    `La cuenta ${email} dejará de poder consultar y modificar la agenda.`,
    async () => {
      await repository.deleteAuthorizedUser(email);
      await renderAuthorizedUsers();
      notice('Acceso retirado.');
    }
  );
};

function showAuth(message, denied = false) {
  document.body.classList.add('auth-pending');
  $('#auth-screen').hidden = false;
  $('#auth-message').textContent = message;
  $('#sign-in').hidden = denied;
  $('#auth-sign-out').hidden = !denied;
}

function showApp(user) {
  currentUser = user;
  document.body.classList.remove('auth-pending');
  $('#auth-screen').hidden = true;
  $('#user-chip').textContent = authService.username(user);

  // El administrador ve "Administración"; el resto ve directamente "Reportes".
  $('#manage').textContent = authService.isOwner(user)
    ? 'Administración'
    : 'Reportes';
}

function startRealtime() {
  unsubscribeRealtime?.();
  $('#sync-status').textContent = '● Sincronizando';
  $('#sync-status').classList.remove('online');
  unsubscribeRealtime = repository.subscribe(nextState => {
    state = nextState;
    render();
    if ($('#rooms-dialog').open) {
      if (authService.isOwner(currentUser)) {
        renderRooms();
      } else {
        renderReportRoomOptions();
      }
    }
    $('#sync-status').textContent = '● En tiempo real';
    $('#sync-status').classList.add('online');
  }, error => {
    $('#sync-status').textContent = '● Sin conexión';
    $('#sync-status').classList.remove('online');
    notice(error.message || 'No se pudo sincronizar con Firebase.');
  });
}

$('#sign-in').onclick = async () => {
  const button = $('#sign-in');
  button.disabled = true;
  $('#auth-message').textContent = 'Abriendo inicio de sesión de Google…';

  try {
    await authService.signIn();
  } catch (error) {
    const code = String(error?.code || '');

    const friendly = {
      'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio y vuelve a intentarlo.',
      'auth/popup-closed-by-user': 'La ventana de Google se cerró antes de terminar. Vuelve a intentarlo.',
      'auth/cancelled-popup-request': 'Ya existe una ventana de inicio de sesión abierta.',
      'auth/network-request-failed': 'No se pudo conectar con Google/Firebase. Revisa la conexión y vuelve a intentarlo.',
      'auth/unauthorized-domain': 'Este dominio todavía no está autorizado en Firebase Authentication.'
    };

    $('#auth-message').textContent =
      friendly[code]
      || error?.message
      || 'No se pudo iniciar sesión.';
  } finally {
    button.disabled = false;
  }
};

$('#sign-out').onclick = () => authService.signOut();
$('#auth-sign-out').onclick = () => authService.signOut();

setInterval(() => {
  if (currentUser && !dragState) render();
}, 60000);

$('#new').disabled = true;
showAuth('Comprobando sesión…');

authService.onChange(async user => {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  currentUser = null;

  if (!user) {
    showAuth('Inicia sesión con una cuenta autorizada para consultar y modificar la agenda compartida.');
    return;
  }

  try {
    if (authService.isOwner(user)) await repository.bootstrapOwner(user.email);
    const authorized = await repository.isAuthorized(user.email);
    if (!authorized) {
      showAuth(`La cuenta ${user.email} no está autorizada para esta agenda.`, true);
      return;
    }

    showApp(user);
    startRealtime();
  } catch (error) {
    showAuth(error.message || 'No se pudo validar el acceso.', true);
  }
});