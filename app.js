import { APP_SCHEMA_VERSION, DEFAULT_SETTINGS, normalizeSettings, minutes, timeLabel, dateKey, parseDate, monday, addDays } from './core.js?v=7.0';
import { repository } from './storage.js?v=7.0';
import { authService, OWNER_EMAIL } from './firebase.js?v=4.1';

// Densidad visual del calendario: cada bloque representa 30 minutos.
const APP_VERSION = '7.0';
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

const PASTEL_PALETTES = {
  lavender: {
    label: 'Morado',
    bg: 'rgba(220, 209, 247, .68)',
    hover: 'rgba(211, 196, 243, .82)',
    border: '#9a80c7',
    accent: '#7b5eae',
    ink: '#34244f'
  },
  mint: {
    label: 'Menta',
    bg: 'rgba(205, 239, 229, .68)',
    hover: 'rgba(190, 232, 220, .82)',
    border: '#69a895',
    accent: '#448d79',
    ink: '#1f5044'
  },
  sky: {
    label: 'Azul',
    bg: 'rgba(210, 229, 249, .68)',
    hover: 'rgba(196, 218, 244, .82)',
    border: '#729dc9',
    accent: '#4d7fb2',
    ink: '#233f61'
  },
  rose: {
    label: 'Rosa',
    bg: 'rgba(246, 216, 229, .68)',
    hover: 'rgba(239, 202, 219, .82)',
    border: '#c07c99',
    accent: '#a85b7b',
    ink: '#5d2f44'
  },
  peach: {
    label: 'Durazno',
    bg: 'rgba(249, 222, 202, .68)',
    hover: 'rgba(244, 209, 184, .82)',
    border: '#c98d68',
    accent: '#ad6f49',
    ink: '#5a3622'
  },
  butter: {
    label: 'Amarillo',
    bg: 'rgba(249, 237, 187, .70)',
    hover: 'rgba(245, 229, 163, .84)',
    border: '#c6a84e',
    accent: '#a6872c',
    ink: '#55430f'
  },
  aqua: {
    label: 'Agua',
    bg: 'rgba(204, 237, 241, .68)',
    hover: 'rgba(188, 229, 234, .82)',
    border: '#68a8b1',
    accent: '#468c96',
    ink: '#204d54'
  },
  sage: {
    label: 'Salvia',
    bg: 'rgba(222, 235, 208, .70)',
    hover: 'rgba(211, 228, 195, .84)',
    border: '#8ea56f',
    accent: '#718b51',
    ink: '#384a27'
  }
};

const USER_DEFAULT_COLORS = {
  'ivan.gutierrez@uteq.edu.mx': 'lavender',
  'monica.arellano@uteq.edu.mx': 'mint',
  'jorge.cervantes@uteq.edu.mx': 'sky',
  'aurora.osornio@uteq.edu.mx': 'rose',
  'karina.garcia@uteq.edu.mx': 'peach'
};

function defaultColorKey(email) {
  email = String(email || '').trim().toLowerCase();
  if (USER_DEFAULT_COLORS[email]) return USER_DEFAULT_COLORS[email];

  const keys = Object.keys(PASTEL_PALETTES);
  let hash = 0;
  for (const char of email) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return keys[Math.abs(hash) % keys.length];
}

function paletteForKey(key, fallbackEmail = '') {
  const resolved = PASTEL_PALETTES[key]
    ? key
    : defaultColorKey(fallbackEmail);

  return {
    key: resolved,
    ...PASTEL_PALETTES[resolved]
  };
}

function renderBookingColorPalette(selectedKey) {
  const palette = $('#booking-color-palette');
  const hidden = $('#booking-color-key');
  const label = $('#selected-color-name');
  if (!palette || !hidden) return;

  const selected = paletteForKey(selectedKey, currentUser?.email);
  hidden.value = selected.key;
  if (label) label.textContent = selected.label;

  palette.innerHTML = Object.entries(PASTEL_PALETTES).map(([key, item]) => `
    <button
      type="button"
      class="color-swatch"
      data-color-key="${escape(key)}"
      role="radio"
      aria-checked="${key === selected.key}"
      aria-label="${escape(item.label)}"
      title="${escape(item.label)}"
      style="--swatch-bg:${item.bg};--swatch-border:${item.border};--swatch-ink:${item.ink}">
      <span></span>
      <small>${escape(item.label)}</small>
    </button>
  `).join('');
}

function selectBookingColor(key) {
  const selected = paletteForKey(key, currentUser?.email);
  $('#booking-color-key').value = selected.key;
  $('#selected-color-name').textContent = selected.label;

  for (const button of $$('#booking-color-palette [data-color-key]')) {
    button.setAttribute('aria-checked', String(button.dataset.colorKey === selected.key));
  }
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
  const palette = paletteForKey(booking?.colorKey, actor.createdEmail || actor.updatedEmail);
  const creatorPalette = paletteForKey(defaultColorKey(actor.createdEmail), actor.createdEmail);

  return [
    `--booking-bg:${palette.bg}`,
    `--booking-hover:${palette.hover}`,
    `--booking-border:${palette.border}`,
    `--booking-accent:${palette.accent}`,
    `--booking-ink:${palette.ink}`,
    `--creator-accent:${creatorPalette.accent}`
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

function roomPlantClass(room) {
  const text = `${room?.id || ''} ${room?.name || ''} ${defaultRoomShort(room)}`
    .toLocaleLowerCase('es-MX');

  if (text.includes('planta alta') || text.includes('alta-f') || /\bpa\b/.test(text)) {
    return 'plant-high';
  }

  if (text.includes('planta baja') || text.includes('baja-f') || /\bpb\b/.test(text)) {
    return 'plant-low';
  }

  return 'plant-neutral';
}


let state = {
  rooms: [],
  bookings: [],
  blocks: [],
  settings: normalizeSettings(DEFAULT_SETTINGS)
};

let week = monday(new Date());
let selectedDay = 0;
let selectedRoom = 'all';
let currentBooking = null;
let confirmAction = null;
let noticeTimer = null;
let currentUser = null;
let unsubscribeRealtime = null;
let dragState = null;
let bookingDragState = null;
let suppressBookingClick = false;
let quickView = 'week';
let isOnline = navigator.onLine;
let activeAdminTab = 'summary';
let adminBookings = [];
let adminRooms = [];
let adminUsers = [];
let currentAdminBooking = null;
let initialCalendarScrollDone = false;

const DAY_LABELS = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb'
};

function notice(message) {
  $('#notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $('#notice').textContent = '';
  }, 6500);
}

function roomById(id) {
  return state.rooms.find(room => room.id === id);
}

function roomName(id) {
  return roomById(id)?.name || 'Sala';
}

function roomShort(id) {
  const room = roomById(id);
  return room ? defaultRoomShort(room) : 'SALA';
}

function activeRooms() {
  return state.rooms.filter(room => room.active !== false);
}

function reservableRooms() {
  return activeRooms().filter(room =>
    room.status !== 'maintenance' &&
    room.status !== 'out_of_service'
  );
}

function settings() {
  return normalizeSettings(state.settings || DEFAULT_SETTINGS);
}

function enabledDates() {
  const enabled = settings().enabledDays;
  return Array.from({ length: 6 }, (_, i) => addDays(week, i))
    .filter(date => enabled.includes(date.getDay()));
}

function dayIndexForDate(targetDate) {
  const key = dateKey(targetDate);
  const index = enabledDates().findIndex(date => dateKey(date) === key);
  return index >= 0 ? index : 0;
}

function goToDate(targetDate, view = 'week') {
  const parsed = targetDate instanceof Date ? targetDate : parseDate(String(targetDate || ''));
  if (Number.isNaN(parsed.getTime())) return;

  week = monday(parsed);
  quickView = view;
  selectedDay = dayIndexForDate(parsed);
  refreshVisibleRange();
}

function ensureSelectOption(select, value) {
  value = String(value || '');
  if (!select || !value || select.querySelector(`option[value="${value}"]`)) return;

  const option = document.createElement('option');
  option.value = value;
  option.textContent = `${value} · horario existente`;
  select.appendChild(option);

  const options = Array.from(select.options).sort((a, b) => minutes(a.value) - minutes(b.value));
  select.replaceChildren(...options);
}

function visibleRange() {
  const days = enabledDates();
  const from = dateKey(days[0] || week);
  const to = dateKey(days[days.length - 1] || addDays(week, 5));
  return { from, to };
}

function dayStartMinutes() {
  return minutes(settings().startTime);
}

function dayEndMinutes() {
  return minutes(settings().endTime);
}

function slotMinutesValue() {
  return Number(settings().blockMinutes) || 30;
}

function slotCount() {
  return Math.max(
    1,
    Math.round((dayEndMinutes() - dayStartMinutes()) / slotMinutesValue())
  );
}

function hourHeight() {
  return SLOT_HEIGHT * (60 / slotMinutesValue());
}

function bookingStatus(booking) {
  return booking?.status === 'cancelled' ? 'cancelled' : 'active';
}

function conflictFor(roomId, date, start, end, excludeBookingId = '') {
  const startM = minutes(start);
  const endM = minutes(end);

  const booking = state.bookings.find(item =>
    bookingStatus(item) === 'active' &&
    item.id !== excludeBookingId &&
    item.roomId === roomId &&
    item.date === date &&
    startM < minutes(item.end) &&
    endM > minutes(item.start)
  );

  if (booking) {
    return {
      type: 'booking',
      label: booking.teacher,
      start: booking.start,
      end: booking.end,
      item: booking
    };
  }

  const block = state.blocks.find(item =>
    item.active !== false &&
    item.roomId === roomId &&
    item.date === date &&
    startM < minutes(item.end) &&
    endM > minutes(item.start)
  );

  if (block) {
    return {
      type: 'block',
      label: block.reason || 'Mantenimiento',
      start: block.start,
      end: block.end,
      item: block
    };
  }

  return null;
}

function updateAvailabilityStatus(roomId, date, start, end, excludeBookingId = '') {
  const status = $('#availability-status');
  const calendar = $('#calendar');
  if (!status || !roomId || !date || !start || !end) return null;

  const room = roomById(roomId);

  if (!room || room.active === false ||
      room.status === 'maintenance' ||
      room.status === 'out_of_service') {
    status.className = 'availability-status busy';
    status.textContent = 'Sala no disponible para nuevas reservaciones.';
    calendar.classList.add('selection-busy');
    calendar.classList.remove('selection-free');
    return { type: 'room', label: 'Sala no disponible' };
  }

  const conflict = conflictFor(roomId, date, start, end, excludeBookingId);

  calendar.classList.toggle('selection-busy', Boolean(conflict));
  calendar.classList.toggle('selection-free', !conflict);

  if (conflict) {
    status.className = 'availability-status busy';
    status.textContent = conflict.type === 'block'
      ? `Bloqueado: ${conflict.label} · ${conflict.start}–${conflict.end}`
      : `Ocupado: ${conflict.label} · ${conflict.start}–${conflict.end}`;
  } else {
    status.className = 'availability-status available';
    status.textContent = `Disponible · ${roomShort(roomId)} · ${start}–${end}`;
  }

  return conflict;
}

