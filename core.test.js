import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, monday, dateKey, INITIAL_ROOMS } from './core.js';
const existing = { id: 'existing', roomId: 'alta-f', date: '2026-09-22', start: '10:00', end: '12:00', teacher: 'Maestro de prueba', group: 'A', activity: 'Prueba' };
const state = { rooms: INITIAL_ROOMS, bookings: [existing] };
test('bloquea empalmes parciales, contenidos e idénticos', () => {
  for (const [start, end] of [['09:30','10:30'],['10:30','11:30'],['11:30','12:30'],['10:00','12:00'],['09:00','13:00']]) assert.throws(() => validateBooking({ ...existing, id: '', start, end }, state), /ocupada/);
});
test('permite límites contiguos, otra sala, otra fecha y editarse a sí misma', () => {
  for (const changes of [{start:'08:00',end:'10:00'},{start:'12:00',end:'14:00'},{roomId:'baja-f'},{date:'2026-09-23'},{id:'existing'}]) assert.doesNotThrow(() => validateBooking({...existing,id:'',...changes}, state));
});
test('editar vuelve a comprobar los demás eventos', () => {
  assert.throws(() => validateBooking({...existing,id:'editing'}, {...state,bookings:[existing,{...existing,id:'editing',start:'14:00',end:'15:00'}]}), /ocupada/);
});
test('rechaza fecha inválida, domingo, sala inexistente, campos vacíos y horas fuera de rango', () => {
  for (const changes of [{date:'2026-02-30'},{date:'2026-09-27'},{roomId:''},{teacher:'  '},{group:''},{activity:''},{start:'06:30'},{end:'22:30'},{start:'12:00',end:'10:00'},{start:'10:00',end:'10:00'},{start:'10:15'}]) assert.throws(() => validateBooking({...existing,...changes}, state));
});
test('domingo y cambio de año pertenecen a la semana correcta', () => {
  assert.equal(dateKey(monday(new Date('2026-09-27T12:00:00'))), '2026-09-21');
  assert.equal(dateKey(monday(new Date('2027-01-01T12:00:00'))), '2026-12-28');
});
