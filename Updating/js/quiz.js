// ============================================
// quiz.js — Core Quiz Engine
// ============================================

import { ayatTypingEffect } from './ui.js';
import { showSection } from './app.js';

let quranData = [];
let currentAyat = null;
let selectedAyats = [];
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

export function getQuranData()    { return quranData; }
export function getCurrentAyat() { return currentAyat; }
export function getScore()        { return score; }
export function getMode()         { return mode; }

export async function loadQuranData() {
  try {
    const res = await fetch('quran_full.json');
    quranData = await res.json();
    console.log(`✅ Quran loaded: ${quranData.length} ayats`);
  } catch (e) {
    alert('❌ Quran data load error: ' + e.message);
  }
}

function initModeSelection() {
  const modeForm = document.getElementById('modeForm');
  if (modeForm) {
    modeForm.addEventListener('change', () => {
      mode = document.querySelector('input[name="quizMode"]:checked').value;
    });
  }
}

export function startGame() {
  const fromPara = parseInt(document.getElementById('fromPara').value);
  const toPara   = parseInt(document.getElementById('toPara').value);
  const errDiv   = document.getElementById('selectError');
  errDiv.classList.add('hidden');

  if (isNaN(fromPara) || isNaN(toPara) || fromPara < 1 || toPara > 30 || fromPara > toPara) {
    errDiv.textContent = '❌ Galat range! Para 1–30 ke andar, From ≤ To.';
    errDiv.classList.remove('hidden');
    return;
  }
  if (!quranData.length) {
    errDiv.textContent = '❌ Quran data load nahi hua abhi.';
    errDiv.classList.remove('hidden');
    return;
  }

  selectedAyats = quranData.filter(a => {
    const p = ((a.page - 1) / 20 | 0) + 1;
    return p >= fromPara && p <= toPara;
  });

  if (!selectedAyats.length) {
    errDiv.textContent = '❌ Is range mein ayat nahi mile.';
    errDiv.classList.remove('hidden');
    return;
  }

  quizIndex = 0; score = 0; usedIndexes = [];
  surahCorrectCount = {}; timePerQ = [];
  hintCount = 0; survivalActive = true;
  if (mode === 'timed') totalQuestions = 10;
  else totalQuestions = 9999;

  document.getElementById('hintBtn').disabled = false;
  document.getElementById('hintInfo').textContent = `Hint: 0/${MAX_HINTS}`;
  document.getElementById('survivalAnswer').classList.add('hidden');

  nextQuestion();
  showSection('quizScreen');
  updateScoreBoard();
}

function randomAyatIndex() {
  if (usedIndexes.length >= Math.min(totalQuestions, selectedAyats.length)) return -1;
  let i, tries = 0;
  do { i = Math.floor(Math.random() * selectedAyats.length); tries++; }
  while (usedIndexes.includes(i) && tries < 1000);
  usedIndexes.push(i);
  return i;
}

export function nextQuestion() {
  document.getElementById('quizError').classList.add('hidden');
  document.getElementById('quizResult').classList.add('hidden');
  document.getElementById('survivalAnswer').classList.add('hidden');
  document.getElementById('answerForm').reset();
  document.querySelector('.next-button').classList.add('hidden');
  document.getElementById('hintBtn').disabled = hintCount >= MAX_HINTS;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;

  if (quizIndex >= totalQuestions || usedIndexes.length >= selectedAyats.length) {
    endQuiz(); return;
  }
  const i = randomAyatIndex();
  if (i === -1) { endQuiz(); return; }

  currentAyat = selectedAyats[i];
  ayatTypingEffect(currentAyat.text);
  quizIndex++;
  updateScoreBoard();

  document.getElementById('quizProgress').textContent =
    mode === 'practice' ? `🎯 Practice — Sawal: ${quizIndex}` :
    mode === 'survival' ? `💥 Survival — Sawal: ${quizIndex}` :
    `⏱️ Sawal: ${quizIndex} / ${totalQuestions}`;

  startTime = Date.now();
  if (mode === 'timed') startTimer(30);
  else document.getElementById('timer').textContent = '';
}

