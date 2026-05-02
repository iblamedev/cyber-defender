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
  battleFx: { projectiles: [], slashes: [], sparks: [], spells: [], combo: 0, comboTimer: 0, hitStop: 0, freezeStamp: 0, uiTheme: null, attackStyle: "default", charging: false, chargeTimer: 0, chargeMax: 0, queuedDamage: null, resolving: false },
  shakeTimer: 0
};

// --- Database / Login System ---
let db;
let currentUser = null;
let currentWorldId = null;
let activeWorlds = [];
let selectedWorldIndex = -1;
const DB_KEY = "cipherRequiemDB";
const LEGACY_DB_KEYS = ["cyberDefenderDB"];
const GUEST_WORLD_KEY = "cipherRequiemGuestWorld";
const LEGACY_GUEST_WORLD_KEYS = ["cyberDefenderGuestWorld"];
const GUEST_PROFILE_KEY = "cipherRequiemGuestProfile";
const LEGACY_GUEST_PROFILE_KEYS = ["cyberDefenderGuestProfile"];

const DOMAIN_BY_PORTAL = { 3: "phishing", 4: "deepfake", 5: "malware", 6: "auth", 7: "incident_response", 99: "incident_response" };
const DOMAIN_LABELS = {
  phishing: "Phishing",
  deepfake: "Deepfake",
  malware: "Malware",
  auth: "Account Security",
  incident_response: "Incident Response"
};
const BATTLE_THEMES = {
  phishing: { primary: "#00e5ff", glow: "rgba(0,229,255,0.45)", combo: "#80d8ff" },
  deepfake: { primary: "#ff80ab", glow: "rgba(255,128,171,0.45)", combo: "#ffb2dd" },
  malware: { primary: "#76ff03", glow: "rgba(118,255,3,0.45)", combo: "#b2ff59" },
  auth: { primary: "#b388ff", glow: "rgba(179,136,255,0.45)", combo: "#d1c4e9" },
  incident_response: { primary: "#ffd740", glow: "rgba(255,215,64,0.45)", combo: "#ffe082" },
  default: { primary: "#ff5252", glow: "rgba(255,82,82,0.45)", combo: "#fff59d" }
};

function playWhoosh() {
  playTone(420, 'triangle', 0.07, 0.08);
  playTone(650, 'triangle', 0.06, 0.05);
}

function playImpactStack() {
  playTone(120, 'sawtooth', 0.08, 0.14);
  playTone(240, 'square', 0.06, 0.1);
}

function playComboChime(combo) {
  const base = 520 + Math.min(combo, 6) * 70;
  playTone(base, 'triangle', 0.08, 0.09);
}

let learnerProfile = {
  mastery: { phishing: 0, deepfake: 0, malware: 0, auth: 0, incident_response: 0 },
  mistakes: [],
  repetitionQueue: [],
  sessions: 0,
  totalCorrect: 0,
  totalAttempts: 0,
  xp: 0,
  portalsClearedCount: 0,
  finalInteractionsCleared: 0,
  scenarioResults: [],
  helperSeen: {}
};

function getStorageItemWithMigration(currentKey, legacyKeys = []) {
  const currentValue = localStorage.getItem(currentKey);
  if (currentValue !== null) return currentValue;

  for (const legacyKey of legacyKeys) {
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue === null) continue;

    try {
      localStorage.setItem(currentKey, legacyValue);
      localStorage.removeItem(legacyKey);
    } catch (e) { }
    return legacyValue;
  }

  return null;
}

async function initDB() {
  try {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    const savedDb = getStorageItemWithMigration(DB_KEY, LEGACY_DB_KEYS);
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
  localStorage.setItem(DB_KEY, data.toString());
}

function normalizeUsername(raw) {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").substring(0, 8);
}

function sanitizeWorldName(raw) {
  return (raw || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().substring(0, 15);
}

function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bytesToHex(new Uint8Array(hashBuf));
}

async function hashPassword(password, saltHex) {
  const salt = saltHex || randomSaltHex();
  const digest = await sha256Hex(`${salt}:${password}`);
  return `v1$${salt}$${digest}`;
}

async function verifyPassword(stored, enteredPassword) {
  if (!stored) return { ok: false, needsUpgrade: false };
  if (stored.startsWith("v1$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return { ok: false, needsUpgrade: false };
    const candidate = await hashPassword(enteredPassword, parts[1]);
    return { ok: candidate === stored, needsUpgrade: false };
  }
  return { ok: stored === enteredPassword, needsUpgrade: stored === enteredPassword };
}

document.getElementById('btn-create').addEventListener('click', async () => {
  if (!db) return alert("Database not initialized.");
  const u = normalizeUsername(document.getElementById('username').value);
  const p = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');

  if (u.length < 3 || u.length > 8) return msg.innerText = "Error: Username must be 3-8 chars (a-z, 0-9, _).";
  if (p.length < 8 || !/[A-Z]/.test(p) || !/[0-9]/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    return msg.innerText = "Error: Pass needs 8+ chars, 1 uppercase, 1 number, 1 special.";
  }

  try {
    const passHash = await hashPassword(p);
    db.run("INSERT INTO users VALUES (?, ?)", [u, passHash]);
    saveDB();
    msg.style.color = "#4CAF50";
    msg.innerText = "Account Created! You may now Login.";
  } catch (e) {
    msg.style.color = "#F44336";
    msg.innerText = "Error: Username already exists.";
  }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  if (!db) return alert("Database not initialized.");
  const u = normalizeUsername(document.getElementById('username').value);
  const p = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');

  const res = db.exec("SELECT username, password FROM users WHERE username=?", [u]);
  let authenticated = false;
  let shouldUpgrade = false;
  if (res.length > 0 && res[0] && res[0].values.length > 0) {
    const stored = String(res[0].values[0][1] || "");
    const verdict = await verifyPassword(stored, p);
    authenticated = verdict.ok;
    shouldUpgrade = verdict.needsUpgrade;
  }

  if (authenticated) {
    if (shouldUpgrade) {
      const upgraded = await hashPassword(p);
      db.run("UPDATE users SET password=? WHERE username=?", [upgraded, u]);
      saveDB();
    }
    currentUser = u;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('world-select-screen').classList.remove('hidden');
    renderWorlds();
  } else {
    msg.style.color = "#F44336";
    msg.innerText = "Error: Invalid credentials.";
  }
});

document.getElementById('btn-guest').addEventListener('click', () => {
  currentUser = "guest";
  currentWorldId = null;
  document.getElementById('login-screen').classList.add('hidden');
  startGuestSession();
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
      activeWorlds.push({ id: row[0], name: row[2], created: row[3], progress: row[4] });

      let progObj = {};
      try {
        progObj = JSON.parse(row[4] || "{}");
      } catch (e) { }
      let clearedCount = progObj.portalsCleared ? progObj.portalsCleared.filter(v => v).length : 0;

      let safeName = escapeHTML(row[2]);
      let safeDate = escapeHTML(row[3]);

      let div = document.createElement('div');
      div.className = 'world-item';

      let textDiv = document.createElement('div');
      let nameDiv = document.createElement('div');
      nameDiv.className = 'world-item-name';
      nameDiv.textContent = safeName;
      let detailsDiv = document.createElement('div');
      detailsDiv.className = 'world-item-details';
      detailsDiv.textContent = `${safeName} (${safeDate}) Progress: ${clearedCount}/5 Threats Cleared`;
      textDiv.appendChild(nameDiv);
      textDiv.appendChild(detailsDiv);

      let actionsDiv = document.createElement('div');
      actionsDiv.className = 'world-actions-inline';
      let editBtn = document.createElement('span');
      editBtn.className = 'edit-world';
      editBtn.title = 'Edit Name';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        editWorld(row[0], row[2]);
      });
      let resetBtn = document.createElement('span');
      resetBtn.className = 'reset-world';
      resetBtn.title = 'Reset Progress';
      resetBtn.textContent = 'Reset';
      resetBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        resetWorld(row[0]);
      });
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(resetBtn);

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
  let name = sanitizeWorldName(cwInput.value);
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
  let newName = prompt(`Enter new name for world "${oldName}":`, oldName || "");
  newName = sanitizeWorldName(newName || "");
  if (newName.length > 0) {
    db.run("UPDATE worlds SET name = ? WHERE id = ?", [newName, id]);
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

function loadGuestProgress() {
  const raw = getStorageItemWithMigration(GUEST_WORLD_KEY, LEGACY_GUEST_WORLD_KEYS);
  if (!raw) {
    return {
      portalsCleared: [false, false, false, false, false],
      bossDefeated: false,
      worldRed: false,
      witherSpawned: false,
      finalMobs: []
    };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {
      portalsCleared: [false, false, false, false, false],
      bossDefeated: false,
      worldRed: false,
      witherSpawned: false,
      finalMobs: []
    };
  }
}

function saveGuestProgress() {
  const p = {
    portalsCleared: state.portalsCleared,
    bossDefeated: state.bossDefeated,
    worldRed: state.worldRed,
    witherSpawned: state.witherSpawned,
    finalMobs: state.finalMobs
  };
  localStorage.setItem(GUEST_WORLD_KEY, JSON.stringify(p));
}

function loadLearnerProfile() {
  const raw = getStorageItemWithMigration(GUEST_PROFILE_KEY, LEGACY_GUEST_PROFILE_KEYS);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    learnerProfile = Object.assign(learnerProfile, parsed);
  } catch (e) { }
}

