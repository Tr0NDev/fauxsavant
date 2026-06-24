import {
  subscribeRoom,
  startGame,
  publishQuestion,
  updateRoom,
  submitVote,
  endGame,
  deleteRoom,
  setupPresence,
} from "./db.js";
import { getRandomQuestion, checkAnswer } from "./questions.js";
import {
  assignRoles,
  createTurnOrder,
  computeThreshold,
  getPalierValue,
  PALIERS,
  checkWinCondition,
  resolveVote,
} from "./game.js";

const ROLE_REVEAL_DURATION = 5;
const ROUND_START_DURATION = 5;
const ROUND_DURATION = 90;
const RECAP_DURATION = 5;
const VOTE_DURATION = 45;
const VOTE_REVEAL_DURATION = 8;
const VOTE_REVEAL_MIN_DURATION = 3000;
const VOTE_REVEAL_MAX_DURATION = 8000;
const VOTE_REVEAL_STEP_MS = 500;

const roomCodeLabel = document.getElementById("room-code");
const gameRoomCodeLabel = document.getElementById("game-room-code");
const roomStatus = document.getElementById("room-status");
const playersGrid = document.getElementById("players-grid");
const btnStart = document.getElementById("btn-start");
const toastContainer = document.getElementById("toast-container");
const gameLobby = document.getElementById("game-lobby");
const gamePanel = document.getElementById("game-panel");
const phaseBanner = document.getElementById("phase-banner");
const roleOverlay = document.getElementById("role-overlay");
const roleOverlayValue = document.getElementById("role-overlay-value");
const roleOverlayTimer = document.getElementById("role-overlay-timer");
const questionCard = document.getElementById("question-card");
const recapCard = document.getElementById("recap-card");
const voteCard = document.getElementById("vote-card");
const endCard = document.getElementById("end-card");
const hudTotal = document.getElementById("hud-total");
const hudThreshold = document.getElementById("hud-threshold");
const hudTurn = document.getElementById("hud-turn");
const hudPhase = document.getElementById("hud-phase");
const hudPot = document.getElementById("hud-pot");
const hudStreak = document.getElementById("hud-streak");
const hudRole = document.getElementById("hud-role");
const hudTimer = document.getElementById("hud-timer");
const questionTheme = document.getElementById("question-theme");
const questionText = document.getElementById("question-text");
const answerInput = document.getElementById("answer-input");
const btnSubmitAnswer = document.getElementById("btn-submit-answer");
const btnCashout = document.getElementById("btn-cashout");
const currentAnswererEl = document.getElementById("current-answerer");
const previousAnswerEl = document.getElementById("previous-answer");
const voteGrid = document.getElementById("vote-grid");
const voteInstruction = document.getElementById("vote-instruction");
const btnSubmitVote = document.getElementById("btn-submit-vote");
const recapText = document.getElementById("recap-text");
const endIcon = document.getElementById("end-icon");
const endTitle = document.getElementById("end-title");
const endMessage = document.getElementById("end-message");
const preRoundControls = document.getElementById("pre-round-controls");
const btnEarlyCashout = document.getElementById("btn-early-cashout");
const btnDeclineCashout = document.getElementById("btn-decline-cashout");
const btnBackHome = document.getElementById("btn-back-home");
const btnLeaveLobby = document.getElementById("btn-leave-lobby");
const btnReturnLobby = document.getElementById("btn-return-lobby");
const btnConfirmLeave = document.getElementById("btn-confirm-leave");
const btnCancelLeave = document.getElementById("btn-cancel-leave");
const confirmLeaveOverlay = document.getElementById("confirm-leave-overlay");
const btnToggleRoomCode = document.getElementById("btn-toggle-room-code");
const btnToggleRole = document.getElementById("btn-toggle-role");
const pointsPerPlayerInput = document.getElementById("points-per-player-input");
const palierLadder = document.getElementById("palier-ladder");

const currentRoomCode =
  new URLSearchParams(window.location.search).get("room") ||
  sessionStorage.getItem("roomCode");
const currentPlayerId = sessionStorage.getItem("playerId");
let currentRoom = null;
let selectedVoteTarget = null;
let hasSubmittedVote = false;
let voteRevealInterval = null;
let lastActiveUpdateAt = 0;
let lastRoomFlashAt = 0;
let answerDraftTimer = null;
let roomCodeHidden = false;
let roleHidden = false;

function showToast(message, type = "default") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function flashFeedback(type) {
  const feedbackClass = {
    success: "flash-success",
    error: "flash-error",
    cashout: "flash-cashout",
  }[type] || "flash-success";
  document.body.classList.add(feedbackClass);
  window.setTimeout(() => document.body.classList.remove(feedbackClass), 350);
}

function handleRoomFlash(room) {
  const flash = room?.flash;
  if (!flash?.timestamp || flash.timestamp === lastRoomFlashAt) return;
  lastRoomFlashAt = flash.timestamp;
  flashFeedback(flash.type);
}

function showCopiedBadge(el) {
  try {
    const parent = el.parentElement || document.body;
    const badge = document.createElement('div');
    badge.className = 'copied-badge';
    badge.textContent = 'Code copié';
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(badge);
    requestAnimationFrame(() => badge.classList.add('show'));
    setTimeout(() => {
      badge.classList.remove('show');
      setTimeout(() => badge.remove(), 200);
    }, 1400);
  } catch (e) {
    // ignore
  }
}

