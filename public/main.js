import * as THREE from 'three';

const socket = io();
const $ = s => document.querySelector(s);
const menu = $('#menu');
const lobby = $('#lobby');
const hud = $('#hud');
const gameOver = $('#gameOver');
const roleReveal = $('#roleReveal');
const joinBtn = $('#join');
const startBtn = $('#start');

let myId = null;
let roomCode = null;
let amHost = false;
let role = null;
let cooldownUntil = 0;
let started = false;
let latestSnapshot = null;
let myPos = new THREE.Vector3(0, 0, 0);
let myRot = 0;
let lastSent = 0;
let lastFrame = performance.now();
let serverNowOffset = 0;
let hasInitialServerPosition = false;
let revealTimer = null;
const keys = new Set();
const meshes = new Map();
const batteryMeshes = new Map();

const obstacleBoxes = [
  { x: -8, z: 0, w: 2.4, d: 9 },
  { x: 8, z: 0, w: 2.4, d: 9 },
  { x: 0, z: -8, w: 9, d: 2.4 },
  { x: 0, z: 8, w: 9, d: 2.4 }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060814);
scene.fog = new THREE.FogExp2(0x080a16, 0.025);

const camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.1, 110);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
$('#game').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x111425, 1.35));
const sun = new THREE.DirectionalLight(0xeaf4ff, 2.5);
sun.position.set(12, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -24; sun.shadow.camera.right = 24; sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
scene.add(sun);
const cyanLight = new THREE.PointLight(0x55efff, 45, 25, 2);
cyanLight.position.set(-10, 6, -10); scene.add(cyanLight);
const limeLight = new THREE.PointLight(0xbfff6a, 35, 22, 2);
limeLight.position.set(10, 5, 10); scene.add(limeLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(42, 42),
  new THREE.MeshStandardMaterial({ color: 0x141a2d, roughness: 0.88, metalness: 0.08 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(40, 20, 0x4d5c83, 0x252d47);
grid.position.y = 0.012;
if (Array.isArray(grid.material)) grid.material.forEach(m => { m.transparent = true; m.opacity = 0.35; });
else { grid.material.transparent = true; grid.material.opacity = 0.35; }
scene.add(grid);

function addFloorDetails() {
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5eeeff, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
  for (const r of [5.1, 10.5, 16.2]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.05, 96), ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.022;
    scene.add(ring);
  }
  const padMat = new THREE.MeshStandardMaterial({ color: 0x202941, emissive: 0x0c5260, emissiveIntensity: 0.9, roughness: 0.65 });
  [[-14,-14],[14,-14],[-14,14],[14,14]].forEach(([x,z]) => {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.55,0.1,24), padMat);
    pad.position.set(x,0.05,z); pad.receiveShadow = true; scene.add(pad);
  });
}
addFloorDetails();

function addStars() {
  const count = 430;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 28 + Math.random() * 38;
    positions[i*3] = Math.cos(angle) * radius;
    positions[i*3+1] = 5 + Math.random() * 28;
    positions[i*3+2] = Math.sin(angle) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9bbcff, size: 0.09, transparent: true, opacity: 0.52 }));
  scene.add(pts);
}
addStars();

function addObstacle(o, index) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(o.w, 2.5, o.d),
    new THREE.MeshStandardMaterial({ color: index % 2 ? 0x323b5a : 0x2a3553, roughness: 0.38, metalness: 0.35 })
  );
  base.position.y = 1.25; base.castShadow = base.receiveShadow = true; group.add(base);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x76efff, emissive: 0x1a8ba0, emissiveIntensity: 2.1, roughness: 0.25 });
  const horizontal = o.w > o.d;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? o.w * .82 : .09, .06, horizontal ? .09 : o.d * .82), trimMat);
  trim.position.y = 2.52; group.add(trim);

  const panelMat = new THREE.MeshStandardMaterial({ color: 0x11192d, emissive: 0x171f48, emissiveIntensity: 0.8, roughness: 0.45 });
  for (let i = -1; i <= 1; i++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 0.9 : o.w + .03, 0.45, horizontal ? o.d + .03 : 0.9), panelMat);
    panel.position.set(horizontal ? i * 1.35 : 0, 1.2, horizontal ? 0 : i * 1.35);
    group.add(panel);
  }
  group.position.set(o.x, 0, o.z); scene.add(group);
}
obstacleBoxes.forEach(addObstacle);