function saveLearnerProfile() {
  localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(learnerProfile));
}

function startGuestSession() {
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
  const p = loadGuestProgress();
  state.portalsCleared = p.portalsCleared;
  state.bossDefeated = p.bossDefeated;
  state.worldRed = p.worldRed;
  state.witherSpawned = p.witherSpawned;
  state.finalMobs = p.finalMobs || [];
  loadLearnerProfile();
  learnerProfile.sessions += 1;
  saveLearnerProfile();

  if (state.bossDefeated) {
    startCreditsSequence();
    return;
  }
  state.started = true;
  maybeRunOnboarding();
  let audio = document.getElementById('bgm');
  audio.play().catch(() => {
    document.body.addEventListener('click', () => { if (audio.paused) audio.play(); }, { once: true });
  });
}

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
  loadLearnerProfile();
  learnerProfile.sessions += 1;
  saveLearnerProfile();

  if (state.bossDefeated) {
    startCreditsSequence();
    return;
  }

  // Enter Game
  state.started = true;
  maybeRunOnboarding();
  let audio = document.getElementById('bgm');
  audio.play().catch(e => {
    document.body.addEventListener('click', () => { if (audio.paused) audio.play(); }, { once: true });
  });
});

function saveWorldState() {
  if (currentUser === "guest") {
    saveGuestProgress();
    saveLearnerProfile();
    return;
  }
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
  saveLearnerProfile();
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
    if (currentUser === "guest") {
      currentUser = null;
      document.getElementById('login-screen').classList.remove('hidden');
    } else {
      document.getElementById('world-select-screen').classList.remove('hidden');
    }
    document.getElementById('bgm').pause();
    document.getElementById('bgm').currentTime = 0;
    document.getElementById('final-bgm').pause();
    document.getElementById('final-bgm').currentTime = 0;
    if (currentUser) renderWorlds();
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

const beginnerMission = [
  "Welcome, Agent. Quick training begins now.",
  "Step 1: If a message sounds urgent, pause before you click.",
  "Step 2: Verify identity through a trusted channel, not the same message.",
  "Step 3: Use strong passwords and turn on multi-factor authentication.",
  "Step 4: If you are unsure, ask a trusted adult, teacher, or IT team.",
  "Training complete. You are ready for your first portal."
];

const termHints = {
  phishing: "Phishing means fake messages that try to trick you into sharing private info.",
  deepfake: "A deepfake is edited media made to look or sound real when it is not.",
  malware: "Malware is harmful software that can steal data or break devices.",
  mfa: "Multi-factor authentication asks for an extra proof, not just a password.",
  incident: "Incident response means calm steps to contain a cyber problem quickly."
};

function maybeRunOnboarding() {
  if (learnerProfile.helperSeen.onboarding) return;
  learnerProfile.helperSeen.onboarding = true;
  saveLearnerProfile();
  showDialog("Trainer", beginnerMission.slice(), null);
}

function maybeShowTermHint(key) {
  if (learnerProfile.helperSeen[key]) return;
  const hint = termHints[key];
  if (!hint) return;
  learnerProfile.helperSeen[key] = true;
  saveLearnerProfile();
  showDialog("Helper", [hint], null);
}

function getMastery(domain) {
  return Math.max(0, Math.min(100, Math.round(learnerProfile.mastery[domain] || 0)));
}

function isAdvancedPortalLocked() {
  const basicsCleared = !!state.portalsCleared[0] && !!state.portalsCleared[1];
  const masteryReady = getMastery("phishing") >= 35 && getMastery("deepfake") >= 35;
  return !(basicsCleared || masteryReady);
}

function renderLearningReport() {
  const el = document.getElementById('learning-report-content');
  const cleared = state.portalsCleared.filter(Boolean).length;
  const totalPhase2 = learnerProfile.finalInteractionsCleared || 0;
  el.innerHTML = `
    <p><strong>Total XP:</strong> ${learnerProfile.xp || 0}</p>
    <p><strong>Portals Cleared:</strong> ${cleared}/5</p>
    <p><strong>Domain Expansion Clears:</strong> ${totalPhase2}/4</p>
    <p><strong>XP Rules:</strong> +100 per portal clear, +200 per domain-expansion interaction (including Wither Storm).</p>
  `;
}

function openReportModal() {
  renderLearningReport();
  document.getElementById('learning-report-modal').classList.remove('hidden');
}

window.flipToDefinition = function (index) {
  const page = document.getElementById('book-content-page');
  page.classList.add('flip');

  setTimeout(() => {
    document.getElementById('def-title').innerText = cyberDefinitions[index].t;
    document.getElementById('def-text').innerText = cyberDefinitions[index].d;
    page.classList.remove('flip');
  }, 300); // Swap text halfway through animation
};

document.querySelectorAll('#dict-toc li[data-def-index]').forEach((item) => {
  item.addEventListener('click', () => {
    const idx = Number(item.getAttribute('data-def-index'));
    if (!Number.isNaN(idx)) flipToDefinition(idx);
  });
});

document.getElementById('learning-report-btn').addEventListener('click', openReportModal);
document.getElementById('btn-pause-report').addEventListener('click', openReportModal);
document.getElementById('btn-close-report').addEventListener('click', () => document.getElementById('learning-report-modal').classList.add('hidden'));

function startBootSequence() {
  const loginScreen = document.getElementById('login-screen');
  const introOverlay = document.getElementById('startup-intro-overlay');
  const introVideo = document.getElementById('startup-intro-video');
  const introHint = document.getElementById('startup-intro-hint');

  initDB();

  if (!loginScreen || !introOverlay || !introVideo) return;

  loginScreen.classList.add('hidden');
  introOverlay.classList.remove('hidden');
  if (introHint) introHint.classList.add('hidden');

  let settled = false;
  const finishIntro = () => {
    if (settled) return;
    settled = true;
    introOverlay.classList.add('hidden');
    if (introHint) introHint.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    requestAnimationFrame(drawLogin);
  };

  const tryPlayIntroWithAudio = () => {
    introVideo.muted = false;
    introVideo.volume = 1;
    const p = introVideo.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (introHint) introHint.classList.add('hidden');
      }).catch(() => {
        if (!settled && introHint) introHint.classList.remove('hidden');
      });
    }
  };

  introVideo.currentTime = 0;
  introVideo.onended = finishIntro;
  introVideo.onerror = finishIntro;
  introOverlay.addEventListener('click', () => {
    if (settled) return;
    tryPlayIntroWithAudio();
  });

  tryPlayIntroWithAudio();
}