function updateQuickFilterButtons() {
  for (const button of $$('#quick-filters [data-view]')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.view === quickView)
    );
  }
}

function setOnlineState(value, message = '') {
  isOnline = Boolean(value);
  const sync = $('#sync-status');

  if (!isOnline) {
    sync.textContent = '● Sin conexión · modo consulta';
    sync.classList.remove('online');
    if ($('#last-sync') && !$('#last-sync').textContent.startsWith('Últimos')) {
      $('#last-sync').textContent = `Últimos datos · ${$('#last-sync').textContent.replace(/^Actualizado\s*/, '') || 'sin confirmar'}`;
    }
  } else if (message) {
    sync.textContent = message;
  }

  updateMutationAvailability();
}

function updateMutationAvailability() {
  const mutationDisabled = !isOnline;

  for (const element of $$('[data-mutation]')) {
    element.disabled = mutationDisabled;
    element.title = mutationDisabled
      ? 'Sin conexión: las modificaciones están temporalmente deshabilitadas.'
      : '';
  }

  $('#new').disabled = mutationDisabled || !reservableRooms().length;
}

function ensureOnline() {
  if (!isOnline) {
    throw new Error('Sin conexión: espera a recuperar Internet antes de modificar la agenda.');
  }
}

function renderWeekdayGrid() {
  const enabled = settings().enabledDays;
  $('#weekday-grid').innerHTML = enabled.map(day => `
    <label>
      <input type="checkbox" name="repeatWeekdays" value="${day}">
      ${DAY_LABELS[day] || day}
    </label>
  `).join('');
}

function renderTimeOptions(form) {
  const startM = dayStartMinutes();
  const endM = dayEndMinutes();
  const step = slotMinutesValue();

  for (const field of ['start', 'end']) {
    const options = [];
    for (
      let value = startM + (field === 'end' ? step : 0);
      value <= endM;
      value += step
    ) {
      options.push(`<option value="${timeLabel(value)}">${timeLabel(value)}</option>`);
    }
    form.elements[field].innerHTML = options.join('');
  }
}

