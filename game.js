// --- Audio Synth & Setup ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
let aCtx = null;

function initAudio() {
  if (!aCtx) {
    aCtx = new AudioContext();
  }
  if (aCtx.state === 'suspended') {
    aCtx.resume();
  }
}

function playTone(freq, type, dur, volVal) {
  if (!aCtx) return;
  let osc = aCtx.createOscillator();
  let gain = aCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, aCtx.currentTime);
  gain.gain.setValueAtTime(volVal, aCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, aCtx.currentTime + dur);
  osc.connect(gain);
  gain.connect(aCtx.destination);
  osc.start();
  osc.stop(aCtx.currentTime + dur);
}

function playTypeSound() { playTone(800 + Math.random() * 200, 'square', 0.05, 0.03); }

function playSfx(type) {
  if (!aCtx) return;
  if (type === 'creeper') playTone(150 + Math.random() * 50, 'sawtooth', 0.5, 0.1);
  else if (type === 'villager') playTone(220, 'triangle', 0.4, 0.15);
  else if (type === 'zombie') playTone(80, 'sawtooth', 0.6, 0.15);
  else if (type === 'enderman') {
    let osc = aCtx.createOscillator();
    let gain = aCtx.createGain();
    osc.frequency.setValueAtTime(400, aCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, aCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.2, aCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, aCtx.currentTime + 0.5);
    osc.connect(gain); gain.connect(aCtx.destination);
    osc.start(); osc.stop(aCtx.currentTime + 0.5);
  }
  else if (type === 'piglin') playTone(120, 'square', 0.3, 0.15);
  else if (type === 'wither') playTone(60, 'sawtooth', 0.8, 0.2);
}

// --- Initialization & State ---
const canvas = document.getElementById('gameCanvas');
let ctx = canvas.getContext('2d');
const domainVideo = document.createElement('video');
domainVideo.src = 'static/wither-domain.mp4';
domainVideo.loop = true;
domainVideo.muted = true;
domainVideo.playsInline = true;
let CS = 48;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const state = {
  started: false,
  map: 'main',
  keys: {},
  player: { x: 16, y: 16, frame: 0, dir: 'down', moving: false, tx: 16, ty: 16, moveTimer: 0, hp: 100, maxHp: 100 },
  inventory: { firewalls: 0, routers: 0, auditLogs: 0 },
  portalsCleared: [false, false, false, false, false],
  dialogueOpen: false,
  combatOpen: false,
  cutscenePlaying: false,
  bossRevealed: false,
  bossDefeated: false,
  worldRed: false,
  witherSpawned: false,
  finalMobs: [],
  flashTimer: 0,
  battle: { active: false, enemy: null, enemyHp: 100, enemyMaxHp: 100 },
  shakeTimer: 0
};

// --- Database / Login System ---
let db;
let currentUser = null;
let currentWorldId = null;
let activeWorlds = [];
let selectedWorldIndex = -1;

async function initDB() {
  try {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    const savedDb = localStorage.getItem('cyberDefenderDB');
    if (savedDb) {
      const uInt8Array = new Uint8Array(savedDb.split(',').map(Number));
      db = new SQL.Database(uInt8Array);
    } else {
      db = new SQL.Database();
      db.run("CREATE TABLE users (username TEXT UNIQUE, password TEXT);");
      db.run("CREATE TABLE worlds (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, name TEXT, created TEXT, progress TEXT);");
      saveDB();
    }
    // Ensure worlds table exists for backwards compatibility
    try {
      db.run("CREATE TABLE IF NOT EXISTS worlds (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, name TEXT, created TEXT, progress TEXT);");
      saveDB();
    } catch (e) { }
  } catch (e) {
    console.error("Failed to load sql.js, skipping DB init", e);
  }
  requestAnimationFrame(drawLogin);
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  localStorage.setItem('cyberDefenderDB', data.toString());
}

document.getElementById('btn-create').addEventListener('click', () => {
  if (!db) return alert("Database not initialized.");
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');

  if (u.length < 3 || u.length > 8) return msg.innerText = "Error: Username must be 3-8 chars.";
  if (p.length < 8 || !/[A-Z]/.test(p) || !/[0-9]/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    return msg.innerText = "Error: Pass needs 8+ chars, 1 uppercase, 1 number, 1 special.";
  }

  try {
    db.run("INSERT INTO users VALUES (?, ?)", [u, p]);
    saveDB();
    msg.style.color = "#4CAF50";
    msg.innerText = "Account Created! You may now Login.";
  } catch (e) {
    msg.style.color = "#F44336";
    msg.innerText = "Error: Username already exists.";
  }
});

document.getElementById('btn-login').addEventListener('click', () => {
  if (!db) return alert("Database not initialized.");
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');

  const res = db.exec("SELECT * FROM users WHERE username=? AND password=?", [u, p]);
  if (res.length > 0) {
    currentUser = u;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('world-select-screen').classList.remove('hidden');
    renderWorlds();
  } else {
    msg.style.color = "#F44336";
    msg.innerText = "Error: Invalid credentials.";
  }
});