window.onload = startBootSequence;

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
    let locked = isAdvancedPortalLocked() && type >= 5;
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
    const pulse = (Math.sin(Date.now() * 0.006) + 1) * 0.5;
    const tendrilSwing = Math.sin(Date.now() * 0.004) * size * 0.05;
    const eyeGlow = pulse > 0.55 ? '#E040FB' : '#B23EE8';

    // Core mass
    drawRect(ox - size * 0.32, oy - size * 0.42, size * 0.64, size * 0.52, '#121217');
    drawRect(ox - size * 0.25, oy - size * 0.34, size * 0.5, size * 0.36, '#1B1B24');

    // Corrupted core glow
    drawRect(ox - size * 0.05, oy - size * 0.19, size * 0.1, size * 0.1, eyeGlow);
    drawRect(ox - size * 0.025, oy - size * 0.165, size * 0.05, size * 0.05, '#F5DCFF');

    // Left head
    drawRect(ox - size * 0.58, oy - size * 0.37, size * 0.23, size * 0.23, '#16161E');
    drawRect(ox - size * 0.54, oy - size * 0.31, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox - size * 0.45, oy - size * 0.31, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox - size * 0.53, oy - size * 0.24, size * 0.13, size * 0.03, '#EAEAEA');

    // Center head
    drawRect(ox - size * 0.16, oy - size * 0.6, size * 0.32, size * 0.3, '#14141C');
    drawRect(ox - size * 0.1, oy - size * 0.52, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox + size * 0.04, oy - size * 0.52, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox - size * 0.07, oy - size * 0.44, size * 0.14, size * 0.03, '#F1F1F1');

    // Right head
    drawRect(ox + size * 0.35, oy - size * 0.37, size * 0.23, size * 0.23, '#16161E');
    drawRect(ox + size * 0.39, oy - size * 0.31, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox + size * 0.48, oy - size * 0.31, size * 0.06, size * 0.05, eyeGlow);
    drawRect(ox + size * 0.4, oy - size * 0.24, size * 0.13, size * 0.03, '#EAEAEA');

    // Spine + trailing body
    drawRect(ox - size * 0.06, oy - size * 0.05, size * 0.12, size * 0.52, '#161620');
    drawRect(ox - size * 0.14, oy + size * 0.18, size * 0.28, size * 0.08, '#0F0F16');
    drawRect(ox - size * 0.06, oy + size * 0.46, size * 0.12, size * 0.22, '#101018');

    // Tendrils / storm limbs
    drawRect(ox - size * 0.72, oy - size * 0.1 + tendrilSwing, size * 0.42, size * 0.06, '#13131A');
    drawRect(ox - size * 0.82, oy - size * 0.02 + tendrilSwing, size * 0.16, size * 0.06, '#13131A');
    drawRect(ox + size * 0.3, oy - size * 0.12 - tendrilSwing, size * 0.42, size * 0.06, '#13131A');
    drawRect(ox + size * 0.66, oy - size * 0.04 - tendrilSwing, size * 0.16, size * 0.06, '#13131A');
    drawRect(ox - size * 0.22, oy + size * 0.28, size * 0.07, size * 0.25, '#14141C');
    drawRect(ox + size * 0.15, oy + size * 0.31, size * 0.07, size * 0.23, '#14141C');

    // Purple corruption accents
    drawRect(ox - size * 0.3, oy - size * 0.08, size * 0.08, size * 0.08, eyeGlow);
    drawRect(ox + size * 0.22, oy + size * 0.02, size * 0.08, size * 0.08, eyeGlow);
    drawRect(ox - size * 0.02, oy + size * 0.26, size * 0.05, size * 0.05, '#A64BFF');
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
const ENCOUNTER_VIDEO_ASSETS = {
  creeper: { intro: '/static/CreeperIntro.mp4', outro: '/static/CreeperOutro.mp4' },
  villager: { intro: '/static/TraderIntro.mp4' },
  zombie: { intro: '/static/ZombieIntro.mp4', outro: '/static/ZombieOutro.mp4' },
  enderman: { intro: '/static/EndermanIntro.mp4' },
  piglin: { intro: '/static/PiglinIntro.mp4' },
  wither: { intro: '/static/WitherIntro.mp4' }
};

function getEncounterVideoTypeByPortal(portalId) {
  if (portalId === 3) return 'creeper';
  if (portalId === 4) return 'villager';
  if (portalId === 5) return 'zombie';
  if (portalId === 6) return 'enderman';
  if (portalId === 7) return 'piglin';
  if (portalId === 99) return 'wither';
  return null;
}

function playOverlayVideo(src, onDone, resumeAudio = true) {
  if (!src) {
    if (onDone) onDone();
    return;
  }

  const bgmEl = document.getElementById('bgm');
  const finalBgmEl = document.getElementById('final-bgm');
  const wasBgmPlaying = bgmEl && !bgmEl.paused;
  const wasFinalBgmPlaying = finalBgmEl && !finalBgmEl.paused;
  if (bgmEl) bgmEl.pause();
  if (finalBgmEl) finalBgmEl.pause();

  state.cutscenePlaying = true;
  videoOverlay.classList.remove('hidden');
  climaxVideo.src = src;
  climaxVideo.currentTime = 0;

  const finish = () => {
    climaxVideo.pause();
    videoOverlay.classList.add('hidden');
    state.cutscenePlaying = false;
    climaxVideo.onended = null;
    climaxVideo.onerror = null;
    if (resumeAudio) {
      if (wasBgmPlaying && bgmEl) bgmEl.play().catch(() => { });
      if (wasFinalBgmPlaying && finalBgmEl) finalBgmEl.play().catch(() => { });
    }
    if (onDone) onDone();
  };

  climaxVideo.onended = finish;
  climaxVideo.onerror = finish;
  let playPromise = climaxVideo.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => finish());
  }
}