function render() {
  const roomsAll = activeRooms();
  const roomsAvailable = reservableRooms();
  const days = enabledDates();

  if (selectedRoom !== 'all' &&
      !roomsAll.some(room => room.id === selectedRoom)) {
    selectedRoom = 'all';
  }

  $('#new').disabled = !isOnline || !roomsAvailable.length;

  $('#room-tabs').innerHTML = [
    `<button data-room="all" aria-pressed="${selectedRoom === 'all'}">Todas las salas</button>`,
    ...roomsAll.map(room => `
      <button
        data-room="${escape(room.id)}"
        aria-pressed="${selectedRoom === room.id}">
        ${escape(room.name)}
      </button>
    `)
  ].join('');

  updateQuickFilterButtons();

  const first = days[0] || week;
  const last = days[days.length - 1] || addDays(week, 5);
  const now = new Date();
  const todayKey = dateKey(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  $('#period').textContent =
    first.getMonth() === last.getMonth()
      ? `${first.getDate()}–${last.getDate()} de ${last.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`
      : `${first.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  $('#schedule-label').textContent =
    `${days.map(day => DAY_LABELS[day.getDay()]).join(', ')} · ${settings().startTime}–${settings().endTime}`;

  if ($('#jump-date')) {
    $('#jump-date').value = dateKey(days[selectedDay] || first);
  }

  if ($('#app-version')) {
    $('#app-version').textContent = `v${APP_VERSION} · esquema ${APP_SCHEMA_VERSION}`;
  }

  let visibleBookings = state.bookings.filter(booking =>
    bookingStatus(booking) === 'active' &&
    (selectedRoom === 'all' || booking.roomId === selectedRoom)
  );

  if (quickView === 'mine') {
    const email = String(currentUser?.email || '').toLowerCase();
    visibleBookings = visibleBookings.filter(booking =>
      String(booking.createdByEmail || '').toLowerCase() === email
    );
  }

  if (quickView === 'today') {
    visibleBookings = visibleBookings.filter(booking =>
      booking.date === todayKey
    );
  }

  const summaryLabel = quickView === 'today'
    ? 'hoy'
    : quickView === 'mine'
      ? 'tuyas en el periodo visible'
      : 'en el periodo visible';

  $('#summary').textContent =
    `${visibleBookings.length} ${visibleBookings.length === 1 ? 'reservación' : 'reservaciones'} ${summaryLabel}`;

  selectedDay = Math.max(0, Math.min(selectedDay, Math.max(days.length - 1, 0)));

  $('#day-picker').innerHTML = days.map((date, index) => `
    <button
      data-day="${index}"
      aria-pressed="${selectedDay === index}"
      aria-label="${escape(fullDate(date))}">
      ${escape(date.toLocaleDateString('es-MX', { weekday: 'short' }))}
      <strong>${date.getDate()}</strong>
    </button>
  `).join('');

  const calendar = $('#calendar');
  const scrollTop = calendar.scrollTop;
  calendar.classList.toggle('all-rooms', selectedRoom === 'all');
  calendar.classList.toggle('single-day', quickView === 'today');

  if (!roomsAll.length || !days.length) {
    calendar.innerHTML = '<div class="empty">No hay salas o días habilitados para mostrar.</div>';
    return;
  }

  const rooms = selectedRoom === 'all'
    ? roomsAll
    : roomsAll.filter(room => room.id === selectedRoom);

  const roomHeaders = rooms.map(room => `
    <span class="${roomPlantClass(room)}" title="${escape(room.name)}">
      ${escape(defaultRoomShort(room))}
    </span>
  `).join('');

  const mobileWidth = Math.max(rooms.length * 125, 280);
  const startM = dayStartMinutes();
  const endM = dayEndMinutes();
  const step = slotMinutesValue();
  const slots = slotCount();
  const hourLabels = Math.floor((endM - startM) / 60) + 1;

  calendar.innerHTML = `
    <div
      class="week"
      style="--room-count:${rooms.length};--day-mobile-width:${mobileWidth}px;--slot-count:${slots}">
      <div class="time-head">HORA</div>

      ${days.map((date, index) => {
        const key = dateKey(date);
        const current = key === todayKey;
        const saturday = date.getDay() === 6;

        return `
          <div
            class="day-head ${index === selectedDay ? 'selected' : ''} ${current ? 'current' : ''} ${saturday ? 'saturday' : ''}"
            style="--room-count:${rooms.length}">
            <div class="day-title">
              ${escape(date.toLocaleDateString('es-MX', { weekday: 'short' }))}
              <strong>${date.getDate()}</strong>
            </div>
            <div class="room-heads" aria-label="Salas para ${escape(fullDate(date))}">
              ${roomHeaders}
            </div>
          </div>
        `;
      }).join('')}

      <div class="time-axis">
        ${Array.from({ length: hourLabels }, (_, index) => `
          <span
            class="time-label"
            style="top:${index * hourHeight()}px">
            ${timeLabel(startM + index * 60)}
          </span>
        `).join('')}
      </div>

      ${days.map((date, index) => {
        const key = dateKey(date);
        const isToday = key === todayKey;
        const isSaturday = date.getDay() === 6;
        const nowLineVisible =
          isToday &&
          currentMinutes >= startM &&
          currentMinutes <= endM;

        const nowLineTop =
          ((currentMinutes - startM) / step) * SLOT_HEIGHT;

        return `
          <div
            class="day-column ${index === selectedDay ? 'selected' : ''} ${isToday ? 'current-day' : ''} ${isSaturday ? 'saturday' : ''}">

            ${rooms.map(room => {
              const roomUnavailable =
                room.status === 'maintenance' ||
                room.status === 'out_of_service';

              return `
                <div
                  class="lane ${roomPlantClass(room)} ${roomUnavailable ? 'room-unavailable' : ''}"
                  data-room="${escape(room.id)}"
                  data-date="${key}"
                  aria-label="${escape(room.name)} · ${escape(fullDate(date))}">

                  ${Array.from({ length: slots }, (_, n) => `
                    <button
                      class="slot"
                      ${roomUnavailable ? 'disabled' : ''}
                      data-date="${key}"
                      data-room="${escape(room.id)}"
                      data-start="${timeLabel(startM + n * step)}"
                      aria-label="Reservar ${escape(room.name)}, ${escape(fullDate(date))}, ${timeLabel(startM + n * step)}">
                    </button>
                  `).join('')}

                  ${state.blocks
                    .filter(block =>
                      block.active !== false &&
                      block.date === key &&
                      block.roomId === room.id
                    )
                    .map(block => `
                      <button
                        type="button"
                        class="room-block"
                        style="
                          top:${((minutes(block.start) - startM) / step) * SLOT_HEIGHT + 2}px;
                          height:${Math.max(((minutes(block.end) - minutes(block.start)) / step) * SLOT_HEIGHT - 4, 24)}px">
                        <span>${escape(block.start)}–${escape(block.end)}</span>
                        <strong>MANTENIMIENTO</strong>
                        <small>${escape(block.reason || 'Bloqueo administrativo')}</small>
                      </button>
                    `).join('')}

                  ${visibleBookings
                    .filter(booking =>
                      booking.date === key &&
                      booking.roomId === room.id
                    )
                    .map(booking => {
                      const duration = minutes(booking.end) - minutes(booking.start);
                      const audit = duration >= 60
                        ? bookingAuditHtml(booking)
                        : '';

                      return `
                        <button
                          class="booking ${duration <= step ? 'compact-booking' : ''}"
                          style="
                            top:${((minutes(booking.start) - startM) / step) * SLOT_HEIGHT + 2}px;
                            height:${Math.max((duration / step) * SLOT_HEIGHT - 4, 24)}px;
                            ${bookingColorStyle(booking)}"
                          data-booking="${escape(booking.id)}"
                          aria-label="${escape(`${booking.teacher}, ${booking.group}, ${booking.activity}, ${booking.start} a ${booking.end}, ${room.name}`)}"
                          title="${escape(`${room.name}\n${booking.teacher} · ${booking.group}\n${booking.activity}\n${booking.start}–${booking.end}`)}">
                          <span class="time">${escape(booking.start)}–${escape(booking.end)}</span>
                          <strong>${escape(booking.teacher)}</strong>
                          <span class="booking-meta">
                            <b>${escape(booking.group)}</b>${booking.activity ? ` · ${escape(booking.activity)}` : ''}
                          </span>
                          ${audit}
                        </button>
                      `;
                    }).join('')}
                </div>
              `;
            }).join('')}

            ${nowLineVisible ? `
              <div
                class="now-line"
                style="top:${nowLineTop}px"
                aria-hidden="true">
                <span>${timeLabel(currentMinutes)}</span>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (!initialCalendarScrollDone && days.some(date => dateKey(date) === todayKey)) {
    const currentTop = ((currentMinutes - startM) / step) * SLOT_HEIGHT;
    if (currentMinutes >= startM && currentMinutes <= endM) {
      calendar.scrollTop = Math.max(0, currentTop - 150);
    } else {
      calendar.scrollTop = scrollTop;
    }
    initialCalendarScrollDone = true;
  } else {
    calendar.scrollTop = scrollTop;
  }

  updateMutationAvailability();
}

function setDefaultRepeatUntil(dateValue) {
  const input = $('#booking-form').elements.repeatUntil;
  if (!dateValue) return;

  const suggestedDays = Math.min(28, settings().repeatLimitDays);
  const suggested = dateKey(addDays(parseDate(dateValue), suggestedDays));

  if (!input.value || input.value < dateValue) {
    input.value = suggested;
  }

  input.min = dateValue;
  input.max = dateKey(addDays(parseDate(dateValue), settings().repeatLimitDays));
}

function ensureRepeatWeekday() {
  const form = $('#booking-form');
  const checked = Array.from(
    form.querySelectorAll('[name="repeatWeekdays"]:checked')
  );

  if (checked.length || !form.elements.date.value) return;

  const day = parseDate(form.elements.date.value).getDay();
  const input = form.querySelector(
    `[name="repeatWeekdays"][value="${day}"]`
  );

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

  const available = reservableRooms();
  let optionsRooms = available;

  if (values.roomId && !available.some(room => room.id === values.roomId)) {
    const existingRoom = roomById(values.roomId);
    if (existingRoom) optionsRooms = [existingRoom, ...available];
  }

  form.elements.roomId.innerHTML = optionsRooms.map(room => `
    <option value="${escape(room.id)}">
      ${escape(room.name)} (${escape(defaultRoomShort(room))})
    </option>
  `).join('');

  renderTimeOptions(form);
  renderWeekdayGrid();

  const days = enabledDates();
  const defaultDate = dateKey(days[selectedDay] || days[0] || new Date());
  const defaultStart = settings().startTime;
  const defaultEnd = timeLabel(
    Math.min(
      dayEndMinutes(),
      minutes(defaultStart) + Math.max(60, slotMinutesValue())
    )
  );

  const defaults = {
    id: '',
    roomId: selectedRoom === 'all'
      ? available[0]?.id
      : selectedRoom,
    date: defaultDate,
    start: defaultStart,
    end: defaultEnd,
    teacher: '',
    group: '',
    activity: '',
    colorKey: defaultColorKey(currentUser?.email)
  };

  const merged = {
    ...defaults,
    ...values,
    colorKey:
      values.colorKey ||
      defaultColorKey(values.createdByEmail || currentUser?.email)
  };

  // Retrocompatibilidad: si la configuración futura cambia el tamaño del bloque,
  // una reservación antigua de :30 debe seguir siendo editable sin alterar su hora.
  ensureSelectOption(form.elements.start, merged.start);
  ensureSelectOption(form.elements.end, merged.end);

  for (const [key, value] of Object.entries(merged)) {
    if (form.elements[key]) {
      form.elements[key].value = value ?? '';
    }
  }

  renderBookingColorPalette(merged.colorKey);

  const editing = Boolean(values.id);
  $('#booking-title').textContent =
    editing ? 'Editar reservación' : 'Nueva reservación';

  $('#repeat-section').hidden = editing;
  form.elements.repeatEnabled.checked = false;
  $('#repeat-options').hidden = true;

  for (const checkbox of form.querySelectorAll('[name="repeatWeekdays"]')) {
    checkbox.checked = false;
  }

  if (!editing) setDefaultRepeatUntil(merged.date);

  $('#booking-dialog').showModal();
}

function showBookingDetails(booking) {
  if (!booking) return;

  currentBooking = booking;
  const status = bookingStatus(booking);

  $('#detail-title').textContent =
    `${roomShort(booking.roomId)} · ${roomName(booking.roomId)}`;

  $('#details').innerHTML = [
    ['Maestro', booking.teacher],
    ['Grupo', booking.group],
    ['Actividad', booking.activity],
    ['Fecha', fullDate(parseDate(booking.date))],
    ['Horario', `${booking.start}–${booking.end}`],
    ['Estado', status === 'cancelled' ? 'Cancelada' : 'Activa'],
    [
      'Apartado por',
      booking.createdByLabel ||
      (booking.createdByEmail
        ? booking.createdByEmail.split('@')[0]
        : '—')
    ],
    [
      'Última edición por',
      booking.updatedByLabel ||
      (booking.updatedByEmail
        ? booking.updatedByEmail.split('@')[0]
        : (
          booking.createdByLabel ||
          (booking.createdByEmail
            ? booking.createdByEmail.split('@')[0]
            : '—')
        ))
    ]
  ].map(([label, value]) => `
    <div class="detail-row">
      <span>${escape(label)}</span>
      <strong>${escape(value)}</strong>
    </div>
  `).join('');

  const cancelled = status === 'cancelled';
  $('#cancel-booking').hidden = cancelled;
  $('#cancel-series').hidden = cancelled || !booking.seriesId;
  $('#restore-booking').hidden =
    !cancelled || !authService.isOwner(currentUser);

  $('#edit-booking').hidden = cancelled;
  $('#duplicate-booking').hidden = false;

  $('#detail-dialog').showModal();
}

function details(id) {
  const booking = state.bookings.find(item => item.id === id);
  if (booking) showBookingDetails(booking);
}

function confirmActionDialog(title, description, action, label = 'Confirmar') {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = description;
  $('#confirm-error').textContent = '';
  $('#confirm-action').textContent = label;
  confirmAction = action;
  $('#confirm-dialog').showModal();
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
    activity: String(data.get('activity') || '').trim(),
    colorKey: String(
      data.get('colorKey') ||
      defaultColorKey(currentUser?.email)
    ).trim()
  };

  if (booking.id || !form.elements.repeatEnabled.checked) {
    return [booking];
  }

  const until = String(data.get('repeatUntil') || '');
  const weekdays = new Set(
    data.getAll('repeatWeekdays').map(Number)
  );

  if (!until) {
    throw new Error('Selecciona la fecha hasta la cual se repetirá la reservación.');
  }

  if (until < booking.date) {
    throw new Error('La fecha final de repetición no puede ser anterior a la fecha principal.');
  }

  const maxDate = dateKey(
    addDays(parseDate(booking.date), settings().repeatLimitDays)
  );

  if (until > maxDate) {
    throw new Error(`El periodo de repetición excede el límite configurado de ${settings().repeatLimitDays} días.`);
  }

  if (!weekdays.size) {
    throw new Error('Selecciona al menos un día de repetición.');
  }

  const bookings = [{ ...booking }];
  let cursor = addDays(parseDate(booking.date), 1);

  while (dateKey(cursor) <= until) {
    if (weekdays.has(cursor.getDay())) {
      bookings.push({
        ...booking,
        id: '',
        date: dateKey(cursor)
      });
    }
    cursor = addDays(cursor, 1);
  }

  return bookings;
}

function setupReportDefaults() {
  const now = new Date();
  const month =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const first = `${month}-01`;
  const last = dateKey(
    new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      12
    )
  );

  if (!$('#report-month').value) $('#report-month').value = month;
  if (!$('#report-year').value) {
    $('#report-year').value = String(now.getFullYear());
  }
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

function reportRange() {
  const type = $('#report-period-type').value;

  if (type === 'monthly') {
    const month = $('#report-month').value;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('Selecciona el mes del reporte.');
    }

    const [year, monthNumber] = month.split('-').map(Number);

    return {
      from: `${month}-01`,
      to: dateKey(new Date(year, monthNumber, 0, 12)),
      label: new Date(
        year,
        monthNumber - 1,
        1,
        12
      ).toLocaleDateString(
        'es-MX',
        { month: 'long', year: 'numeric' }
      ),
      file: month
    };
  }

  if (type === 'annual') {
    const year = Number($('#report-year').value);

    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error('Escribe un año válido.');
    }

    return {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `Año ${year}`,
      file: String(year)
    };
  }

  const from = $('#report-from').value;
  const to = $('#report-to').value;

  if (!from || !to) {
    throw new Error('Selecciona las fechas inicial y final del reporte.');
  }

  if (to < from) {
    throw new Error('La fecha final del reporte no puede ser anterior a la fecha inicial.');
  }

  return {
    from,
    to,
    label: `${from} a ${to}`,
    file: `${from}_a_${to}`
  };
}

function renderReportRoomOptions() {
  const all = $('#report-all-rooms');
  all.checked = true;

  $('#report-room-options').innerHTML = state.rooms.map(room => `
    <label class="disabled">
      <input
        type="checkbox"
        name="reportRoom"
        value="${escape(room.id)}"
        checked
        disabled>
      <span>
        <strong>${escape(defaultRoomShort(room))}</strong>
        · ${escape(room.name)}
      </span>
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

function selectedReportRoomIds() {
  if ($('#report-all-rooms').checked) {
    return state.rooms.map(room => room.id);
  }

  const ids = $$('#report-room-options input[name="reportRoom"]:checked')
    .map(input => input.value);

  if (!ids.length) {
    throw new Error('Selecciona al menos una sala para el reporte.');
  }

  return ids;
}

function updateReportPreview() {
  const preview = $('#report-preview');
  if (!preview) return;

  try {
    const range = reportRange();
    const roomIds = selectedReportRoomIds();

    preview.textContent =
      `${roomIds.length} ${roomIds.length === 1 ? 'sala' : 'salas'} · ${range.label}`;
    $('#report-error').textContent = '';
  } catch {
    preview.textContent = '';
  }
}

function excelRows(bookings) {
  return bookings.map(booking => {
    const room =
      state.rooms.find(item => item.id === booking.roomId) ||
      { name: 'Sala archivada o eliminada', short: '—' };

    const day = parseDate(booking.date)
      .toLocaleDateString('es-MX', { weekday: 'long' });

    const status = bookingStatus(booking);

    return {
      'Fecha': booking.date,
      'Día': day,
      'Sala': room.name,
      'Abreviatura': defaultRoomShort(room),
      'Hora inicial': booking.start,
      'Hora final': booking.end,
      'Duración (min)': minutes(booking.end) - minutes(booking.start),
      'Maestro': booking.teacher,
      'Grupo': booking.group,
      'Actividad': booking.activity,
      'Registrado por':
        booking.createdByLabel ||
        (booking.createdByEmail
          ? booking.createdByEmail.split('@')[0]
          : ''),
      'Última edición por':
        booking.updatedByLabel ||
        (booking.updatedByEmail
          ? booking.updatedByEmail.split('@')[0]
          : ''),
      'Estado': status === 'cancelled' ? 'Cancelada' : 'Activa',
      'Cancelado por':
        booking.cancelledByLabel ||
        (booking.cancelledByEmail
          ? booking.cancelledByEmail.split('@')[0]
          : ''),
      'Fecha de cancelación':
        booking.cancelledAt?.toDate?.()?.toLocaleString('es-MX') || ''
    };
  });
}

function reportStatistics(bookings, roomIds) {
  const active = bookings.filter(booking =>
    bookingStatus(booking) === 'active'
  );

  const cancelled = bookings.filter(booking =>
    bookingStatus(booking) === 'cancelled'
  );

  const roomStats = new Map();
  const userStats = new Map();
  const hourStats = new Map();

  for (const booking of bookings) {
    const duration =
      (minutes(booking.end) - minutes(booking.start)) / 60;

    const room = roomById(booking.roomId);
    const roomLabel = room
      ? defaultRoomShort(room)
      : booking.roomId;

    const roomEntry =
      roomStats.get(roomLabel) ||
      { reservations: 0, hours: 0 };

    roomEntry.reservations += 1;
    roomEntry.hours += duration;
    roomStats.set(roomLabel, roomEntry);

    const user =
      booking.createdByLabel ||
      booking.createdByEmail ||
      'Sin identificar';

    userStats.set(
      user,
      (userStats.get(user) || 0) + 1
    );

    const hourKey = `${booking.start}–${booking.end}`;
    hourStats.set(
      hourKey,
      (hourStats.get(hourKey) || 0) + 1
    );
  }

  const sortedRooms = [...roomStats.entries()]
    .sort((a, b) => b[1].reservations - a[1].reservations);

  const sortedUsers = [...userStats.entries()]
    .sort((a, b) => b[1] - a[1]);

  const sortedHours = [...hourStats.entries()]
    .sort((a, b) => b[1] - a[1]);

  return {
    total: bookings.length,
    totalHours: bookings.reduce(
      (sum, booking) =>
        sum + (minutes(booking.end) - minutes(booking.start)) / 60,
      0
    ),
    active: active.length,
    cancelled: cancelled.length,
    topRoom: sortedRooms[0]?.[0] || '—',
    roomStats: sortedRooms,
    userStats: sortedUsers,
    hourStats: sortedHours,
    roomIds
  };
}

async function exportReport() {
  const range = reportRange();
  const roomIds = selectedReportRoomIds();
  const roomSet = new Set(roomIds);

  let bookings = await repository.queryBookingsRange(
    range.from,
    range.to
  );

  bookings = bookings.filter(booking =>
    roomSet.has(booking.roomId)
  );

  const rows = excelRows(bookings);
  const statistics = reportStatistics(bookings, roomIds);
  const selectedRooms = roomIds
    .map(id => roomById(id))
    .filter(Boolean);

  const roomDescription =
    roomIds.length === state.rooms.length
      ? 'Todas las salas'
      : selectedRooms.map(defaultRoomShort).join(', ');

  const fileBase =
    `reporte_reservaciones_${range.file}`
      .replace(/[^a-zA-Z0-9_-]/g, '_');

  if (!window.XLSX) {
    throw new Error('No se pudo cargar el generador XLSX.');
  }

  const headers = [
    'Fecha',
    'Día',
    'Sala',
    'Abreviatura',
    'Hora inicial',
    'Hora final',
    'Duración (min)',
    'Maestro',
    'Grupo',
    'Actividad',
    'Registrado por',
    'Última edición por',
    'Estado',
    'Cancelado por',
    'Fecha de cancelación'
  ];

  const dataSheet = rows.length
    ? window.XLSX.utils.json_to_sheet(rows, { header: headers })
    : window.XLSX.utils.aoa_to_sheet([headers]);

  dataSheet['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 34 }, { wch: 13 },
    { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 30 },
    { wch: 16 }, { wch: 44 }, { wch: 22 }, { wch: 22 },
    { wch: 12 }, { wch: 22 }, { wch: 24 }
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

  summarySheet['!cols'] = [
    { wch: 26 },
    { wch: 70 }
  ];

  const statsRows = [
    ['Estadística', 'Valor'],
    ['Total de reservaciones', statistics.total],
    ['Total de horas reservadas', Number(statistics.totalHours.toFixed(1))],
    ['Reservaciones activas', statistics.active],
    ['Reservaciones canceladas', statistics.cancelled],
    ['Sala más utilizada', statistics.topRoom],
    [],
    ['Sala', 'Reservaciones', 'Horas'],
    ...statistics.roomStats.map(([room, value]) => [
      room,
      value.reservations,
      Number(value.hours.toFixed(1))
    ]),
    [],
    ['Usuario', 'Reservaciones'],
    ...statistics.userStats.map(([user, count]) => [
      user,
      count
    ]),
    [],
    ['Horario', 'Reservaciones'],
    ...statistics.hourStats.map(([hour, count]) => [
      hour,
      count
    ])
  ];

  const statsSheet =
    window.XLSX.utils.aoa_to_sheet(statsRows);

  statsSheet['!cols'] = [
    { wch: 34 },
    { wch: 18 },
    { wch: 14 }
  ];

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    'Resumen'
  );
  window.XLSX.utils.book_append_sheet(
    workbook,
    dataSheet,
    'Reservaciones'
  );
  window.XLSX.utils.book_append_sheet(
    workbook,
    statsSheet,
    'Estadísticas'
  );

  window.XLSX.writeFile(
    workbook,
    `${fileBase}.xlsx`,
    { compression: true }
  );

  notice(
    `Reporte descargado: ${bookings.length} ${bookings.length === 1 ? 'reservación' : 'reservaciones'}.`
  );
}

function downloadJson(data, fileName) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json;charset=utf-8' }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function clearBookingDropPreview() {
  document
    .querySelectorAll('.booking-drop-preview')
    .forEach(node => node.remove());

  document
    .querySelectorAll('.lane.booking-drop-target')
    .forEach(node =>
      node.classList.remove('booking-drop-target')
    );

  $('#calendar').classList.remove('booking-moving');
}

function bookingDropTarget(lane, clientY, booking, grabOffsetY = 0) {
  if (!lane || !booking) return null;

  const step = slotMinutesValue();
  const duration = Math.max(step / 2, minutes(booking.end) - minutes(booking.start));
  const rect = lane.getBoundingClientRect();
  const rawTop = clientY - rect.top - grabOffsetY;

  const maxStart = Math.max(dayStartMinutes(), dayEndMinutes() - duration);
  const rawMinutes = dayStartMinutes() + Math.round(rawTop / SLOT_HEIGHT) * step;
  const startMinutes = Math.max(dayStartMinutes(), Math.min(maxStart, rawMinutes));
  const endMinutes = Math.min(dayEndMinutes(), startMinutes + duration);

  return {
    roomId: lane.dataset.room,
    date: lane.dataset.date,
    start: timeLabel(startMinutes),
    end: timeLabel(endMinutes),
    top: ((startMinutes - dayStartMinutes()) / step) * SLOT_HEIGHT + 2,
    height: Math.max((duration / step) * SLOT_HEIGHT - 4, 24)
  };
}

function paintBookingDropPreview(lane, target, booking, conflict) {
  clearBookingDropPreview();
  if (!lane || !target || !booking) return;

  const preview = document.createElement('div');
  preview.className =
    `booking-drop-preview${conflict ? ' conflict' : ''}`;

  preview.style.cssText =
    `top:${target.top}px;` +
    `height:${target.height}px;` +
    bookingColorStyle(booking);

  preview.innerHTML = `
    <span>${escape(target.start)}–${escape(target.end)}</span>
    <strong>${escape(booking.teacher)}</strong>
    <small>${escape(roomShort(target.roomId))} · ${escape(target.date)}</small>
  `;

  lane.classList.add('booking-drop-target');
  lane.appendChild(preview);
  $('#calendar').classList.add('booking-moving');
}

function laneUnderPointer(clientX, clientY, sourceBookingElement) {
  const previous =
    sourceBookingElement?.style.pointerEvents || '';

  if (sourceBookingElement) {
    sourceBookingElement.style.pointerEvents = 'none';
  }

  const element =
    document.elementFromPoint(clientX, clientY);

  const lane =
    element?.closest?.('.lane') || null;

  if (sourceBookingElement) {
    sourceBookingElement.style.pointerEvents = previous;
  }

  return lane;
}

function clearDragSelection() {
  document
    .querySelectorAll('.slot.drag-selected')
    .forEach(slot =>
      slot.classList.remove('drag-selected')
    );

  $('#calendar').classList.remove(
    'dragging',
    'selection-free',
    'selection-busy'
  );
}

function paintDragSelection() {
  clearDragSelection();

  if (!dragState) return;

  $('#calendar').classList.add('dragging');

  const [from, to] = [
    dragState.startIndex,
    dragState.endIndex
  ].sort((a, b) => a - b);

  dragState.slots.forEach((slot, index) => {
    if (index >= from && index <= to) {
      slot.classList.add('drag-selected');
    }
  });
}

function openAdminTab(tab) {
  const owner = authService.isOwner(currentUser);

  if (!owner && tab !== 'report') {
    tab = 'report';
  }

  activeAdminTab = tab;

  for (const button of $$('#admin-tabs [data-admin-tab]')) {
    const allowed =
      owner || button.dataset.adminTab === 'report';

    button.hidden = !allowed;
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.adminTab === tab)
    );
  }

  for (const panel of $$('[data-admin-panel]')) {
    panel.hidden = panel.dataset.adminPanel !== tab;
  }

  if (tab === 'summary') loadAdminSummary();
  if (tab === 'reservations') loadAdminReservations();
  if (tab === 'rooms') loadAdminRooms();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'report') {
    renderReportRoomOptions();
    setupReportDefaults();
    toggleReportPeriodFields();
  }
  if (tab === 'audit') loadAuditLogs();
  if (tab === 'settings') renderSettingsForm();
}

function adminDefaultDates() {
  const now = new Date();
  const first =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const last = dateKey(
    new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      12
    )
  );

  return { first, last };
}

function countEnabledDaysInRange(from, to) {
  const enabled = new Set(settings().enabledDays);
  let cursor = parseDate(from);
  const end = parseDate(to);
  let count = 0;

  while (cursor <= end) {
    if (enabled.has(cursor.getDay())) count += 1;
    cursor = addDays(cursor, 1);
  }

  return count;
}

async function loadAdminSummary() {
  if (!authService.isOwner(currentUser)) return;

  const target = $('#summary-cards');
  target.innerHTML =
    '<div class="admin-loading">Calculando indicadores…</div>';

  try {
    const now = new Date();
    const today = dateKey(now);
    const month = adminDefaultDates();
    const weekStart = dateKey(monday(now));
    const weekEnd = dateKey(addDays(monday(now), 5));

    const [monthBookings, weekBookings] =
      await Promise.all([
        repository.queryBookingsRange(
          month.first,
          month.last
        ),
        repository.queryBookingsRange(
          weekStart,
          weekEnd
        )
      ]);

    const activeMonth =
      monthBookings.filter(booking =>
        bookingStatus(booking) === 'active'
      );

    const activeWeek =
      weekBookings.filter(booking =>
        bookingStatus(booking) === 'active'
      );

    const todayBookings =
      activeMonth.filter(booking =>
        booking.date === today
      );

    const monthHours =
      activeMonth.reduce(
        (sum, booking) =>
          sum +
          (minutes(booking.end) - minutes(booking.start)) / 60,
        0
      );

    target.innerHTML = [
      ['Reservaciones hoy', todayBookings.length],
      ['Esta semana', activeWeek.length],
      ['Este mes', activeMonth.length],
      ['Horas reservadas este mes', monthHours.toFixed(1)]
    ].map(([label, value]) => `
      <article class="summary-card">
        <span>${escape(label)}</span>
        <strong>${escape(value)}</strong>
      </article>
    `).join('');

    const nowMinutes =
      now.getHours() * 60 + now.getMinutes();

    const upcoming =
      todayBookings
        .filter(booking =>
          minutes(booking.end) >= nowMinutes
        )
        .sort((a, b) =>
          minutes(a.start) - minutes(b.start)
        );

    $('#summary-upcoming').innerHTML =
      upcoming.length
        ? upcoming.slice(0, 8).map(booking => `
            <div class="compact-row">
              <strong>${escape(booking.start)}–${escape(booking.end)}</strong>
              <span>${escape(roomShort(booking.roomId))} · ${escape(booking.teacher)}</span>
              <small>${escape(booking.group)}</small>
            </div>
          `).join('')
        : '<p class="empty-mini">No hay próximas reservaciones hoy.</p>';

    const usage = new Map();

    for (const booking of activeMonth) {
      const value =
        usage.get(booking.roomId) ||
        { count: 0, hours: 0 };

      value.count += 1;
      value.hours +=
        (minutes(booking.end) - minutes(booking.start)) / 60;

      usage.set(booking.roomId, value);
    }

    const enabledDaysInMonth =
      countEnabledDaysInRange(month.first, month.last);

    const availableHoursPerRoom =
      enabledDaysInMonth *
      ((dayEndMinutes() - dayStartMinutes()) / 60);

    $('#summary-room-usage').innerHTML =
      state.rooms.map(room => {
        const value =
          usage.get(room.id) ||
          { count: 0, hours: 0 };

        const occupancy =
          availableHoursPerRoom > 0
            ? Math.min(100, value.hours / availableHoursPerRoom * 100)
            : 0;

        return `
          <div class="compact-row">
            <strong>${escape(defaultRoomShort(room))}</strong>
            <span>${value.count} reservaciones · ${value.hours.toFixed(1)} h</span>
            <small>${occupancy.toFixed(1)} % ocupación</small>
          </div>
        `;
      }).join('');
  } catch (error) {
    target.innerHTML =
      `<p class="form-error">${escape(error.message)}</p>`;
  }
}

function renderAdminReservationRows() {
  const search =
    $('#admin-res-search').value
      .trim()
      .toLocaleLowerCase('es-MX');

  const roomId = $('#admin-res-room').value;
  const statusFilter = $('#admin-res-status').value;
  const today = dateKey(new Date());

  let rows = adminBookings.filter(booking => {
    if (roomId !== 'all' && booking.roomId !== roomId) {
      return false;
    }

    if (statusFilter === 'active' &&
        bookingStatus(booking) !== 'active') {
      return false;
    }

    if (statusFilter === 'cancelled' &&
        bookingStatus(booking) !== 'cancelled') {
      return false;
    }

    if (statusFilter === 'past' &&
        !(bookingStatus(booking) === 'active' &&
          booking.date < today)) {
      return false;
    }

    if (search) {
      const haystack =
        `${booking.teacher} ${booking.group} ${booking.activity}`
          .toLocaleLowerCase('es-MX');

      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  $('#admin-res-count').textContent =
    `${rows.length} ${rows.length === 1 ? 'resultado' : 'resultados'}`;

  $('#admin-res-list').innerHTML =
    rows.length
      ? rows.map(booking => {
          const cancelled =
            bookingStatus(booking) === 'cancelled';

          return `
            <article class="reservation-admin-row">
              <div class="reservation-admin-main">
                <strong>${escape(booking.date)} · ${escape(booking.start)}–${escape(booking.end)}</strong>
                <span>${escape(roomShort(booking.roomId))} · ${escape(booking.teacher)} · ${escape(booking.group)}</span>
                <small>${escape(booking.activity)}</small>
              </div>

              <div class="reservation-admin-meta">
                <span class="status-pill ${cancelled ? 'cancelled' : 'active'}">
                  ${cancelled ? 'Cancelada' : 'Activa'}
                </span>
                <small>
                  por ${escape(
                    booking.createdByLabel ||
                    booking.createdByEmail ||
                    '—'
                  )}
                </small>
              </div>

              <div class="reservation-admin-actions">
                <button type="button" data-admin-booking-view="${escape(booking.id)}">Ver</button>
                ${cancelled
                  ? `<button type="button" class="primary" data-admin-booking-restore="${escape(booking.id)}" data-mutation>Restaurar</button>`
                  : `
                    <button type="button" data-admin-booking-edit="${escape(booking.id)}" data-mutation>Editar</button>
                    <button type="button" data-admin-booking-move="${escape(booking.id)}" data-mutation>Mover</button>
                    <button type="button" data-admin-booking-duplicate="${escape(booking.id)}">Duplicar</button>
                    <button type="button" class="danger" data-admin-booking-cancel="${escape(booking.id)}" data-mutation>Cancelar</button>
                  `}
              </div>
            </article>
          `;
        }).join('')
      : '<p class="empty-mini">No se encontraron reservaciones para esos filtros.</p>';

  updateMutationAvailability();
}

async function loadAdminReservations() {
  if (!authService.isOwner(currentUser)) return;

  const defaults = adminDefaultDates();

  if (!$('#admin-res-from').value) {
    $('#admin-res-from').value = defaults.first;
  }

  if (!$('#admin-res-to').value) {
    $('#admin-res-to').value = defaults.last;
  }

  $('#admin-res-room').innerHTML = [
    '<option value="all">Todas las salas</option>',
    ...state.rooms.map(room => `
      <option value="${escape(room.id)}">
        ${escape(defaultRoomShort(room))} · ${escape(room.name)}
      </option>
    `)
  ].join('');

  const from = $('#admin-res-from').value;
  const to = $('#admin-res-to').value;

  if (!from || !to || to < from) return;

  $('#admin-res-list').innerHTML =
    '<div class="admin-loading">Consultando reservaciones…</div>';

  try {
    adminBookings =
      await repository.queryBookingsRange(from, to);

    renderAdminReservationRows();
  } catch (error) {
    $('#admin-res-list').innerHTML =
      `<p class="form-error">${escape(error.message)}</p>`;
  }
}

function roomStatusLabel(status) {
  return ({
    available: 'Disponible',
    maintenance: 'Mantenimiento',
    out_of_service: 'Fuera de servicio'
  })[status] || 'Disponible';
}

function roomAdminRow(room, archived = false) {
  return `
    <div class="compact-row room-admin-row">
      <div>
        <strong>${escape(defaultRoomShort(room))} · ${escape(room.name)}</strong>
        <span>
          ${escape(room.building || 'Sin edificio')}
          ${room.floor ? ` · ${escape(room.floor)}` : ''}
          ${room.capacity ? ` · ${escape(String(room.capacity))} lugares` : ''}
        </span>
        <small>${escape(roomStatusLabel(room.status))}</small>
      </div>

      <div class="row-actions">
        ${archived
          ? `<button type="button" class="primary" data-room-enable="${escape(room.id)}" data-mutation>Reactivar</button>`
          : `
            <button type="button" data-room-edit="${escape(room.id)}">Editar</button>
            <button type="button" class="danger" data-room-disable="${escape(room.id)}" data-mutation>Desactivar</button>
          `}
      </div>
    </div>
  `;
}

function resetRoomForm() {
  const form = $('#room-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.status.value = 'available';
  $('#room-form-title').textContent = 'Agregar sala';
  $('#room-error').textContent = '';
}

function populateBlockFormOptions() {
  const form = $('#block-form');

  form.elements.roomId.innerHTML =
    activeRooms().map(room => `
      <option value="${escape(room.id)}">
        ${escape(defaultRoomShort(room))} · ${escape(room.name)}
      </option>
    `).join('');

  const start = dayStartMinutes();
  const end = dayEndMinutes();

  form.elements.start.innerHTML = '';
  form.elements.end.innerHTML = '';

  for (let value = start; value < end; value += 30) {
    form.elements.start.insertAdjacentHTML(
      'beforeend',
      `<option value="${timeLabel(value)}">${timeLabel(value)}</option>`
    );
  }

  for (let value = start + 30; value <= end; value += 30) {
    form.elements.end.insertAdjacentHTML(
      'beforeend',
      `<option value="${timeLabel(value)}">${timeLabel(value)}</option>`
    );
  }

  if (!form.elements.date.value) {
    form.elements.date.value = dateKey(new Date());
  }
}

async function loadAdminRooms() {
  if (!authService.isOwner(currentUser)) return;

  try {
    adminRooms = await repository.listRooms();

    const active =
      adminRooms.filter(room =>
        room.active !== false
      );

    const archived =
      adminRooms.filter(room =>
        room.active === false
      );

    $('#rooms-active-list').innerHTML =
      active.length
        ? active.map(room =>
            roomAdminRow(room, false)
          ).join('')
        : '<p class="empty-mini">No hay salas activas.</p>';

    $('#rooms-archived-list').innerHTML =
      archived.length
        ? archived.map(room =>
            roomAdminRow(room, true)
          ).join('')
        : '<p class="empty-mini">No hay salas archivadas.</p>';

    populateBlockFormOptions();

    const now = new Date();
    const from = dateKey(
      new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        12
      )
    );

    const to = dateKey(addDays(now, 90));
    const blocks =
      await repository.queryBlocksRange(from, to);

    $('#blocks-list').innerHTML =
      blocks.length
        ? blocks.map(block => `
            <div class="compact-row">
              <div>
                <strong>${escape(block.date)} · ${escape(block.start)}–${escape(block.end)}</strong>
                <span>${escape(roomShort(block.roomId))}</span>
                <small>${escape(block.reason || 'Mantenimiento')}</small>
              </div>
              <button
                type="button"
                class="danger"
                data-block-remove="${escape(block.id)}"
                data-mutation>
                Quitar
              </button>
            </div>
          `).join('')
        : '<p class="empty-mini">No hay bloqueos próximos.</p>';

    updateMutationAvailability();
  } catch (error) {
    $('#room-error').textContent = error.message;
  }
}

async function loadAdminUsers() {
  if (!authService.isOwner(currentUser)) return;

  try {
    adminUsers = await repository.listAuthorizedUsers();

    if (!adminUsers.some(user => user.email === OWNER_EMAIL)) {
      adminUsers.unshift({
        name: 'Iván Gutiérrez Bautista',
        email: OWNER_EMAIL,
        active: true,
        virtualOwner: true
      });
    }

    $('#users-list').innerHTML =
      adminUsers.map(user => {
        const active = user.active !== false;
        const isOwner = user.email === OWNER_EMAIL;

        return `
          <div class="user-row">
            <div>
              <strong>${escape(user.name || user.email)}</strong>
              <span>${escape(user.email)}</span>
              <small class="status-text ${active ? 'active' : 'inactive'}">
                ${isOwner
                  ? 'Administrador principal'
                  : active
                    ? 'Acceso activo'
                    : 'Acceso revocado'}
              </small>
            </div>

            ${isOwner
              ? '<span class="owner-badge">Administrador</span>'
              : active
                ? `<button type="button" class="danger" data-user-revoke="${escape(user.email)}" data-mutation>Revocar acceso</button>`
                : `<button type="button" class="primary" data-user-enable="${escape(user.email)}" data-mutation>Reactivar</button>`
            }
          </div>
        `;
      }).join('');

    updateMutationAvailability();
  } catch (error) {
    $('#user-error').textContent = error.message;
  }
}

function auditActionLabel(action) {
  const labels = {
    CREATE_BOOKING: 'Creó reservación',
    UPDATE_BOOKING: 'Editó reservación',
    MOVE_BOOKING: 'Movió reservación',
    CANCEL_BOOKING: 'Canceló reservación',
    RESTORE_BOOKING: 'Restauró reservación',
    CREATE_SERIES: 'Creó serie',
    CANCEL_SERIES: 'Canceló serie',
    ROOM_CREATED: 'Creó sala',
    ROOM_UPDATED: 'Editó sala',
    ROOM_DISABLED: 'Desactivó sala',
    ROOM_ENABLED: 'Reactivó sala',
    USER_GRANTED: 'Autorizó usuario',
    USER_REVOKED: 'Revocó usuario',
    USER_REACTIVATED: 'Reactivó usuario',
    SETTINGS_UPDATED: 'Cambió configuración',
    ROOM_BLOCK_CREATED: 'Creó bloqueo',
    ROOM_BLOCK_UPDATED: 'Editó bloqueo',
    ROOM_BLOCK_REMOVED: 'Quitó bloqueo'
  };

  return labels[action] || action;
}

async function loadAuditLogs() {
  if (!authService.isOwner(currentUser)) return;

  const defaults = adminDefaultDates();

  if (!$('#audit-from').value) {
    $('#audit-from').value = defaults.first;
  }

  if (!$('#audit-to').value) {
    $('#audit-to').value = defaults.last;
  }

  $('#audit-list').innerHTML =
    '<div class="admin-loading">Consultando historial…</div>';

  try {
    const logs = await repository.listAuditLogs(
      $('#audit-from').value,
      $('#audit-to').value
    );

    $('#audit-list').innerHTML =
      logs.length
        ? logs.map(log => {
            const date =
              log.createdAt?.toDate?.()
                ?.toLocaleString('es-MX') ||
              log.createdDate ||
              '—';

            let detail = '';

            if (log.action === 'MOVE_BOOKING' &&
                log.before &&
                log.after) {
              detail =
                `Antes: ${roomShort(log.before.roomId)} · ${log.before.date} · ${log.before.start}–${log.before.end} | ` +
                `Después: ${roomShort(log.after.roomId)} · ${log.after.date} · ${log.after.start}–${log.after.end}`;
            } else if (log.targetEmail) {
              detail = log.targetEmail;
            } else if (log.bookingId) {
              detail = `Reservación ${log.bookingId}`;
            } else if (log.roomId) {
              detail = roomShort(log.roomId);
            }

            return `
              <article class="audit-row">
                <div>
                  <strong>${escape(auditActionLabel(log.action))}</strong>
                  <span>${escape(log.actorLabel || log.actorEmail || '—')}</span>
                  ${detail ? `<small>${escape(detail)}</small>` : ''}
                </div>
                <time>${escape(date)}</time>
              </article>
            `;
          }).join('')
        : '<p class="empty-mini">No hay movimientos registrados en este periodo.</p>';
  } catch (error) {
    $('#audit-list').innerHTML =
      `<p class="form-error">${escape(error.message)}</p>`;
  }
}

function renderSettingsForm() {
  if (!authService.isOwner(currentUser)) return;

  const form = $('#settings-form');
  const value = settings();

  form.elements.startTime.value = value.startTime;
  form.elements.endTime.value = value.endTime;
  form.elements.blockMinutes.value =
    String(value.blockMinutes);

  form.elements.repeatLimitDays.value =
    String(
      [90, 180, 365, 730].includes(value.repeatLimitDays)
        ? value.repeatLimitDays
        : 365
    );

  for (const checkbox of form.querySelectorAll('[name="enabledDays"]')) {
    checkbox.checked =
      value.enabledDays.includes(Number(checkbox.value));
  }

  $('#settings-error').textContent = '';
}

function openAdmin() {
  const owner = authService.isOwner(currentUser);

  $('#admin-title').textContent =
    owner
      ? 'Panel de administración'
      : 'Reportes';

  setupReportDefaults();
  renderReportRoomOptions();

  $('#admin-dialog').showModal();

  openAdminTab(owner ? 'summary' : 'report');
}

function refreshVisibleRange() {
  if (!currentUser) return;

  unsubscribeRealtime?.();

  const range = visibleRange();

  $('#sync-status').textContent =
    isOnline
      ? '● Sincronizando'
      : '● Sin conexión · modo consulta';

  $('#sync-status').classList.remove('online');

  unsubscribeRealtime =
    repository.subscribeRange(
      range,
      nextState => {
        state = {
          rooms: nextState.rooms,
          bookings: nextState.bookings,
          blocks: nextState.blocks,
          settings: normalizeSettings(nextState.settings)
        };

        setOnlineState(navigator.onLine);

        if (navigator.onLine) {
          $('#sync-status').textContent = '● En tiempo real';
          $('#sync-status').classList.add('online');
          const syncedAt = new Date();
          $('#last-sync').textContent = `Actualizado ${syncedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
          $('#last-sync').dateTime = syncedAt.toISOString();
        }

        render();

        if ($('#admin-dialog').open &&
            activeAdminTab === 'report') {
          renderReportRoomOptions();
        }
      },
      error => {
        setOnlineState(false);
        notice(
          error.message ||
          'No se pudo sincronizar con Firebase.'
        );
      }
    );
}

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

  $('#manage').textContent =
    authService.isOwner(user)
      ? 'Administración'
      : 'Reportes';
}