function updateRoomCodeVisibility() {
  if (!roomCodeLabel || !btnToggleRoomCode) return;
  roomCodeLabel.classList.toggle('hidden-value', roomCodeHidden);
  btnToggleRoomCode.querySelector('.icon').classList.toggle('icon-eye-off', roomCodeHidden);
  btnToggleRoomCode.setAttribute('aria-label', roomCodeHidden ? 'Afficher le code de la partie' : 'Cacher le code de la partie');
}

function updateRoleVisibility() {
  if (!hudRole || !btnToggleRole) return;
  hudRole.classList.toggle('role-hidden', roleHidden);
  btnToggleRole.querySelector('.icon').classList.toggle('icon-eye-off', roleHidden);
  btnToggleRole.setAttribute('aria-label', roleHidden ? 'Afficher le rôle' : 'Cacher le rôle');
  if (roleOverlay) {
    const shouldShow = !roleHidden && currentRoom?.phaseType === "roleReveal";
    roleOverlay.classList.toggle('hidden', !shouldShow);
    roleOverlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  }
}

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(`${encodeURIComponent(name)}=`));
  return cookie ? decodeURIComponent(cookie.split('=')[1]) : null;
}

function saveVisibilityPrefs() {
  setCookie('jeuquizz_roomCodeHidden', roomCodeHidden ? 'true' : 'false');
  setCookie('jeuquizz_roleHidden', roleHidden ? 'true' : 'false');
}

function loadVisibilityPrefs() {
  const savedRoomCodeHidden = getCookie('jeuquizz_roomCodeHidden');
  const savedRoleHidden = getCookie('jeuquizz_roleHidden');
  if (savedRoomCodeHidden !== null) roomCodeHidden = savedRoomCodeHidden === 'true';
  if (savedRoleHidden !== null) roleHidden = savedRoleHidden === 'true';
}

function toggleRoomCodeVisibility() {
  roomCodeHidden = !roomCodeHidden;
  updateRoomCodeVisibility();
  saveVisibilityPrefs();
}

function toggleRoleVisibility() {
  roleHidden = !roleHidden;
  updateRoleVisibility();
  saveVisibilityPrefs();
}

function getActivePlayers(room) {
  return Object.values(room.players || {}).filter((player) => !player.eliminated);
}

function updatePointsPerPlayerInput(room) {
  if (!pointsPerPlayerInput) return;
  pointsPerPlayerInput.value = room.pointsPerPlayer ?? 100;
  pointsPerPlayerInput.disabled = !isHost() || room.phase !== "lobby";
}

function handlePointsPerPlayerChange(event) {
  if (!currentRoom || !isHost() || currentRoom.phase !== "lobby") return;
  const value = Number(event.target.value);
  if (Number.isNaN(value) || value < 10) {
    event.target.value = currentRoom.pointsPerPlayer ?? 100;
    return;
  }
  updateRoom(currentRoom.roomCode, { pointsPerPlayer: value }).catch(() => {});
}

function isHost() {
  return currentRoom?.hostId === currentPlayerId;
}

function isEliminated() {
  return currentRoom?.players?.[currentPlayerId]?.eliminated === true;
}

function isPlayerOnline(player) {
  if (!player) return false;
  if (player.online === true) return true;
  if (player.lastActiveAt && Date.now() - player.lastActiveAt < 5 * 60 * 1000) return true;
  return false;
}

async function markPlayerActive() {
  if (!currentRoomCode || !currentPlayerId) return;
  const now = Date.now();
  if (now - lastActiveUpdateAt < 25000) return;
  lastActiveUpdateAt = now;
  await updateRoom(currentRoomCode, {
    [`players/${currentPlayerId}/online`]: true,
    [`players/${currentPlayerId}/lastActiveAt`]: now,
  });
}

async function leaveRoom() {
  if (!currentRoomCode || !currentPlayerId) return;
  try {
    if (!currentRoom || !currentRoom.players) {
      sessionStorage.removeItem("roomCode");
      sessionStorage.removeItem("playerId");
      return;
    }

    const remainingPlayers = Object.values(currentRoom.players).filter((player) => player.id !== currentPlayerId);
    if (remainingPlayers.length === 0) {
      await deleteRoom(currentRoomCode);
      sessionStorage.removeItem("roomCode");
      sessionStorage.removeItem("playerId");
      return;
    }

    const updates = {
      [`players/${currentPlayerId}`]: null,
    };
    if (currentRoom.hostId === currentPlayerId && remainingPlayers.length > 0) {
      updates.hostId = remainingPlayers[0].id;
    }

    await updateRoom(currentRoomCode, updates);
    sessionStorage.removeItem("roomCode");
    sessionStorage.removeItem("playerId");
  } catch (e) {
    // ignore cleanup failures
  }
}

async function eliminateSelfAndExit() {
  // Make this operation resilient: even if the room was modified or deleted
  // by other clients, ensure the local session is cleared and the user is sent home.
  try {
    if (currentRoom && currentRoom.roomCode && currentPlayerId) {
      const playersMap = currentRoom.players || {};
      const playersCount = Object.keys(playersMap).length;
      // If this is the last player known in the room, delete the room entirely.
      if (playersCount <= 1) {
        await deleteRoom(currentRoom.roomCode).catch(() => {});
      } else {
        const activePlayers = Object.values(playersMap).filter((player) => player.id !== currentPlayerId && !player.eliminated);
        const updates = { [`players/${currentPlayerId}/eliminated`]: true };

        if (currentRoom.hostId === currentPlayerId && activePlayers.length > 0) {
          updates.hostId = activePlayers[0].id;
        }

        if (currentRoom.currentTurn === currentPlayerId) {
          const nextPlayer = getNextActivePlayer(currentRoom, currentPlayerId);
          if (nextPlayer) {
            updates.currentTurn = nextPlayer;
            updates.currentQuestion = null;
          }
        }

        // Try best-effort update; if it fails we'll still cleanup locally.
        await updateRoom(currentRoom.roomCode, updates).catch(() => {});
      }
    }
  } catch (e) {
    // ignore errors from remote updates
  } finally {
    // Always clear local session and redirect to main menu
    try {
      sessionStorage.removeItem("roomCode");
      sessionStorage.removeItem("playerId");
    } catch (e) {
      // ignore
    }
    window.location.href = "index.html";
  }
}