function startTimer(seconds) {
  let time = seconds;
  const timerEl = document.getElementById('timer');
  timerEl.textContent = `⏱️ ${time}s`;
  timerEl.classList.remove('urgent');
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    time--;
    timerEl.textContent = `⏱️ ${time}s`;
    if (time <= 10) timerEl.classList.add('urgent');
    if (time <= 0) {
      clearInterval(timer);
      timerEl.textContent = "⏱️ Time's up!";
      timerEl.classList.remove('urgent');
      timePerQ.push(seconds);
      showResultMsg('⏱️ Waqt khatam!', false);
      document.querySelector('.next-button').classList.remove('hidden');
    }
  }, 1000);
}

export function checkAnswer() {
  if (mode === 'timed' && timer) clearInterval(timer);
  const timeSpent = Math.round((Date.now() - startTime) / 1000);

  const user_para         = document.getElementById('user_para').value.trim();
  const user_page_in_para = document.getElementById('user_page_in_para').value.trim();
  const user_page         = document.getElementById('user_page').value.trim();
  const user_surah        = document.getElementById('user_surah').value.trim().toLowerCase();
  const user_ruku         = document.getElementById('user_ruku').value.trim();
  const user_ayat         = document.getElementById('user_ayat').value.trim();

  const errorDiv = document.getElementById('quizError');
  errorDiv.classList.add('hidden');
  document.getElementById('quizResult').classList.add('hidden');
  document.querySelector('.next-button').classList.add('hidden');
  document.getElementById('survivalAnswer').classList.add('hidden');

  if (!user_para) {
    errorDiv.textContent = '❌ Para Number zaroori hai!';
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 2500);
    return false;
  }

  const page_num      = parseInt(currentAyat.page);
  const actual_para   = ((page_num - 1) / 20 | 0) + 1;
  const actual_pip    = ((page_num - 1) % 20) + 1;

  let resultParts = [];
  let optionalCorrect = 0;

  const paraCorrect = parseInt(user_para) === actual_para;
  if (!paraCorrect) resultParts.push(`❌ Para Galat! Sahi: ${actual_para}`);

  let pipCorrect = true;
  if (user_page_in_para) {
    pipCorrect = parseInt(user_page_in_para) === actual_pip - 1;
    if (!pipCorrect) resultParts.push(`❌ Page In Para Galat! Sahi: ${actual_pip - 1}`);
  }

  if (user_page) {
    if (parseInt(user_page) === page_num) optionalCorrect++;
    else resultParts.push(`❌ Page No. Galat! Sahi: ${page_num}`);
  }
  if (user_surah) {
    if (currentAyat.surah_name.toLowerCase().includes(user_surah)) optionalCorrect++;
    else resultParts.push(`❌ Surah Galat! Sahi: ${currentAyat.surah_name}`);
  }
  if (user_ruku && currentAyat.ruku_no !== undefined) {
    if (parseInt(user_ruku) === currentAyat.ruku_no) optionalCorrect++;
    else resultParts.push(`❌ Ruku Galat! Sahi: ${currentAyat.ruku_no}`);
  }
  if (user_ayat && currentAyat.ayat_no !== undefined) {
    if (parseInt(user_ayat) === currentAyat.ayat_no) optionalCorrect++;
    else resultParts.push(`❌ Ayat No. Galat! Sahi: ${currentAyat.ayat_no}`);
  }

  const isCorrect = paraCorrect && (user_page_in_para ? pipCorrect : true);

  if (isCorrect) {
    score++;
    const sname = currentAyat.surah_name;
    surahCorrectCount[sname] = (surahCorrectCount[sname] || 0) + 1;
    const baseCoins    = Math.max(10, 15 - Math.floor(timeSpent / 5));
    const optCoins     = optionalCorrect * 5;
    const totalCoins   = baseCoins + optCoins;
    let msg = `✅ Sahi! +${baseCoins} coins`;
    if (optCoins > 0) msg += ` + ${optCoins} optional = 🪙 ${totalCoins}`;
    showResultMsg(msg, true);
  } else {
    showResultMsg(resultParts.join('<br>') || '❌ Galat!', false);
    if (mode === 'survival') {
      survivalActive = false;
      showSurvivalAnswer();
      timePerQ.push(timeSpent);
      updateScoreBoard();
      setTimeout(() => endQuiz(), 2200);
      return false;
    }
  }

  document.querySelector('.next-button').classList.remove('hidden');
  timePerQ.push(timeSpent);
  updateScoreBoard();
  return false;
}

