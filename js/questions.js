// ============================================================
//  questions.js - Chargement et gestion des questions
// ============================================================

// Liste des thèmes disponibles avec leur fichier JSON
// Ajoute tes thèmes ici en suivant le même format
const THEMES = [
  { name: "Géographie", file: "data/questions/geographie.json" },
  { name: "Histoire",   file: "data/questions/histoire.json" },
  { name: "Science",    file: "data/questions/science.json" },
  // { name: "Sport",   file: "data/questions/sport.json" },
  // { name: "Cinéma",  file: "data/questions/cinema.json" },
];

// Cache pour éviter de re-fetcher les fichiers
const _cache = {};

/**
 * Charge un fichier JSON de questions (avec cache)
 */
async function loadTheme(themeFile) {
  if (_cache[themeFile]) return _cache[themeFile];
  const res = await fetch(themeFile);
  if (!res.ok) throw new Error(`Impossible de charger ${themeFile}`);
  const data = await res.json();
  _cache[themeFile] = data;
  return data;
}

/**
 * Tire une question aléatoire depuis un thème aléatoire.
 * Les thèmes sont weightés par leur nombre de questions.
 * Si un thème est vide ou invalide, il est ignoré.
 * @returns {{ question, answers, difficulty, theme }}
 */
/**
 * Retourne une clé sûre pour une question (utilisée pour l'exclusion)
 */
function questionKey(q) {
  const text = (q && q.question) ? q.question : String(q || '');
  return encodeURIComponent(text).replace(/[.#$\[\]]/g, '_');
}

/**
 * Tire une question aléatoire, en option excluant celles présentes dans `usedMap`.
 * `usedMap` est un objet dont les clés sont des clés de question (voir `questionKey`).
 */
export async function getRandomQuestion(usedMap = {}) {
  const availableThemes = [];

  for (const theme of THEMES) {
    const questions = await loadTheme(theme.file).catch(() => []);
    const validQuestions = Array.isArray(questions) ? questions : [];
    // Filter out questions that are marked used (answered correctly)
    const filtered = validQuestions.filter(q => !usedMap || !usedMap[questionKey(q)]);
    // If filtering removes all questions, fall back to full list for that theme
    const finalList = filtered.length ? filtered : validQuestions;
    if (finalList.length > 0) {
      availableThemes.push({ theme, questions: finalList });
    }
  }

  if (availableThemes.length === 0) {
    throw new Error('Aucun thème de questions disponible.');
  }

  const totalQuestions = availableThemes.reduce((sum, item) => sum + item.questions.length, 0);
  let roll = Math.floor(Math.random() * totalQuestions);
  let selectedTheme = availableThemes[0];

  for (const item of availableThemes) {
    if (roll < item.questions.length) {
      selectedTheme = item;
      break;
    }
    roll -= item.questions.length;
  }

  const chosenQuestion = selectedTheme.questions[Math.floor(Math.random() * selectedTheme.questions.length)];
  return { ...chosenQuestion, theme: selectedTheme.theme.name };
}

/**
 * Génère un QCM à partir d'une question :
 * 1 bonne réponse + 3 mauvaises piochées dans le même thème
 * @param {{ question, answers, difficulty, theme, file }} questionObj
 * @returns {{ choices: string[], correctIndex: number }}
 */
export async function buildQCM(questionObj, themeFile) {
  const file = themeFile || THEMES.find(t => t.name === questionObj.theme)?.file;
  const allQuestions = file ? await loadTheme(file) : [];

  // Bonne réponse = première réponse dans le tableau
  const correctAnswer = questionObj.answers[0];

  // Mauvaises réponses = premières réponses des autres questions du même thème
  const wrongPool = allQuestions
    .filter(q => !q.answers.some(a => questionObj.answers.includes(a)))
    .map(q => q.answers[0])
    .filter(Boolean);

  // Mélanger et prendre 3 mauvaises réponses
  const shuffledWrong = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3);

  // Si pas assez de mauvaises réponses, compléter avec des génériques
  while (shuffledWrong.length < 3) {
    shuffledWrong.push(`Option ${shuffledWrong.length + 2}`);
  }

  // Construire et mélanger les 4 choix
  const choices = [correctAnswer, ...shuffledWrong].sort(() => Math.random() - 0.5);
  const correctIndex = choices.indexOf(correctAnswer);

  return { choices, correctIndex };
}

/**
 * Vérifie si une réponse donnée est correcte
 */
function normalizeAnswer(answer) {
  let normalized = answer
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^(?:la|le|un)\s+/i, '');

  return normalized.replace(/[\s,\.\?!;:]+/g, '');
}

// Basic singularization for common French plural forms to accept both
// singular and plural answers (e.g. "séisme" / "séismes", "château" / "châteaux").
function singularize(word) {
  if (!word || word.length <= 2) return word;
  // aux -> al (chevaux -> cheval)
  if (word.endsWith('aux')) return word.slice(0, -3) + 'al';
  // common plural endings: remove trailing s or x
  if (word.endsWith('s') || word.endsWith('x')) return word.slice(0, -1);
  return word;
}

export function checkAnswer(userAnswer, questionObj) {
  const normalizedInput = normalizeAnswer(userAnswer);
  const inputVariants = new Set([normalizedInput, singularize(normalizedInput)]);

  return questionObj.answers.some((answer) => {
    const aNorm = normalizeAnswer(answer);
    const aVariants = [aNorm, singularize(aNorm)];
    return aVariants.some((v) => inputVariants.has(v));
  });
}

export { THEMES };