function addWalls() {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x101527, roughness: 0.7, metalness: 0.15 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x627cff, emissive: 0x3047b8, emissiveIntensity: 1.8 });
  const walls = [
    [0, 1.3, -20, 40, 2.6, .55, 40, .05], [0, 1.3, 20, 40, 2.6, .55, 40, .05],
    [-20, 1.3, 0, .55, 2.6, 40, .05, 40], [20, 1.3, 0, .55, 2.6, 40, .05, 40]
  ];
  for (const [x,y,z,w,h,d,gw,gd] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat); m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; scene.add(m);
    const g = new THREE.Mesh(new THREE.BoxGeometry(gw,.05,gd), glowMat); g.position.set(x,2.63,z); scene.add(g);
  }
}
addWalls();

const reactorGroup = new THREE.Group();
const reactorPad = new THREE.Mesh(
  new THREE.CylinderGeometry(3.25, 3.25, .18, 64),
  new THREE.MeshStandardMaterial({ color: 0x163945, emissive: 0x0b6c64, emissiveIntensity: 1.3, metalness: .3, roughness: .32 })
);
reactorPad.position.y = .09; reactorPad.receiveShadow = true; reactorGroup.add(reactorPad);
const reactorRing = new THREE.Mesh(
  new THREE.TorusGeometry(2.35, .09, 12, 64),
  new THREE.MeshStandardMaterial({ color: 0xbfff75, emissive: 0x63d743, emissiveIntensity: 2.6 })
);
reactorRing.rotation.x = Math.PI / 2; reactorRing.position.y = .26; reactorGroup.add(reactorRing);
const reactorCore = new THREE.Mesh(
  new THREE.CylinderGeometry(.72, 1.18, 2.5, 30),
  new THREE.MeshStandardMaterial({ color: 0xb9fff0, emissive: 0x23bd9e, emissiveIntensity: 2.7, metalness: .18, roughness: .2 })
);
reactorCore.position.y = 1.25; reactorCore.castShadow = true; reactorGroup.add(reactorCore);
const reactorHalo = new THREE.PointLight(0x55ffc8, 65, 13, 2); reactorHalo.position.y = 2; reactorGroup.add(reactorHalo);
scene.add(reactorGroup);

function deterministicColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const hues = [0x65efff,0xff668f,0xc2ff70,0xb98bff,0xffc65e,0x6c8bff,0x52e39f,0xff8f64];
  return hues[Math.abs(h) % hues.length];
}

function makeNameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '800 42px Inter, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(5,8,18,.75)';
  const width = Math.min(460, ctx.measureText(text).width + 80);
  ctx.roundRect((512-width)/2, 30, width, 68, 28); ctx.fill();
  ctx.fillStyle = '#f7f8ff'; ctx.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(3.5, .88, 1); sprite.position.y = 2.65; sprite.renderOrder = 20;
  return sprite;
}

function makePlayerMesh(id, name = 'Joueur') {
  const color = deterministicColor(id);
  const group = new THREE.Group();
  group.userData.id = id;

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .16 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.62, .9, 6, 12), bodyMat);
  body.position.y = 1.03; body.castShadow = true; group.add(body);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(.78, .85, .34), bodyMat.clone());
  backpack.position.set(0,1.04,-.55); backpack.rotation.x = -.06; backpack.castShadow = true; group.add(backpack);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(.4, 20, 14),
    new THREE.MeshPhysicalMaterial({ color: 0xd6fbff, emissive: 0x235d71, emissiveIntensity: .6, metalness:.2, roughness:.08, transmission:.05 })
  );
  visor.scale.set(1.16,.58,.42); visor.position.set(0,1.36,.54); group.add(visor);

  const footGeo = new THREE.CapsuleGeometry(.2,.22,4,8);
  const leftFoot = new THREE.Mesh(footGeo, bodyMat.clone()); leftFoot.position.set(-.3,.3,.05); leftFoot.rotation.z = Math.PI/2; group.add(leftFoot);
  const rightFoot = leftFoot.clone(); rightFoot.position.x = .3; group.add(rightFoot);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.72,28), new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:.22, depthWrite:false }));
  shadow.rotation.x = -Math.PI/2; shadow.position.y = .02; group.add(shadow);

  const shield = new THREE.Mesh(new THREE.TorusGeometry(.9,.045,8,40), new THREE.MeshBasicMaterial({ color:0x7effdc, transparent:true, opacity:.85 }));
  shield.rotation.x = Math.PI/2; shield.position.y = 1.1; shield.visible = false; group.add(shield); group.userData.shield = shield;

  const targetRing = new THREE.Mesh(new THREE.RingGeometry(.82,.95,32), new THREE.MeshBasicMaterial({ color:0x65efff, transparent:true, opacity:.8, side:THREE.DoubleSide }));
  targetRing.rotation.x = -Math.PI/2; targetRing.position.y = .035; targetRing.visible = false; group.add(targetRing); group.userData.targetRing = targetRing;

  group.add(makeNameSprite(name));
  scene.add(group); meshes.set(id, group); return group;
}

