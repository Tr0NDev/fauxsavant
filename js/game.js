// ============================================================
//  game.js - Logique du jeu, états, règles
// ============================================================

// ── Constantes ───────────────────────────────────────────────
export const MAX_PLAYERS        = 10;
export const POINTS_PER_PLAYER  = 100;   // seuil de base par joueur
export const TURN_TIME_SECONDS  = 90;    // temps pour répondre (1m30)
export const VOTE_TIME_SECONDS  = 60;    // temps pour voter

// Paliers de gains (index = numéro de bonne réponse consécutive)
export const PALIERS = [0, 10, 25, 50, 100, 200, 400, 800, 1500, 3000];

// Missions imposteur : { id, label, condition(gameState, playerId), reward }
export const IMPOSTOR_MISSIONS = [
  {
    id: "double_wrong",
    label: "Répondre faux 2 fois en une manche",
    description: "Augmente le seuil de +50 pts",
    reward: { type: "raise_threshold", amount: 50 },
  },
  {
    id: "lose_15s",
    label: "Perdre 15+ secondes sur une question",
    description: "Augmente le seuil de +30 pts",
    reward: { type: "raise_threshold", amount: 30 },
  },
  {
    id: "survive_vote",
    label: "Survivre à un vote d'élimination",
    description: "Augmente le seuil de +80 pts",
    reward: { type: "raise_threshold", amount: 80 },
  },
  {
    id: "cashout_prevented",
    label: "Empêcher un cash-out (joueur rate après avoir pu cash out)",
    description: "Augmente le seuil de +60 pts",
    reward: { type: "raise_threshold", amount: 60 },
  },
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Génère un code de partie aléatoire (6 caractères)
 */
export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Assigne aléatoirement les rôles : 1 imposteur pour 5 joueurs
 * @param {string[]} playerIds
 * @returns {{ [id]: 'impostor' | 'villager' }}
 */
function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function assignRoles(playerIds) {
  const roles = {};
  const shuffled = shuffle(playerIds);
  const impostorCount = Math.max(1, Math.floor(playerIds.length / 5));

  shuffled.forEach((id, i) => {
    roles[id] = i < impostorCount ? "impostor" : "villager";
  });
  return roles;
}

export function createTurnOrder(playerIds) {
  return shuffle(playerIds);
}

/**
 * Calcule le seuil total à atteindre
 * seuil = POINTS_PER_PLAYER * nombre de joueurs encore en jeu + bonus imposteurs
 */
export function computeThreshold(activePlayers, pointsPerPlayer = POINTS_PER_PLAYER, bonusThreshold = 0) {
  return activePlayers * pointsPerPlayer + bonusThreshold;
}

/**
 * Calcule la valeur du palier actuel
 * @param {number} streak - nombre de bonnes réponses consécutives
 */
export function getPalierValue(streak) {
  const idx = Math.min(streak, PALIERS.length - 1);
  return PALIERS[idx];
}

/**
 * Vérifie les conditions de victoire
 * @returns {'villagers' | 'impostors' | null}
 */
export function checkWinCondition(gameState) {
  const { players, totalScore, bonusThreshold, roles } = gameState;

  const activePlayers   = Object.values(players).filter(p => !p.eliminated);
  const activeVillagers = activePlayers.filter(p => roles[p.id] === "villager");
  const activeImpostors = activePlayers.filter(p => roles[p.id] === "impostor");

  // Plus de villageois → imposteurs gagnent
  if (activeVillagers.length === 0) return "impostors";

  // Plus d'imposteurs
  if (activeImpostors.length === 0) {
    // Moins de 1/4 des joueurs initiaux restants → les villageois doivent finir
    const initialCount = Object.keys(players).length;
    if (activePlayers.length < initialCount / 4) {
      // Ils doivent encore atteindre le score
      const threshold = computeThreshold(activePlayers.length, bonusThreshold);
      if (totalScore >= threshold) return "villagers";
      return null; // partie continue
    }
    // Sinon victoire directe des villageois
    return "villagers";
  }

  // Score atteint → villageois gagnent
  const threshold = computeThreshold(activePlayers.length, gameState.pointsPerPlayer ?? POINTS_PER_PLAYER, bonusThreshold);
  if (totalScore >= threshold) return "villagers";

  return null; // partie en cours
}

/**
 * Résultat du vote d'élimination
 * @param {{ [playerId]: string }} votes - votes[voterId] = targetId ou "none"
 * @param {string[]} activePlayerIds
 * @returns {{ eliminated: string | null, counts: object }}
 */
export function resolveVote(votes, activePlayerIds) {
  const counts = {};
  activePlayerIds.forEach(id => (counts[id] = 0));

  Object.values(votes).forEach(target => {
    if (counts[target] !== undefined) counts[target]++;
    // ignore invalid targets (no 'none' option anymore)
  });

  const total = Object.values(votes).length;
  const majority = Math.floor(total / 2) + 1;

  // Trouver la ou les cibles avec le plus de votes
  let maxVotes = 0;
  let eliminated = null;
  const topCandidates = [];

  Object.entries(counts).forEach(([id, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = id;
      topCandidates.length = 0;
      topCandidates.push(id);
    } else if (count === maxVotes) {
      topCandidates.push(id);
    }
  });

  const tie = topCandidates.length > 1;

  if (maxVotes < majority) eliminated = null;
  if (tie && maxVotes >= majority) eliminated = null;

  return { eliminated, counts, tie, topCandidates };
}

/**
 * Vérifie si une mission imposteur est accomplie
 */
export function checkMission(missionId, playerStats) {
  switch (missionId) {
    case "double_wrong":
      return (playerStats.wrongThisRound || 0) >= 2;
    case "lose_15s":
      return (playerStats.timeUsedThisQuestion || 0) >= 15;
    case "survive_vote":
      return playerStats.survivedVote === true;
    case "cashout_prevented":
      return playerStats.cashoutPrevented === true;
    default:
      return false;
  }
}

// ── État initial de la partie ─────────────────────────────────

export function createInitialGameState(roomCode, hostId) {
  return {
    roomCode,
    hostId,
    phase: "lobby",         // lobby → playing → voting → ended
    players: {},            // { [id]: { id, name, score, eliminated, ready } }
    roles: {},              // { [id]: 'villager' | 'impostor' }
    currentTurn: null,      // id du joueur dont c'est le tour
    turnOrder: [],          // ordre des tours
    currentStreak: 0,       // bonnes réponses consécutives
    totalScore: 0,          // score cumulé des villageois
    currentPot: 0,          // points accumulés dans le tour courant
    pointsPerPlayer: POINTS_PER_PLAYER,
    bonusThreshold: 0,      // bonus ajouté par les missions imposteurs
    currentQuestion: null,  // question en cours
    phaseType: null,        // roleReveal / roundStart / round / recap / voting
    phaseEndAt: null,       // timestamp de fin de phase
    nextPhaseType: null,    // phase suivante après recap or roleReveal
    recapMessage: null,     // message de fin de manche
    votes: {},              // votes en cours
    impostorMissions: {},   // { [playerId]: { completed: [], inProgress: {} } }
    roundStats: {},         // stats de la manche courante
    log: [],                // historique des événements
    createdAt: Date.now(),
  };
}