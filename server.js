const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const GAME_DURATION_MS = 5 * 60 * 1000;
const SNAPSHOT_MS = 100;
const MAX_PLAYERS = 12;
const WORLD_LIMIT = 18;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '1.1.0' }));

const rooms = new Map();

const ROLE_DEFS = {
  SABOTEUR: {
    name: 'Saboteur', team: 'Saboteur', ability: 'Désorientation', icon: '⚠',
    description: 'Empêche l’équipe de livrer les batteries. Ton pouvoir inverse les déplacements du joueur le plus proche pendant 6 s.',
    cooldownMs: 18000
  },
  GLUE: {
    name: 'Pot de colle', team: 'Neutre', ability: 'Super-glue', icon: '◆',
    description: 'Objectif personnel : engluer 3 joueurs différents. Ton pouvoir ralentit fortement la cible pendant 6 s.',
    cooldownMs: 15000
  },
  JAILER: {
    name: 'Geôlier', team: 'Équipe', ability: 'Prison express', icon: '▦',
    description: 'Immobilise le joueur le plus proche pendant 4 s. Très pratique… sauf quand tu bloques un allié.',
    cooldownMs: 20000
  },
  GUARDIAN: {
    name: 'Gardien', team: 'Équipe', ability: 'Bouclier', icon: '⬡',
    description: 'Protège le joueur le plus proche des effets négatifs pendant 7 s et retire ses handicaps actuels.',
    cooldownMs: 17000
  },
  RUNNER: {
    name: 'Sprinteur', team: 'Équipe', ability: 'Turbo', icon: '»',
    description: 'Accélère fortement tes déplacements pendant 5 s. Idéal pour transporter une batterie sous pression.',
    cooldownMs: 12000
  },
  SWAPPER: {
    name: 'Téléporteur', team: 'Équipe', ability: 'Permutation', icon: '⇄',
    description: 'Échange instantanément ta position avec celle du joueur le plus proche. Sauvetage ou chaos garanti.',
    cooldownMs: 19000
  },
  BUMPER: {
    name: 'Bousculeur', team: 'Équipe', ability: 'Coup d’épaule', icon: '➜',
    description: 'Projette le joueur le plus proche loin de toi. Peut libérer un passage… ou ruiner une livraison.',
    cooldownMs: 13500
  },
  PHANTOM: {
    name: 'Fantôme', team: 'Équipe', ability: 'Phase', icon: '◌',
    description: 'Traverse les obstacles intérieurs pendant 5 s. Les murs extérieurs restent infranchissables.',
    cooldownMs: 16000
  },
  MAGNET: {
    name: 'Aimanteur', team: 'Équipe', ability: 'Attraction', icon: '∩',
    description: 'Attire brutalement le joueur le plus proche vers toi. Utile pour sauver un porteur… ou semer le doute.',
    cooldownMs: 15000
  }
};

const BATTERY_SPAWNS = [
  { id: 'b1', x: -13, z: -12 },
  { id: 'b2', x: 13, z: -10 },
  { id: 'b3', x: 0, z: 14 }
];
const REACTOR = { x: 0, z: 0, radius: 3.2 };
const SPAWNS = [
  [-4, -4], [4, -4], [-4, 4], [4, 4], [0, -6], [0, 6],
  [-6, 0], [6, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]
];

function cleanRoomCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || randomCode();
}
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function cleanName(raw) {
  return String(raw || 'Joueur').replace(/[<>]/g, '').trim().slice(0, 18) || 'Joueur';
}
function createRoom(code) {
  const room = {
    code,
    players: new Map(),
    hostId: null,
    started: false,
    startAt: 0,
    winner: null,
    batteries: BATTERY_SPAWNS.map(b => ({ ...b, carrierId: null, delivered: false })),
    delivered: 0,
    events: []
  };
  rooms.set(code, room);
  return room;
}
function roleCatalog() {
  return Object.entries(ROLE_DEFS).map(([id, r]) => ({
    id, name: r.name, team: r.team, ability: r.ability, icon: r.icon, description: r.description
  }));
}
function publicLobby(room) {
  return {
    code: room.code,
    started: room.started,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, host: p.id === room.hostId })),
    roles: roleCatalog()
  };
}
function emitLobby(room) { io.to(room.code).emit('lobby', publicLobby(room)); }
function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rolesForCount(n) {
  const roles = ['SABOTEUR'];
  if (n >= 3) roles.push('GLUE');
  const cycle = ['RUNNER', 'JAILER', 'GUARDIAN', 'SWAPPER', 'BUMPER', 'PHANTOM', 'MAGNET', 'RUNNER', 'GUARDIAN', 'JAILER'];
  let i = 0;
  while (roles.length < n) roles.push(cycle[i++ % cycle.length]);
  return shuffle(roles.slice(0, n));
}
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function addEvent(room, text) {
  room.events.push({ text, at: Date.now() });
  room.events = room.events.filter(e => Date.now() - e.at < 8000).slice(-5);
  io.to(room.code).emit('gameEvent', text);
}
function getEffect(player, type) {
  const now = Date.now();
  return player.effects.find(e => e.type === type && e.expires > now);
}
function clearExpiredEffects(player) {
  const now = Date.now();
  player.effects = player.effects.filter(e => e.expires > now);
}
function nearestTarget(room, actor, maxDistance = 6) {
  let best = null;
  let bestD = Infinity;
  for (const p of room.players.values()) {
    if (p.id === actor.id) continue;
    const d = distance(actor, p);
    if (d < bestD && d <= maxDistance) { best = p; bestD = d; }
  }
  return best;
}
function harmfulEffect(room, target, effect, actorName) {
  clearExpiredEffects(target);
  if (getEffect(target, 'shield')) {
    addEvent(room, `${target.name} bloque l'effet de ${actorName} grâce à son bouclier !`);
    return false;
  }
  target.effects = target.effects.filter(e => e.type !== effect.type);
  target.effects.push(effect);
  return true;
}
function privateRolePayload(player) {
  if (!player?.role || !ROLE_DEFS[player.role]) return null;
  return {
    role: player.role,
    ...ROLE_DEFS[player.role],
    personalProgress: player.glueTargets ? player.glueTargets.size : 0,
    personalGoal: player.role === 'GLUE' ? 3 : null
  };
}
function emitPrivateRole(player) {
  const payload = privateRolePayload(player);
  if (payload) io.to(player.id).emit('role', payload);
}
function startGame(room) {
  const players = [...room.players.values()];
  const roles = rolesForCount(players.length);
  room.started = true;
  room.startAt = Date.now();
  room.winner = null;
  room.delivered = 0;
  room.batteries = BATTERY_SPAWNS.map(b => ({ ...b, carrierId: null, delivered: false }));
  players.forEach((p, i) => {
    const [x, z] = SPAWNS[i % SPAWNS.length];
    p.x = x; p.z = z; p.rot = 0;
    p.role = roles[i];
    p.effects = [];
    p.cooldownUntil = 0;
    p.carrying = null;
    p.glueTargets = new Set();
    p.neutralWon = false;
    p.lastMoveAt = Date.now();
    emitPrivateRole(p);
  });
  addEvent(room, 'La partie commence : livrez les 3 batteries au réacteur !');
  io.to(room.code).emit('gameStarted', { durationMs: GAME_DURATION_MS, reactor: REACTOR });
}
function endGame(room, winner, reason) {
  if (room.winner) return;
  room.winner = { winner, reason };
  io.to(room.code).emit('gameOver', room.winner);
}
function clamp(v) { return Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, v)); }