// --- World Selection Logic ---
function renderWorlds() {
  const list = document.getElementById('world-list');
  list.innerHTML = '';
  activeWorlds = [];
  selectedWorldIndex = -1;

  const res = db.exec("SELECT * FROM worlds WHERE username=?", [currentUser]);
  if (res.length > 0) {
    let rows = res[0].values;
    rows.forEach((row, i) => {
      // id: row[0], username: row[1], name: row[2], created: row[3], progress: row[4]
      activeWorlds.push({ id: row[0], name: row[2], created: row[3], progress: row[4] });

      let progObj = JSON.parse(row[4]);
      let clearedCount = progObj.portalsCleared ? progObj.portalsCleared.filter(v => v).length : 0;

      function escapeHTML(str) {
        if (!str) return "";
        return str.replace(/[&<>'"]/g, tag => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
      }
      let safeName = escapeHTML(row[2]);
      let safeDate = escapeHTML(row[3]);

      let div = document.createElement('div');
      div.className = 'world-item';

      let textDiv = document.createElement('div');
      textDiv.innerHTML = `<div class="world-item-name">${safeName}</div>
                           <div class="world-item-details">${safeName} (${safeDate})<br>Progress: ${clearedCount}/5 Threats Cleared</div>`;

      let actionsDiv = document.createElement('div');
      actionsDiv.className = 'world-actions-inline';
      actionsDiv.innerHTML = `
        <span class="edit-world" onclick="editWorld(${row[0]}, '${safeName}'); event.stopPropagation();" title="Edit Name">✏️</span>
        <span class="reset-world" onclick="resetWorld(${row[0]}); event.stopPropagation();" title="Reset Progress">🔄</span>
      `;

      div.appendChild(textDiv);
      div.appendChild(actionsDiv);
      div.onclick = () => {
        document.querySelectorAll('.world-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedWorldIndex = i;
      };
      list.appendChild(div);
    });
  }
}

// Custom Modal Logic
const cwModal = document.getElementById('create-world-modal');
const cwInput = document.getElementById('new-world-name');

document.getElementById('btn-create-world').addEventListener('click', () => {
  if (activeWorlds.length >= 5) return alert("Maximum 5 worlds allowed per user.");
  cwModal.classList.remove('hidden');
  cwInput.value = '';
  cwInput.focus();
});

document.getElementById('btn-cancel-create').addEventListener('click', () => {
  cwModal.classList.add('hidden');
});

document.getElementById('btn-confirm-create').addEventListener('click', () => {
  let name = cwInput.value.trim().substring(0, 15);
  if (!name) return alert("Please enter a valid name.");

  let date = new Date().toLocaleString();
  let defaultProgress = JSON.stringify({
    portalsCleared: [false, false, false, false, false],
    bossDefeated: false,
    worldRed: false,
    witherSpawned: false,
    finalMobs: []
  });

  db.run("INSERT INTO worlds (username, name, created, progress) VALUES (?, ?, ?, ?)", [currentUser, name, date, defaultProgress]);
  saveDB();
  cwModal.classList.add('hidden');
  renderWorlds();
});

document.getElementById('btn-delete-world').addEventListener('click', () => {
  if (selectedWorldIndex === -1) return alert("Please select a world to delete.");
  let selected = activeWorlds[selectedWorldIndex];
  if (confirm(`Are you sure you want to completely delete "${selected.name}"? This cannot be undone.`)) {
    db.run("DELETE FROM worlds WHERE id = ?", [selected.id]);
    saveDB();
    renderWorlds();
  }
});

window.editWorld = function (id, oldName) {
  let newName = prompt(`Enter new name for world "${oldName}":`, oldName);
  if (newName && newName.trim().length > 0) {
    db.run("UPDATE worlds SET name = ? WHERE id = ?", [newName.trim().substring(0, 15), id]);
    saveDB();
    renderWorlds();
  }
};

window.resetWorld = function (id) {
  if (confirm("Are you sure you want to reset this world? All progress, items, and boss defeats will be permanently wiped!")) {
    let defaultProgress = JSON.stringify({
      portalsCleared: [false, false, false, false, false],
      bossDefeated: false,
      worldRed: false,
      witherSpawned: false,
      finalMobs: []
    });
    db.run("UPDATE worlds SET progress = ? WHERE id = ?", [defaultProgress, id]);
    saveDB();
    renderWorlds();
  }
};

document.getElementById('btn-cancel-world').addEventListener('click', () => {
  currentUser = null;
  document.getElementById('world-select-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
});

document.getElementById('btn-play-world').addEventListener('click', () => {
  if (selectedWorldIndex === -1) return alert("Please select a world first.");

  let selected = activeWorlds[selectedWorldIndex];
  currentWorldId = selected.id;

  // Fully reset game state to defaults before applying loaded progress
  state.map = 'main';
  state.player = { x: 16, y: 16, frame: 0, dir: 'down', moving: false, tx: 16, ty: 16, moveTimer: 0, hp: 100, maxHp: 100 };
  state.inventory = { firewalls: 0, routers: 0, auditLogs: 0 };
  state.dialogueOpen = false;
  state.combatOpen = false;
  state.cutscenePlaying = false;
  state.bossRevealed = false;
  state.flashTimer = 0;
  state.battle = { active: false, enemy: null, enemyHp: 100, enemyMaxHp: 100 };
  state.shakeTimer = 0;

  // Load State
  let p = JSON.parse(selected.progress);
  state.portalsCleared = p.portalsCleared;
  state.bossDefeated = p.bossDefeated;
  state.worldRed = p.worldRed;
  state.witherSpawned = p.witherSpawned;
  if (p.finalMobs) state.finalMobs = p.finalMobs;

  // Sync loaded state with the main map
  let pCoords = { 3: [4, 28], 4: [4, 4], 5: [28, 10], 6: [28, 28], 7: [16, 4] };
  let mapObj = maps['main'];
  for (let i = 0; i < 5; i++) {
    let pid = i + 3;
    if (pCoords[pid]) {
      if (state.portalsCleared[i]) {
        mapObj.data[pCoords[pid][1] * mapObj.w + pCoords[pid][0]] = 15; // Set to dirt path
      } else {
        mapObj.data[pCoords[pid][1] * mapObj.w + pCoords[pid][0]] = pid; // Restore portal
      }
    }
  }

  document.getElementById('world-select-screen').classList.add('hidden');

  if (state.bossDefeated) {
    startCreditsSequence();
    return;
  }

  // Enter Game
  state.started = true;
  let audio = document.getElementById('bgm');
  audio.play().catch(e => {
    document.body.addEventListener('click', () => { if (audio.paused) audio.play(); }, { once: true });
  });
});

function saveWorldState() {
  if (!currentWorldId || !db) return;
  let p = {
    portalsCleared: state.portalsCleared,
    bossDefeated: state.bossDefeated,
    worldRed: state.worldRed,
    witherSpawned: state.witherSpawned,
    finalMobs: state.finalMobs
  };
  db.run("UPDATE worlds SET progress = ? WHERE id = ?", [JSON.stringify(p), currentWorldId]);
  saveDB();
}

document.getElementById('btn-resume').addEventListener('click', () => {
  state.paused = false;
  document.getElementById('pause-modal').classList.add('hidden');
});

document.getElementById('btn-pause-instructions').addEventListener('click', () => {
  document.getElementById('instructions-modal').classList.remove('hidden');
});

document.getElementById('close-instructions-btn').addEventListener('click', () => {
  document.getElementById('instructions-modal').classList.add('hidden');
});

document.getElementById('btn-exit-world').addEventListener('click', () => {
  if (confirm("Save and exit world?")) {
    saveWorldState();
    state.started = false;
    state.paused = false;
    document.getElementById('pause-modal').classList.add('hidden');
    document.getElementById('world-select-screen').classList.remove('hidden');
    document.getElementById('bgm').pause();
    document.getElementById('bgm').currentTime = 0;
    document.getElementById('final-bgm').pause();
    document.getElementById('final-bgm').currentTime = 0;
    domainVideo.pause();
    renderWorlds();
  }
});

let loginSteveCrouch = false;
setInterval(() => loginSteveCrouch = !loginSteveCrouch, 800);

function drawLogin() {
  if (document.getElementById('login-screen').classList.contains('hidden')) return;
  const lCanvas = document.getElementById('loginCanvas');
  const lCtx = lCanvas.getContext('2d');
  lCanvas.width = window.innerWidth;
  lCanvas.height = window.innerHeight;

  ctx = lCtx; // Hijack global ctx

  // Draw Sky
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(0, 0, lCanvas.width, lCanvas.height);

  // Draw Grass Floor
  ctx.fillStyle = '#4CAF50';
  ctx.fillRect(0, lCanvas.height * 0.7, lCanvas.width, lCanvas.height * 0.3);
  ctx.fillStyle = '#795548';
  ctx.fillRect(0, lCanvas.height * 0.75, lCanvas.width, lCanvas.height * 0.25);

  // Draw Steve
  let sx = lCanvas.width * 0.2;
  let sy = lCanvas.height * 0.7 - 80;
  if (loginSteveCrouch) sy += 10;
  drawSprite(sx, sy, 80, 'steve');

  ctx = canvas.getContext('2d'); // Restore
  requestAnimationFrame(drawLogin);
}

const cyberDefinitions = [
  { t: "Phishing", d: "Fraudulent messages designed to trick you into revealing sensitive info." },
  { t: "Deepfake", d: "AI-generated media replacing a person's likeness/voice to deceive." },
  { t: "Malware (Virus)", d: "Malicious software designed to cause damage to a system or network." },
  { t: "Trojan / Keylogger", d: "Disguised malware that secretly records keystrokes to steal data." },
  { t: "Brute Force", d: "Trial-and-error method to guess passwords or encryption keys." },
  { t: "Zero-Day Attack", d: "An attack targeting a newly discovered vulnerability before a patch exists." }
];

window.flipToDefinition = function (index) {
  const page = document.getElementById('book-content-page');
  page.classList.add('flip');

  setTimeout(() => {
    document.getElementById('def-title').innerText = cyberDefinitions[index].t;
    document.getElementById('def-text').innerText = cyberDefinitions[index].d;
    page.classList.remove('flip');
  }, 300); // Swap text halfway through animation
};

// Call initDB on load
window.onload = initDB;

// Start Button Logic
const instructionsModal = document.getElementById('instructions-modal');
document.getElementById('start-game-btn').addEventListener('click', () => {
  initAudio();
  instructionsModal.classList.add('hidden');
  state.started = true;
  document.getElementById('bgm').play().catch(e => console.log(e));
});

// --- Map Data ---
function getBiome(x, y) {
  let noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  let r = noise - Math.floor(noise);

  let dx = x + Math.sin(y * 0.5) * 1.5 + (r - 0.5) * 1.5;
  let dy = y + Math.cos(x * 0.5) * 1.5 + (r - 0.5) * 1.5;

  if (dx >= 10 && dx <= 22 && dy >= 10 && dy <= 22) return 0;
  if (dx < 10 && dy <= 16) return 20;
  if (dx < 10 && dy > 16) return 21;
  if (dx >= 10 && dx <= 22 && dy < 10) return 22;
  if (dx > 22 && dy <= 22) return 23;
  return 24;
}

function generateMainMap() {
  let data = [];
  for (let y = 0; y < 33; y++) {
    for (let x = 0; x < 33; x++) {
      if (x === 0 || y === 0 || x === 32 || y === 32) data.push(1);
      else if (x === 4 && y === 28) data.push(3); // Creeper
      else if (x === 4 && y === 4) data.push(4); // Trader
      else if (x === 28 && y === 10) data.push(5); // Zombie
      else if (x === 28 && y === 28) data.push(6); // Enderman
      else if (x === 16 && y === 4) data.push(7); // Piglin
      else data.push(getBiome(x, y));
    }
  }

  let setPath = (px, py) => {
    let idx = py * 33 + px;
    if (data[idx] !== 1 && (data[idx] < 3 || data[idx] > 7)) data[idx] = 15;
  };

  for (let y = 13; y <= 19; y++) {
    for (let x = 13; x <= 19; x++) {
      if (Math.hypot(x - 16, y - 16) <= 2.5) setPath(x, y);
    }
  }

  let portals = [[4, 4], [4, 28], [16, 4], [28, 10], [28, 28]];
  // Fixed Seed for paths so they don't change every load
  let s = 12345;
  let rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  portals.forEach(([px, py]) => {
    let cx = 16, cy = 16;
    while (cx !== px || cy !== py) {
      if (rand() < 0.5 && cx !== px) {
        cx += Math.sign(px - cx);
      } else if (cy !== py) {
        cy += Math.sign(py - cy);
      } else {
        cx += Math.sign(px - cx);
      }
      setPath(cx, cy);
      if (rand() < 0.4) setPath(cx + 1, cy);
      if (rand() < 0.4) setPath(cx, cy + 1);
    }
  });

  for (let i = 0; i < 40; i++) {
    let rx = Math.floor(rand() * 31) + 1;
    let ry = Math.floor(rand() * 31) + 1;
    let idx = ry * 33 + rx;
    if (data[idx] >= 20 || data[idx] === 0) {
      data[idx] = 2;
    }
  }

  return { width: 33, height: 33, w: 33, h: 33, start: { x: 16, y: 16 }, data: data };
}

const maps = {
  main: generateMainMap(),
  portal3: { width: 10, height: 10, data: new Array(100).fill(1).map((_, i) => i < 10 || i > 89 || i % 10 == 0 || i % 10 == 9 ? 2 : 1), npc: { x: 4, y: 2, type: 'creeper', name: 'Phishing Creeper' } },
  portal4: { width: 10, height: 10, data: new Array(100).fill(1).map((_, i) => i < 10 || i > 89 || i % 10 == 0 || i % 10 == 9 ? 2 : 1), npc: { x: 4, y: 2, type: 'villager', name: 'Deepfake Trader' } },
  portal5: { width: 10, height: 10, data: new Array(100).fill(1).map((_, i) => i < 10 || i > 89 || i % 10 == 0 || i % 10 == 9 ? 2 : 1), npc: { x: 4, y: 2, type: 'zombie', name: 'Malware Zombie' } },
  portal6: { width: 10, height: 10, data: new Array(100).fill(1).map((_, i) => i < 10 || i > 89 || i % 10 == 0 || i % 10 == 9 ? 2 : 1), npc: { x: 4, y: 2, type: 'enderman', name: 'Keylog Enderman' } },
  portal7: { width: 10, height: 10, data: new Array(100).fill(1).map((_, i) => i < 10 || i > 89 || i % 10 == 0 || i % 10 == 9 ? 2 : 1), npc: { x: 4, y: 2, type: 'piglin', name: 'Brute Piglin' } }
};
const portalExits = { portal3: { x: 4, y: 29 }, portal4: { x: 4, y: 5 }, portal5: { x: 28, y: 11 }, portal6: { x: 28, y: 29 }, portal7: { x: 16, y: 5 } };

const mapDataObj = (mapName) => maps[mapName];
const getTile = (map, x, y) => {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 2;
  return map.data[y * map.w + x];
};
const setTile = (map, x, y, val) => {
  if (x >= 0 && y >= 0 && x < map.w && y < map.h) map.data[y * map.w + x] = val;
};

// --- Render Functions ---
function drawRect(x, y, w, h, c) {
  ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
}

function drawBlock(x, y, size, type) {
  let isCorruptedWall = false;
  if (state.worldRed && state.map === 'main') {
    let mx = Math.floor(x / CS); let my = Math.floor(y / CS);
    if (mx < 11 || mx > 21 || my < 11 || my > 21) isCorruptedWall = true;
  }

  if (isCorruptedWall) {
    drawRect(x, y, size, size, '#111');
    drawRect(x + 2, y + 2, size - 4, size - 4, '#F00');
    return;
  }

  if (state.worldRed && type !== 2 && type !== 1 && type < 3) {
    drawRect(x, y, size, size, '#500');
  } else if (type === 0) { // Grass
    drawRect(x, y, size, size, '#4CAF50'); drawRect(x + size * 0.1, y + size * 0.1, size * 0.2, size * 0.2, '#388E3C');
  } else if (type === 1) { // Wall
    drawRect(x, y, size, size, '#333');
  } else if (type === 2) { // Old Wall/Tree
    drawRect(x, y, size, size, '#1B5E20'); drawRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6, '#388E3C');
  } else if (type === 20) { // Sand
    drawRect(x, y, size, size, '#EEDC82'); drawRect(x + size * 0.3, y + size * 0.5, size * 0.1, size * 0.1, '#D4C447');
    if ((x + y) % 5 === 0) drawRect(x + size * 0.7, y + size * 0.7, size * 0.1, size * 0.2, '#2E8B57'); // Tiny cactus
  } else if (type === 21) { // Snow
    drawRect(x, y, size, size, '#FFFAFA'); drawRect(x + size * 0.6, y + size * 0.2, size * 0.1, size * 0.1, '#EEE');
    if ((x + y) % 7 === 0) drawRect(x + size * 0.8, y + size * 0.8, size * 0.15, size * 0.15, '#ADD8E6'); // Ice patch
  } else if (type === 22) { // Forest
    drawRect(x, y, size, size, '#2E8B57'); drawRect(x + size * 0.2, y + size * 0.7, size * 0.15, size * 0.15, '#1B5E20');
    if ((x + y) % 3 === 0) drawRect(x + size * 0.7, y + size * 0.1, size * 0.2, size * 0.2, '#006400'); // Dense leaves
  } else if (type === 23) { // Mountain
    drawRect(x, y, size, size, '#708090'); drawRect(x + size * 0.4, y + size * 0.4, size * 0.2, size * 0.2, '#2F4F4F');
    if ((x + y) % 6 === 0) drawRect(x + size * 0.1, y + size * 0.8, size * 0.2, size * 0.1, '#A9A9A9'); // Gravel
  } else if (type === 24) { // Nether (Now Purple)
    drawRect(x, y, size, size, '#4A004A'); drawRect(x + size * 0.5, y + size * 0.5, size * 0.2, size * 0.2, '#800080');
    if ((x + y) % 4 === 0) drawRect(x + size * 0.8, y + size * 0.2, size * 0.1, size * 0.3, '#DA70D6'); // Bright purple crack
  } else if (type === 15) { // Dirt Path
    drawRect(x, y, size, size, '#8B5A2B'); drawRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6, '#A0522D');
  } else if (type >= 3 && type <= 7) { // Portal
    let colors = ['#00BCD4', '#E91E63', '#8BC34A', '#9C27B0', '#FF9800'];
    let c = colors[type - 3];
    let locked = (!state.portalsCleared[0] || !state.portalsCleared[1]) && type >= 5;
    if (locked) c = '#444'; // Grey out locked portals

    drawRect(x, y, size, size, '#000');
    drawRect(x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8, c);
    ctx.strokeStyle = locked ? '#888' : '#FFF'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * 0.2 + (Math.sin(Date.now() * 0.01) * 5), 0, Math.PI * 2); ctx.stroke();

    if (locked) { // Lock icon
      drawRect(x + size * 0.4, y + size * 0.5, size * 0.2, size * 0.2, '#FFD700');
      drawRect(x + size * 0.45, y + size * 0.3, size * 0.1, size * 0.2, '#CCC');
    }
  } else if (type === 8) { // Firewall
    drawRect(x, y, size, size, '#795548'); drawRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6, '#F44336');
    drawRect(x + size * 0.3, y + size * 0.4, size * 0.4, size * 0.2, '#FFF');
  } else if (type === 9) { // Router
    drawRect(x, y, size, size, '#795548'); drawRect(x + size * 0.2, y + size * 0.4, size * 0.6, size * 0.4, '#2196F3');
    drawRect(x + size * 0.3, y + size * 0.1, size * 0.05, size * 0.3, '#FFF'); drawRect(x + size * 0.65, y + size * 0.1, size * 0.05, size * 0.3, '#FFF');
  } else if (type === 10) { // Audit Log
    drawRect(x, y, size, size, '#795548'); drawRect(x + size * 0.3, y + size * 0.2, size * 0.4, size * 0.6, '#FFF');
    drawRect(x + size * 0.4, y + size * 0.3, size * 0.2, size * 0.05, '#000'); drawRect(x + size * 0.4, y + size * 0.5, size * 0.2, size * 0.05, '#000');
  }
}