async function cleanupRoomIfEmptyOrAfk(room) {
  if (!room || !room.players) return;
  const players = Object.values(room.players);
  if (players.length === 0) {
    try {
      await deleteRoom(room.roomCode);
    } catch (e) {
      // ignore room delete failures
    }
    return;
  }

  const activePlayers = players.filter(isPlayerOnline);
  if (activePlayers.length > 0) return;

  const lastActiveAt = Math.max(...players.map((player) => player.lastActiveAt || 0));
  const offlineTimeout = 5 * 60 * 1000;
  if (lastActiveAt && Date.now() - lastActiveAt > offlineTimeout) {
    try {
      await deleteRoom(room.roomCode);
    } catch (e) {
      // ignore room delete failures
    }
  }
}

async function resetRoomToLobby(roomCode) {
  if (!roomCode) return;
  const room = currentRoom;
  if (!room) return;

  const updates = {
    phase: "lobby",
    phaseType: null,
    phaseEndAt: null,
    nextPhaseType: null,
    currentTurn: null,
    currentQuestion: null,
    currentPot: 0,
    currentStreak: 0,
    recapMessage: null,
    votes: {},
    roles: {},
    turnOrder: [],
    totalScore: 0,
    bonusThreshold: 0,
    impostorMissions: {},
    roundStats: {},
  };

  Object.values(room.players || {}).forEach((player) => {
    updates[`players/${player.id}/eliminated`] = false;
    updates[`players/${player.id}/score`] = 0;
    updates[`players/${player.id}/ready`] = true;
  });

  await updateRoom(roomCode, updates);
}

function isMyTurn() {
  return currentRoom?.currentTurn === currentPlayerId && !isEliminated();
}

function getRoleLabel(room) {
  if (isEliminated()) return "Éliminé";
  const role = room.roles?.[currentPlayerId];
  return role === "impostor" ? "Imposteur" : "Joueur";
}

function getThreshold(room) {
  return computeThreshold(
    getActivePlayers(room).length,
    room.pointsPerPlayer ?? 100,
    room.bonusThreshold || 0
  );
}

function getNextActivePlayer(room, fromPlayerId) {
  const ids = room.turnOrder || [];
  if (!ids.length) return null;
  const startIndex = Math.max(0, ids.indexOf(fromPlayerId));
  for (let i = 1; i <= ids.length; i += 1) {
    const candidate = ids[(startIndex + i) % ids.length];
    const player = room.players?.[candidate];
    if (player && !player.eliminated) return candidate;
  }
  return null;
}

function getVoteRevealState(room) {
  const activePlayers = getActivePlayers(room);
  const voteData = room.votes || {};
  const finalCounts = activePlayers.reduce((acc, player) => {
    acc[player.id] = 0;
    return acc;
  }, {});
  Object.values(voteData).forEach((target) => {
    if (finalCounts[target] !== undefined) finalCounts[target] += 1;
  });

  if (room.phaseType !== "voteReveal") {
    return {
      counts: finalCounts,
      revealedVotes: Object.values(voteData).length,
      totalVotes: Object.values(voteData).length,
      finalCounts,
    };
  }

  const voterIds = Object.keys(voteData).sort();
  const totalVotes = voterIds.length;
  const revealDuration = Math.min(
    VOTE_REVEAL_MAX_DURATION,
    Math.max(VOTE_REVEAL_MIN_DURATION, totalVotes * VOTE_REVEAL_STEP_MS)
  );
  const revealStartAt = (room.phaseEndAt || Date.now()) - revealDuration;
  const elapsed = Math.max(0, Date.now() - revealStartAt);
  const revealedVotes = Math.min(totalVotes, Math.floor(elapsed / VOTE_REVEAL_STEP_MS));

  const counts = activePlayers.reduce((acc, player) => {
    acc[player.id] = 0;
    return acc;
  }, {});
  voterIds.slice(0, revealedVotes).forEach((voterId) => {
    const target = voteData[voterId];
    if (counts[target] !== undefined) counts[target] += 1;
  });

  return { counts, revealedVotes, totalVotes, finalCounts };
}