function clearCurrentGestures() {
  dragState = null;

  if (bookingDragState?.element) {
    bookingDragState.element.classList.remove('being-dragged');
  }

  bookingDragState = null;
  clearDragSelection();
  clearBookingDropPreview();
}


// ---------------------------------------------------------
// EVENTOS GENERALES
// ---------------------------------------------------------

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]');
  if (close) close.closest('dialog')?.close();
});

window.addEventListener('offline', () => {
  setOnlineState(false);
  notice('Sin conexión · modo consulta');
});

window.addEventListener('online', () => {
  setOnlineState(true);
  notice('Conexión recuperada.');
  refreshVisibleRange();
});

$('#new').onclick = () => {
  if (!isOnline) {
    notice('Sin conexión: no se pueden crear reservaciones.');
    return;
  }
  openBooking();
};

$('#room-tabs').onclick = event => {
  const button =
    event.target.closest('[data-room]');

  if (!button) return;

  selectedRoom = button.dataset.room;
  render();
};

$('#quick-filters').onclick = event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;

  const view = button.dataset.view;

  if (view === 'today') {
    const now = new Date();
    week = monday(now);
    selectedDay = dayIndexForDate(now);
    quickView = enabledDates().some(date => dateKey(date) === dateKey(now))
      ? 'today'
      : 'week';

    if (quickView !== 'today') {
      notice('Hoy no es un día habilitado para reservaciones. Se muestra la semana actual.');
    }

    refreshVisibleRange();
    return;
  }

  if (view === 'week') {
    const now = new Date();
    week = monday(now);
    quickView = 'week';
    selectedDay = dayIndexForDate(now);
    refreshVisibleRange();
    return;
  }

  quickView = view;
  render();
};