function maybePlayEncounterVideo(portalId, isFinal, phase, onDone, resumeAudio = true) {
  if (isFinal && portalId !== 99) {
    if (onDone) onDone();
    return;
  }
  const type = getEncounterVideoTypeByPortal(portalId);
  const clips = type ? ENCOUNTER_VIDEO_ASSETS[type] : null;
  const src = clips ? clips[phase] : null;
  playOverlayVideo(src, onDone, resumeAudio);
}

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

function showCombatMenu(options, correctOpts, onAnswer) {
  state.combatOpen = true;
  combatMenu.classList.remove('hidden');
  combatOptionsDiv.innerHTML = '';
  const optionPack = options.map((opt, idx) => ({ label: Array.isArray(opt) ? opt[0] : opt, originalIndex: idx }));
  for (let i = optionPack.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionPack[i], optionPack[j]] = [optionPack[j], optionPack[i]];
  }
  optionPack.forEach((optObj) => {
    let div = document.createElement('div');
    div.className = 'combat-option';
    div.innerText = optObj.label;
    div.onclick = () => {
      combatMenu.classList.add('hidden');
      state.combatOpen = false;
      onAnswer(optObj.originalIndex, correctOpts.includes(optObj.originalIndex));
    };
    combatOptionsDiv.appendChild(div);
  });
}

function attackEnemy(victoryCallback, successText) {
  const theme = getActiveTheme();
  playTone(800, 'square', 0.2, 0.2);
  playWhoosh();
  playImpactStack();
  playTone(980, 'triangle', 0.1, 0.12);
  state.battleFx.hitStop = 10;
  state.battleFx.freezeStamp = Date.now();
  state.shakeTimer = 1.6;
  battleScreenPulse(theme.combo, 0.35, 260);
  spawnBattleText("FINISH!", "#ffeb3b", 42);
  state.battle.enemyHp = 0;
  updateBattleHUD();
  showDialog("Coach", [successText || "Threat contained. Great response."], () => {
    endBattle();
    victoryCallback();
  });
}

function enemyAttacks(retryCallback, coachingText) {
  state.shakeTimer = 1.0;
  playTone(150, 'sawtooth', 0.4, 0.3);
  playImpactStack();
  battleScreenPulse('#ff1744', 0.22, 170);
  spawnBattleText("-15", "#ff1744", 26);
  state.battleFx.combo = 0;
  state.battleFx.comboTimer = 0;
  state.battleFx.charging = false;
  state.battleFx.chargeTimer = 0;
  state.battleFx.queuedDamage = null;
  state.battleFx.resolving = false;

  state.player.hp -= 15;
  if (state.player.hp < 0) state.player.hp = 0;
  updateBattleHUD();

  if (state.player.hp === 0) {
    setTimeout(() => {
      showDialog("Coach", ["Shields are low. Resetting this challenge so you can practice again."], () => {
        state.player.hp = state.player.maxHp;
        updateBattleHUD();
        retryCallback();
      });
    }, 420);
  } else {
    setTimeout(() => {
      showDialog("Coach", ["Almost there. " + coachingText, "Look for the option that lowers risk first, then try again."], retryCallback);
    }, 320);
  }
}

function endBattle() {
  state.battle.active = false;
  state.battleFx.projectiles = [];
  state.battleFx.slashes = [];
  state.battleFx.sparks = [];
  state.battleFx.spells = [];
  state.battleFx.combo = 0;
  state.battleFx.comboTimer = 0;
  state.battleFx.charging = false;
  state.battleFx.chargeTimer = 0;
  state.battleFx.queuedDamage = null;
  state.battleFx.resolving = false;
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

function spawnBattleText(text, color = "#fff", size = 34) {
  const el = document.createElement('div');
  el.innerText = text;
  el.style.position = 'fixed';
  el.style.left = (window.innerWidth * 0.68 + (Math.random() - 0.5) * 120) + 'px';
  el.style.top = (window.innerHeight * 0.32 + (Math.random() - 0.5) * 80) + 'px';
  el.style.color = color;
  el.style.fontFamily = "'Press Start 2P', monospace";
  el.style.fontSize = size + 'px';
  el.style.textShadow = '3px 3px 0 #000';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '1001';
  el.style.transition = 'transform 1.25s ease-out, opacity 1.25s ease-out';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(-70px) scale(1.06)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 1300);
}

function battleScreenPulse(color, alpha = 0.25, ms = 180) {
  const fx = document.createElement('div');
  fx.style.position = 'fixed';
  fx.style.inset = '0';
  fx.style.background = color;
  fx.style.opacity = String(alpha);
  fx.style.pointerEvents = 'none';
  fx.style.zIndex = '999';
  fx.style.transition = `opacity ${ms}ms ease-out`;
  document.body.appendChild(fx);
  requestAnimationFrame(() => { fx.style.opacity = '0'; });
  setTimeout(() => fx.remove(), ms + 40);
}

function getActiveTheme() {
  const enemy = state.battle && state.battle.enemy;
  if (!enemy) return BATTLE_THEMES.default;
  const domain = enemy.domain || DOMAIN_BY_PORTAL[enemy.id];
  return BATTLE_THEMES[domain] || BATTLE_THEMES.default;
}

function applyBattleUiTheme(theme) {
  const enemyBox = document.querySelector('.enemy-status');
  const playerBox = document.querySelector('.player-status');
  const combat = document.getElementById('combat-menu');
  if (!enemyBox || !playerBox || !combat) return;
  enemyBox.style.boxShadow = `0 0 18px ${theme.glow}, 4px 4px 0 rgba(0,0,0,0.3)`;
  playerBox.style.boxShadow = `0 0 12px ${theme.glow}, 4px 4px 0 rgba(0,0,0,0.3)`;
  combat.style.borderColor = theme.primary;
}

function spawnHitVfx() {
  const fx = state.battleFx;
  const theme = getActiveTheme();
  fx.slashes.push({ life: 1, color: theme.primary });
  fx.slashes.push({ life: 0.75, color: "#ffffff", offset: 14 });
  spawnUniqueAttackVfx(fx.attackStyle, theme);
  for (let i = 0; i < 14; i++) {
    fx.sparks.push({
      x: canvas.width * 0.7 + (Math.random() - 0.5) * 40,
      y: canvas.height * 0.4 + (Math.random() - 0.5) * 30,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: 1,
      color: theme.primary
    });
  }
  for (let i = 0; i < 10; i++) {
    fx.sparks.push({
      x: canvas.width * 0.7 + (Math.random() - 0.5) * 50,
      y: canvas.height * 0.4 + (Math.random() - 0.5) * 35,
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 0.5) * 7,
      life: 0.9,
      color: "#ffffff"
    });
  }
}

function spawnUniqueAttackVfx(style, theme) {
  const fx = state.battleFx;
  const base = { life: 1, color: theme.primary };
  switch (style) {
    case "phishing_beam":
      fx.spells.push({ ...base, kind: "beam", width: 34 });
      break;
    case "deepfake_cards":
      for (let i = 0; i < 5; i++) {
        fx.spells.push({ ...base, kind: "card", t: i * -0.12, rot: (Math.random() - 0.5) * 0.7, vy: (Math.random() - 0.5) * 0.06 });
      }
      break;
    case "malware_glitch":
      fx.spells.push({ ...base, kind: "glitch_orb", t: 0, wobble: Math.random() * Math.PI * 2 });
      break;
    case "auth_sigil":
      fx.spells.push({ ...base, kind: "sigil", r: 20 });
      fx.spells.push({ ...base, kind: "lance", t: -0.05 });
      break;
    case "incident_wave":
      fx.spells.push({ ...base, kind: "wave", t: 0, amp: 24 });
      break;
    case "wither_rift":
      fx.spells.push({ ...base, kind: "rift", t: 0 });
      fx.spells.push({ ...base, kind: "beam", width: 46, dark: true });
      break;
    default:
      fx.spells.push({ ...base, kind: "beam", width: 28 });
      break;
  }
}