function makeBattery(id) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(.36,.36,1.05,16),
    new THREE.MeshStandardMaterial({ color:0xffd45d, emissive:0x8a5b00, emissiveIntensity:1.65, metalness:.28, roughness:.26 })
  );
  body.rotation.z = Math.PI/2; body.castShadow = true; g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.18,16), new THREE.MeshStandardMaterial({color:0x1c2437,metalness:.55,roughness:.28}));
  band.rotation.z = Math.PI/2; g.add(band);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(.18,.28,.18), new THREE.MeshStandardMaterial({color:0xf5fbff,emissive:0x86eaff,emissiveIntensity:1}));
  cap.position.x = .61; g.add(cap);
  const glow = new THREE.PointLight(0xffc957, 7, 3.5, 2); g.add(glow);
  scene.add(g); batteryMeshes.set(id,g); return g;
}

function collides(x, z) {
  if (Math.abs(x) > 18 || Math.abs(z) > 18) return true;
  if (hasEffect('phase')) return false;
  const r = .65;
  return obstacleBoxes.some(o => Math.abs(x - o.x) < o.w/2 + r && Math.abs(z - o.z) < o.d/2 + r);
}
function myEffects() { return latestSnapshot?.players.find(p => p.id === myId)?.effects || []; }
function hasEffect(type) {
  const now = Date.now() + serverNowOffset;
  return myEffects().some(e => e.type === type && e.expires > now);
}
function movementSpeed() {
  let s = 6;
  if (hasEffect('slow')) s *= .46;
  if (hasEffect('boost')) s *= 1.65;
  if (hasEffect('jailed')) s = 0;
  return s;
}
function updateMovement(dt) {
  if (!started || !myId || !roleReveal.classList.contains('hidden')) return;
  let x = 0, z = 0;
  if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (!x && !z) return;
  if (hasEffect('reverse')) { x *= -1; z *= -1; }
  const len = Math.hypot(x,z); x/=len; z/=len;
  const nx = myPos.x + x * movementSpeed() * dt;
  const nz = myPos.z + z * movementSpeed() * dt;
  if (!collides(nx, myPos.z)) myPos.x = nx;
  if (!collides(myPos.x, nz)) myPos.z = nz;
  myRot = Math.atan2(x, z);
}

function nearestOtherPlayer(max = 7.2) {
  if (!latestSnapshot) return null;
  const me = latestSnapshot.players.find(p => p.id === myId);
  if (!me) return null;
  let best = null, dBest = Infinity;
  for (const p of latestSnapshot.players) {
    if (p.id === myId) continue;
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < dBest && d <= max) { dBest = d; best = p; }
  }
  return best;
}