$('#day-picker').onclick = event => {
  const button =
    event.target.closest('[data-day]');

  if (!button) return;

  selectedDay = Number(button.dataset.day);
  quickView = 'week';
  render();
};

$('#calendar').onclick = event => {
  const booking =
    event.target.closest('[data-booking]');

  if (!booking) return;

  if (suppressBookingClick) {
    event.preventDefault();
    return;
  }

  details(booking.dataset.booking);
};


// ---------------------------------------------------------
// ARRASTRAR RESERVACIÓN EXISTENTE
// ---------------------------------------------------------

$('#calendar').addEventListener('pointerdown', event => {
  const bookingElement =
    event.target.closest('.booking');

  if (!bookingElement ||
      event.button !== 0 ||
      !isOnline) {
    return;
  }

  const booking =
    state.bookings.find(item =>
      item.id === bookingElement.dataset.booking
    );

  if (!booking ||
      bookingStatus(booking) !== 'active') {
    return;
  }

  const rect =
    bookingElement.getBoundingClientRect();

  bookingDragState = {
    pointerId: event.pointerId,
    booking,
    element: bookingElement,
    originX: event.clientX,
    originY: event.clientY,
    grabOffsetY:
      Math.max(0, event.clientY - rect.top),
    moved: false,
    target: null,
    targetLane: null,
    conflict: null
  };

  bookingElement.setPointerCapture?.(
    event.pointerId
  );
});