function drawUniqueSpells() {
  const fx = state.battleFx;
  const theme = getActiveTheme();
  const sx = canvas.width * 0.33;
  const sy = canvas.height * 0.64;
  const ex = canvas.width * 0.7;
  const ey = canvas.height * 0.4;
  const nx = ex - sx;
  const ny = ey - sy;
  const len = Math.max(1, Math.hypot(nx, ny));
  const ux = nx / len;
  const uy = ny / len;
  const px = -uy;
  const py = ux;

  fx.spells.forEach(sp => {
    if (sp.kind === "beam") {
      const a = Math.max(0, sp.life);
      ctx.save();
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = sp.dark ? "#7c4dff" : theme.primary;
      ctx.lineWidth = sp.width * a;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(6, sp.width * 0.28);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
      sp.life -= 0.08;
    } else if (sp.kind === "card") {
      sp.t += 0.05;
      const x = sx + nx * sp.t + px * Math.sin(sp.t * 8) * 18;
      const y = sy + ny * sp.t + py * Math.cos(sp.t * 6) * 14;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sp.rot + sp.t * 0.6);
      ctx.fillStyle = theme.primary;
      ctx.fillRect(-8, -12, 16, 24);
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(-8, -12, 16, 24);
      ctx.restore();
      sp.life -= 0.04;
    } else if (sp.kind === "glitch_orb") {
      sp.t += 0.055;
      const x = sx + nx * sp.t + (Math.random() - 0.5) * 10;
      const y = sy + ny * sp.t + (Math.random() - 0.5) * 10;
      ctx.fillStyle = theme.primary;
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? "#00ff7f" : "#111";
        ctx.fillRect(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24, 6, 4);
      }
      sp.life -= 0.06;
    } else if (sp.kind === "sigil") {
      sp.r += 7;
      ctx.strokeStyle = theme.primary;
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.beginPath();
      ctx.arc(sx, sy, sp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, sp.r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      sp.life -= 0.07;
    } else if (sp.kind === "lance") {
      sp.t += 0.07;
      const x = sx + nx * sp.t;
      const y = sy + ny * sp.t;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - ux * 24, y - uy * 24);
      ctx.lineTo(x + ux * 24, y + uy * 24);
      ctx.stroke();
      sp.life -= 0.08;
    } else if (sp.kind === "wave") {
      sp.t += 0.045;
      const cx = sx + nx * sp.t;
      const cy = sy + ny * sp.t;
      ctx.strokeStyle = theme.primary;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = i / 13 * Math.PI * 2;
        const r = 18 + Math.sin(a * 3 + sp.t * 8) * 8;
        const wx = cx + Math.cos(a) * r;
        const wy = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.stroke();
      sp.life -= 0.055;
    } else if (sp.kind === "rift") {
      sp.t += 0.04;
      const x = sx + nx * sp.t;
      const y = sy + ny * sp.t;
      const rr = 16 + Math.sin(sp.t * 16) * 5;
      ctx.fillStyle = "#1a0033";
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#b388ff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, rr + 4, 0, Math.PI * 2);
      ctx.stroke();
      sp.life -= 0.05;
    }
  });

  fx.spells = fx.spells.filter(sp => sp.life > 0 && (sp.t === undefined || sp.t < 1.2));
}

