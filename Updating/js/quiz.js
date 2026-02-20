// ============================================
// quiz.js
// Core quiz engine — existing logic modularized
// ============================================

import { ayatTypingEffect } from './ui.js';
import { showSection } from './app.js';

// ── State ──────────────────────────────────
let quranData = [];
let currentAyat = null;
let selectedAyats = [];
let fromPara = 1, toPara = 30;
let quizIndex = 0;
let score = 0;
let totalQuestions = 10;
let mode = 'practice';
let usedIndexes = [];
let surahCorrectCount = {};
let startTime = 0;
let timer = null;
let timePerQ = [];
let survivalActive = true;
let hintCount = 0;
const MAX_HINTS = 2;

// ── Getters (doosri files ke liye) ─────────
export function getQuranData() { return quranData; }
export function getCurrentAyat() { return currentAyat; }
export function getScore() { return score; }
export function getMode() { return mode; }

// ── Load Quran Data ────────────────────────
export async function loadQuranData() {
  try {
    const res = await fetch('quran_full.json');
    quranData = await res.json();
    console.log(`✅ Quran data loaded: ${quranData.length} ayats`);
  } catch (e) {
    alert('❌ Quran data load error: ' + e.message);
  }
}

// ── Mode Selection ─────────────────────────
export function initModeSelection() {
  const modeForm = document.getElementById('modeForm');
  if (modeForm) {
    modeForm.addEventListener('change', () => {
      mode = document.querySelector('input[name="quizMode"]:checked').value;
    });
  }
}

// ── Start Game ─────────────────────────────
export function startGame() {
  fromPara = parseInt(document.getElementById('fromPara').value);
  toPara = parseInt(document.getElementById('toPara').value);
  const errDiv = document.getElementById('selectError');
  errDiv.classList.add('hidden');

  // Validation
  if (isNaN(fromPara) || isNaN(toPara) || fromPara < 1 || toPara > 30 || fromPara > toPara) {
    errDiv.textContent = "❌ Galat range! Para range 1–30 ke andar aur From ≤ To hona zaroori hai.";
    errDiv.classList.remove('hidden');
    return;
  }
  if (!quranData || quranData.length === 0) {
    errDiv.textContent = "❌ Quran data abhi load nahi hui.";
    errDiv.classList.remove('hidden');
    return;
  }

  // Filter ayats by para range
  selectedAyats = quranData.filter(a => {
    const paraNum = ((a.page - 1) / 20 | 0) + 1;
    return paraNum >= fromPara && paraNum <= toPara;
  });

  if (!selectedAyats.length) {
    errDiv.textContent = "❌ Is range ke andar ayat nahi mile.";
    errDiv.classList.remove('hidden');
    return;
  }

  // Reset state
  quizIndex = 0;
  score = 0;
  usedIndexes = [];
  surahCorrectCount = {};
  timePerQ = [];
  hintCount = 0;
  survivalActive = true;

  // Set total questions by mode
  if (mode === 'timed') totalQuestions = 10;
  else totalQuestions = 9999;

  // UI reset
  document.getElementById('hintBtn').disabled = false;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;
  document.getElementById('survivalAnswer').classList.add('hidden');

  nextQuestion();
  showSection('quizScreen');
  updateScoreBoard();
}

// ── Random Ayat (no repeat) ────────────────
function randomAyatIndex() {
  if (usedIndexes.length >= Math.min(totalQuestions, selectedAyats.length)) return -1;
  let i;
  let attempts = 0;
  do {
    i = Math.floor(Math.random() * selectedAyats.length);
    attempts++;
    if (attempts > 1000) return -1;
  } while (usedIndexes.includes(i));
  usedIndexes.push(i);
  return i;
}

// ── Next Question ──────────────────────────
export function nextQuestion() {
  // Hide previous results
  document.getElementById('quizError').classList.add('hidden');
  document.getElementById('quizResult').classList.add('hidden');
  document.getElementById('survivalAnswer').classList.add('hidden');
  document.getElementById('answerForm').reset();
  document.querySelector('.next-button').classList.add('hidden');

  // Update hint button
  document.getElementById('hintBtn').disabled = hintCount >= MAX_HINTS;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;

  // Check if quiz should end
  if (quizIndex >= totalQuestions || usedIndexes.length >= selectedAyats.length) {
    endQuiz();
    return;
  }

  const i = randomAyatIndex();
  if (i === -1) { endQuiz(); return; }

  currentAyat = selectedAyats[i];
  ayatTypingEffect(currentAyat.text);
  quizIndex++;
  updateScoreBoard();

  // Progress text
  document.getElementById('quizProgress').textContent =
    mode === 'practice'
      ? `🎯 Practice Mode — Sawal: ${quizIndex}`
      : mode === 'survival'
      ? `💥 Survival Mode — Sawal: ${quizIndex}`
      : `⏱️ Sawalat: ${quizIndex} / ${totalQuestions}`;

  startTime = Date.now();

  if (mode === 'timed') {
    startTimer(30);
  } else {
    document.getElementById('timer').textContent = '';
  }
}

