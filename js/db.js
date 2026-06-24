// ============================================================
//  db.js - Interface Firebase Realtime Database
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, update, push,
  onValue, onDisconnect, serverTimestamp, remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import FIREBASE_CONFIG from "./firebase-config.js";

// ── Init ──────────────────────────────────────────────────────
const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

// ── Helpers ───────────────────────────────────────────────────
const roomRef    = (code)          => ref(db, `rooms/${code}`);
const playerRef  = (code, id)      => ref(db, `rooms/${code}/players/${id}`);
const phaseRef   = (code)          => ref(db, `rooms/${code}/phase`);
const voteRef    = (code, voterId) => ref(db, `rooms/${code}/votes/${voterId}`);
const questionRef= (code)          => ref(db, `rooms/${code}/currentQuestion`);
const logRef     = (code)          => ref(db, `rooms/${code}/log`);

// ── Salon ─────────────────────────────────────────────────────

/** Crée une nouvelle partie dans Firebase */
export async function createRoom(initialState) {
  await set(roomRef(initialState.roomCode), initialState);
}

/** Rejoint une partie existante */
export async function joinRoom(roomCode, player) {
  const snap = await get(roomRef(roomCode));
  if (!snap.exists()) throw new Error("Partie introuvable");
  const room = snap.val();
  // If the game is already started, add the player as a spectator
  const playerToWrite = { ...player };
  if (room.phase !== "lobby") {
    playerToWrite.eliminated = true; // treated as non-active by game logic
    playerToWrite.spectator = true;
    playerToWrite.ready = false;
  } else {
    const count = Object.keys(room.players || {}).length;
    if (count >= 10) throw new Error("La partie est complète (10 joueurs max)");
  }

  await set(playerRef(roomCode, player.id), playerToWrite);
  return room;
}

/** Écoute les changements de la room en temps réel */
export function subscribeRoom(roomCode, callback) {
  const unsub = onValue(roomRef(roomCode), snap => {
    if (snap.exists()) callback(snap.val());
  });
  return unsub; // appelle unsub() pour se désabonner
}

/** Marque le joueur comme déconnecté si il perd la connexion */
export function setupPresence(roomCode, playerId) {
  const pRef = playerRef(roomCode, playerId);
  onDisconnect(pRef).remove();
}

// ── Jeu ───────────────────────────────────────────────────────

/** Met à jour des champs de la room */
export async function updateRoom(roomCode, updates) {
  await update(roomRef(roomCode), updates);
}

/** Lance la partie : assigne rôles, ordre des tours, phase playing */
export async function startGame(roomCode, roles, turnOrder) {
  await update(roomRef(roomCode), {
    phase: "playing",
    phaseType: "roleReveal",
    nextPhaseType: "roundStart",
    roles,
    turnOrder,
    currentTurn: turnOrder[0],
    currentStreak: 0,
    currentPot: 0,
    totalScore: 0,
    bonusThreshold: 0,
    currentQuestion: null,
    phaseEndAt: Date.now() + 5000,
    startedAt: serverTimestamp(),
  });
}

/** Publie la question en cours */
export async function publishQuestion(roomCode, questionData) {
  await set(questionRef(roomCode), {
    ...questionData,
    publishedAt: serverTimestamp(),
  });
}

/** Enregistre la réponse d'un joueur + met à jour le score */
export async function submitAnswer(roomCode, playerId, result) {
  // result = { correct, streak, scoreGained, totalScore, bonusThreshold, currentPot }
  await update(roomRef(roomCode), {
    [`roundStats/${playerId}`]: result,
    currentStreak: result.streak,
    totalScore: result.totalScore,
    bonusThreshold: result.bonusThreshold,
    ...(result.currentPot !== undefined ? { currentPot: result.currentPot } : {}),
  });
}

/** Cash out : le joueur encaisse son palier */
export async function cashOut(roomCode, playerId, amount) {
  await update(roomRef(roomCode), {
    [`players/${playerId}/score`]: { ".sv": `{".sv": "increment"}` }, // fallback
    totalScore: { ".sv": "increment" },
  });
  // Approche simple : on relit et on additionne côté client avant d'écrire
  // (géré dans ui-game.js)
}

/** Passe au joueur suivant */
export async function nextTurn(roomCode, nextPlayerId) {
  await update(roomRef(roomCode), {
    currentTurn: nextPlayerId,
    currentQuestion: null,
    votes: null,
  });
}

// ── Vote ──────────────────────────────────────────────────────

/** Démarre une phase de vote */
export async function startVote(roomCode) {
  await update(roomRef(roomCode), {
    phase: "voting",
    votes: {},
    voteStartedAt: serverTimestamp(),
  });
}

/** Soumet un vote */
export async function submitVote(roomCode, voterId, targetId) {
  await set(voteRef(roomCode, voterId), targetId);
}

/** Élimine un joueur */
export async function eliminatePlayer(roomCode, playerId) {
  await update(roomRef(roomCode), {
    [`players/${playerId}/eliminated`]: true,
    phase: "playing",
    votes: null,
  });
}

// ── Log ───────────────────────────────────────────────────────

/** Ajoute une entrée dans le log de la partie */
export async function addLog(roomCode, entry) {
  await push(logRef(roomCode), {
    ...entry,
    timestamp: serverTimestamp(),
  });
}

// ── Fin de partie ─────────────────────────────────────────────

export async function endGame(roomCode, winner) {
  await update(roomRef(roomCode), {
    phase: "ended",
    winner,
    endedAt: serverTimestamp(),
  });
}

/** Supprime la room (cleanup) */
export async function deleteRoom(roomCode) {
  await remove(roomRef(roomCode));
}

export { db };