import { minutes, timeLabel, dateKey, parseDate, monday, addDays } from './core.js';
import { repository } from './storage.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullDate = date => date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let state = { rooms: [], bookings: [] }, week = monday(new Date()), selectedDay = Math.min((new Date().getDay() + 6) % 7, 5), selectedRoom = '', currentBooking, confirmAction, noticeTimer;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('agenda-audiovisuales-updates') : null;
function notice(message) { $('#notice').textContent = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').textContent = ''; }, 6500); }
function roomName(id) { return state.rooms.find(r => r.id === id)?.name || 'Sala'; }
function dates() { return Array.from({ length: 6 }, (_, i) => addDays(week, i)); }
function render() {
  if (selectedRoom !== 'all' && !state.rooms.some(r => r.id === selectedRoom)) selectedRoom = state.rooms[0]?.id || '';
  $('#new').disabled = !state.rooms.length;
  $('#room-tabs').innerHTML = state.rooms.map(r => `<button data-room="${escape(r.id)}" aria-pressed="${selectedRoom === r.id}">${escape(r.name)}</button>`).join('') + (state.rooms.length > 1 ? `<button data-room="all" aria-pressed="${selectedRoom === 'all'}">Todas las salas</button>` : '');
  const days = dates(), last = days[5];
  $('#period').textContent = week.getMonth() === last.getMonth() ? `${week.getDate()}–${last.getDate()} de ${last.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}` : `${week.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const visibleBookings = state.bookings.filter(b => b.date >= dateKey(week) && b.date <= dateKey(last) && (selectedRoom === 'all' || b.roomId === selectedRoom));
  $('#summary').textContent = `${visibleBookings.length} ${visibleBookings.length === 1 ? 'reservación' : 'reservaciones'} esta semana`;
  $('#day-picker').innerHTML = days.map((d, i) => `<button data-day="${i}" aria-pressed="${selectedDay === i}" aria-label="${fullDate(d)}">${d.toLocaleDateString('es-MX', { weekday: 'short' })}<strong>${d.getDate()}</strong></button>`).join('');
  const calendar = $('#calendar'), scrollTop = calendar.scrollTop;
  calendar.classList.toggle('all-rooms', selectedRoom === 'all');
  if (!state.rooms.length) { calendar.innerHTML = '<div class="empty">Agrega una sala para comenzar a reservar.</div>'; return; }
  const rooms = selectedRoom === 'all' ? state.rooms : state.rooms.filter(r => r.id === selectedRoom);
  calendar.innerHTML = `<div class="week"><div class="time-head">HORA</div>${days.map((d, i) => `<div class="day-head ${i === selectedDay ? 'selected' : ''} ${dateKey(d) === dateKey(new Date()) ? 'current' : ''}">${d.toLocaleDateString('es-MX', { weekday: 'short' })}<strong>${d.getDate()}</strong></div>`).join('')}<div class="time-axis">${Array.from({ length: 16 }, (_, i) => `<span class="time-label" style="top:${i * 200}px">${timeLabel(420 + i * 60)}</span>`).join('')}</div>${days.map((d, i) => `<div class="day-column ${i === selectedDay ? 'selected' : ''}">${rooms.map(r => `<div class="lane" aria-label="${escape(r.name)} · ${fullDate(d)}">${Array.from({ length: 30 }, (_, n) => `<button class="slot" data-date="${dateKey(d)}" data-room="${escape(r.id)}" data-start="${timeLabel(420 + n * 30)}" aria-label="Reservar ${escape(r.name)}, ${fullDate(d)}, ${timeLabel(420 + n * 30)}"></button>`).join('')}${visibleBookings.filter(b => b.date === dateKey(d) && b.roomId === r.id).map(b => `<button class="booking ${state.rooms.indexOf(r) % 2 ? 'blue' : ''}" style="top:${(minutes(b.start) - 420) / 30 * 100 + 3}px;height:${(minutes(b.end) - minutes(b.start)) / 30 * 100 - 6}px" data-booking="${escape(b.id)}" aria-label="${escape(`${b.teacher}, ${b.group}, ${b.activity}, ${b.start} a ${b.end}, ${r.name}`)}" title="${escape(`${r.name}\n${b.teacher} · ${b.group}\n${b.activity}\n${b.start}–${b.end}`)}"><span class="time">${b.start}–${b.end}</span><strong>${escape(b.teacher)}</strong><span>${escape(b.group)}</span><span class="activity">${escape(b.activity)}</span>${selectedRoom === 'all' && minutes(b.end) - minutes(b.start) > 30 ? `<small>${escape(r.name)}</small>` : ''}</button>`).join('')}</div>`).join('')}</div>`).join('')}</div>`;
  calendar.scrollTop = scrollTop;
}
function changed(nextState, message) { state = nextState; render(); channel?.postMessage('changed'); if (message) notice(message); }
function openBooking(values = {}) {
  const form = $('#booking-form'); form.reset(); $('#booking-error').textContent = '';
  form.elements.roomId.innerHTML = state.rooms.map(r => `<option value="${escape(r.id)}">${escape(r.name)}</option>`).join('');
  for (const field of ['start', 'end']) form.elements[field].innerHTML = Array.from({ length: 30 }, (_, i) => { const t = timeLabel(420 + (i + (field === 'end' ? 1 : 0)) * 30); return `<option value="${t}">${t}</option>`; }).join('');
  const defaults = { id: '', roomId: selectedRoom === 'all' ? state.rooms[0]?.id : selectedRoom, date: dateKey(dates()[selectedDay]), start: '07:00', end: '08:00', teacher: '', group: '', activity: '' };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) if (form.elements[key]) form.elements[key].value = value;
  $('#booking-title').textContent = values.id ? 'Editar reservación' : 'Nueva reservación';
  $('#booking-dialog').showModal();
}
function details(id) {
  currentBooking = state.bookings.find(b => b.id === id); if (!currentBooking) return;
  const b = currentBooking; $('#detail-title').textContent = roomName(b.roomId);
  $('#details').innerHTML = [['Maestro', b.teacher], ['Grupo', b.group], ['Actividad', b.activity], ['Fecha', fullDate(parseDate(b.date))], ['Horario', `${b.start}–${b.end}`]].map(([label, value]) => `<div class="detail-row"><span>${label}</span><strong>${escape(value)}</strong></div>`).join('');
  $('#detail-dialog').showModal();
}
function confirmDelete(title, description, action) { $('#confirm-title').textContent = title; $('#confirm-text').textContent = description; $('#confirm-error').textContent = ''; confirmAction = action; $('#confirm-dialog').showModal(); }
function renderRooms() {
  $('#rooms-list').innerHTML = state.rooms.map(r => `<form class="room-edit" data-id="${escape(r.id)}"><label>Nombre de la sala<input name="name" value="${escape(r.name)}" required></label><div class="actions"><button type="button" class="danger" data-remove-room="${escape(r.id)}">Eliminar</button><button type="submit">Guardar nombre</button></div></form>`).join('');
}
document.addEventListener('click', event => { const close = event.target.closest('[data-close]'); if (close) close.closest('dialog').close(); });
$('#new').onclick = () => openBooking();
$('#room-tabs').onclick = event => { const button = event.target.closest('[data-room]'); if (button) { selectedRoom = button.dataset.room; render(); } };
$('#day-picker').onclick = event => { const button = event.target.closest('[data-day]'); if (button) { selectedDay = Number(button.dataset.day); render(); } };
$('#calendar').onclick = event => {
  const booking = event.target.closest('[data-booking]'); if (booking) return details(booking.dataset.booking);
  const slot = event.target.closest('.slot'); if (slot) openBooking({ roomId: slot.dataset.room, date: slot.dataset.date, start: slot.dataset.start, end: timeLabel(Math.min(minutes(slot.dataset.start) + 60, 1320)) });
};
$('#previous').onclick = () => { week = addDays(week, -7); render(); };
$('#next').onclick = () => { week = addDays(week, 7); render(); };
$('#today').onclick = () => { week = monday(new Date()); selectedDay = Math.min((new Date().getDay() + 6) % 7, 5); render(); };
$('#booking-form').elements.start.onchange = event => { const end = $('#booking-form').elements.end; if (minutes(end.value) <= minutes(event.target.value)) end.value = timeLabel(Math.min(minutes(event.target.value) + 60, 1320)); };
$('#booking-form').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type=submit]'); button.disabled = true;
  const booking = Object.fromEntries(new FormData(form)); for (const key of ['teacher', 'group', 'activity']) booking[key] = booking[key].trim();
  try { const next = await repository.saveBooking(booking); week = monday(parseDate(booking.date)); selectedDay = (parseDate(booking.date).getDay() + 6) % 7; selectedRoom = booking.roomId; changed(next, 'Reservación guardada.'); $('#booking-dialog').close(); }
  catch (error) { $('#booking-error').textContent = error.message; } finally { button.disabled = false; }
};
$('#edit-booking').onclick = () => { $('#detail-dialog').close(); openBooking(currentBooking); };
$('#delete-booking').onclick = () => { const id = currentBooking.id; confirmDelete('¿Eliminar esta reservación?', `${currentBooking.teacher} · ${currentBooking.start}–${currentBooking.end}`, async () => { changed(await repository.deleteBooking(id), 'Reservación eliminada.'); $('#detail-dialog').close(); }); };
$('#cancel-delete').onclick = () => $('#confirm-dialog').close();
$('#confirm-delete').onclick = async event => { const button = event.currentTarget; button.disabled = true; try { await confirmAction(); $('#confirm-dialog').close(); } catch (error) { $('#confirm-error').textContent = error.message; } finally { button.disabled = false; } };
$('#manage').onclick = () => { renderRooms(); $('#room-error').textContent = ''; $('#rooms-dialog').showModal(); };
$('#room-form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true; try { changed(await repository.saveRoom(null, form.elements.name.value), 'Sala agregada.'); form.reset(); renderRooms(); $('#room-error').textContent = ''; } catch (error) { $('#room-error').textContent = error.message; } finally { button.disabled = false; } };
$('#rooms-list').onsubmit = async event => { event.preventDefault(); const form = event.target; try { changed(await repository.saveRoom(form.dataset.id, form.elements.name.value), 'Nombre actualizado.'); renderRooms(); $('#room-error').textContent = ''; } catch (error) { $('#room-error').textContent = error.message; } };
$('#rooms-list').onclick = event => { const button = event.target.closest('[data-remove-room]'); if (!button) return; const id = button.dataset.removeRoom, count = state.bookings.filter(b => b.roomId === id).length; confirmDelete('¿Eliminar esta sala?', `${roomName(id)}. También se eliminarán todas sus reservaciones${count ? ` (${count} actualmente)` : ''}.`, async () => { changed(await repository.deleteRoom(id), 'Sala eliminada.'); renderRooms(); }); };
async function refresh() { try { state = await repository.read(); render(); if ($('#rooms-dialog').open) renderRooms(); } catch (error) { notice(error.message); } }
if (channel) channel.onmessage = refresh;
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
$('#new').disabled = true;
refresh();