$('#calendar').addEventListener('pointermove', event => {
  if (!bookingDragState ||
      event.pointerId !== bookingDragState.pointerId) {
    return;
  }

  const active = bookingDragState;

  const distance = Math.hypot(
    event.clientX - active.originX,
    event.clientY - active.originY
  );

  if (!active.moved && distance < 6) return;

  active.moved = true;
  event.preventDefault();
  active.element.classList.add('being-dragged');

  const lane = laneUnderPointer(
    event.clientX,
    event.clientY,
    active.element
  );

  if (!lane?.dataset.room ||
      !lane?.dataset.date) {
    active.target = null;
    active.targetLane = null;
    clearBookingDropPreview();
    return;
  }

  const room = roomById(lane.dataset.room);

  if (!room ||
      room.active === false ||
      room.status === 'maintenance' ||
      room.status === 'out_of_service') {
    active.target = null;
    active.targetLane = null;
    clearBookingDropPreview();
    return;
  }

  const target = bookingDropTarget(
    lane,
    event.clientY,
    active.booking,
    active.grabOffsetY
  );

  if (!target) return;

  const conflict =
    conflictFor(
      target.roomId,
      target.date,
      target.start,
      target.end,
      active.booking.id
    );

  active.target = target;
  active.targetLane = lane;
  active.conflict = conflict || null;

  paintBookingDropPreview(
    lane,
    target,
    active.booking,
    Boolean(conflict)
  );

  updateAvailabilityStatus(
    target.roomId,
    target.date,
    target.start,
    target.end,
    active.booking.id
  );
});

window.addEventListener('pointerup', async event => {
  if (!bookingDragState ||
      event.pointerId !== bookingDragState.pointerId) {
    return;
  }

  const active = bookingDragState;
  bookingDragState = null;

  active.element.classList.remove('being-dragged');

  if (!active.moved) {
    clearBookingDropPreview();
    return;
  }

  suppressBookingClick = true;

  setTimeout(() => {
    suppressBookingClick = false;
  }, 0);

  const target = active.target;
  const conflict = active.conflict;

  clearBookingDropPreview();

  if (!target) {
    notice('Movimiento cancelado: suelta la reservación dentro de una sala disponible.');
    return;
  }

  if (conflict) {
    notice(
      conflict.type === 'block'
        ? `No se puede mover: existe un bloqueo ${conflict.start}–${conflict.end}.`
        : `No se puede mover: ${conflict.label} ya ocupa ${conflict.start}–${conflict.end}.`
    );
    return;
  }

  const unchanged =
    target.roomId === active.booking.roomId &&
    target.date === active.booking.date &&
    target.start === active.booking.start &&
    target.end === active.booking.end;

  if (unchanged) {
    notice('La reservación quedó en el mismo lugar.');
    return;
  }

  try {
    ensureOnline();

    await repository.saveBooking(
      {
        ...active.booking,
        roomId: target.roomId,
        date: target.date,
        start: target.start,
        end: target.end
      },
      currentUser?.email
    );

    notice(
      `Reservación movida a ${roomShort(target.roomId)} · ${target.date} · ${target.start}–${target.end}.`
    );
  } catch (error) {
    notice(
      error.message ||
      'No se pudo mover la reservación.'
    );
  }
});

