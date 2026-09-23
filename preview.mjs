import http from 'node:http';
import { readFile } from 'node:fs/promises';
const assets = { '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'], '/styles.css': ['styles.css','text/css'], '/app.js': ['app.js','text/javascript'], '/core.js': ['core.js','text/javascript'], '/storage.js': ['storage.js','text/javascript'] };
http.createServer(async (req, res) => {
  const item = assets[new URL(req.url, 'http://localhost').pathname];
  if (!item) { res.writeHead(404); res.end('No encontrado'); return; }
  try { const body = await readFile(new URL(item[0], import.meta.url)); res.writeHead(200, { 'Content-Type': item[1] + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { res.writeHead(500); res.end('No se pudo abrir la página.'); }
}).listen(4173, '127.0.0.1', () => console.log('Agenda disponible en http://127.0.0.1:4173'));
