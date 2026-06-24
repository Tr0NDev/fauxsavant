import { createRoom, joinRoom } from "./db.js";
import { createInitialGameState, generateRoomCode } from "./game.js";

const hostNameInput = document.getElementById("host-name");
const joinNameInput = document.getElementById("join-name");
const joinCodeInput = document.getElementById("join-code");
const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "default") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function showCopiedBadge(inputEl) {
  try {
    const parent = inputEl.parentElement || document.body;
    const badge = document.createElement('div');
    badge.className = 'copied-badge';
    badge.textContent = 'Code copié';
    // ensure parent is positioned to allow absolute placement
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(badge);
    // trigger animation
    requestAnimationFrame(() => badge.classList.add('show'));
    setTimeout(() => {
      badge.classList.remove('show');
      setTimeout(() => badge.remove(), 200);
    }, 1400);
  } catch (e) {
    // ignore
  }
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function getStoredName() {
  return localStorage.getItem("lastPlayerName") || "";
}

function storeName(name) {
  try {
    localStorage.setItem("lastPlayerName", name);
  } catch (e) {
    // ignore
  }
}

function generateRandomName() {
  const prefixes = ["Joueur", "Invité", "Player", "Guest"];
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}${suffix}`;
}

function createPlayer(name) {
  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, name };
}

async function handleCreate() {
  let name = hostNameInput.value.trim();
  if (!name) {
    name = generateRandomName();
  }
  storeName(name);
  hostNameInput.value = name;

  const roomCode = generateRoomCode();
  const player = createPlayer(name);
  const initialState = createInitialGameState(roomCode, player.id);
  initialState.players[player.id] = {
    id: player.id,
    name,
    score: 0,
    eliminated: false,
    ready: true,
    online: true,
  };

  try {
    await createRoom(initialState);
    sessionStorage.setItem("roomCode", roomCode);
    sessionStorage.setItem("playerId", player.id);
    // copy room code to clipboard so host can share it quickly
    try {
      await navigator.clipboard.writeText(roomCode);
    } catch (e) {
      // ignore clipboard errors
    }
    window.location.href = `game.html?room=${roomCode}`;
  } catch (err) {
    console.error(err);
    showToast(err.message || "Erreur lors de la création de la partie", "danger");
  }
}

async function handleJoin() {
  let name = joinNameInput.value.trim();
  const roomCode = normalizeRoomCode(joinCodeInput.value);
  if (!name) {
    name = generateRandomName();
  }
  storeName(name);
  joinNameInput.value = name;
  if (!roomCode || roomCode.length !== 6) {
    showToast("Entre un code de partie valide (6 caractères)", "danger");
    return;
  }

  const player = createPlayer(name);

  try {
    await joinRoom(roomCode, {
      id: player.id,
      name,
      score: 0,
      eliminated: false,
      ready: true,
      online: true,
    });
    sessionStorage.setItem("roomCode", roomCode);
    sessionStorage.setItem("playerId", player.id);
    window.location.href = `game.html?room=${roomCode}`;
  } catch (err) {
    console.error(err);
    showToast(err.message || "Impossible de rejoindre la partie", "danger");
  }
}

btnCreate.addEventListener("click", handleCreate);
btnJoin.addEventListener("click", handleJoin);

// Prefill inputs from localStorage
const stored = getStoredName();
if (stored) {
  hostNameInput.value = stored;
  joinNameInput.value = stored;
}

// Clicking the join code input will copy its value to clipboard if present
joinCodeInput.addEventListener("click", async () => {
  const code = normalizeRoomCode(joinCodeInput.value || "");
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showCopiedBadge(joinCodeInput);
  } catch (e) {
    // ignore
  }
});