function syncScene(snapshot) {
  latestSnapshot = snapshot;
  serverNowOffset = snapshot.now - Date.now();
  $('#delivered').textContent = snapshot.delivered;
  const sec = Math.ceil(snapshot.timeLeft / 1000);
  $('#timer').textContent = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;

  const live = new Set();
  for (const p of snapshot.players) {
    live.add(p.id);
    const mesh = meshes.get(p.id) || makePlayerMesh(p.id, p.name);
    if (p.id === myId && !hasInitialServerPosition) {
      myPos.set(p.x, 0, p.z); myRot = p.rot; hasInitialServerPosition = true;
    }
    if (p.id !== myId) {
      mesh.position.x += (p.x - mesh.position.x) * .32;
      mesh.position.z += (p.z - mesh.position.z) * .32;
      mesh.rotation.y += (p.rot - mesh.rotation.y) * .28;
    } else {
      if (Math.hypot(myPos.x-p.x, myPos.z-p.z) > 1.5) myPos.set(p.x, 0, p.z);
      mesh.position.set(myPos.x, 0, myPos.z); mesh.rotation.y = myRot;
    }
    const shielded = p.effects.some(e => e.type === 'shield' && e.expires > snapshot.now);
    const phased = p.effects.some(e => e.type === 'phase' && e.expires > snapshot.now);
    mesh.userData.shield.visible = shielded;
    mesh.traverse(obj => {
      if (obj.isMesh && obj.material && obj !== mesh.userData.shield && obj !== mesh.userData.targetRing) {
        if ('transparent' in obj.material) {
          obj.material.transparent = phased;
          obj.material.opacity = phased ? .48 : 1;
        }
      }
    });
  }
  for (const [id, m] of meshes) if (!live.has(id)) { scene.remove(m); meshes.delete(id); }

  for (const b of snapshot.batteries) {
    const bm = batteryMeshes.get(b.id) || makeBattery(b.id);
    bm.visible = !b.delivered;
    if (!bm.visible) continue;
    if (b.carrierId) {
      const carrier = meshes.get(b.carrierId);
      if (carrier) bm.position.set(carrier.position.x, 1.55, carrier.position.z - .92);
    } else bm.position.set(b.x, .63, b.z);
  }

  const effectNames = myEffects().map(x => ({
    reverse:'Commandes inversées', slow:'Englué', jailed:'Immobilisé', shield:'Protégé', boost:'Turbo', phase:'Intangible'
  }[x.type])).filter(Boolean);
  $('#effects').textContent = effectNames.length ? `Effets : ${effectNames.join(' • ')}` : '';

  const target = nearestOtherPlayer();
  for (const [id,m] of meshes) m.userData.targetRing.visible = !!target && id === target.id && cooldownUntil <= Date.now();
  $('#targetHint').classList.toggle('hidden', !target || cooldownUntil > Date.now());
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(.05, (now - lastFrame) / 1000 || 0); lastFrame = now;
  updateMovement(dt);

  reactorRing.rotation.z += dt * .55;
  reactorCore.scale.y = 1 + Math.sin(now * .003) * .035;
  reactorHalo.intensity = 58 + Math.sin(now * .004) * 10;
  for (const [id,b] of batteryMeshes) {
    if (b.visible && !latestSnapshot?.batteries.find(x => x.id === id)?.carrierId) {
      b.rotation.y += dt * .55;
      b.position.y += Math.sin(now * .004 + id.charCodeAt(1)) * .0015;
    }
  }
  for (const m of meshes.values()) {
    if (m.userData.shield?.visible) m.userData.shield.rotation.z += dt * 1.4;
    if (m.userData.targetRing?.visible) m.userData.targetRing.rotation.z -= dt * 1.8;
  }

  if (started && myId) {
    const me = meshes.get(myId);
    if (me) {
      me.position.set(myPos.x, 0, myPos.z); me.rotation.y = myRot;
      const desired = new THREE.Vector3(myPos.x, 10.3, myPos.z + 12.2);
      camera.position.lerp(desired, 1 - Math.pow(.0015, dt));
      camera.lookAt(myPos.x, .72, myPos.z - 1.4);
    }
    if (now - lastSent > 50 && hasInitialServerPosition) {
      socket.emit('move', { x: myPos.x, z: myPos.z, rot: myRot }); lastSent = now;
    }
  } else {
    camera.position.x = Math.sin(now * .00012) * 4.5;
    camera.position.set(camera.position.x, 20, 24);
    camera.lookAt(0,0,0);
  }

  const cd = Math.max(0, cooldownUntil - Date.now());
  const cdEl = $('#cooldown');
  if (cd > 0) { cdEl.textContent = `${Math.ceil(cd/1000)}s`; cdEl.classList.remove('cooldown-ready'); }
  else { cdEl.textContent = 'PRÊT'; cdEl.classList.add('cooldown-ready'); }
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

function renderRoleCatalog(roles = []) {
  $('#roleCatalog').innerHTML = roles.map(r => `
    <article class="role-card" data-team="${escapeHtml(r.team)}">
      <div class="role-card-head"><span class="role-card-icon">${escapeHtml(r.icon || '?')}</span><div><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.team)} • ${escapeHtml(r.ability)}</small></div></div>
      <p>${escapeHtml(r.description)}</p>
    </article>`).join('');
}

function teamClass(team) {
  return team === 'Saboteur' ? 'team-saboteur' : team === 'Neutre' ? 'team-neutre' : 'team-equipe';
}
function applyRole(data, reveal = false) {
  if (!data) return;
  role = data;
  $('#roleName').textContent = data.name;
  $('#roleTeam').textContent = data.team;
  $('#roleDesc').textContent = data.description + (data.personalGoal ? ` Progression : ${data.personalProgress}/${data.personalGoal}.` : '');
  $('#abilityName').textContent = data.ability;
  $('#roleIcon').textContent = data.icon || '?';
  const hudCard = $('#roleHud');
  hudCard.classList.remove('team-equipe','team-saboteur','team-neutre'); hudCard.classList.add(teamClass(data.team));

  $('#revealIcon').textContent = data.icon || '?';
  $('#revealName').textContent = data.name;
  $('#revealTeam').textContent = data.team;
  $('#revealDesc').textContent = data.description + (data.personalGoal ? ` Objectif : ${data.personalProgress}/${data.personalGoal}.` : '');
  $('#revealAbility').textContent = data.ability;
  const card = roleReveal.querySelector('.role-reveal-card');
  card.classList.remove('team-equipe','team-saboteur','team-neutre'); card.classList.add(teamClass(data.team));
  if (reveal && started) showRoleReveal();
}
function showRoleReveal() {
  if (!role) return;
  roleReveal.classList.remove('hidden');
  keys.clear();
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => roleReveal.classList.add('hidden'), 5200);
}
function closeRoleReveal() { roleReveal.classList.add('hidden'); clearTimeout(revealTimer); }