io.on('connection', socket => {
  socket.on('joinRoom', ({ roomCode, name } = {}, cb = () => {}) => {
    const code = cleanRoomCode(roomCode);
    let room = rooms.get(code);
    if (!room) room = createRoom(code);
    if (room.started) return cb({ ok: false, error: 'La partie a déjà commencé.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Salon complet.' });

    for (const joined of socket.rooms) if (joined !== socket.id) socket.leave(joined);
    socket.join(code);
    socket.data.roomCode = code;
    const p = {
      id: socket.id,
      name: cleanName(name),
      x: 0, z: 0, rot: 0,
      role: null,
      effects: [],
      cooldownUntil: 0,
      carrying: null,
      glueTargets: new Set(),
      neutralWon: false,
      lastMoveAt: Date.now()
    };
    room.players.set(socket.id, p);
    if (!room.hostId) room.hostId = socket.id;
    emitLobby(room);
    cb({ ok: true, code, id: socket.id, roles: roleCatalog() });
  });

  socket.on('getMyRole', (cb = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    const payload = privateRolePayload(p);
    if (!payload) return cb({ ok: false, error: 'Le rôle n’est pas encore attribué.' });
    cb({ ok: true, role: payload });
  });

  socket.on('startGame', (cb = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return cb({ ok: false, error: 'Salon introuvable.' });
    if (room.hostId !== socket.id) return cb({ ok: false, error: 'Seul l’hôte peut lancer.' });
    if (room.players.size < 2) return cb({ ok: false, error: 'Il faut au moins 2 joueurs.' });
    startGame(room);
    cb({ ok: true });
  });

  socket.on('move', ({ x, z, rot } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !room.started || room.winner) return;
    clearExpiredEffects(p);
    if (getEffect(p, 'jailed')) return;
    if (![x, z, rot].every(Number.isFinite)) return;
    x = clamp(x); z = clamp(z);

    const now = Date.now();
    const dt = Math.max(0.016, Math.min(0.25, (now - p.lastMoveAt) / 1000));
    const baseSpeed = 6;
    let mult = 1;
    if (getEffect(p, 'slow')) mult *= 0.46;
    if (getEffect(p, 'boost')) mult *= 1.65;
    const allowed = baseSpeed * mult * dt * 1.9 + 0.35;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= allowed) { p.x = x; p.z = z; p.rot = rot; }
    p.lastMoveAt = now;
  });

  socket.on('interact', () => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !room.started || room.winner) return;

    if (p.carrying) {
      const bat = room.batteries.find(b => b.id === p.carrying);
      if (bat && distance(p, REACTOR) <= REACTOR.radius + 0.8) {
        bat.delivered = true;
        bat.carrierId = null;
        p.carrying = null;
        room.delivered += 1;
        addEvent(room, `${p.name} a livré une batterie (${room.delivered}/3).`);
        if (room.delivered >= room.batteries.length) endGame(room, 'Équipe', 'Les 3 batteries ont été livrées au réacteur.');
      } else if (bat) {
        bat.carrierId = null;
        bat.x = p.x; bat.z = p.z;
        p.carrying = null;
        addEvent(room, `${p.name} a posé une batterie.`);
      }
      return;
    }

    let nearest = null;
    let nearestD = Infinity;
    for (const bat of room.batteries) {
      if (bat.delivered || bat.carrierId) continue;
      const d = distance(p, bat);
      if (d < nearestD && d < 2.3) { nearest = bat; nearestD = d; }
    }
    if (nearest) {
      nearest.carrierId = p.id;
      p.carrying = nearest.id;
      addEvent(room, `${p.name} transporte une batterie.`);
    }
  });

  socket.on('ability', (cb = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const p = room?.players.get(socket.id);
    if (!room || !p || !room.started || room.winner || !p.role) return cb({ ok: false, error: 'Pouvoir indisponible.' });
    const now = Date.now();
    if (now < p.cooldownUntil) return cb({ ok: false, error: `Recharge : ${Math.ceil((p.cooldownUntil - now) / 1000)} s` });
    const def = ROLE_DEFS[p.role];
    let target;

    if (p.role === 'RUNNER') {
      p.effects = p.effects.filter(e => e.type !== 'boost');
      p.effects.push({ type: 'boost', expires: now + 5000, by: p.id });
      addEvent(room, `${p.name} active son Turbo !`);
    } else if (p.role === 'PHANTOM') {
      p.effects = p.effects.filter(e => e.type !== 'phase');
      p.effects.push({ type: 'phase', expires: now + 5000, by: p.id });
      addEvent(room, `${p.name} devient intangible quelques secondes.`);
    } else if (p.role === 'GUARDIAN') {
      target = nearestTarget(room, p, 6);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      target.effects = target.effects.filter(e => !['reverse', 'slow', 'jailed', 'shield'].includes(e.type));
      target.effects.push({ type: 'shield', expires: now + 7000, by: p.id });
      addEvent(room, `${p.name} protège ${target.name}.`);
    } else if (p.role === 'JAILER') {
      target = nearestTarget(room, p, 5.5);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      if (harmfulEffect(room, target, { type: 'jailed', expires: now + 4000, by: p.id }, p.name)) {
        addEvent(room, `${p.name} met ${target.name} en prison express !`);
      }
    } else if (p.role === 'SABOTEUR') {
      target = nearestTarget(room, p, 6);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      if (harmfulEffect(room, target, { type: 'reverse', expires: now + 6000, by: p.id }, p.name)) {
        addEvent(room, `${target.name} semble complètement désorienté…`);
      }
    } else if (p.role === 'GLUE') {
      target = nearestTarget(room, p, 6);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      if (harmfulEffect(room, target, { type: 'slow', expires: now + 6000, by: p.id }, p.name)) {
        p.glueTargets.add(target.id);
        addEvent(room, `${target.name} marche soudain dans de la colle !`);
        if (p.glueTargets.size >= 3 && !p.neutralWon) {
          p.neutralWon = true;
          io.to(p.id).emit('personalWin', 'Objectif neutre accompli : 3 joueurs différents englués !');
          addEvent(room, 'Un rôle neutre vient peut-être d’accomplir quelque chose…');
        }
        emitPrivateRole(p);
      }
    } else if (p.role === 'SWAPPER') {
      target = nearestTarget(room, p, 7);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      const px = p.x, pz = p.z;
      p.x = target.x; p.z = target.z;
      target.x = px; target.z = pz;
      addEvent(room, `${p.name} et ${target.name} permutent de place !`);
    } else if (p.role === 'BUMPER') {
      target = nearestTarget(room, p, 5.5);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      if (getEffect(target, 'shield')) {
        addEvent(room, `${target.name} résiste à la bousculade grâce à son bouclier !`);
      } else {
        let dx = target.x - p.x;
        let dz = target.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        target.x = clamp(target.x + dx * 4.5);
        target.z = clamp(target.z + dz * 4.5);
        addEvent(room, `${p.name} expédie ${target.name} à l’autre bout du couloir !`);
      }
    } else if (p.role === 'MAGNET') {
      target = nearestTarget(room, p, 8);
      if (!target) return cb({ ok: false, error: 'Aucune cible à portée.' });
      if (getEffect(target, 'shield')) {
        addEvent(room, `${target.name} résiste à l’attraction grâce à son bouclier !`);
      } else {
        let dx = p.x - target.x;
        let dz = p.z - target.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        target.x = clamp(p.x - dx * 1.7);
        target.z = clamp(p.z - dz * 1.7);
        addEvent(room, `${p.name} attire ${target.name} comme un aimant !`);
      }
    }

    p.cooldownUntil = now + def.cooldownMs;
    cb({ ok: true, cooldownMs: def.cooldownMs });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (p?.carrying) {
      const bat = room.batteries.find(b => b.id === p.carrying);
      if (bat) { bat.carrierId = null; bat.x = p.x; bat.z = p.z; }
    }
    room.players.delete(socket.id);
    if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null;
    if (room.players.size === 0) rooms.delete(room.code);
    else emitLobby(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.started || room.winner) continue;
    const elapsed = now - room.startAt;
    if (elapsed >= GAME_DURATION_MS) {
      endGame(room, 'Saboteur', 'Le temps est écoulé avant la livraison des batteries.');
      continue;
    }
    for (const p of room.players.values()) clearExpiredEffects(p);
    const snapshot = {
      now,
      timeLeft: Math.max(0, GAME_DURATION_MS - elapsed),
      delivered: room.delivered,
      reactor: REACTOR,
      players: [...room.players.values()].map(p => ({
        id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot,
        carrying: p.carrying,
        effects: p.effects.map(e => ({ type: e.type, expires: e.expires }))
      })),
      batteries: room.batteries.map(b => ({ ...b }))
    };
    io.to(room.code).emit('snapshot', snapshot);
  }
}, SNAPSHOT_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chaos Roles 3D v1.1 lancé sur le port ${PORT}`);
});