// ── Timer ──────────────────────────────────
function startTimer(seconds) {
  let time = seconds;
  document.getElementById('timer').textContent = `⏱️ ${time}s`;
  if (timer) clearInterval(timer);

  timer = setInterval(() => {
    time--;
    document.getElementById('timer').textContent = `⏱️ ${time}s`;

    if (time <= 0) {
      clearInterval(timer);
      document.getElementById('timer').textContent = "⏱️ Time's up!";
      timePerQ.push(seconds);
      showWrong("⏱️ Waqt khatam!");
      document.querySelector('.next-button').classList.remove('hidden');
    }
  }, 1000);
}

// ── Check Answer ───────────────────────────
export function checkAnswer() {
  if (mode === 'timed' && timer) clearInterval(timer);
  const timeSpent = Math.round((Date.now() - startTime) / 1000);

  const user_page = document.getElementById('user_page').value.trim();
  const user_para = document.getElementById('user_para').value.trim();
  const user_page_in_para = document.getElementById('user_page_in_para').value.trim();
  const user_surah = document.getElementById('user_surah').value.trim().toLowerCase();
  const user_ruku = document.getElementById('user_ruku').value.trim();
  const user_ayat = document.getElementById('user_ayat').value.trim();

  const errorDiv = document.getElementById('quizError');
  const resultDiv = document.getElementById('quizResult');
  errorDiv.classList.add('hidden');
  resultDiv.classList.add('hidden');
  document.querySelector('.next-button').classList.add('hidden');
  document.getElementById('survivalAnswer').classList.add('hidden');

  // Minimum required fields check
  if (!user_para) {
    errorDiv.textContent = "❌ Para Number zaroori hai!";
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 2300);
    return false;
  }

  // Calculate correct answers
  const page_num = parseInt(currentAyat.page);
  const actual_para = ((page_num - 1) / 20 | 0) + 1;
  const actual_page_in_para = ((page_num - 1) % 20) + 1;

  let resultParts = [];
  let correctCount = 0;
  let optionalCorrect = 0;

  // ── Zaroori: Para check ──
  const userPara = parseInt(user_para);
  const paraCorrect = userPara === actual_para;
  if (!paraCorrect) {
    resultParts.push(`❌ Para Galat! Sahi: ${actual_para}`);
  } else {
    correctCount++;
  }

  // ── Zaroori: Page in Para check ──
  let pageInParaCorrect = true;
  if (user_page_in_para) {
    const userPIP = parseInt(user_page_in_para);
    pageInParaCorrect = (userPIP + 1 === actual_page_in_para || userPIP === actual_page_in_para - 1);
    if (!pageInParaCorrect) {
      resultParts.push(`❌ Page In Para Galat! Sahi: ${actual_page_in_para - 1}`);
    } else {
      correctCount++;
    }
  }

  // ── Optional: Page Number (+5 coins) ──
  if (user_page) {
    if (parseInt(user_page) === page_num) {
      optionalCorrect++;
    } else {
      resultParts.push(`❌ Page Number Galat! Sahi: ${page_num}`);
    }
  }

  // ── Optional: Surah Name (+5 coins) ──
  if (user_surah) {
    if (currentAyat.surah_name.toLowerCase().includes(user_surah)) {
      optionalCorrect++;
    } else {
      resultParts.push(`❌ Surah Name Galat! Sahi: ${currentAyat.surah_name}`);
    }
  }

  // ── Optional: Ruku No (+5 coins) ──
  if (user_ruku && currentAyat.ruku_no !== undefined) {
    if (parseInt(user_ruku) === currentAyat.ruku_no) {
      optionalCorrect++;
    } else {
      resultParts.push(`❌ Ruku Galat! Sahi: ${currentAyat.ruku_no}`);
    }
  }

  // ── Optional: Ayat No (+5 coins) ──
  if (user_ayat && currentAyat.ayat_no !== undefined) {
    if (parseInt(user_ayat) === currentAyat.ayat_no) {
      optionalCorrect++;
    } else {
      resultParts.push(`❌ Ayat No Galat! Sahi: ${currentAyat.ayat_no}`);
    }
  }

  // ── Final Result ──
  const isCorrect = paraCorrect && (user_page_in_para ? pageInParaCorrect : true);

  if (isCorrect) {
    score++;
    const sname = currentAyat.surah_name;
    surahCorrectCount[sname] = (surahCorrectCount[sname] || 0) + 1;

    // Coins calculate (baad mein coins.js mein jayega)
    const baseCoins = Math.max(10, 15 - Math.floor(timeSpent / 5));
    const optionalCoins = optionalCorrect * 5;
    const totalCoins = baseCoins + optionalCoins;

    let msg = `✅ Sahi! +${baseCoins} coins`;
    if (optionalCoins > 0) msg += ` + ${optionalCoins} (optional) = ${totalCoins} coins`;

    resultDiv.textContent = msg;
    resultDiv.classList.remove('hidden', 'error');
    resultDiv.classList.add('result');
  } else {
    resultDiv.innerHTML = resultParts.join('<br>') || "❌ Galat Jawab!";
    resultDiv.classList.remove('hidden', 'result');
    resultDiv.classList.add('error');

    if (mode === 'survival') {
      survivalActive = false;
      showSurvivalAnswer();
      timePerQ.push(timeSpent);
      updateScoreBoard();
      setTimeout(() => endQuiz(), 2000);
      return false;
    }
  }

  document.querySelector('.next-button').classList.remove('hidden');
  timePerQ.push(timeSpent);
  updateScoreBoard();
  setTimeout(() => resultDiv.classList.add('hidden'), 5000);
  return false;
}