joinBtn.addEventListener('click', () => {
  $('#menuError').textContent = '';
  socket.emit('joinRoom', { name: $('#name').value, roomCode: $('#room').value }, res => {
    if (!res?.ok) { $('#menuError').textContent = res?.error || 'Connexion impossible.'; return; }
    myId = res.id; roomCode = res.code;
    menu.classList.add('hidden'); lobby.classList.remove('hidden'); $('#roomCode').textContent = roomCode;
    if (res.roles) renderRoleCatalog(res.roles);
  });
});
startBtn.addEventListener('click', () => {
  $('#lobbyError').textContent = '';
  socket.emit('startGame', res => { if (!res?.ok) $('#lobbyError').textContent = res?.error || 'Impossible de lancer.'; });
});
$('#copyCode').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(roomCode || ''); showToast('Code copié !', 1300); }
  catch { showToast(`Code : ${roomCode}`, 1800); }
});
$('#closeReveal').addEventListener('click', closeRoleReveal);
$('#replay').addEventListener('click', () => location.reload());
['#name','#room'].forEach(sel => $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); }));

socket.on('lobby', data => {
  roomCode = data.code;
  amHost = data.hostId === myId;
  startBtn.classList.toggle('hidden', !amHost || data.started);
  $('#playerCount').textContent = `${data.players.length}/12`;
  $('#playerList').innerHTML = data.players.map(p => `<div class="player-row"><div class="player-ident"><span class="player-avatar">${escapeHtml(p.name.slice(0,2).toUpperCase())}</span><span>${escapeHtml(p.name)}</span></div>${p.host ? '<b class="host-tag">HÔTE</b>' : ''}</div>`).join('');
  if (data.roles) renderRoleCatalog(data.roles);
});
socket.on('role', data => applyRole(data, started));
socket.on('gameStarted', () => {
  started = true; hasInitialServerPosition = false; keys.clear();
  lobby.classList.add('hidden'); hud.classList.remove('hidden');
  socket.emit('getMyRole', res => {
    if (res?.ok) applyRole(res.role, true);
    else showToast('Synchronisation du rôle…', 1200);
  });
});
socket.on('snapshot', snap => syncScene(snap));
socket.on('gameEvent', text => addEvent(text));
socket.on('personalWin', text => showToast(text, 4200));
socket.on('gameOver', data => {
  started = false; keys.clear(); hud.classList.add('hidden'); roleReveal.classList.add('hidden'); gameOver.classList.remove('hidden');
  $('#winner').textContent = `Victoire : ${data.winner}`; $('#reason').textContent = data.reason;
});
socket.on('connect_error', () => showToast('Connexion au serveur impossible.', 2600));

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}
document.addEventListener('keydown', e => {
  if (isTypingTarget(e.target)) return;
  const movementCodes = ['KeyW','KeyZ','KeyA','KeyQ','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  if (movementCodes.includes(e.code)) { keys.add(e.code); e.preventDefault(); }
  if (e.repeat || !started || !roleReveal.classList.contains('hidden')) return;
  if (e.code === 'KeyE') { e.preventDefault(); socket.emit('interact'); }
  if (e.code === 'KeyF') {
    e.preventDefault();
    socket.emit('ability', res => {
      if (res?.ok) cooldownUntil = Date.now() + res.cooldownMs;
      else showToast(res?.error || 'Pouvoir indisponible.', 1700);
    });
  }
  if (e.code === 'Tab') { e.preventDefault(); showRoleReveal(); }
});
document.addEventListener('keyup', e => {
  if (!isTypingTarget(e.target)) keys.delete(e.code);
});
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll('input').forEach(input => input.addEventListener('focus', () => keys.clear()));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

function addEvent(text) {
  const d = document.createElement('div'); d.className = 'event'; d.textContent = text; $('#events').appendChild(d);
  while ($('#events').children.length > 5) $('#events').firstChild.remove();
  setTimeout(() => d.remove(), 6500);
}
function showToast(text, ms=2000) {
  const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(showToast.timer); showToast.timer = setTimeout(()=>t.classList.add('hidden'),ms);
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