window.addEventListener('pointercancel', event => {
  if (!bookingDragState ||
      event.pointerId !== bookingDragState.pointerId) {
    return;
  }

  bookingDragState.element?.classList.remove('being-dragged');
  bookingDragState = null;
  clearBookingDropPreview();
});


// ---------------------------------------------------------
// SELECCIÓN DE NUEVO HORARIO
// ---------------------------------------------------------

$('#calendar').addEventListener('pointerdown', event => {
  const slot = event.target.closest('.slot');

  if (!slot ||
      event.target.closest('.booking') ||
      event.button !== 0 ||
      !isOnline ||
      slot.disabled) {
    return;
  }

  event.preventDefault();

  const lane = slot.closest('.lane');
  const slots = Array.from(
    lane.querySelectorAll('.slot')
  );

  const index = slots.indexOf(slot);

  dragState = {
    pointerId: event.pointerId,
    lane,
    slots,
    startIndex: index,
    endIndex: index,
    moved: false,
    roomId: slot.dataset.room,
    date: slot.dataset.date
  };

  slot.setPointerCapture?.(event.pointerId);
  paintDragSelection();

  const start =
    timeLabel(
      dayStartMinutes() +
      index * slotMinutesValue()
    );

  const end =
    timeLabel(
      Math.min(
        dayEndMinutes(),
        minutes(start) +
        Math.max(60, slotMinutesValue())
      )
    );

  updateAvailabilityStatus(
    dragState.roomId,
    dragState.date,
    start,
    end
  );
});

$('#calendar').addEventListener('pointermove', event => {
  if (!dragState ||
      event.pointerId !== dragState.pointerId) {
    return;
  }

  const target =
    document
      .elementFromPoint(
        event.clientX,
        event.clientY
      )
      ?.closest?.('.slot');

  if (!target ||
      target.closest('.lane') !== dragState.lane) {
    return;
  }

  const index =
    dragState.slots.indexOf(target);

  if (index < 0 ||
      index === dragState.endIndex) {
    return;
  }

  dragState.endIndex = index;
  dragState.moved =
    dragState.moved ||
    index !== dragState.startIndex;

  paintDragSelection();

  const [from, to] = [
    dragState.startIndex,
    dragState.endIndex
  ].sort((a, b) => a - b);

  const start =
    timeLabel(
      dayStartMinutes() +
      from * slotMinutesValue()
    );

  const end =
    timeLabel(
      Math.min(
        dayEndMinutes(),
        dayStartMinutes() +
        (to + 1) * slotMinutesValue()
      )
    );

  updateAvailabilityStatus(
    dragState.roomId,
    dragState.date,
    start,
    end
  );
});

window.addEventListener('pointerup', event => {
  if (!dragState ||
      event.pointerId !== dragState.pointerId) {
    return;
  }

  const active = dragState;

  const [from, to] = [
    active.startIndex,
    active.endIndex
  ].sort((a, b) => a - b);

  const start =
    timeLabel(
      dayStartMinutes() +
      from * slotMinutesValue()
    );

  const end = active.moved
    ? timeLabel(
        Math.min(
          dayEndMinutes(),
          dayStartMinutes() +
          (to + 1) * slotMinutesValue()
        )
      )
    : timeLabel(
        Math.min(
          dayEndMinutes(),
          dayStartMinutes() +
          from * slotMinutesValue() +
          Math.max(60, slotMinutesValue())
        )
      );

  const conflict =
    updateAvailabilityStatus(
      active.roomId,
      active.date,
      start,
      end
    );

  dragState = null;
  clearDragSelection();

  if (conflict) {
    notice(
      conflict.type === 'block'
        ? 'Ese horario está bloqueado administrativamente.'
        : `Ese horario ya está ocupado por ${conflict.label} (${conflict.start}–${conflict.end}).`
    );
    return;
  }

  openBooking({
    roomId: active.roomId,
    date: active.date,
    start,
    end
  });
});


// ---------------------------------------------------------
// NAVEGACIÓN DE SEMANA
// ---------------------------------------------------------

$('#previous').onclick = () => {
  initialCalendarScrollDone = true;
  week = addDays(week, -7);
  quickView = 'week';
  selectedDay = 0;
  refreshVisibleRange();
};

$('#next').onclick = () => {
  initialCalendarScrollDone = true;
  week = addDays(week, 7);
  quickView = 'week';
  selectedDay = 0;
  refreshVisibleRange();
};

$('#today').onclick = () => {
  const now = new Date();
  week = monday(now);
  selectedDay = dayIndexForDate(now);

  if (!enabledDates().some(date => dateKey(date) === dateKey(now))) {
    quickView = 'week';
    notice('Hoy no es un día habilitado para reservaciones.');
  } else {
    quickView = 'today';
  }

  refreshVisibleRange();
};

$('#jump-date').onchange = event => {
  const value = String(event.target.value || '');
  if (!value) return;
  goToDate(value, 'week');
};


// ---------------------------------------------------------
// FORMULARIO DE RESERVACIÓN
// ---------------------------------------------------------

$('#booking-form').elements.start.onchange = event => {
  const end = $('#booking-form').elements.end;

  if (minutes(end.value) <=
      minutes(event.target.value)) {
    end.value =
      timeLabel(
        Math.min(
          minutes(event.target.value) +
          Math.max(60, slotMinutesValue()),
          dayEndMinutes()
        )
      );
  }
};

$('#booking-form').elements.date.onchange = event => {
  setDefaultRepeatUntil(event.target.value);

  if ($('#booking-form').elements.repeatEnabled.checked) {
    ensureRepeatWeekday();
  }
};

$('#repeat-enabled').onchange =
  toggleRepeatOptions;

$('#booking-color-palette').onclick = event => {
  const button =
    event.target.closest('[data-color-key]');

  if (!button) return;

  selectBookingColor(
    button.dataset.colorKey
  );
};

$('#booking-form').onsubmit = async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button =
    form.querySelector('[type=submit]');

  button.disabled = true;

  try {
    ensureOnline();

    const bookings =
      createBookingSeries(form);

    const base = bookings[0];

    if (bookings.length > 1) {
      await repository.saveBookings(
        bookings,
        currentUser?.email
      );
    } else {
      await repository.saveBooking(
        base,
        currentUser?.email
      );
    }

    week = monday(
      parseDate(base.date)
    );

    quickView = 'week';
    selectedRoom = 'all';

    $('#booking-dialog').close();

    notice(
      bookings.length > 1
        ? `${bookings.length} reservaciones guardadas.`
        : 'Reservación guardada.'
    );

    refreshVisibleRange();
  } catch (error) {
    $('#booking-error').textContent =
      error.message;
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
    activity: currentBooking.activity,
    colorKey:
      currentBooking.colorKey ||
      defaultColorKey(
        currentBooking.createdByEmail ||
        currentUser?.email
      )
  };

  $('#detail-dialog').close();
  $('#admin-dialog').close();

  openBooking(copy);
  $('#booking-title').textContent =
    'Duplicar reservación';
};

$('#edit-booking').onclick = () => {
  if (!currentBooking) return;

  $('#detail-dialog').close();
  $('#admin-dialog').close();

  openBooking(currentBooking);
};

$('#cancel-booking').onclick = () => {
  if (!currentBooking) return;

  confirmActionDialog(
    '¿Cancelar esta reservación?',
    `${currentBooking.teacher} · ${currentBooking.start}–${currentBooking.end}. El horario volverá a quedar disponible, pero el historial se conservará.`,
    async () => {
      ensureOnline();

      await repository.cancelBooking(
        currentBooking.id,
        currentUser?.email
      );

      $('#detail-dialog').close();
      notice('Reservación cancelada.');
      refreshVisibleRange();
    },
    'Cancelar reservación'
  );
};

$('#cancel-series').onclick = () => {
  if (!currentBooking?.seriesId) return;

  confirmActionDialog(
    '¿Cancelar toda la serie?',
    'Se cancelarán las reservaciones activas de esta serie y se liberarán sus horarios. El historial permanecerá en Firestore.',
    async () => {
      ensureOnline();

      await repository.cancelSeries(
        currentBooking.seriesId,
        currentUser?.email
      );

      $('#detail-dialog').close();
      notice('Serie cancelada.');
      refreshVisibleRange();
    },
    'Cancelar serie'
  );
};

$('#restore-booking').onclick = () => {
  if (!currentBooking) return;

  confirmActionDialog(
    '¿Restaurar esta reservación?',
    'Se comprobará nuevamente que la sala y el horario estén disponibles.',
    async () => {
      ensureOnline();

      await repository.restoreBooking(
        currentBooking.id,
        currentUser?.email
      );

      $('#detail-dialog').close();
      notice('Reservación restaurada.');
      refreshVisibleRange();

      if ($('#admin-dialog').open) {
        await loadAdminReservations();
      }
    },
    'Restaurar'
  );
};


// ---------------------------------------------------------
// CONFIRMACIÓN
// ---------------------------------------------------------

$('#cancel-confirm').onclick = () =>
  $('#confirm-dialog').close();

