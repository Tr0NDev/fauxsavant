// ============================================================
//  questions.js - Chargement et gestion des questions
// ============================================================

const SUPABASE_URL = "https://oyfvucukbyejgykaqttr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ioeHAVKx_JHu6SSsbYUkYA_q9EJc0oH";

const THEMES = [
  { name: "Géographie", key: "geographie" },
  { name: "Histoire", key: "histoire" },
  { name: "Science", key: "science" },
  { name: "Art", key: "art" },
  { name: "Cinema", key: "cinema" },
  { name: "Jeux Vidéo", key: "jeuxvideo" },
  { name: "Sport", key: "sport" },
  { name: "Musique", key: "musique" },
];

const _cache = new Map();

function getSupabaseConfig() {
  return { url: SUPABASE_URL.replace(/\/+$/, ""), anonKey: SUPABASE_ANON_KEY };
}

/**
 * Charge un thème depuis Supabase (avec cache).
 */
async function loadTheme(themeKey) {
  if (_cache.has(themeKey)) return _cache.get(themeKey);

  const { url, anonKey } = getSupabaseConfig();
  const query = new URLSearchParams({
    select: "question,answers,difficulty",
    theme: `eq.${themeKey}`,
    order: "id.asc",
  });
  const headers = { apikey: anonKey };
  if (anonKey.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${anonKey}`;
  }

  const response = await fetch(`${url}/rest/v1/questions?${query}`, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Impossible de charger le thème "${themeKey}" depuis Supabase (${response.status})${detail ? ` : ${detail}` : ""}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`La réponse Supabase pour "${themeKey}" n'est pas une liste de questions.`);
  }
  _cache.set(themeKey, data);
  return data;
}

function questionKey(q) {
  const text = (q && q.question) ? q.question : String(q || "");
  return encodeURIComponent(text).replace(/[.#$\[\]]/g, "_");
}

/**
 * Tire une question aléatoire, pondérée par le nombre de questions de chaque thème.
 * @returns {{ question, answers, difficulty, theme }}
 */
export async function getRandomQuestion(usedMap = {}) {
  const loadedThemes = await Promise.all(THEMES.map(async (theme) => ({
    theme,
    questions: await loadTheme(theme.key),
  })));

  const availableThemes = loadedThemes
    .map(({ theme, questions }) => {
      const filtered = questions.filter(q => !usedMap || !usedMap[questionKey(q)]);
      return { theme, questions: filtered.length ? filtered : questions };
    })
    .filter(({ questions }) => questions.length > 0);

  if (availableThemes.length === 0) {
    throw new Error("Aucune question disponible dans Supabase. Vérifie que les thèmes ont été importés.");
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
 * Génère un QCM à partir d'une question : une bonne réponse et trois mauvaises.
 * @returns {{ choices: string[], correctIndex: number }}
 */
export async function buildQCM(questionObj) {
  const themeKey = THEMES.find(theme => theme.name === questionObj.theme)?.key;
  const allQuestions = themeKey ? await loadTheme(themeKey) : [];
  const correctAnswer = questionObj.answers[0];
  const wrongPool = allQuestions
    .filter(q => !q.answers.some(answer => questionObj.answers.includes(answer)))
    .map(q => q.answers[0])
    .filter(Boolean);
  const shuffledWrong = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3);

  while (shuffledWrong.length < 3) {
    shuffledWrong.push(`Option ${shuffledWrong.length + 2}`);
  }

  const choices = [correctAnswer, ...shuffledWrong].sort(() => Math.random() - 0.5);
  return { choices, correctIndex: choices.indexOf(correctAnswer) };
}

function normalizeAnswer(answer) {
  return answer
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/^(?:la|le|un)\s+/i, "")
    .replace(/[\s,\.\?!;:]+/g, "");
}

function singularize(word) {
  if (!word || word.length <= 2) return word;
  if (word.endsWith("aux")) return word.slice(0, -3) + "al";
  if (word.endsWith("s") || word.endsWith("x")) return word.slice(0, -1);
  return word;
}

export function checkAnswer(userAnswer, questionObj) {
  const normalizedInput = normalizeAnswer(userAnswer);
  const inputVariants = new Set([normalizedInput, singularize(normalizedInput)]);

  return questionObj.answers.some((answer) => {
    const normalizedAnswer = normalizeAnswer(answer);
    return [normalizedAnswer, singularize(normalizedAnswer)].some(value => inputVariants.has(value));
  });
}

export { THEMES };
