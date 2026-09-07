const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;
const CREATOR = 'آرمان آریا';
const CREATOR_PASSWORD = process.env.CREATOR_PASSWORD || '';

const users = new Map();
const messages = [];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch { return false; }
}
if (CREATOR_PASSWORD) users.set(CREATOR, { name: CREATOR, role: 'creator', club: 'آرمان FC', passwordHash: hashPassword(CREATOR_PASSWORD) });

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function validName(name) { return typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 24; }
function validPassword(password) { return typeof password === 'string' && password.length >= 4 && password.length <= 128; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS' }); return res.end(); }
  if (url.pathname === '/health') return json(res, 200, { ok: true, online: wss.clients.size, users: users.size });

  if (url.pathname === '/api/register' && req.method === 'POST') {
    try {
      const { name, password, club = '' } = await body(req);
      const n = String(name || '').trim();
      if (!validName(n) || !validPassword(password)) return json(res, 400, { ok:false, error:'نام یا رمز عبور نامعتبر است.' });
      if (n === CREATOR) return json(res, 403, { ok:false, error:'این نام برای سازنده رزرو شده است.' });
      if (users.has(n)) return json(res, 409, { ok:false, error:'این حساب قبلاً ساخته شده است.' });
      users.set(n, { name:n, role:'user', club:String(club || ''), passwordHash:hashPassword(password) });
      return json(res, 201, { ok:true, user:{ name:n, role:'user', club:String(club || '') } });
    } catch { return json(res, 400, { ok:false, error:'درخواست نامعتبر است.' }); }
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const { name, password } = await body(req);
      const n = String(name || '').trim();
      const u = users.get(n);
      if (!u || !verifyPassword(String(password || ''), u.passwordHash)) return json(res, 401, { ok:false, error:'نام کاربری یا رمز عبور اشتباه است.' });
      return json(res, 200, { ok:true, user:{ name:u.name, role:u.role, club:u.club || '' } });
    } catch { return json(res, 400, { ok:false, error:'درخواست نامعتبر است.' }); }
  }

  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
  const full = path.join(__dirname, file);
  if (!full.startsWith(__dirname)) return json(res, 403, { error:'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return json(res, 404, { error:'not found' });
    const ext = path.extname(full).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
function broadcast(obj) { const text = JSON.stringify(obj); for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(text); }
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type:'online', count:wss.clients.size }));
  ws.send(JSON.stringify({ type:'history', messages:messages.slice(-50) }));
  for (const client of wss.clients) if (client !== ws && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type:'online', count:wss.clients.size }));
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'public_message') return;
      const name = String(msg.name || '').trim();
      const text = String(msg.text || '').trim();
      if (!name || !text || text.length > 500) return;
      const u = users.get(name);
      const role = name === CREATOR ? 'creator' : (u ? u.role : 'user');
      const item = { id:crypto.randomUUID(), name, text, role, time:new Date().toISOString() };
      messages.push(item); if (messages.length > 100) messages.shift();
      broadcast({ type:'public_message', message:item });
    } catch {}
  });
  ws.on('close', () => broadcast({ type:'online', count:wss.clients.size }));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Morabi Man server running on port ${PORT}`));