$('#confirm-action').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await confirmAction?.();
    $('#confirm-dialog').close();
  } catch (error) {
    $('#confirm-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};


// ---------------------------------------------------------
// ADMINISTRACIÓN
// ---------------------------------------------------------

$('#manage').onclick = openAdmin;

$('#admin-tabs').onclick = event => {
  const button =
    event.target.closest('[data-admin-tab]');

  if (!button) return;

  openAdminTab(button.dataset.adminTab);
};

$('#admin-res-load').onclick =
  loadAdminReservations;

$('#admin-res-search').oninput =
  renderAdminReservationRows;

$('#admin-res-room').onchange =
  renderAdminReservationRows;

$('#admin-res-status').onchange =
  renderAdminReservationRows;

$('#admin-res-list').onclick = async event => {
  const view =
    event.target.closest('[data-admin-booking-view]');

  const edit =
    event.target.closest('[data-admin-booking-edit]');

  const move =
    event.target.closest('[data-admin-booking-move]');

  const duplicate =
    event.target.closest('[data-admin-booking-duplicate]');

  const cancel =
    event.target.closest('[data-admin-booking-cancel]');

  const restore =
    event.target.closest('[data-admin-booking-restore]');

  const id =
    view?.dataset.adminBookingView ||
    edit?.dataset.adminBookingEdit ||
    move?.dataset.adminBookingMove ||
    duplicate?.dataset.adminBookingDuplicate ||
    cancel?.dataset.adminBookingCancel ||
    restore?.dataset.adminBookingRestore;

  if (!id) return;

  const booking =
    adminBookings.find(item =>
      item.id === id
    );

  if (!booking) return;

  currentAdminBooking = booking;

  if (view) {
    showBookingDetails(booking);
    return;
  }

  if (edit) {
    $('#admin-dialog').close();
    openBooking(booking);
    return;
  }

  if (move) {
    $('#admin-dialog').close();
    openBooking(booking);
    $('#booking-title').textContent = 'Mover reservación';
    return;
  }

  if (duplicate) {
    currentBooking = booking;
    $('#admin-dialog').close();
    $('#duplicate-booking').click();
    return;
  }

  if (cancel) {
    confirmActionDialog(
      '¿Cancelar esta reservación?',
      `${booking.teacher} · ${booking.date} · ${booking.start}–${booking.end}`,
      async () => {
        ensureOnline();

        await repository.cancelBooking(
          booking.id,
          currentUser?.email
        );

        notice('Reservación cancelada.');
        await loadAdminReservations();
        refreshVisibleRange();
      },
      'Cancelar reservación'
    );
    return;
  }

  if (restore) {
    confirmActionDialog(
      '¿Restaurar esta reservación?',
      'Se comprobará nuevamente que el horario esté disponible.',
      async () => {
        ensureOnline();

        await repository.restoreBooking(
          booking.id,
          currentUser?.email
        );

        notice('Reservación restaurada.');
        await loadAdminReservations();
        refreshVisibleRange();
      },
      'Restaurar'
    );
  }
};

$('#room-form-reset').onclick =
  resetRoomForm;

$('#room-form').onsubmit = async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button =
    form.querySelector('[type=submit]');

  button.disabled = true;
  $('#room-error').textContent = '';

  try {
    ensureOnline();

    const data = new FormData(form);

    await repository.saveRoom(
      String(data.get('id') || ''),
      {
        name: data.get('name'),
        short: data.get('short'),
        building: data.get('building'),
        floor: data.get('floor'),
        capacity: data.get('capacity'),
        equipment: data.get('equipment'),
        status: data.get('status'),
        notes: data.get('notes')
      },
      currentUser?.email
    );

    resetRoomForm();
    notice('Sala guardada.');
    await loadAdminRooms();
    refreshVisibleRange();
  } catch (error) {
    $('#room-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};

$('#panel-rooms').onclick = event => {
  const edit =
    event.target.closest('[data-room-edit]');

  const disable =
    event.target.closest('[data-room-disable]');

  const enable =
    event.target.closest('[data-room-enable]');

  const removeBlock =
    event.target.closest('[data-block-remove]');

  if (edit) {
    const room =
      adminRooms.find(item =>
        item.id === edit.dataset.roomEdit
      );

    if (!room) return;

    const form = $('#room-form');

    form.elements.id.value = room.id;
    form.elements.name.value = room.name || '';
    form.elements.short.value = defaultRoomShort(room);
    form.elements.building.value = room.building || '';
    form.elements.floor.value = room.floor || '';
    form.elements.capacity.value = room.capacity || '';
    form.elements.equipment.value =
      (room.equipment || []).join(', ');
    form.elements.status.value =
      room.status || 'available';
    form.elements.notes.value =
      room.notes || '';

    $('#room-form-title').textContent =
      'Editar sala';

    form.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    return;
  }

  if (disable) {
    const id = disable.dataset.roomDisable;
    const room =
      adminRooms.find(item => item.id === id);

    confirmActionDialog(
      '¿Desactivar esta sala?',
      `${room?.name || 'La sala'} dejará de aceptar nuevas reservaciones, pero todo su historial permanecerá intacto.`,
      async () => {
        ensureOnline();

        await repository.setRoomActive(
          id,
          false,
          currentUser?.email
        );

        notice('Sala desactivada.');
        await loadAdminRooms();
        refreshVisibleRange();
      },
      'Desactivar'
    );

    return;
  }

  if (enable) {
    const id = enable.dataset.roomEnable;

    confirmActionDialog(
      '¿Reactivar esta sala?',
      'La sala volverá a estar disponible según su estado operativo.',
      async () => {
        ensureOnline();

        await repository.setRoomActive(
          id,
          true,
          currentUser?.email
        );

        notice('Sala reactivada.');
        await loadAdminRooms();
        refreshVisibleRange();
      },
      'Reactivar'
    );

    return;
  }

  if (removeBlock) {
    const id = removeBlock.dataset.blockRemove;

    confirmActionDialog(
      '¿Quitar este bloqueo?',
      'El horario volverá a estar disponible para reservaciones.',
      async () => {
        ensureOnline();

        await repository.deleteRoomBlock(
          id,
          currentUser?.email
        );

        notice('Bloqueo eliminado.');
        await loadAdminRooms();
        refreshVisibleRange();
      },
      'Quitar bloqueo'
    );
  }
};

$('#block-form').onsubmit = async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button =
    form.querySelector('[type=submit]');

  button.disabled = true;
  $('#block-error').textContent = '';

  try {
    ensureOnline();

    const data = new FormData(form);

    await repository.saveRoomBlock(
      {
        id: data.get('id'),
        roomId: data.get('roomId'),
        date: data.get('date'),
        start: data.get('start'),
        end: data.get('end'),
        reason: data.get('reason')
      },
      currentUser?.email
    );

    form.reset();
    populateBlockFormOptions();

    notice('Bloqueo agregado.');
    await loadAdminRooms();
    refreshVisibleRange();
  } catch (error) {
    $('#block-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};

$('#user-form').onsubmit = async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button =
    form.querySelector('[type=submit]');

  button.disabled = true;
  $('#user-error').textContent = '';

  try {
    ensureOnline();

    await repository.saveAuthorizedUser(
      form.elements.name.value,
      form.elements.email.value,
      currentUser?.email
    );

    form.reset();
    notice('Usuario autorizado o reactivado.');
    await loadAdminUsers();
  } catch (error) {
    $('#user-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};

$('#users-list').onclick = event => {
  const revoke =
    event.target.closest('[data-user-revoke]');

  const enable =
    event.target.closest('[data-user-enable]');

  if (revoke) {
    const email =
      revoke.dataset.userRevoke;

    confirmActionDialog(
      '¿Revocar acceso?',
      `La cuenta ${email} dejará de poder entrar, pero su historial se conservará.`,
      async () => {
        ensureOnline();

        await repository.setAuthorizedUserActive(
          email,
          false,
          currentUser?.email
        );

        notice('Acceso revocado.');
        await loadAdminUsers();
      },
      'Revocar acceso'
    );

    return;
  }

  if (enable) {
    const email =
      enable.dataset.userEnable;

    confirmActionDialog(
      '¿Reactivar acceso?',
      `La cuenta ${email} volverá a poder utilizar la agenda.`,
      async () => {
        ensureOnline();

        await repository.setAuthorizedUserActive(
          email,
          true,
          currentUser?.email
        );

        notice('Acceso reactivado.');
        await loadAdminUsers();
      },
      'Reactivar'
    );
  }
};

$('#report-period-type').onchange =
  toggleReportPeriodFields;

$('#report-month').onchange =
  updateReportPreview;

$('#report-year').oninput =
  updateReportPreview;

$('#report-from').onchange =
  updateReportPreview;

$('#report-to').onchange =
  updateReportPreview;

$('#report-all-rooms').onchange =
  syncReportRoomInputs;

$('#report-room-options').onchange = event => {
  if (event.target.matches(
    'input[name="reportRoom"]'
  )) {
    updateReportPreview();
  }
};

$('#report-form').onsubmit = async event => {
  event.preventDefault();

  const button =
    event.currentTarget
      .querySelector('[type=submit]');

  button.disabled = true;
  $('#report-error').textContent = '';

  try {
    await exportReport();
  } catch (error) {
    $('#report-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};

$('#audit-load').onclick =
  loadAuditLogs;

$('#settings-form').onsubmit = async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button =
    form.querySelector('[type=submit]');

  button.disabled = true;
  $('#settings-error').textContent = '';

  try {
    ensureOnline();

    const data = new FormData(form);

    const saved =
      await repository.saveSettings(
        {
          startTime: data.get('startTime'),
          endTime: data.get('endTime'),
          blockMinutes: data.get('blockMinutes'),
          repeatLimitDays: data.get('repeatLimitDays'),
          enabledDays:
            data.getAll('enabledDays')
              .map(Number)
        },
        currentUser?.email
      );

    state.settings =
      normalizeSettings(saved);

    notice('Configuración actualizada.');
    render();
    refreshVisibleRange();
  } catch (error) {
    $('#settings-error').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};

$('#download-backup').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#backup-status').textContent =
    'Preparando respaldo…';

  try {
    const backup =
      await repository.downloadBackupData();

    const stamp =
      new Date().toISOString().slice(0, 10);

    downloadJson(
      backup,
      `agenda_audiovisuales_respaldo_${stamp}.json`
    );

    $('#backup-status').textContent =
      'Respaldo descargado. Firestore no fue modificado.';
  } catch (error) {
    $('#backup-status').textContent =
      error.message;
  } finally {
    button.disabled = false;
  }
};


// ---------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------

$('#sign-in').onclick = async () => {
  const button = $('#sign-in');
  button.disabled = true;

  $('#auth-message').textContent =
    'Abriendo inicio de sesión de Google…';

  try {
    await authService.signIn();
  } catch (error) {
    const code =
      String(error?.code || '');

    const friendly = {
      'auth/popup-blocked':
        'El navegador bloqueó la ventana de Google. Permite ventanas emergentes para este sitio y vuelve a intentarlo.',
      'auth/popup-closed-by-user':
        'La ventana de Google se cerró antes de terminar. Vuelve a intentarlo.',
      'auth/cancelled-popup-request':
        'Ya existe una ventana de inicio de sesión abierta.',
      'auth/network-request-failed':
        'No se pudo conectar con Google/Firebase. Revisa la conexión y vuelve a intentarlo.',
      'auth/unauthorized-domain':
        'Este dominio todavía no está autorizado en Firebase Authentication.'
    };

    $('#auth-message').textContent =
      friendly[code] ||
      error?.message ||
      'No se pudo iniciar sesión.';
  } finally {
    button.disabled = false;
  }
};

$('#sign-out').onclick = () =>
  authService.signOut();

$('#auth-sign-out').onclick = () =>
  authService.signOut();

setInterval(() => {
  if (currentUser &&
      !dragState &&
      !bookingDragState) {
    render();
  }
}, 60000);

$('#new').disabled = true;
showAuth('Comprobando sesión…');

authService.onChange(async user => {
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  currentUser = null;
  clearCurrentGestures();

  if (!user) {
    showAuth(
      'Inicia sesión con una cuenta autorizada para consultar y modificar la agenda compartida.'
    );
    return;
  }

  try {
    if (authService.isOwner(user)) {
      await repository.bootstrapOwner(
        user.email
      );
    }

    const authorized =
      await repository.isAuthorized(
        user.email
      );

    if (!authorized) {
      showAuth(
        `La cuenta ${user.email} no está autorizada o tiene el acceso revocado.`,
        true
      );
      return;
    }

    state.settings =
      await repository.getSettings();

    showApp(user);
    setOnlineState(navigator.onLine);
    refreshVisibleRange();
  } catch (error) {
    showAuth(
      error.message ||
      'No se pudo validar el acceso.',
      true
    );
  }
});