// ── Show Wrong ─────────────────────────────
function showWrong(msg) {
  const resultDiv = document.getElementById('quizResult');
  resultDiv.textContent = msg;
  resultDiv.classList.remove('hidden', 'result');
  resultDiv.classList.add('error');
}

// ── Survival Answer Show ───────────────────
function showSurvivalAnswer() {
  const div = document.getElementById('survivalAnswer');
  const page = parseInt(currentAyat.page);
  const para = ((page - 1) / 20 | 0) + 1;
  const pip = ((page - 1) % 20) + 1;
  div.innerHTML = `
    <b>Sahi Jawab:</b><br>
    Surah: <b>${currentAyat.surah_name}</b><br>
    Para: <b>${para}</b><br>
    Page: <b>${page}</b><br>
    Page in Para: <b>${pip - 1}</b>
  `;
  div.classList.remove('hidden');
}

// ── Hint System ────────────────────────────
export function showHint() {
  if (hintCount >= MAX_HINTS) return;
  hintCount++;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;
  if (hintCount >= MAX_HINTS) document.getElementById('hintBtn').disabled = true;

  const surahWords = currentAyat.surah_name.split(" ");
  const first2 = surahWords.slice(0, 2).join(" ");
  const para = ((parseInt(currentAyat.page) - 1) / 20 | 0) + 1;

  const errDiv = document.getElementById('quizError');
  errDiv.innerHTML = `<b>💡 Hint:</b> Surah: <b>${first2}...</b>, Para: <b>${para}</b>`;
  errDiv.classList.remove('hidden');
  setTimeout(() => errDiv.classList.add('hidden'), 3500);
}

// ── Score Board ────────────────────────────
function updateScoreBoard() {
  const sb = document.getElementById('scoreBoard');
  if (sb) sb.innerHTML = `Score: ${score} / ${quizIndex}`;
}

// ── End Quiz ───────────────────────────────
function endQuiz() {
  if (timer) clearInterval(timer);

  let bestSurahName = '';
  let maxCorrect = 0;
  Object.entries(surahCorrectCount).forEach(([s, c]) => {
    if (c > maxCorrect) { maxCorrect = c; bestSurahName = s; }
  });

  const avgTime = timePerQ.length
    ? Math.round(timePerQ.reduce((a, b) => a + b, 0) / timePerQ.length)
    : 0;

  document.getElementById('finalResult').innerHTML = `
    🧠 Score: <b>${score} / ${quizIndex}</b><br>
    📖 Best Surah: <b>${bestSurahName || '-'}</b><br>
    ⏱️ Average Time: <b>${avgTime} sec</b><br>
    <br>${mode === 'survival' && !survivalActive ? '💥 Survival Khatam!' : '🎉 Mubarak!'}
  `;
  showSection('resultScreen');
}

// ── Restart Game ───────────────────────────
export function restartGame(home = false) {
  quizIndex = 0;
  score = 0;
  usedIndexes = [];
  surahCorrectCount = {};
  timePerQ = [];
  hintCount = 0;
  if (timer) clearInterval(timer);
  document.getElementById('hintBtn').disabled = false;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;
  if (home) showSection('welcomeScreen');
  else showSection('paraSelectScreen');
}

// ── Global Functions (HTML onclick ke liye) ─
export function initQuiz() {
  initModeSelection();
  window.startGame = startGame;
  window.nextQuestion = nextQuestion;
  window.checkAnswer = checkAnswer;
  window.showHint = showHint;
  window.restartGame = restartGame;
}