function showResultMsg(msg, isCorrect) {
  const div = document.getElementById('quizResult');
  div.innerHTML = msg;
  div.className = isCorrect ? 'result' : 'error';
  div.classList.remove('hidden');
  if (isCorrect) setTimeout(() => div.classList.add('hidden'), 4000);
}

function showSurvivalAnswer() {
  const page = parseInt(currentAyat.page);
  const para = ((page - 1) / 20 | 0) + 1;
  const pip  = ((page - 1) % 20) + 1;
  const div  = document.getElementById('survivalAnswer');
  div.innerHTML = `<b>Sahi Jawab:</b><br>
    Surah: <b>${currentAyat.surah_name}</b> |
    Para: <b>${para}</b> |
    Page: <b>${page}</b> |
    Page in Para: <b>${pip - 1}</b>`;
  div.classList.remove('hidden');
}

export function showHint() {
  if (hintCount >= MAX_HINTS) return;
  hintCount++;
  document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${MAX_HINTS}`;
  if (hintCount >= MAX_HINTS) document.getElementById('hintBtn').disabled = true;
  const para   = ((parseInt(currentAyat.page) - 1) / 20 | 0) + 1;
  const first2 = currentAyat.surah_name.split(' ').slice(0, 2).join(' ');
  const err    = document.getElementById('quizError');
  err.innerHTML = `💡 <b>Hint:</b> Surah shuru: <b>${first2}...</b>, Para: <b>${para}</b>`;
  err.classList.remove('hidden');
  setTimeout(() => err.classList.add('hidden'), 3500);
}

function updateScoreBoard() {
  const sb = document.getElementById('scoreBoard');
  if (sb) sb.textContent = `Score: ${score} / ${quizIndex}`;
}

function endQuiz() {
  if (timer) clearInterval(timer);
  let best = '', max = 0;
  Object.entries(surahCorrectCount).forEach(([s, c]) => { if (c > max) { max = c; best = s; } });
  const avg = timePerQ.length ? Math.round(timePerQ.reduce((a, b) => a + b, 0) / timePerQ.length) : 0;
  document.getElementById('finalResult').innerHTML = `
    🧠 Score: <b>${score} / ${quizIndex}</b><br>
    📖 Best Surah: <b>${best || '—'}</b><br>
    ⏱️ Avg Time: <b>${avg} sec</b><br><br>
    ${mode === 'survival' && !survivalActive ? '💥 Survival Khatam!' : '🎉 Mubarak!'}
  `;
  showSection('resultScreen');
}

export function restartGame(home = false) {
  quizIndex = 0; score = 0; usedIndexes = [];
  surahCorrectCount = {}; timePerQ = [];
  hintCount = 0; survivalActive = true;
  if (timer) clearInterval(timer);
  document.getElementById('hintBtn').disabled = false;
  document.getElementById('hintInfo').textContent = `Hint: 0/${MAX_HINTS}`;
  showSection(home ? 'welcomeScreen' : 'paraSelectScreen');
}

export function initQuiz() {
  initModeSelection();
  window.startGame    = startGame;
  window.nextQuestion = nextQuestion;
  window.checkAnswer  = checkAnswer;
  window.showHint     = showHint;
  window.restartGame  = restartGame;
    }