function drawSprite(x, y, size, type, isFlashy = false) {
  let ox = x + size / 2; let oy = y + size / 2;
  let bop = state.player.moving && type === 'steve' ? (Date.now() % 400 < 200 ? -2 : 0) : 0;
  oy += bop;

  if (isFlashy) {
    // Flashy spawn effect for boss mobs
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, 1 - state.flashTimer)})`;
    ctx.beginPath(); ctx.arc(ox, oy, size * (1 + state.flashTimer * 3), 0, Math.PI * 2); ctx.fill();
  }

  if (type === 'steve') {
    // Head (Skin)
    drawRect(ox - size * 0.25, oy - size * 0.4, size * 0.5, size * 0.45, '#E7A47B');
    // Hair Top
    drawRect(ox - size * 0.25, oy - size * 0.4, size * 0.5, size * 0.1, '#563620');
    // Hair Sides
    drawRect(ox - size * 0.25, oy - size * 0.3, size * 0.1, size * 0.15, '#563620');
    drawRect(ox + size * 0.15, oy - size * 0.3, size * 0.1, size * 0.15, '#563620');

    // Eyes (White)
    drawRect(ox - size * 0.15, oy - size * 0.2, size * 0.1, size * 0.05, '#FFF');
    drawRect(ox + size * 0.05, oy - size * 0.2, size * 0.1, size * 0.05, '#FFF');
    // Pupils (Dark Blue on the INNER sides)
    drawRect(ox - size * 0.05, oy - size * 0.2, size * 0.05, size * 0.05, '#36318C');
    drawRect(ox + size * 0.05, oy - size * 0.2, size * 0.05, size * 0.05, '#36318C');

    // Nose
    drawRect(ox - size * 0.05, oy - size * 0.15, size * 0.1, size * 0.05, '#B47155');
    // Mouth
    drawRect(ox - size * 0.1, oy - size * 0.1, size * 0.2, size * 0.05, '#371E10');

    // Shirt (Cyan)
    drawRect(ox - size * 0.25, oy + size * 0.05, size * 0.5, size * 0.3, '#00A5B4');
    // Arms (Skin)
    drawRect(ox - size * 0.4, oy + size * 0.05, size * 0.15, size * 0.3, '#E7A47B');
    drawRect(ox + size * 0.25, oy + size * 0.05, size * 0.15, size * 0.3, '#E7A47B');
    // Sleeves (Cyan over top of arms)
    drawRect(ox - size * 0.4, oy + size * 0.05, size * 0.15, size * 0.1, '#00A5B4');
    drawRect(ox + size * 0.25, oy + size * 0.05, size * 0.15, size * 0.1, '#00A5B4');

    // Pants (Dark Blue/Purple)
    drawRect(ox - size * 0.25, oy + size * 0.35, size * 0.5, size * 0.2, '#36318C');
    // Shoes (Grey)
    drawRect(ox - size * 0.25, oy + size * 0.5, size * 0.2, size * 0.05, '#4C4C4C');
    drawRect(ox + size * 0.05, oy + size * 0.5, size * 0.2, size * 0.05, '#4C4C4C');
  } else if (type === 'steve-back') {
    // Back perspective of Steve
    drawRect(ox - size * 0.25, oy - size * 0.4, size * 0.5, size * 0.5, '#5D4037'); // Hair covers back of head
    drawRect(ox - size * 0.3, oy + size * 0.1, size * 0.6, size * 0.4, '#00BCD4'); // Cyan Shirt Back
    drawRect(ox - size * 0.4, oy + size * 0.1, size * 0.1, size * 0.3, '#FFCC80'); // Left Arm
    drawRect(ox + size * 0.3, oy + size * 0.1, size * 0.1, size * 0.3, '#FFCC80'); // Right Arm
  } else if (type === 'creeper') {
    drawRect(ox - size * 0.25, oy - size * 0.4, size * 0.5, size * 0.5, '#4CAF50');
    drawRect(ox - size * 0.15, oy - size * 0.2, size * 0.1, size * 0.1, '#000'); drawRect(ox + size * 0.05, oy - size * 0.2, size * 0.1, size * 0.1, '#000');
    drawRect(ox - size * 0.05, oy - size * 0.1, size * 0.1, size * 0.15, '#000');
    drawRect(ox - size * 0.15, oy, size * 0.1, size * 0.15, '#000'); drawRect(ox + size * 0.05, oy, size * 0.1, size * 0.15, '#000');
    drawRect(ox - size * 0.25, oy + size * 0.1, size * 0.5, size * 0.4, '#388E3C');
  } else if (type === 'villager') {
    // Wandering Trader styling
    drawRect(ox - size * 0.2, oy - size * 0.4, size * 0.4, size * 0.5, '#B57B52'); // Face skin
    drawRect(ox - size * 0.2, oy - size * 0.1, size * 0.4, size * 0.2, '#8B0000'); // Red mask
    drawRect(ox - size * 0.15, oy - size * 0.2, size * 0.1, size * 0.05, '#388E3C'); // Left eye
    drawRect(ox + size * 0.05, oy - size * 0.2, size * 0.1, size * 0.05, '#388E3C'); // Right eye
    drawRect(ox - size * 0.25, oy - size * 0.45, size * 0.5, size * 0.15, '#2A4B7C'); // Hood top
    drawRect(ox - size * 0.25, oy - size * 0.45, size * 0.1, size * 0.4, '#2A4B7C'); // Hood left side
    drawRect(ox + size * 0.15, oy - size * 0.45, size * 0.1, size * 0.4, '#2A4B7C'); // Hood right side
    drawRect(ox - size * 0.05, oy - size * 0.1, size * 0.1, size * 0.25, '#8E5A34'); // Big nose over mask
    drawRect(ox - size * 0.25, oy + size * 0.1, size * 0.5, size * 0.4, '#2A4B7C'); // Blue robes
    drawRect(ox - size * 0.15, oy + size * 0.1, size * 0.05, size * 0.4, '#D4C447'); // Gold trim left
    drawRect(ox + size * 0.1, oy + size * 0.1, size * 0.05, size * 0.4, '#D4C447'); // Gold trim right
    drawRect(ox - size * 0.3, oy + size * 0.2, size * 0.6, size * 0.15, '#2A4B7C'); // Crossed arms blue
    drawRect(ox - size * 0.1, oy + size * 0.2, size * 0.2, size * 0.15, '#B57B52'); // Hands
    drawRect(ox - size * 0.15, oy + size * 0.2, size * 0.05, size * 0.15, '#D4C447'); // Arm gold band left
    drawRect(ox + size * 0.1, oy + size * 0.2, size * 0.05, size * 0.15, '#D4C447'); // Arm gold band right
  } else if (type === 'zombie') {
    drawRect(ox - size * 0.25, oy - size * 0.4, size * 0.5, size * 0.5, '#1B5E20');
    drawRect(ox - size * 0.15, oy - size * 0.2, size * 0.1, size * 0.1, '#000'); drawRect(ox + size * 0.05, oy - size * 0.2, size * 0.1, size * 0.1, '#000');
    drawRect(ox - size * 0.25, oy + size * 0.1, size * 0.5, size * 0.4, '#00BCD4');
  } else if (type === 'enderman') {
    drawRect(ox - size * 0.2, oy - size * 0.5, size * 0.4, size * 0.4, '#111');
    drawRect(ox - size * 0.15, oy - size * 0.3, size * 0.1, size * 0.05, '#E040FB'); drawRect(ox + size * 0.05, oy - size * 0.3, size * 0.1, size * 0.05, '#E040FB');
    drawRect(ox - size * 0.2, oy - size * 0.1, size * 0.4, size * 0.6, '#111');
  } else if (type === 'piglin') {
    // Head & Ears
    drawRect(ox - size * 0.3, oy - size * 0.4, size * 0.6, size * 0.5, '#F0A3A3');
    drawRect(ox - size * 0.4, oy - size * 0.3, size * 0.1, size * 0.3, '#F0A3A3');
    drawRect(ox + size * 0.3, oy - size * 0.3, size * 0.1, size * 0.3, '#F0A3A3');
    // Eyes
    drawRect(ox - size * 0.2, oy - size * 0.2, size * 0.1, size * 0.1, '#FFF');
    drawRect(ox + size * 0.1, oy - size * 0.2, size * 0.1, size * 0.1, '#FFF');
    // Tusks
    drawRect(ox - size * 0.25, oy - size * 0.05, size * 0.15, size * 0.15, '#E5D59A');
    drawRect(ox + size * 0.1, oy - size * 0.05, size * 0.15, size * 0.15, '#E5D59A');
    // Snout
    drawRect(ox - size * 0.15, oy - size * 0.1, size * 0.3, size * 0.2, '#D88282');
    // Nostrils
    drawRect(ox - size * 0.1, oy - size * 0.05, size * 0.05, size * 0.1, '#4A2A2A');
    drawRect(ox + size * 0.05, oy - size * 0.05, size * 0.05, size * 0.1, '#4A2A2A');
    // Body (Brown tunic)
    drawRect(ox - size * 0.25, oy + size * 0.1, size * 0.5, size * 0.4, '#543825');
    // Gold buckle detail
    drawRect(ox - size * 0.1, oy + size * 0.25, size * 0.2, size * 0.05, '#D4C447');
    drawRect(ox - size * 0.1, oy + size * 0.3, size * 0.05, size * 0.05, '#D4C447');
  } else if (type === 'wither') {
    // Left Head
    drawRect(ox - size * 0.5, oy - size * 0.4, size * 0.25, size * 0.25, '#222'); drawRect(ox - size * 0.4, oy - size * 0.25, size * 0.05, size * 0.05, '#F00');
    // Right Head
    drawRect(ox + size * 0.25, oy - size * 0.4, size * 0.25, size * 0.25, '#222'); drawRect(ox + size * 0.35, oy - size * 0.25, size * 0.05, size * 0.05, '#F00');
    // Center Head
    drawRect(ox - size * 0.2, oy - size * 0.6, size * 0.4, size * 0.4, '#222');
    drawRect(ox - size * 0.1, oy - size * 0.4, size * 0.05, size * 0.05, '#F00'); drawRect(ox + size * 0.05, oy - size * 0.4, size * 0.05, size * 0.05, '#F00');
    // Body / Spine / Ribs
    drawRect(ox - size * 0.05, oy - size * 0.2, size * 0.1, size * 0.5, '#222');
    drawRect(ox - size * 0.25, oy - size * 0.1, size * 0.5, size * 0.05, '#222');
    drawRect(ox - size * 0.15, oy, size * 0.3, size * 0.05, '#222');
    drawRect(ox - size * 0.15, oy + size * 0.1, size * 0.3, size * 0.05, '#222');
  }
}

// --- Dialog & UI Logic ---
const dialogBox = document.getElementById('dialog-box');
const dialogSpeaker = document.getElementById('dialog-speaker');
const dialogText = document.getElementById('dialog-text');
const combatMenu = document.getElementById('combat-menu');
const combatOptionsDiv = document.getElementById('combat-options');
const videoOverlay = document.getElementById('video-overlay');
const climaxVideo = document.getElementById('climax-video');

let dialogCallback = null;
let dialogActiveTexts = [];
let textWait = false;
let typeTimer = null;
let currentText = "";
let targetText = "";

function getSpeakerType(speaker) {
  let s = speaker.toLowerCase();
  if (s.includes('creeper')) return 'creeper';
  if (s.includes('trader') || s.includes('villager')) return 'villager';
  if (s.includes('zombie')) return 'zombie';
  if (s.includes('enderman')) return 'enderman';
  if (s.includes('piglin')) return 'piglin';
  if (s.includes('wither')) return 'wither';
  return 'system';
}

function showDialog(speaker, texts, cb) {
  state.dialogueOpen = true;
  dialogSpeaker.innerText = speaker;
  dialogActiveTexts = texts;
  dialogCallback = cb;
  dialogBox.classList.remove('hidden');
  nextDialog();
}

function nextDialog() {
  if (typeTimer) {
    clearInterval(typeTimer); typeTimer = null;
    dialogText.innerText = targetText;
    textWait = true;
    return;
  }

  if (dialogActiveTexts.length > 0) {
    targetText = dialogActiveTexts.shift();
    currentText = "";
    dialogText.innerText = "";
    textWait = false;
    let i = 0;
    let sfxTicks = 0;
    let sType = getSpeakerType(dialogSpeaker.innerText);

    typeTimer = setInterval(() => {
      currentText += targetText[i];
      dialogText.innerText = currentText;

      if (sType === 'system') {
        if (targetText[i] !== " ") playTypeSound();
      } else {
        if (sfxTicks === 0 && targetText[i] !== " ") playSfx(sType);
        sfxTicks++;
        if (sfxTicks > 18) sfxTicks = 0; // repeat every ~600ms
      }

      i++;
      if (i >= targetText.length) {
        clearInterval(typeTimer); typeTimer = null; textWait = true;
      }
    }, 35);
  } else {
    dialogBox.classList.add('hidden');
    state.dialogueOpen = false;
    textWait = false;
    let cb = dialogCallback;
    dialogCallback = null;
    if (cb) cb();
  }
}

function showCombatMenu(options, correctOpts, victoryCallback) {
  state.combatOpen = true;
  combatMenu.classList.remove('hidden');
  combatOptionsDiv.innerHTML = '';
  options.forEach((opt, idx) => {
    let div = document.createElement('div');
    div.className = 'combat-option';
    div.innerText = Array.isArray(opt) ? opt[0] : opt;
    div.onclick = () => {
      combatMenu.classList.add('hidden');
      state.combatOpen = false;
      if (correctOpts.includes(idx)) {
        attackEnemy(victoryCallback);
      } else {
        enemyAttacks(options, correctOpts, victoryCallback);
      }
    };
    combatOptionsDiv.appendChild(div);
  });
}

function attackEnemy(victoryCallback) {
  playTone(800, 'square', 0.2, 0.2);
  state.battle.enemyHp = 0;
  updateBattleHUD();
  showDialog("System", ["ATTACK CONTAINED! THREAT CLEANSED! ★"], () => {
    endBattle();
    victoryCallback();
  });
}

function enemyAttacks(options, correctOpts, victoryCallback) {
  state.shakeTimer = 1.0;
  playTone(150, 'sawtooth', 0.4, 0.3);

  state.player.hp -= 34;
  if (state.player.hp < 0) state.player.hp = 0;
  updateBattleHUD();

  if (state.player.hp === 0) {
    showDialog("System", ["AGENT HEALTH DEPLETED.", "Connection Severed!"], () => {
      endBattle();
      state.map = 'main';
      state.player.hp = state.player.maxHp;
      state.player.x = state.player.tx = maps.main.start.x;
      state.player.y = state.player.ty = maps.main.start.y;
    });
  } else {
    showDialog("System", ["WRONG DEFENSE!", "The attack damaged your shields. Try again!"], () => {
      showCombatMenu(options, correctOpts, victoryCallback);
    });
  }
}

function endBattle() {
  state.battle.active = false;
  document.getElementById('battle-scene').classList.add('hidden');
  updateHUD();
}

function updateBattleHUD() {
  const pFill = document.getElementById('player-hp-fill');
  const eFill = document.getElementById('enemy-hp-fill');
  const pText = document.getElementById('player-hp-text');

  let pPct = (state.player.hp / state.player.maxHp) * 100;
  let ePct = (state.battle.enemyHp / state.battle.enemyMaxHp) * 100;

  pFill.style.width = pPct + '%';
  eFill.style.width = ePct + '%';
  pText.innerText = Math.floor(state.player.hp);

  pFill.style.backgroundColor = pPct > 50 ? '#4CAF50' : pPct > 20 ? '#FFEB3B' : '#F44336';
  eFill.style.backgroundColor = ePct > 50 ? '#4CAF50' : ePct > 20 ? '#FFEB3B' : '#F44336';
}

function triggerEncounter(portalId, isFinal = false) {
  const wrongAnswersPool = [
    "Ignore it and hope it goes away",
    "Click the suspicious link to investigate",
    "Download more RAM to speed up the system",
    "Turn off Windows Defender to save CPU",
    "Restart the router",
    "Unplug the monitor",
    "Forward the email to the entire company",
    "Reply with your password to verify",
    "Delete System32 folder",
    "Put the computer in a bag of rice",
    "Run a random .exe file found on a USB",
    "Install 5 different antivirus programs at once",
    "Yell at the computer monitor",
    "Format the hard drive immediately",
    "Change password to 'password123'"
  ];

  const combats = {
    3: {
      speaker: 'Phishing Creeper', type: 'creeper',
      pre: ["Sssss... I am from Tech Support.", "Your account has been compromised!", "Please click this urgent bit.ly link and enter your banking password to secure your funds!"],
      correct: "Verify independently by calling the official bank number",
      post: () => completePortal(3, isFinal)
    },
    4: {
      speaker: 'Deepfake Trader', type: 'villager',
      pre: ["Hrmmm. I am your CEO.", "Listen to my voice. I need you to bypass normal protocols.", "Send a $50,000 wire transfer to this offshore account immediately for a secret acquisition."],
      correct: "Refuse and verify using an established internal communication channel",
      post: () => completePortal(4, isFinal)
    },
    5: {
      speaker: isFinal ? 'Zombie - Zero Day Shrine' : 'Malware Zombie', type: 'zombie',
      pre: isFinal ? ["Domain Expansion: Zero Day Shrine!", "I am exploiting an unknown vulnerability in your core OS.", "No patch exists. Complete system collapse is imminent."] : ["Ughhhh...", "I sent you an invoice.pdf.exe.", "Open it so I can encrypt your hard drive..."],
      correct: isFinal ? "Isolate the network and deploy behavioral heuristic blocking" : "Delete the email and report it to the IT Security team",
      post: () => completePortal(5, isFinal)
    },
    6: {
      speaker: isFinal ? 'Enderman - Absolute Decompilation' : 'Keylog Enderman', type: 'enderman',
      pre: isFinal ? ["Domain Expansion: Absolute Decompilation.", "I am reverse-engineering your proprietary source code.", "All your encryption logic is laid bare."] : ["Vwoop.", "I have hidden a script in your browser.", "Every keystroke you type is being sent to my server."],
      correct: isFinal ? "Implement heavy code obfuscation and runtime memory encryption" : "Run an anti-malware scan and rotate all passwords using a secure device",
      post: () => completePortal(6, isFinal)
    },
    7: {
      speaker: isFinal ? 'Piglin - Distributed Botnet Space' : 'Brute Piglin', type: 'piglin',
      pre: isFinal ? ["Domain Expansion: Distributed Botnet Space!", "A million compromised IoT refrigerators are pinging your server!", "Your bandwidth is suffocating!"] : ["*Snort*", "I am trying 10,000 common passwords per second against your login portal!"],
      correct: isFinal ? "Re-route traffic through cloud scrubbing centers to filter the DDoS" : "Enforce account lockouts and mandatory Multi-Factor Authentication",
      post: () => completePortal(7, isFinal)
    },
    99: {
      speaker: 'Darknet Wither', type: 'wither',
      pre: ["I AM THE ZERO-DAY MULTI-VECTOR THREAT.", "YOUR ANTIVIRUS IS OBSOLETE.", "I HAVE INJECTED RANSOMWARE, EXFILTRATED DATA, AND INITIATED A TERABIT DDoS SIMULTANEOUSLY!"],
      correct: "Activate Advanced Threat Protection, isolate critical segments, and trigger incident response protocols",
      post: () => completePortal(99, isFinal)
    }
  };

  const encounter = combats[portalId];
  if (!encounter) return;

  let opts = [];
  let shuffledWrong = wrongAnswersPool.sort(() => 0.5 - Math.random()).slice(0, 4);
  opts.push(encounter.correct);
  opts.push(...shuffledWrong);
  opts.sort(() => 0.5 - Math.random());

  encounter.opts = opts;
  encounter.ans = [opts.indexOf(encounter.correct)];

  document.getElementById('battle-flash').classList.add('flash-anim');
  playTone(400, 'square', 0.8, 0.2);

  setTimeout(() => {
    state.battle.active = true;
    state.battle.enemy = encounter;
    state.battle.enemy.id = portalId;
    state.battle.enemyHp = 100;
    state.battle.enemyMaxHp = 100;

    document.getElementById('battle-scene').classList.remove('hidden');
    document.getElementById('enemy-name').innerText = encounter.speaker;
    document.getElementById('player-name').innerText = "AGENT";
    updateBattleHUD();

    if (portalId === 99) {
      domainVideo.play().catch(e => console.log("Video autoplay blocked:", e));
    }

    showDialog(encounter.speaker, encounter.pre.slice(), () => {
      showCombatMenu(encounter.opts, encounter.ans, encounter.post);
    });

    document.getElementById('battle-flash').classList.remove('flash-anim');
  }, 800);
}

function completePortal(pid, isFinal) {
  if (isFinal) {
    let mob = state.finalMobs.find(m => m.id === pid);
    if (mob) mob.alive = false;

    showDialog("System", ["Threat cleansed from the physical domain."], () => {
      if (state.finalMobs.every(m => !m.alive)) {
        if (!state.witherSpawned) {
          state.witherSpawned = true;
          showDialog("System", ["WARNING! Code Red!", "A massive Zero-Day multi-vector signature detected!", "The Darknet Wither has formed!"], () => {
            state.finalMobs.push({ id: 99, type: 'wither', x: 16, y: 18, alive: true, size: 2.2 });
            state.flashTimer = 0;
          });
        } else {
          domainVideo.pause();
          state.bossDefeated = true;
          state.worldRed = false; // Restore world color!
          document.getElementById('final-bgm').pause(); // Stop boss music
          document.getElementById('bgm').play().catch(e => console.log(e)); // Restart original BGM as victory

          showDialog("System", ["DARKNET WITHER ANNIHILATED.", "Network fully secured. The Domain has collapsed. Great job, Agent!", "Research modern cyber threats to keep yourself safe out there!"], () => {
            startCreditsSequence();
          });
        }
      }
    });
  } else {
    state.portalsCleared[pid - 3] = true;
    state.map = 'main';
    let ret = portalExits['portal' + pid];
    state.player.x = state.player.tx = ret.x;
    state.player.y = state.player.ty = ret.y + 1;

    let mainMap = maps.main;
    for (let i = 0; i < mainMap.data.length; i++) {
      if (mainMap.data[i] === pid) {
        let mx = i % mainMap.w;
        let my = Math.floor(i / mainMap.w);
        mainMap.data[i] = getBiome(mx, my);
      }
    }

    showDialog("System", ["PORTAL CLOSED. Threat neutralized."], () => {
      saveWorldState();
      checkEndgame();
    });
  }
}

function checkEndgame() {
  if (state.portalsCleared.every(v => v === true) && !state.bossRevealed) {
    state.bossRevealed = true;
    showDialog("System", ["WAIT! The last three portals were decoy clones!", "DOMAIN EXPANSION DETECTED!"], playCutscene);
  }
}

function playCutscene() {
  document.getElementById('bgm').pause();
  state.cutscenePlaying = true;
  videoOverlay.classList.remove('hidden');
  climaxVideo.currentTime = 0;
  let playPromise = climaxVideo.play();
  if (playPromise !== undefined) {
    playPromise.then(_ => { }).catch(e => {
      console.error("Autoplay prevented:", e);
      videoEnded();
    });
  }
  climaxVideo.onended = videoEnded;
}

function videoEnded() {
  videoOverlay.classList.add('hidden');
  state.cutscenePlaying = false;

  // Transition into final red phase
  state.worldRed = true;
  state.flashTimer = 0;
  document.getElementById('final-bgm').play().catch(e => console.log(e));

  // Spawn player comfortably near the center
  state.player.x = state.player.tx = 16;
  state.player.y = state.player.ty = 16;

  // Manifest the true enemies in the overworld around the player
  state.finalMobs = [
    { id: 5, type: 'zombie', x: 14, y: 16, alive: true },
    { id: 6, type: 'enderman', x: 18, y: 16, alive: true },
    { id: 7, type: 'piglin', x: 16, y: 14, alive: true }
  ];

  document.getElementById('final-warning').classList.remove('hidden');
  setTimeout(() => {
    document.getElementById('final-warning').classList.add('hidden');
    showDialog("Darknet Devil", ["FOOLISH AGENT.", "THE DOMAIN IS MINE.", "MY LORDS HAVE MANIFESTED PHYSICALLY!"], () => {
      showDialog("System", ["ALERT: The original threats are loose in the main world! Cleanse them all!"], null);
    });
  }, 3000);
}

// --- Inputs ---
window.addEventListener('keydown', e => {
  state.keys[e.key] = true;
  if (!state.started) return;

  if (e.key === 'Escape') {
    if (!state.dialogueOpen && !state.combatOpen && !state.cutscenePlaying && !(state.battle && state.battle.active)) {
      state.paused = !state.paused;
      if (state.paused) {
        document.getElementById('pause-modal').classList.remove('hidden');
      } else {
        document.getElementById('pause-modal').classList.add('hidden');
      }
    }
  }

  if (state.dialogueOpen && (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter')) {
    nextDialog();
  } else if (!state.dialogueOpen && !state.combatOpen && !state.cutscenePlaying) {
    if (e.key === 'e' || e.key === 'E') {
      tryInteract();
    }
  }
});
window.addEventListener('keyup', e => { state.keys[e.key] = false; });

const dictModal = document.getElementById('dict-modal');
document.getElementById('dict-btn').addEventListener('click', () => { dictModal.classList.remove('hidden'); });
document.getElementById('close-dict-btn').addEventListener('click', () => { dictModal.classList.add('hidden'); });

function tryInteract() {
  let mapObj = maps[state.map];
  let foundTile = -1;
  let foundNpc = false;
  let targetMob = null;

  // Search 2-tile radius
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let cx = state.player.x + dx;
      let cy = state.player.y + dy;
      let tile = getTile(mapObj, cx, cy);

      if (state.bossRevealed && !state.bossDefeated && state.map === 'main') {
        let mob = state.finalMobs.find(m => m.alive && m.x === cx && m.y === cy);
        if (mob) targetMob = mob;
      }

      if (tile >= 3 && tile <= 7) {
        foundTile = tile;
      }

      if (mapObj.npc && cx === mapObj.npc.x && cy === mapObj.npc.y) {
        foundNpc = true;
      }
    }
  }

  // During final boss phase, we can interact with the spawned mobs
  if (targetMob) {
    triggerEncounter(targetMob.id, true); // true indicates it's the overworld final fight
    return;
  }

  if (state.map === 'main') {
    if (foundTile !== -1) {
      if ((!state.portalsCleared[0] || !state.portalsCleared[1]) && foundTile >= 5) {
        showDialog("System", ["PORTAL SEALED!", "Cleanse the Phishing & Deepfake portals to unlock!"], null);
        return;
      }
      state.map = 'portal' + foundTile;
      state.player.x = state.player.tx = 5;
      state.player.y = state.player.ty = 8;
    }
  } else {
    // Inside portal Dungeon
    if (foundNpc) {
      let portalId = parseInt(state.map.replace('portal', ''));
      triggerEncounter(portalId, false);
    }
  }
}

function updateLogic() {
  const tooltip = document.getElementById('interact-tooltip');
  if (!state.started || state.paused || state.dialogueOpen || state.combatOpen || state.cutscenePlaying || (state.battle && state.battle.active)) {
    if (tooltip) tooltip.classList.add('hidden');
    return;
  }

  const p = state.player;
  if (!p.moving) {
    let dx = 0, dy = 0;
    if (state.keys['w'] || state.keys['ArrowUp']) { dy = -1; p.dir = 'up'; }
    else if (state.keys['s'] || state.keys['ArrowDown']) { dy = 1; p.dir = 'down'; }
    else if (state.keys['a'] || state.keys['ArrowLeft']) { dx = -1; p.dir = 'left'; }
    else if (state.keys['d'] || state.keys['ArrowRight']) { dx = 1; p.dir = 'right'; }

    if (dx !== 0 || dy !== 0) {
      let mapObj = maps[state.map];
      let nx = p.x + dx, ny = p.y + dy;
      let targetTile = getTile(mapObj, nx, ny);

      let solid = targetTile === 2 || (targetTile >= 3 && targetTile <= 7);
      if (mapObj.npc && mapObj.npc.x === nx && mapObj.npc.y === ny) solid = true;

      // Final Boss mobs are solid
      if (state.bossRevealed && !state.bossDefeated && state.map === 'main') {
        if (state.finalMobs.some(m => m.alive && m.x === nx && m.y === ny)) solid = true;
      }

      if (!solid) {
        if (targetTile === 8) { state.inventory.firewalls++; setTile(mapObj, nx, ny, 1); updateHUD(); }
        else if (targetTile === 9) { state.inventory.routers++; setTile(mapObj, nx, ny, 1); updateHUD(); }
        else if (targetTile === 10) { state.inventory.auditLogs++; setTile(mapObj, nx, ny, 1); updateHUD(); }

        p.tx = nx; p.ty = ny;
        p.moving = true; p.moveTimer = 0;
      }
    }
  } else {
    p.moveTimer += 0.18;
    if (p.moveTimer >= 1) {
      p.x = p.tx; p.y = p.ty; p.moving = false;
    }
  }

  // Tooltip Logic
  let mapObj = maps[state.map];
  let isInteractable = false;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let cx = p.x + dx;
      let cy = p.y + dy;
      let targetTile = getTile(mapObj, cx, cy);

      if (targetTile >= 3 && targetTile <= 7) isInteractable = true;
      if (mapObj.npc && mapObj.npc.x === cx && mapObj.npc.y === cy) isInteractable = true;
      if (state.bossRevealed && !state.bossDefeated && state.map === 'main') {
        if (state.finalMobs.some(m => m.alive && m.x === cx && m.y === cy)) isInteractable = true;
      }
    }
  }

  if (isInteractable) {
    tooltip.classList.remove('hidden');
  } else {
    tooltip.classList.add('hidden');
  }
}

function updateHUD() {
  // HUD stats removed.
}

// --- Render Loop ---
function draw() {
  updateLogic();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (state.cutscenePlaying) { requestAnimationFrame(draw); return; }

  if (state.battle && state.battle.active) {

    let shakeX = 0; let shakeY = 0;
    if (state.shakeTimer > 0) {
      shakeX = (Math.random() - 0.5) * 20;
      shakeY = (Math.random() - 0.5) * 20;
      state.shakeTimer -= 0.05;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    if (state.battle.enemy.id === 99 && domainVideo.readyState >= 2) {
      let scale = 1 + Math.sin(Date.now() / 1500) * 0.05;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.drawImage(domainVideo, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      ctx.restore();
      ctx.fillStyle = 'rgba(50, 0, 10, 0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#B0E0E6');
      grad.addColorStop(1, '#FFF');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = '#C8E6C9';
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.7, canvas.height * 0.4, 180, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#A5D6A7';
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.3, canvas.height * 0.8, 200, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    let eBob = Math.sin(Date.now() * 0.005) * 5;
    drawSprite(canvas.width * 0.7 - CS * 1.5, canvas.height * 0.4 - CS * 3 + eBob, CS * 3, state.battle.enemy.type);

    let pBob = Math.cos(Date.now() * 0.005) * 3;
    drawSprite(canvas.width * 0.3 - CS * 2, canvas.height * 0.8 - CS * 4 + pBob, CS * 4, 'steve-back');

    ctx.restore();
    requestAnimationFrame(draw);
    return;
  }

  ctx.save();
  let px = state.player.x * CS; let py = state.player.y * CS;
  if (state.player.moving) {
    let dx = state.player.tx - state.player.x; let dy = state.player.ty - state.player.y;
    px += (dx * state.player.moveTimer) * CS; py += (dy * state.player.moveTimer) * CS;
  }

  let cx = canvas.width / 2 - px - CS / 2; let cy = canvas.height / 2 - py - CS / 2;
  ctx.translate(cx, cy);

  let mapObj = maps[state.map];
  for (let y = 0; y < mapObj.height; y++) {
    for (let x = 0; x < mapObj.width; x++) {
      let t = mapObj.data[y * mapObj.width + x];
      drawBlock(x * CS, y * CS, CS, t);
    }
  }

  // Draw World Red overlay underneath the characters but over the map!
  if (state.worldRed) {
    ctx.fillStyle = 'rgba(200, 0, 0, 0.4)';
    // cover bounds
    ctx.fillRect(-1000, -1000, 3000, 3000);
  }

  // Flash timer logic for spawning final mobs
  if (state.worldRed) {
    state.flashTimer += 0.05;
    if (state.flashTimer >= 1) state.flashTimer = 1;
  }

  if (mapObj.npc) drawSprite(mapObj.npc.x * CS, mapObj.npc.y * CS, CS, mapObj.npc.type);
  drawSprite(px, py, CS, 'steve');

  // Draw Final Mobs if boss sequence is active
  if (state.bossRevealed && !state.bossDefeated && state.map === 'main') {
    state.finalMobs.forEach(mob => {
      if (mob.alive) {
        let s = mob.size ? CS * mob.size : CS;
        let offset = mob.size ? (CS * mob.size - CS) / 2 : 0;
        drawSprite(mob.x * CS - offset, mob.y * CS - offset, s, mob.type, state.flashTimer < 1);
      }
    });
  }

  ctx.restore();
  requestAnimationFrame(draw);
}

// --- Credits Sequence ---
let creditsActive = false;
let creditsData = [
  { role: "Lead Game Developer & Architect", name: "Dev Balaji A", type: "villager" },
  { role: "3D Environment & VFX Director", name: "Akilan G P", type: "zombie" },
  { role: "Cybersecurity Consultant & Narrative", name: "Ruhan M", type: "piglin" },
  { role: "UI/UX Design & Audio Integration", name: "Amaziah S", type: "enderman" }
];
let activeCreditSprites = [];
let sideToggle = 1; function startCreditsSequence() {
  creditsActive = true;
  document.getElementById('credits-screen').classList.remove('hidden');

  setTimeout(() => {
    document.querySelector('.credits-main-title').style.opacity = 1;
  }, 1000);

  const container = document.getElementById('credits-scroll-container');
  container.innerHTML = '';

  creditsData.forEach((credit, i) => {
    let box = document.createElement('div');
    box.className = 'credit-box';
    box.innerHTML = `<div class="role">${credit.role}</div><div class="name">${credit.name}</div>`;
    container.appendChild(box);
  });

  setTimeout(() => {
    container.style.transform = 'translateY(0)';
  }, 100);

  setTimeout(() => {
    let w = window.innerWidth;
    let h = window.innerHeight;
    activeCreditSprites.push({ type: 'villager', x: -100, y: h / 2 - 80, tx: w * 0.25 - 280 }); // Dev
    activeCreditSprites.push({ type: 'zombie', x: w + 100, y: h / 2 - 80, tx: w * 0.75 + 200 }); // Akilan
    activeCreditSprites.push({ type: 'piglin', x: -100, y: h / 2 + 60, tx: w * 0.25 - 280 }); // Ruhan
    activeCreditSprites.push({ type: 'enderman', x: w + 100, y: h / 2 + 60, tx: w * 0.75 + 200 }); // Amaziah
  }, 4000);

  setTimeout(() => {
    document.getElementById('restart-game-btn').classList.remove('hidden');
  }, 8000);

  document.getElementById('restart-game-btn').onclick = () => location.reload();

  requestAnimationFrame(drawCredits);
}

function drawCredits() {
  if (!creditsActive) return;
  const cCanvas = document.getElementById('creditsCanvas');
  const cCtx = cCanvas.getContext('2d');
  cCanvas.width = window.innerWidth;
  cCanvas.height = window.innerHeight;

  cCtx.clearRect(0, 0, cCanvas.width, cCanvas.height);

  let oldCtx = ctx;
  ctx = cCtx;

  activeCreditSprites.forEach(sp => {
    if (Math.abs(sp.x - sp.tx) > 5) {
      sp.x += (sp.x < sp.tx) ? 3 : -3;
    }

    let isCrouching = false;
    if (sp.type === 'enderman' && Math.abs(sp.x - sp.tx) <= 5) {
      isCrouching = Math.floor(Date.now() / 800) % 2 === 0;
    }

    let bob = Math.sin(Date.now() * 0.005) * 5;
    if (isCrouching) bob += 15;

    drawSprite(sp.x, sp.y + bob, 80, sp.type);
  });

  ctx = oldCtx;
  requestAnimationFrame(drawCredits);
}

requestAnimationFrame(draw);