function drawBattleFx() {
  const fx = state.battleFx;
  const theme = getActiveTheme();
  const sx = canvas.width * 0.33;
  const sy = canvas.height * 0.64;
  const ex = canvas.width * 0.7;
  const ey = canvas.height * 0.4;

  drawUniqueSpells();

  fx.slashes.forEach(s => {
    const alpha = s.life;
    ctx.globalAlpha = Math.max(0.2, alpha);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    const o = s.offset || 0;
    ctx.moveTo(ex - 36, ey - 26 - o);
    ctx.lineTo(ex + 34, ey + 36 - o);
    ctx.stroke();
    ctx.globalAlpha = 1;
    s.life -= 0.055;
  });
  fx.slashes = fx.slashes.filter(s => s.life > 0);

  fx.sparks.forEach(sp => {
    sp.x += sp.vx;
    sp.y += sp.vy;
    sp.vy += 0.1;
    sp.life -= 0.028;
    ctx.fillStyle = sp.color;
    ctx.globalAlpha = Math.max(0, sp.life);
    ctx.fillRect(sp.x, sp.y, 3, 3);
    ctx.globalAlpha = 1;
  });
  fx.sparks = fx.sparks.filter(sp => sp.life > 0);

  if (fx.combo > 1 && fx.comboTimer > 0) {
    const pulse = 1 + Math.sin(Date.now() * 0.015) * 0.08;
    const comboColor = theme.combo;
    ctx.save();
    ctx.translate(canvas.width * 0.52, canvas.height * 0.2);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = comboColor;
    ctx.font = "bold 28px 'Press Start 2P'";
    ctx.textAlign = "center";
    ctx.fillText(`${fx.combo}x COMBO`, 0, 0);
    ctx.restore();
    fx.comboTimer -= 0.012;
    if (fx.comboTimer <= 0) fx.combo = 0;
  }

  if (fx.combo > 1 && fx.comboTimer > 0) {
    const lineAlpha = Math.min(0.25, fx.comboTimer * 0.08);
    ctx.save();
    ctx.globalAlpha = lineAlpha;
    ctx.strokeStyle = theme.combo;
    ctx.lineWidth = 2;
    for (let i = 0; i < 11; i++) {
      const y = canvas.height * 0.08 + i * 34;
      ctx.beginPath();
      ctx.moveTo(canvas.width * 0.42, y);
      ctx.lineTo(canvas.width * 0.95, y - 28);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (fx.charging && fx.chargeTimer > 0) {
    const p = 1 - (fx.chargeTimer / Math.max(1, fx.chargeMax));
    const r = 18 + p * 38 + Math.sin(Date.now() * 0.03) * 4;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.65, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i / 12) + Date.now() * 0.004;
      const px = sx + Math.cos(a) * (r + 12);
      const py = sy + Math.sin(a) * (r + 12);
      ctx.fillStyle = theme.combo;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    fx.chargeTimer -= 1;
    if (fx.chargeTimer <= 0 && fx.queuedDamage) {
      const q = fx.queuedDamage;
      fx.queuedDamage = null;
      executeChargedAttack(q.mode, q.onRelease);
    }
  }
}

function animeImpactCut(color = "#ffffff") {
  const cut = document.createElement('div');
  cut.style.position = 'fixed';
  cut.style.left = '0';
  cut.style.right = '0';
  cut.style.top = '45%';
  cut.style.height = '8px';
  cut.style.background = color;
  cut.style.boxShadow = `0 0 30px ${color}`;
  cut.style.opacity = '0.95';
  cut.style.pointerEvents = 'none';
  cut.style.zIndex = '1002';
  cut.style.transition = 'transform 130ms ease-out, opacity 140ms ease-out';
  document.body.appendChild(cut);
  requestAnimationFrame(() => {
    cut.style.transform = 'scaleX(1.25)';
    cut.style.opacity = '0';
  });
  setTimeout(() => cut.remove(), 170);
}

function animeComboPulse(color = "#ffffff") {
  const ring = document.createElement('div');
  ring.style.position = 'fixed';
  ring.style.left = '50%';
  ring.style.top = '20%';
  ring.style.width = '48px';
  ring.style.height = '48px';
  ring.style.borderRadius = '50%';
  ring.style.border = `3px solid ${color}`;
  ring.style.transform = 'translate(-50%, -50%) scale(0.6)';
  ring.style.opacity = '0.9';
  ring.style.pointerEvents = 'none';
  ring.style.zIndex = '1002';
  ring.style.transition = 'transform 220ms ease-out, opacity 220ms ease-out';
  document.body.appendChild(ring);
  requestAnimationFrame(() => {
    ring.style.transform = 'translate(-50%, -50%) scale(2.2)';
    ring.style.opacity = '0';
  });
  setTimeout(() => ring.remove(), 260);
}

function showUltimateCutIn(theme, cb) {
  const cut = document.createElement('div');
  cut.style.position = 'fixed';
  cut.style.right = '-120%';
  cut.style.top = '44%';
  cut.style.transform = 'translateY(-50%)';
  cut.style.padding = '12px 30px 12px 70px';
  cut.style.fontFamily = "'Press Start 2P', monospace";
  cut.style.fontSize = '20px';
  cut.style.color = '#fff';
  cut.style.background = 'rgba(8,8,18,0.92)';
  cut.style.borderLeft = `6px solid ${theme.primary}`;
  cut.style.boxShadow = `0 0 30px ${theme.glow}`;
  cut.style.zIndex = '1003';
  cut.style.pointerEvents = 'none';
  cut.style.transition = 'right 220ms ease-out, opacity 220ms ease-out';
  cut.innerText = 'COUNTERMEASURE DEPLOYED';
  document.body.appendChild(cut);
  requestAnimationFrame(() => { cut.style.right = '0'; });
  setTimeout(() => {
    cut.style.opacity = '0';
    setTimeout(() => cut.remove(), 230);
    if (cb) cb();
  }, 420);
}

function startChargeSequence(mode, onRelease) {
  state.battleFx.charging = true;
  state.battleFx.resolving = false;
  state.battleFx.chargeMax = mode === "final" ? 288 : 192;
  state.battleFx.chargeTimer = state.battleFx.chargeMax;
  state.battleFx.queuedDamage = { mode, onRelease };
  showDialog("Coach", [mode === "final" ? "Charging final countermeasure..." : "Charging secure countermeasure..."], null);
}

function executeChargedAttack(mode, onRelease) {
  state.battleFx.resolving = true;
  state.battleFx.charging = false;
  const theme = getActiveTheme();
  if (mode === "normal") {
    dealEnemyDamage(33);
    spawnBattleText("CAST!", theme.combo, 24);
    setTimeout(() => {
      state.battleFx.resolving = false;
      if (onRelease) onRelease();
    }, 520);
  } else {
    showUltimateCutIn(theme, () => {
      spawnHitVfx();
      attackEnemy(onRelease, "Final strike landed. Threat fully neutralized.");
      state.battleFx.resolving = false;
    });
  }
}

function dealEnemyDamage(amount) {
  const theme = getActiveTheme();
  state.battle.enemyHp = Math.max(0, state.battle.enemyHp - amount);
  updateBattleHUD();
  playWhoosh();
  playImpactStack();
  playTone(700, 'square', 0.12, 0.15);
  state.battleFx.hitStop = 7;
  state.battleFx.freezeStamp = Date.now();
  state.shakeTimer = Math.min(1.4, state.shakeTimer + 0.5);
  spawnHitVfx();
  state.battleFx.combo = Math.min(9, state.battleFx.combo + 1);
  state.battleFx.comboTimer = 4.2;
  if (state.battleFx.combo >= 2) playComboChime(state.battleFx.combo);
  animeImpactCut(theme.primary);
  if (state.battleFx.combo >= 2) animeComboPulse(theme.combo);
  spawnBattleText(`-${amount}`, theme.primary, 30);
  battleScreenPulse(theme.primary, 0.18, 140);
}

function triggerEncounter(portalId, isFinal = false) {
  const combats = {
    3: {
      speaker: 'Phishing Creeper', type: 'creeper',
      domain: "phishing",
      attackStyle: "phishing_beam",
      pre: ["Alert: your account needs urgent action.", "A short link asks for your password now."],
      steps: [
        { q: "What is happening?", options: ["A trusted bank update", "A likely phishing message", "A normal reminder"], ans: 1, coach: "Urgency and unknown links are phishing warning signs." },
        { q: "What is risky?", options: ["Checking through official channels", "Entering password in an unknown link", "Reporting the message"], ans: 1, coach: "Never share passwords through unverified pages." },
        { q: "What is the safest action?", options: ["Verify with the official bank number", "Click first and decide later", "Forward it to everyone"], ans: 0, coach: "Independent verification is safest." }
      ],
      post: () => completePortal(3, isFinal)
    },
    4: {
      speaker: 'Deepfake Trader', type: 'villager',
      domain: "deepfake",
      attackStyle: "deepfake_cards",
      pre: ["A voice message sounds like your CEO.", "It asks for an urgent transfer and to skip policy."],
      steps: [
        { q: "What is happening?", options: ["Likely impersonation attempt", "Normal approved request", "General reminder"], ans: 0, coach: "Urgency plus bypassing policy is suspicious." },
        { q: "What is risky?", options: ["Sending money without verification", "Verifying on official internal channels", "Following approval flow"], ans: 0, coach: "Financial actions require verification." },
        { q: "What is the safest action?", options: ["Refuse and verify through trusted company channel", "Send now to be safe", "Share credentials"], ans: 0, coach: "Trusted channels prevent deepfake abuse." }
      ],
      post: () => completePortal(4, isFinal)
    },
    5: {
      speaker: isFinal ? 'Zombie - Zero Day Shrine' : 'Malware Zombie', type: 'zombie',
      domain: "malware",
      attackStyle: "malware_glitch",
      pre: isFinal
        ? ["Multiple endpoints suddenly encrypt files and leave ransom notes.", "Backups may also be exposed."]
        : ["An unexpected file arrived: invoice.pdf.exe.", "It asks you to open it right away."],
      steps: isFinal
        ? [
          { q: "What is the first priority?", options: ["Isolate impacted hosts immediately", "Reboot everything at once", "Pay ransom to save time"], ans: 0, coach: "Containment comes first to stop spread." },
          { q: "Which action reduces blast radius?", options: ["Disconnect shared storage and lateral paths", "Disable logging", "Post incident details publicly"], ans: 0, coach: "Segmenting and isolating shared paths limits damage." },
          { q: "Best recovery approach?", options: ["Restore from verified clean backups after eradication", "Restore unknown backups immediately", "Ignore root-cause analysis"], ans: 0, coach: "Recover only after malware is removed and backups are trusted." }
        ]
        : [
          { q: "What is happening?", options: ["Possible malware delivery", "Safe office file", "System update"], ans: 0, coach: "Unexpected executable files are high-risk." },
          { q: "What is risky?", options: ["Opening unknown executable files", "Scanning before opening", "Reporting suspicious email"], ans: 0, coach: "Opening unknown executables can install malware." },
          { q: "What is the safest action?", options: ["Delete, report, and run a scan", "Open as admin", "Disable antivirus first"], ans: 0, coach: "Contain and report quickly." }
        ],
      post: () => completePortal(5, isFinal)
    },
    6: {
      speaker: isFinal ? 'Enderman - Absolute Decompilation' : 'Keylog Enderman', type: 'enderman',
      domain: "auth",
      attackStyle: "auth_sigil",
      pre: isFinal
        ? ["Privileged sessions were hijacked and tokens may be stolen.", "Several admin accounts show impossible travel logins."]
        : ["Your browser acts strange while typing passwords.", "A hidden script may be recording keys."],
      steps: isFinal
        ? [
          { q: "What should happen first?", options: ["Revoke active sessions and tokens", "Wait for users to log out", "Only change desktop wallpaper"], ans: 0, coach: "Immediate token/session revocation cuts attacker access." },
          { q: "How to recover privileged access safely?", options: ["Rotate admin credentials from a clean device and enforce MFA", "Reuse old passwords", "Disable MFA to simplify"], ans: 0, coach: "Use clean endpoints and strong auth controls." },
          { q: "What validates containment?", options: ["Review auth logs for anomalous sign-ins and lock risky paths", "Delete all logs", "Assume fixed without evidence"], ans: 0, coach: "Verification through logs confirms the response worked." }
        ]
        : [
          { q: "What is happening?", options: ["Possible keylogger activity", "Only normal lag", "Safe patch"], ans: 0, coach: "This behavior can mean credential theft." },
          { q: "What is risky?", options: ["Changing passwords on same infected device", "Disconnecting first", "Using a clean device"], ans: 0, coach: "Use a clean device for password resets." },
          { q: "What is the safest action?", options: ["Scan device and rotate passwords with MFA", "Keep logging in", "Share password to test"], ans: 0, coach: "Contain first, then recover securely." }
        ],
      post: () => completePortal(6, isFinal)
    },
    7: {
      speaker: isFinal ? 'Piglin - Distributed Botnet Space' : 'Brute Piglin', type: 'piglin',
      domain: "incident_response",
      attackStyle: "incident_wave",
      pre: isFinal
        ? ["Traffic spikes from thousands of distributed sources hit multiple endpoints.", "Service health is degrading rapidly."]
        : ["Many login attempts are hitting one account each second.", "The service is slowing down."],
      steps: isFinal
        ? [
          { q: "What type of attack is this pattern?", options: ["Distributed denial-of-service activity", "Normal seasonal traffic", "Local hardware failure"], ans: 0, coach: "Volume from many sources indicates distributed flooding." },
          { q: "What should be enabled immediately?", options: ["Rate limiting, WAF rules, and upstream filtering", "Disable alerts and autoscaling", "Open all debug ports"], ans: 0, coach: "Layered traffic controls reduce service pressure." },
          { q: "What is the best communication move?", options: ["Trigger incident comms and status updates while monitoring", "Stay silent and hope recovery", "Share private keys"], ans: 0, coach: "Coordinated response includes technical and stakeholder communication." }
        ]
        : [
          { q: "What is happening?", options: ["Brute-force login attack", "Normal behavior", "Scheduled backup"], ans: 0, coach: "Fast repeated attempts are brute-force patterns." },
          { q: "What is risky?", options: ["No lockout and weak passwords", "MFA and rate limits", "Monitoring alerts"], ans: 0, coach: "Weak controls raise account takeover risk." },
          { q: "What is the safest action?", options: ["Enable lockouts, MFA, and monitoring", "Turn off logs", "Post passwords publicly"], ans: 0, coach: "Layered controls reduce damage." }
        ],
      post: () => completePortal(7, isFinal)
    },
    99: {
      speaker: 'Darknet Wither', type: 'wither',
      domain: "incident_response",
      attackStyle: "wither_rift",
      pre: ["Critical alert: malware, data theft, and heavy traffic are active.", "This is a high-priority cyber incident."],
      steps: [
        { q: "What is happening?", options: ["Multi-vector cyber incident", "Minor visual bug", "Routine maintenance"], ans: 0, coach: "Multiple simultaneous alerts need incident response." },
        { q: "What is risky?", options: ["Ignoring response procedures", "Isolating affected systems", "Escalating to incident team"], ans: 0, coach: "Delay increases impact." },
        { q: "What is the safest action?", options: ["Isolate critical segments and run incident playbook", "Wait for it to end", "Share secrets online"], ans: 0, coach: "Containment and coordinated response protect users." }
      ],
      post: () => completePortal(99, isFinal)
    }
  };

  const encounter = combats[portalId];
  if (!encounter) return;

  const startBattle = () => {
    document.getElementById('battle-flash').classList.add('flash-anim');
    playTone(400, 'square', 0.8, 0.2);

    setTimeout(() => {
    state.battle.active = true;
    state.battleFx.projectiles = [];
    state.battleFx.slashes = [];
    state.battleFx.sparks = [];
    state.battleFx.spells = [];
    state.battleFx.combo = 0;
    state.battleFx.comboTimer = 0;
    state.battleFx.hitStop = 0;
    state.battleFx.freezeStamp = 0;
    state.battleFx.charging = false;
    state.battleFx.chargeTimer = 0;
    state.battleFx.queuedDamage = null;
    state.battleFx.resolving = false;
    state.battle.enemy = encounter;
    state.battle.enemy.id = portalId;
    state.battle.enemyHp = 100;
    state.battle.enemyMaxHp = 100;

    document.getElementById('battle-scene').classList.remove('hidden');
    document.getElementById('enemy-name').innerText = encounter.speaker;
    document.getElementById('player-name').innerText = "AGENT";
    state.battleFx.uiTheme = BATTLE_THEMES[encounter.domain] || BATTLE_THEMES.default;
    state.battleFx.attackStyle = encounter.attackStyle || "default";
    applyBattleUiTheme(state.battleFx.uiTheme);
    updateBattleHUD();

    showDialog(encounter.speaker, encounter.pre.slice(), () => runScenarioSteps(encounter, encounter.post));

      document.getElementById('battle-flash').classList.remove('flash-anim');
    }, 800);
  };

  maybePlayEncounterVideo(portalId, isFinal, 'intro', startBattle);
}

function runScenarioSteps(encounter, onVictory) {
  const domain = encounter.domain || DOMAIN_BY_PORTAL[state.battle.enemy.id];
  maybeShowTermHint(domain === "incident_response" ? "incident" : domain);
  let steps = encounter.steps.slice();
  let scenarioCompleted = false;
  const isDomainExpansionFight = !!(state.battle && state.battle.enemy && state.battle.enemy.id >= 5 && state.battle.enemy.id <= 99 && state.bossRevealed);

  function getScenarioGuidance(stepText) {
    const t = (stepText || "").toLowerCase();
    if (t.includes("happening") || t.includes("type of attack")) return "Start by identifying the threat pattern before taking action.";
    if (t.includes("risky")) return "Pick the choice that avoids sharing secrets or increasing damage.";
    if (t.includes("safest") || t.includes("best") || t.includes("first priority") || t.includes("should happen first")) {
      return isDomainExpansionFight
        ? "In advanced incidents, contain first, verify second, recover third."
        : "Choose the action that verifies identity and reduces risk first.";
    }
    return "Choose the option that protects users, data, and service continuity.";
  }

  const repeat = learnerProfile.repetitionQueue.find(r => r.domain === domain);
  if (repeat) {
    steps = repeat.steps.concat(steps);
    learnerProfile.repetitionQueue = learnerProfile.repetitionQueue.filter(r => r !== repeat);
  }

  function completeScenarioSuccess() {
    if (scenarioCompleted) return;
    scenarioCompleted = true;
    learnerProfile.mastery[domain] = Math.min(100, getMastery(domain) + 18);
    learnerProfile.totalCorrect += 1;
    learnerProfile.totalAttempts += steps.length;
    learnerProfile.scenarioResults.push({ domain, passed: true, at: Date.now() });
    saveLearnerProfile();
  }

  function runStep(i) {
    if (i >= steps.length) {
      completeScenarioSuccess();
      attackEnemy(onVictory, "Threat contained. Excellent decision flow.");
      return;
    }

    const step = steps[i];
    const guidance = step.guide || getScenarioGuidance(step.q);
    showDialog("Coach", [step.q, guidance], () => {
      const askedAt = performance.now();
      showCombatMenu(step.options, [step.ans], (selected, correct) => {
        const dt = performance.now() - askedAt;
        const perfect = dt < 2200;
        if (correct) {
          const isFinalStep = i === steps.length - 1;
          if (isFinalStep) {
            const theme = getActiveTheme();
            showDialog("Coach", ["Correct. " + step.coach, "Finishing move ready."], () => {
              completeScenarioSuccess();
              if (perfect) {
                spawnBattleText("PERFECT", theme.combo, 24);
                animeComboPulse(theme.combo);
              }
              startChargeSequence("final", onVictory);
            });
          } else {
            startChargeSequence("normal", () => runStep(i + 1));
            if (perfect) {
              spawnBattleText("PERFECT", getActiveTheme().combo, 20);
              animeComboPulse(getActiveTheme().combo);
            }
            setTimeout(() => {
              showDialog("Coach", ["Correct. " + step.coach, "Charge complete. Releasing attack..."], null);
            }, 260);
          }
          return;
        }
        learnerProfile.mastery[domain] = Math.max(0, getMastery(domain) - 8);
        learnerProfile.totalAttempts += 1;
        learnerProfile.mistakes.push({ domain, step: step.q, selected: step.options[selected], at: Date.now() });
        if (!learnerProfile.repetitionQueue.some(r => r.domain === domain)) {
          learnerProfile.repetitionQueue.push({ domain, steps: [step] });
        }
        saveLearnerProfile();
        enemyAttacks(() => runStep(i), step.coach);
      });
    });
  }

  runStep(0);
}

function completePortal(pid, isFinal) {
  if (isFinal) {
    learnerProfile.xp = (learnerProfile.xp || 0) + 200;
    learnerProfile.finalInteractionsCleared = (learnerProfile.finalInteractionsCleared || 0) + 1;
    saveLearnerProfile();

    let mob = state.finalMobs.find(m => m.id === pid);
    if (mob) mob.alive = false;

    const continueAfterCleansed = () => {
      if (state.finalMobs.every(m => !m.alive)) {
        if (!state.witherSpawned) {
          state.witherSpawned = true;
          showDialog("System", ["WARNING! Code Red!", "A massive Zero-Day multi-vector signature detected!", "The Darknet Wither has formed!"], () => {
            state.finalMobs.push({ id: 99, type: 'wither', x: 16, y: 18, alive: true, size: 2.2 });
            state.flashTimer = 0;
          });
        } else {
          const finishWither = () => {
            state.bossDefeated = true;
            state.worldRed = false; // Restore world color!
            document.getElementById('final-bgm').pause(); // Stop boss music
            document.getElementById('bgm').play().catch(e => console.log(e)); // Restart original BGM as victory

            showDialog("System", ["Darknet Wither neutralized. Network stabilized."], () => {
              setTimeout(() => startCreditsSequence(), 1200);
            });
          };
          maybePlayEncounterVideo(99, true, 'outro', finishWither, false);
        }
      }
    };

    showDialog("System", ["Threat cleansed from the physical domain."], continueAfterCleansed);
  } else {
    const finishPortalClose = () => {
      learnerProfile.xp = (learnerProfile.xp || 0) + 100;
      learnerProfile.portalsClearedCount = (learnerProfile.portalsClearedCount || 0) + 1;
      saveLearnerProfile();

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
    };

    maybePlayEncounterVideo(pid, false, 'outro', finishPortalClose);
  }
}

function checkEndgame() {
  if (state.portalsCleared.every(v => v === true) && !state.bossRevealed) {
    state.bossRevealed = true;
    showDialog("System", ["Alert: hidden threat signatures detected.", "Domain expansion detected."], playCutscene);
  }
}

function playCutscene() {
  document.getElementById('bgm').pause();
  document.getElementById('final-bgm').pause();
  state.cutscenePlaying = true;
  videoOverlay.classList.remove('hidden');
  climaxVideo.src = '/static/SpecialCutscene.mp4';
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
    showDialog("Darknet Devil", ["You made it this far, Agent.", "My strongest signatures are now active."], () => {
      showDialog("System", ["Alert: advanced threats are active in the main world. Cleanse them all."], null);
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
      if (isAdvancedPortalLocked() && foundTile >= 5) {
        showDialog("System", ["Portal sealed.", "Clear both Creeper and Trader portals, or reach 35% mastery in both Phishing and Deepfake."], null);
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
    if (state.battleFx.combo > 1 && state.battleFx.comboTimer > 0) {
      const p = 1 + Math.sin(Date.now() * 0.01) * 0.018;
      ctx.translate(canvas.width * 0.5, canvas.height * 0.5);
      ctx.scale(p, p);
      ctx.translate(-canvas.width * 0.5, -canvas.height * 0.5);
    }

    const nowTs = state.battleFx.hitStop > 0 ? (state.battleFx.freezeStamp || Date.now()) : Date.now();
    if (state.battleFx.hitStop > 0) state.battleFx.hitStop -= 1;

    let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#B0E0E6');
    grad.addColorStop(1, '#FFF');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#C8E6C9';
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.7, canvas.height * 0.4, 180, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#A5D6A7';
    ctx.beginPath();
    ctx.ellipse(canvas.width * 0.3, canvas.height * 0.8, 200, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    let eBob = Math.sin(nowTs * 0.005) * 5;
    drawSprite(canvas.width * 0.7 - CS * 1.5, canvas.height * 0.4 - CS * 3 + eBob, CS * 3, state.battle.enemy.type);

    let pBob = Math.cos(nowTs * 0.005) * 3;
    drawSprite(canvas.width * 0.3 - CS * 2, canvas.height * 0.8 - CS * 4 + pBob, CS * 4, 'steve-back');
    drawBattleFx();

    if ((state.battle.enemyHp / state.battle.enemyMaxHp) <= 0.34 && state.battle.enemyHp > 0) {
      const t = 0.12 + (Math.sin(Date.now() * 0.02) + 1) * 0.08;
      const g = ctx.createRadialGradient(canvas.width * 0.52, canvas.height * 0.5, canvas.width * 0.15, canvas.width * 0.52, canvas.height * 0.5, canvas.width * 0.65);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(180,0,0,${Math.min(0.38, t)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

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