function formatTime(timestamp) {
  const remaining = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// Safely escape HTML to avoid injection when inserting user-provided names
function escapeHtml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderPlayers(players = {}) {
  playersGrid.innerHTML = "";
  const playerList = Object.values(players);
  if (playerList.length === 0) {
    playersGrid.innerHTML = "<p>Aucun joueur dans la salle.</p>";
    return;
  }

  playerList.forEach((player) => {
    const card = document.createElement("div");
    const isHostPlayer = player.id === currentRoom?.hostId;
    const eliminatedClass = player.eliminated ? "eliminated" : "";
    const spectatorClass = player.spectator ? " spectator" : "";
    card.className = `player-card ${eliminatedClass}${spectatorClass} ${isHostPlayer ? "is-host" : ""}`;
    const roleBadge = player.id === currentPlayerId ? "Toi" : (player.spectator ? "Spectateur" : "Joueur");
    const eliminatedText = player.eliminated && !player.spectator ? " (éliminé)" : "";
    card.innerHTML = `
      <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="player-name">${player.name}${eliminatedText}${isHostPlayer ? '<span class="host-crown">👑</span>' : ''}</div>
        <div class="player-role-badge">${roleBadge}</div>
      </div>
    `;
    playersGrid.appendChild(card);
  });
}

function renderQuestion(room) {
  const question = room.currentQuestion;
  const showQuestion = room.phaseType === "round" && question;
  questionCard.classList.toggle("hidden", !showQuestion);
  if (!showQuestion) return;

  questionTheme.textContent = question.theme || "Général";
  questionText.textContent = question.question || "...";

  answerInput.disabled = !isMyTurn();
  if (!isMyTurn()) {
    answerInput.value = room.currentAnswerDraft || "";
  }
  btnSubmitAnswer.disabled = !isMyTurn();
  btnCashout.disabled = !isMyTurn() || (((room.currentPot || 0) <= 0) && ((room.currentStreak || 0) <= 0));
  // Hide the cashout button under the answer while a question is shown
  if (showQuestion) {
    btnCashout.classList.add("hidden");
  } else {
    btnCashout.classList.remove("hidden");
  }
  // Hide the send button for observers / players who are not the current answerer
  if (showQuestion && isMyTurn()) {
    btnSubmitAnswer.classList.remove("hidden");
  } else {
    btnSubmitAnswer.classList.add("hidden");
  }

  if (currentAnswererEl) {
    if (showQuestion && !isMyTurn() && room.currentTurn) {
      const rawName = room.players?.[room.currentTurn]?.name || "...";
      const safeName = escapeHtml(rawName);
      // insert bolded, colored name then the text
      currentAnswererEl.innerHTML = `<span class="current-answerer-name">${safeName}</span>doit répondre`;
      currentAnswererEl.classList.remove("hidden");
      if (previousAnswerEl) {
        const previousAnswer = room.previousQuestionAnswer || "";
        if (previousAnswer.trim()) {
          previousAnswerEl.textContent = `Réponse précédente : ${previousAnswer}`;
          previousAnswerEl.classList.remove("hidden");
        } else {
          previousAnswerEl.classList.add("hidden");
        }
      }
    } else {
      currentAnswererEl.classList.add("hidden");
      if (previousAnswerEl) previousAnswerEl.classList.add("hidden");
    }
  }
}

function renderPhaseBanner(room) {
  const now = Date.now();
  const remaining = room.phaseEndAt ? formatTime(room.phaseEndAt) : "00:00";
  hudTimer.textContent = remaining;

  if (room.phaseType === "roleReveal") {
    phaseBanner.classList.add("hidden");
    if (roleOverlay) {
      const roleLabel = room.roles?.[currentPlayerId] === "impostor" ? "Imposteur" : "Joueur";
      roleOverlayValue.textContent = roleLabel;
      if (roleOverlayTimer) {
        roleOverlayTimer.textContent = remaining;
      }
      roleOverlayValue.className = `role-popup-value ${room.roles?.[currentPlayerId] === "impostor" ? "role-impostor" : "role-villager"}`;
      const shouldShow = !roleHidden;
      roleOverlay.classList.toggle('hidden', !shouldShow);
      roleOverlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    }
  } else if (room.phaseType === "roundStart") {
    phaseBanner.classList.remove("hidden");
    phaseBanner.textContent = "Préparez-vous pour le prochain tour...";
  } else if (room.phaseType === "recap") {
    phaseBanner.classList.remove("hidden");
    phaseBanner.textContent = "Récap de la manche";
  } else if (room.phaseType === "voting") {
    phaseBanner.classList.remove("hidden");
    phaseBanner.textContent = "Vote d'élimination";
  } else if (room.phaseType === "voteReveal") {
    phaseBanner.classList.remove("hidden");
    phaseBanner.textContent = "Révélation des votes";
  } else {
    phaseBanner.classList.add("hidden");
  }
}

function renderRecap(room) {
  const showRecap = room.phaseType === "recap";
  recapCard.classList.toggle("hidden", !showRecap);
  if (!showRecap) return;
  recapText.textContent = room.recapMessage || "Récapitulatif de la manche.";
}

function renderVote(room) {
  const showVote = room.phaseType === "voting" || room.phaseType === "voteReveal";
  voteCard.classList.toggle("hidden", !showVote);
  if (!showVote) return;

  const eliminated = currentRoom?.players?.[currentPlayerId]?.eliminated === true;
  const activePlayers = getActivePlayers(room);
  const voteData = room.votes || {};
  selectedVoteTarget = voteData[currentPlayerId] || selectedVoteTarget || null;
  hasSubmittedVote = Boolean(voteData[currentPlayerId]);

  const isReveal = room.phaseType === "voteReveal";
  const revealState = getVoteRevealState(room);
  const voteCounts = revealState.counts;
  const maxCount = Math.max(...Object.values(voteCounts), 1);

  voteGrid.innerHTML = "";
  activePlayers.forEach((player) => {
    const count = voteCounts[player.id] || 0;
    const barWidth = Math.round((count / maxCount) * 100);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `vote-card ${selectedVoteTarget === player.id ? "selected" : ""} ${isReveal ? "revealed" : ""}`;
    card.innerHTML = `
      <div class="vote-avatar">${player.name.charAt(0).toUpperCase()}</div>
      <div class="vote-name">${player.name}</div>
      <div class="vote-bar"><div class="vote-bar-fill" style="width: ${barWidth}%;"></div></div>
      <div class="vote-count">${isReveal ? `${count} vote${count > 1 ? "s" : ""}` : "Vote caché"}</div>
    `;
    if (hasSubmittedVote || isReveal || eliminated) {
      card.disabled = true;
      card.classList.add("disabled");
    }
    card.addEventListener("click", () => {
      if (hasSubmittedVote || room.phaseType !== "voting" || eliminated) return;
      selectedVoteTarget = player.id;
      renderVote(room);
    });
    voteGrid.appendChild(card);
  });

  const votedCount = Object.keys(voteData).length;
  voteInstruction.textContent = isReveal
    ? `Révélation des votes : ${revealState.revealedVotes}/${revealState.totalVotes} votes affichés.`
    : hasSubmittedVote
      ? `Vote envoyé (${votedCount}/${activePlayers.length}). Attends la fin du vote.`
      : `Choisis un joueur (${votedCount}/${activePlayers.length} votes enregistrés).`;

  btnSubmitVote.classList.toggle("hidden", room.phaseType !== "voting" || eliminated);
  btnSubmitVote.disabled = eliminated || hasSubmittedVote || selectedVoteTarget === null;
  btnSubmitVote.textContent = hasSubmittedVote ? "Vote envoyé" : "Valider le vote";
}

function renderEnd(room) {
  endCard.classList.toggle("hidden", room.phase !== "ended");
  if (room.phase !== "ended") return;

  const winner = room.winner || "draw";
  const villagers = winner === "villagers";
  endIcon.textContent = villagers ? "🎉" : "💀";
  endTitle.textContent = villagers ? "Villageois victorieux" : "Imposteurs victorieux";
  endTitle.className = `end-title ${villagers ? "villagers" : "impostors"}`;
  endMessage.textContent = villagers
    ? "Les villageois ont atteint l'objectif ou éliminé tous les imposteurs."
    : "Les imposteurs ont remporté la partie.";
}

function renderGame(room) {
  const inLobby = room.phase === "lobby";
  gameLobby.classList.toggle("hidden", !inLobby);
  gamePanel.classList.toggle("hidden", inLobby);
  if (btnReturnLobby) {
    btnReturnLobby.classList.toggle("hidden", inLobby);
  }

  if (inLobby) {
    const activePlayerCount = Object.values(room.players || {}).filter((player) => !player.eliminated).length;
    btnStart.disabled = room.phase !== "lobby" || !isHost() || activePlayerCount < 3;
    btnStart.classList.toggle("hidden", !isHost() || room.phase !== "lobby");
    renderPlayers(room.players);
    updatePointsPerPlayerInput(room);
    return;
  }

  renderPlayers(room.players);
  hudTotal.textContent = room.totalScore || 0;
  hudThreshold.textContent = `Objectif : ${getThreshold(room)}`;
  hudPot.textContent = room.currentPot || 0;
  hudStreak.textContent = `Palier : ${getPalierValue(room.currentStreak || 0)}`;
  hudRole.textContent = getRoleLabel(room);
  hudRole.className = `role-value ${isEliminated() ? "role-eliminated" : room.roles?.[currentPlayerId] === "impostor" ? "role-impostor" : "role-villager"}`;
  updateRoleVisibility();
  const inRound = room.phaseType === "round";
  const myTurn = isMyTurn();
  const streak = room.currentStreak || 0;
  // Only consider the palier for showing the pre-question choice. If palier==0, don't ask even if there is a pot.
  const hasPalier = streak > 0;
  const waitingForQuestion = inRound && !room.currentQuestion && myTurn && hasPalier;

  questionCard.classList.toggle("hidden", !inRound || !room.currentQuestion);
  if (preRoundControls) preRoundControls.classList.toggle("hidden", !waitingForQuestion);

  // If it's your turn, there's no current question, and your palier is 0,
  // immediately publish a question for you (no pre-question prompt), even if the pot > 0.
  if (inRound && !room.currentQuestion && myTurn && !hasPalier) {
    // publishNewQuestion will set currentQuestion in the DB and prevent repeated calls
    publishNewQuestion(room, currentPlayerId).catch((e) => console.error(e));
  }

  renderPhaseBanner(room);
  renderQuestion(room);
  renderRecap(room);
  renderVote(room);
  renderPalier(room);
  renderEnd(room);
}

function renderPalier(room) {
  if (!palierLadder) return;
  const streak = room.currentStreak || 0;
  const activeIndex = Math.min(streak, PALIERS.length - 1);
  palierLadder.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'palier-step-list';

  // Render from highest to lowest (visual ladder)
  for (let i = PALIERS.length - 1; i >= 0; i -= 1) {
    const step = document.createElement('div');
    step.className = 'palier-step small';
    if (i === activeIndex) step.classList.add('active');
    if (isMyTurn() && room.currentTurn === currentPlayerId) step.classList.add('current-turn');
    const val = document.createElement('div');
    val.className = 'value';
    val.textContent = PALIERS[i] + ' pts';
    step.appendChild(val);
    list.appendChild(step);
  }

  palierLadder.appendChild(list);
}

async function handleEarlyCashout() {
  if (!currentRoom || currentRoom.phaseType !== "round" || !isMyTurn() || currentRoom.currentQuestion) return;
  const streak = currentRoom.currentStreak || 0;
  // Amount to add is based on the player's streak (palier) or current personal pot
  const personalPot = currentRoom.personalPot || 0;
  const amount = personalPot > 0 ? personalPot : getPalierValue(streak);
  if (amount <= 0) {
    showToast("Aucun pot ni palier à encaisser.", "warning");
    return;
  }

  const newManchePot = (currentRoom.currentPot || 0) + amount;
  // keep the turn on the current player and give them a question immediately
  await updateRoom(currentRoom.roomCode, {
    currentPot: newManchePot,
    currentStreak: 0,
    // clear any per-player personal pot if used
    personalPot: 0,
    currentQuestion: null,
    currentTurn: currentPlayerId,
    flash: { type: "cashout", timestamp: Date.now() },
  });
  flashFeedback("cashout");
  // Immediately publish a question for the same player
  publishNewQuestion(currentRoom, currentPlayerId).catch((e) => console.error(e));
}

function handleDeclineCashout() {
  // Player declined early cashout: immediately publish a question for this player
  if (!currentRoom || currentRoom.phaseType !== "round" || !isMyTurn()) return;
  publishNewQuestion(currentRoom, currentPlayerId).catch((e) => console.error(e));
}

async function startPhase(roomCode, phaseType, duration, updates = {}) {
  await updateRoom(roomCode, {
    phaseType,
    phaseEndAt: Date.now() + duration * 1000,
    nextPhaseType: updates.nextPhaseType || null,
    ...updates,
  });
}

async function publishNewQuestion(room, nextPlayerId) {
  const question = await getRandomQuestion();
  // Write the question and set the turn to the next player
  await updateRoom(currentRoomCode, {
    currentTurn: nextPlayerId,
    currentQuestion: {
      question: question.question,
      theme: question.theme,
      difficulty: question.difficulty,
      answers: question.answers,
      publishedAt: Date.now(),
    },
    currentAnswerDraft: null,
    // Do NOT touch phaseEndAt here: the round's 90s timer is started once at manche start
  });
}

async function transitionPhase(room) {
  if (!room || room.phase !== "playing" || !isHost()) return;
  if (!room.phaseEndAt || room.phaseEndAt > Date.now()) return;

  if (room.phaseType === "roleReveal") {
    const firstPlayer = (room.turnOrder && room.turnOrder.find(id => room.players?.[id] && !room.players[id].eliminated)) || (room.turnOrder && room.turnOrder[0]) || room.currentTurn || null;
    if (firstPlayer) {
      await startPhase(room.roomCode, "round", ROUND_DURATION, {
        nextPhaseType: "recap",
        currentTurn: firstPlayer,
        currentQuestion: null,
        currentPot: 0,
        currentStreak: 0,
      });
    }
    return;
  }

  if (room.phaseType === "round") {
    const pot = room.currentPot || 0;
    const totalScore = (room.totalScore || 0) + pot;
    await updateRoom(room.roomCode, {
      currentQuestion: null,
      currentPot: 0,
      currentStreak: 0,
      totalScore,
    });
    await startPhase(room.roomCode, "recap", RECAP_DURATION, {
      nextPhaseType: "voting",
      recapMessage: pot > 0 ? `La manche est terminée. ${pot} pts ajoutés au total.` : "La manche est terminée. Aucun pot à ajouter.",
    });
    return;
  }

  if (room.phaseType === "recap") {
    const shouldStartRound = room.nextPhaseType === "roundStart" || /égalité|Aucune élimination|aucune élimination/i.test(room.recapMessage || "");
    if (shouldStartRound) {
      await startPhase(room.roomCode, "roundStart", ROUND_START_DURATION, {
        nextPhaseType: "round",
      });
    } else {
      await startPhase(room.roomCode, "voting", VOTE_DURATION, {
        nextPhaseType: "roundStart",
        votes: {},
      });
    }
    return;
  }

  if (room.phaseType === "roundStart") {
    await startPhase(room.roomCode, "round", ROUND_DURATION, {
      nextPhaseType: "recap",
    });
    return;
  }

  if (room.phaseType === "voteReveal") {
    await finalizeVote(room);
    return;
  }

  if (room.phaseType === "voting") {
    await beginVoteReveal(room);
  }
}

async function finalizeVote(room) {
  if (!room || (room.phaseType !== "voting" && room.phaseType !== "voteReveal")) return;

  const activePlayers = getActivePlayers(room);
  const voterIds = activePlayers.map((p) => p.id);
  const existingVotes = room.votes || {};

  // Fill missing votes randomly (host chooses random targets for non-voters)
  const mergedVotes = { ...existingVotes };
  const randomTargetFor = (voterId) => {
    const possible = voterIds.filter(id => id !== voterId);
    if (possible.length === 0) return voterId;
    return possible[Math.floor(Math.random() * possible.length)];
  };
  voterIds.forEach((voterId) => {
    if (mergedVotes[voterId] === undefined) {
      mergedVotes[voterId] = randomTargetFor(voterId);
    }
  });

  // persist merged votes so clients see final votes
  await updateRoom(room.roomCode, { votes: mergedVotes });

  const voteResult = resolveVote(mergedVotes, voterIds);
  const nextTurn = getNextActivePlayer(room, room.currentTurn);

  const updates = {
    phaseType: "recap",
    phaseEndAt: Date.now() + RECAP_DURATION * 1000,
    nextPhaseType: "roundStart",
    currentQuestion: null,
    votes: {},
    recapMessage: voteResult.eliminated
      ? `${room.players[voteResult.eliminated].name} a été éliminé.`
      : voteResult.tie
        ? "Égalité des votes : aucune élimination. On repart sur une série de questions."
        : "Aucune élimination.",
  };

  if (voteResult.eliminated) {
    updates[`players/${voteResult.eliminated}/eliminated`] = true;
    const totalActivePlayers = activePlayers.length;
    if (totalActivePlayers > 1) {
      const newTotalScore = Math.round((room.totalScore || 0) * (totalActivePlayers - 1) / totalActivePlayers);
      updates.totalScore = newTotalScore;
    } else {
      updates.totalScore = 0;
    }
  }

  if (nextTurn) {
    updates.currentTurn = nextTurn;
  }

  await updateRoom(room.roomCode, updates);
}

async function handleStart() {
  if (!currentRoom || !isHost()) return;

  try {
    const playerIds = Object.keys(currentRoom.players || {});
    if (playerIds.length < 2) {
      showToast("Il faut au moins 2 joueurs pour démarrer.", "error");
      return;
    }

    const roles = assignRoles(playerIds);
    const turnOrder = createTurnOrder(playerIds);
    await startGame(currentRoom.roomCode, roles, turnOrder);
    showToast("Partie démarrée !", "success");
  } catch (error) {
    console.error(error);
    showToast("Impossible de démarrer la partie.", "error");
  }
}

async function handleSubmitAnswer() {
  if (!currentRoom || currentRoom.phase !== "playing" || currentRoom.phaseType !== "round") return;
  if (!isMyTurn()) return;

  const answer = answerInput.value.trim();
  if (!answer) {
    showToast("Écris ta réponse.", "warning");
    return;
  }

  const question = currentRoom.currentQuestion;
  if (!question) return;

  const correct = checkAnswer(answer, question);
  let streak = currentRoom.currentStreak || 0;
  const baseMessage = correct ? "Bonne réponse !" : "Mauvaise réponse.";
  const previousQuestionAnswer = question.answers?.[0] || "";

  if (correct) {
    streak += 1;
    await updateRoom(currentRoom.roomCode, {
      currentStreak: streak,
      currentAnswerDraft: null,
      previousQuestionAnswer,
      flash: { type: "success", timestamp: Date.now() },
    });
    flashFeedback(true);
  } else {
    streak = 0;
    await updateRoom(currentRoom.roomCode, {
      currentStreak: 0,
      currentAnswerDraft: null,
      previousQuestionAnswer,
      flash: { type: "error", timestamp: Date.now() },
    });
    flashFeedback(false);
  }

  answerInput.value = "";

  // Continue the round: pass to the next active player and publish a new question
  const nextPlayer = getNextActivePlayer(currentRoom, currentRoom.currentTurn);
  if (nextPlayer) {
    // Move to next player and clear the current question so they immediately see the pre-question controls
    await updateRoom(currentRoom.roomCode, {
      currentTurn: nextPlayer,
      currentQuestion: null,
      currentAnswerDraft: null,
    });
  }
}

async function handleCashout() {
  if (!currentRoom || currentRoom.phase !== "playing" || currentRoom.phaseType !== "round") return;
  if (!isMyTurn()) return;

  const currentPot = currentRoom.currentPot || 0;
  const streak = currentRoom.currentStreak || 0;
  const palierValue = getPalierValue(streak);
  const amount = currentPot > 0 ? currentPot : palierValue;
  if (amount <= 0) {
    showToast("Aucun pot ni palier à encaisser.", "warning");
    return;
  }
  // Add the amount to the manche's cagnotte, reset palier, keep the turn on the current player and publish question for the same player
  const newManchePot = (currentRoom.currentPot || 0) + amount;
  await updateRoom(currentRoom.roomCode, {
    currentPot: newManchePot,
    currentStreak: 0,
    currentQuestion: null,
    currentTurn: currentPlayerId,
    flash: { type: "cashout", timestamp: Date.now() },
  });
  flashFeedback("cashout");
  // Immediately publish a question for the same player
  publishNewQuestion(currentRoom, currentPlayerId).catch((e) => console.error(e));
}

async function handleSubmitVote() {
  if (!currentRoom || currentRoom.phase !== "playing" || currentRoom.phaseType !== "voting") return;
  if (isEliminated()) return;
  if (selectedVoteTarget === null) return;

  const voteData = currentRoom.votes || {};
  if (!voteData[currentPlayerId]) {
    await submitVote(currentRoom.roomCode, currentPlayerId, selectedVoteTarget);
    showToast("Vote enregistré.", "success");
    return;
  }
}

async function beginVoteReveal(room) {
  if (!room || room.phaseType !== "voting") return;

  const activePlayers = getActivePlayers(room);
  const voterIds = activePlayers.map((p) => p.id);
  const existingVotes = room.votes || {};
  const mergedVotes = { ...existingVotes };

  const randomTargetFor = (voterId) => {
    const possible = activePlayers.map((p) => p.id).filter((id) => id !== voterId);
    if (!possible.length) return voterId;
    return possible[Math.floor(Math.random() * possible.length)];
  };

  voterIds.forEach((voterId) => {
    if (mergedVotes[voterId] === undefined) {
      mergedVotes[voterId] = randomTargetFor(voterId);
    }
  });

  await updateRoom(room.roomCode, {
    phaseType: "voteReveal",
    phaseEndAt: Date.now() + VOTE_REVEAL_DURATION * 1000,
    nextPhaseType: "recap",
    votes: mergedVotes,
  });
}

async function maybeFinishVoteEarly(room) {
  if (!room || room.phase !== "playing" || room.phaseType !== "voting" || !isHost()) return;
  const activePlayers = getActivePlayers(room);
  const voteCount = Object.keys(room.votes || {}).length;
  if (voteCount >= activePlayers.length) {
    await beginVoteReveal(room);
  }
}

async function maybeEndGame(room) {
  if (!room || room.phase !== "playing") return;
  const winner = checkWinCondition(room);
  if (!winner) return;
  await endGame(room.roomCode, winner);
}

function renderRoomStatus(room) {
  roomStatus.textContent = `Statut : ${room.phase || "lobby"}`;
}

function updateRoomView(room) {
  currentRoom = room;
  handleRoomFlash(room);
  renderRoomStatus(room);
  roomCodeLabel.textContent = room.roomCode || currentRoomCode || "—";
  if (gameRoomCodeLabel) {
    gameRoomCodeLabel.textContent = room.roomCode || currentRoomCode || "—";
  }
  renderGame(room);
}

// Copy room code when clicking the room code display (lobby)
if (roomCodeLabel) {
  roomCodeLabel.addEventListener('click', async () => {
    const code = (roomCodeLabel.textContent || '').trim();
    if (!code || code === '---') return;
    try {
      await navigator.clipboard.writeText(code);
      showCopiedBadge(roomCodeLabel);
    } catch (e) {
      // ignore
    }
  });
}

function setupInterval() {
  setInterval(async () => {
    if (!currentRoom) return;
    await markPlayerActive();
    await cleanupRoomIfEmptyOrAfk(currentRoom);
    if (currentRoom.phase === "playing") {
      await transitionPhase(currentRoom);
      await maybeFinishVoteEarly(currentRoom);
      await maybeEndGame(currentRoom);
      renderPhaseBanner(currentRoom);
      if (currentRoom.phaseType === "voting" || currentRoom.phaseType === "voteReveal") {
        renderVote(currentRoom);
      }
    }
  }, 500);
}

async function handleAnswerDraftInput(event) {
  if (!currentRoom || currentRoom.phaseType !== "round" || !isMyTurn()) return;
  const draft = event.target.value || "";
  if (answerDraftTimer) clearTimeout(answerDraftTimer);
  answerDraftTimer = setTimeout(async () => {
    answerDraftTimer = null;
    if (!currentRoom || currentRoom.phaseType !== "round" || !isMyTurn()) return;
    await updateRoom(currentRoom.roomCode, { currentAnswerDraft: draft });
  }, 150);
}

function init() {
  if (!currentRoomCode) {
    roomStatus.textContent = "Aucun code de salle trouvé.";
    showToast("Reviens depuis l'accueil pour rejoindre ou créer une partie.", "warning");
    btnStart.disabled = true;
    return;
  }

  loadVisibilityPrefs();
  roomCodeLabel.textContent = currentRoomCode;
  updateRoomCodeVisibility();
  updateRoleVisibility();
  roomStatus.textContent = "Connexion à la salle...";
  btnStart.addEventListener("click", handleStart);
  if (pointsPerPlayerInput) pointsPerPlayerInput.addEventListener("change", handlePointsPerPlayerChange);
  btnSubmitAnswer.addEventListener("click", handleSubmitAnswer);
  btnCashout.addEventListener("click", handleCashout);
  answerInput.addEventListener("input", handleAnswerDraftInput);
  if (btnEarlyCashout) btnEarlyCashout.addEventListener("click", handleEarlyCashout);
  if (btnDeclineCashout) btnDeclineCashout.addEventListener("click", handleDeclineCashout);
  btnSubmitVote.addEventListener("click", handleSubmitVote);
  if (btnToggleRoomCode) btnToggleRoomCode.addEventListener("click", toggleRoomCodeVisibility);
  if (btnToggleRole) btnToggleRole.addEventListener("click", toggleRoleVisibility);
  btnBackHome.addEventListener("click", async () => {
    if (!currentRoom || !currentRoom.roomCode) {
      window.location.href = "index.html";
      return;
    }
    await resetRoomToLobby(currentRoom.roomCode);
  });
  if (btnLeaveLobby) {
    btnLeaveLobby.addEventListener("click", async () => {
      await leaveRoom();
      window.location.href = "index.html";
    });
  }
  if (btnReturnLobby) {
    btnReturnLobby.addEventListener("click", () => {
      if (!confirmLeaveOverlay) return;
      confirmLeaveOverlay.classList.remove("hidden");
      confirmLeaveOverlay.setAttribute("aria-hidden", "false");
    });
  }
  if (btnCancelLeave) {
    btnCancelLeave.addEventListener("click", () => {
      if (!confirmLeaveOverlay) return;
      confirmLeaveOverlay.classList.add("hidden");
      confirmLeaveOverlay.setAttribute("aria-hidden", "true");
    });
  }
  if (btnConfirmLeave) {
    btnConfirmLeave.addEventListener("click", async (e) => {
      if (!confirmLeaveOverlay) return;
      // Prevent double clicks
      btnConfirmLeave.disabled = true;
      confirmLeaveOverlay.classList.add("hidden");
      confirmLeaveOverlay.setAttribute("aria-hidden", "true");
      try {
        await eliminateSelfAndExit();
      } catch (err) {
        // ensure we still cleanup and redirect on unexpected errors
        try {
          sessionStorage.removeItem("roomCode");
          sessionStorage.removeItem("playerId");
        } catch (e) {}
        window.location.href = "index.html";
      } finally {
        btnConfirmLeave.disabled = false;
      }
    });
  }

  subscribeRoom(currentRoomCode, async (room) => {
    updateRoomView(room);
    await cleanupRoomIfEmptyOrAfk(room);
    await maybeEndGame(room);
    await maybeFinishVoteEarly(room);
  });

  window.addEventListener("beforeunload", leaveRoom);
  setupPresence(currentRoomCode, currentPlayerId);
  setupInterval();
}

init();
