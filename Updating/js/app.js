'use strict';

// ═══════════════════════════════════════════
//  FIREBASE
// ═══════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInAnonymously, GoogleAuthProvider,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const app  = initializeApp({
  apiKey:            "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
  authDomain:        "quran-quiz-3ee30.firebaseapp.com",
  databaseURL:       "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
  projectId:         "quran-quiz-3ee30",
  storageBucket:     "quran-quiz-3ee30.firebasestorage.app",
  messagingSenderId: "362662301719",
  appId:             "1:362662301719:web:e5fa7bd4adf633758e8c52",
  measurementId:     "G-CVQTH5SS0X"
});
const auth = getAuth(app);
const db   = getFirestore(app);
const GP   = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
let quranData = [], curUser = null, curData = null, guestN = 0;
let selAyats = [], curAyat = null;
let qIdx = 0, score = 0, totalQ = 10, mode = 'practice';
let usedI = [], surahC = {}, startT = 0, qTmr = null;
let timeArr = [], survOn = true, hints = 0;
let sessionCorrect = 0, sessionTotal = 0; // session accuracy tracker
const MAX_H = 2;

// ═══════════════════════════════════════════
//  COINS SYSTEM
// ═══════════════════════════════════════════
// Coin formula:
//   Base:    15 coins (fast) → 5 coins (slow, >30s)
//   Speed bonus: <5s = +5, <10s = +3, <15s = +1
//   Optional fields: +5 each
//   Hint penalty: -5 each
//   Survival bonus: +20 per correct
//   Accuracy milestone: every 10 correct in a row = +50

function calcCoins(timeSpent, optCorrect, hintsUsed, isSurvival) {
  let coins = 0;

  // Base coins (speed based)
  if      (timeSpent <= 5)  coins = 15;
  else if (timeSpent <= 10) coins = 12;
  else if (timeSpent <= 15) coins = 10;
  else if (timeSpent <= 20) coins = 8;
  else if (timeSpent <= 30) coins = 6;
  else                      coins = 5;

  // Optional fields bonus
  coins += optCorrect * 5;

  // Hint penalty
  coins -= hintsUsed * 5;

  // Survival bonus
  if (isSurvival) coins += 20;

  // Min 0
  return Math.max(0, coins);
}

// Save coins to Firestore (background)
async function addCoinsToFirestore(amount, correct, total) {
  if (!curUser || curUser.isAnonymous || amount === 0) return;
  try {
    const ref = doc(db, 'users', curUser.uid);
    const newCoins  = (curData?.coins  || 0) + amount;
    const newCorrect= (curData?.totalCorrect || 0) + correct;
    const newTotal  = (curData?.totalGames || 0) + total;
    const accuracy  = newTotal > 0 ? Math.round((newCorrect / newTotal) * 100) : 0;

    await updateDoc(ref, {
      coins:        increment(amount),
      totalCorrect: increment(correct),
      totalGames:   increment(total),
      accuracy:     accuracy,
      lastPlayed:   serverTimestamp()
    });

    // Update local cache
    if (curData) {
      curData.coins        = newCoins;
      curData.totalCorrect = newCorrect;
      curData.totalGames   = newTotal;
      curData.accuracy     = accuracy;
    }
    updateHeader();
  } catch(e) {
    console.warn('Coins save error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const $  = id => document.getElementById(id);
const on = (id, ev, fn) => $(id) && $(id).addEventListener(ev, fn);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id) && $(id).classList.add('active');
  if (id !== 'welcomeScreen') {
    const sc = $('searchContainer');
    if (sc) sc.style.display = 'none';
    const tb = $('toggleSearchBtn');
    if (tb) tb.textContent = '🔎 Search';
  }
}

function toast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) { t = document.createElement('div'); t.id = '_toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className   = `toast toast-${type} toast-show`;
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => t.classList.remove('toast-show'), dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `auth-msg ${type} show`;
}

function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.className = 'auth-msg'; m.textContent = '';
  });
}

function btnLoad(id, loading, orig) {
  const b = $(id);
  if (!b) return;
  b.disabled = loading;
  if (loading) { b._o = b.textContent; b.textContent = '⏳'; }
  else b.textContent = orig || b._o || b.textContent;
}

// ═══════════════════════════════════════════
//  HEADER UI
// ═══════════════════════════════════════════
function updateHeader() {
  const lb = $('logoutBtn');
  if (curUser && !curUser.isAnonymous) {
    // Registered user
    const coins = curData?.coins || 0;
    const acc   = curData?.accuracy || 0;
    const el    = $('headerMeta');
    if (el) {
      el.innerHTML = `
        <div class="hm-coins">🪙 <span id="coinCount">${coins.toLocaleString()}</span></div>
        <div class="hm-acc">🎯 <span>${acc}%</span></div>
        <div class="hm-user">${curData?.isHafiz ? '👑' : '👤'} <span>${curData?.username || 'Player'}</span></div>
      `;
    }
    $('headerMeta')?.classList.remove('hidden');
    if (lb) lb.style.display = 'inline-flex';
  } else if (curUser && curUser.isAnonymous) {
    // Guest user — show logout only
    $('headerMeta')?.classList.add('hidden');
    if (lb) lb.style.display = 'inline-flex';
  } else {
    // Not logged in
    $('headerMeta')?.classList.add('hidden');
    if (lb) lb.style.display = 'none';
  }
}

function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup');
  if (!p) return;
  $('wpName').textContent  = isNew ? `Ahlan, ${name}! 🌙` : `Marhaba, ${name}! 🌙`;
  $('wpCoins').textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  setTimeout(() => p.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  FIRESTORE
// ═══════════════════════════════════════════
async function syncUser(uid, data) {
  try {
    const ref  = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const nd = {
        uid, username: data.username || 'Player', email: data.email || '',
        coins: 500, xp: 0, level: 1, accuracy: 0,
        totalGames: 0, totalWins: 0, totalCorrect: 0, streak: 0,
        bestStreak: 0, avgSpeed: 0, fastestAnswer: 0,
        lastLogin: serverTimestamp(), createdAt: serverTimestamp(),
        isHafiz: false, role: 'user', avatar: 'default',
        onlineMode: false, badges: [], friends: [], bookmarks: []
      };
      await setDoc(ref, nd);
      curData = nd;
    } else {
      curData = snap.data();
      updateDoc(ref, { lastLogin: serverTimestamp() }).catch(() => {});
    }
    updateHeader();
    checkUnlocks();
  } catch(e) { console.warn('Firestore:', e.code); }
}

function checkUnlocks() {
  if (!curData) return;
  if (!curData.onlineMode && curData.coins >= 800) {
    updateDoc(doc(db, 'users', curUser.uid), { onlineMode: true }).catch(() => {});
    toast('🎉 Online Mode unlock! 800 coins complete!', 'success', 4000);
  }
}

// ═══════════════════════════════════════════
//  FIREBASE ERRORS
// ═══════════════════════════════════════════
function fbErr(code) {
  return ({
    'auth/email-already-in-use':   '❌ Email pehle se registered hai.',
    'auth/invalid-email':          '❌ Sahi email format likhein.',
    'auth/user-not-found':         '❌ Email registered nahi.',
    'auth/wrong-password':         '❌ Password galat hai.',
    'auth/invalid-credential':     '❌ Email ya password galat hai.',
    'auth/weak-password':          '❌ Password min 6 characters chahiye.',
    'auth/too-many-requests':      '❌ Zyada try — thodi der baad koshish karein.',
    'auth/network-request-failed': '❌ Internet check karein.',
    'auth/popup-blocked':          '❌ Popup block — browser mein allow karein.',
    'auth/operation-not-allowed':  '❌ Yeh method Firebase mein enable nahi.',
  })[code] || `❌ Error: ${code}`;
}

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
async function doLogin() {
  clearMsgs();
  const email = $('loginEmail').value.trim();
  const pw    = $('loginPassword').value;
  if (!email || !pw) { setMsg('loginMsg', '❌ Email aur password likhein!'); return; }
  btnLoad('loginBtn', true);
  try {
    const c = await signInWithEmailAndPassword(auth, email, pw);
    showScreen('welcomeScreen');
    toast('✅ Login ho gaye!', 'success');
    syncUser(c.user.uid, { username: c.user.displayName || email.split('@')[0], email: c.user.email });
  } catch(e) {
    setMsg('loginMsg', fbErr(e.code));
    btnLoad('loginBtn', false, '🔐 Login');
  }
}

async function doSignup() {
  clearMsgs();
  const un  = $('signupUsername').value.trim();
  const em  = $('signupEmail').value.trim();
  const pw  = $('signupPassword').value;
  const cpw = $('signupConfirmPw').value;
  if (!un || !em || !pw || !cpw) { setMsg('signupMsg', '❌ Sab fields bharen!'); return; }
  if (un.length < 3 || un.length > 20 || !/^[a-zA-Z0-9_]+$/.test(un)) {
    setMsg('signupMsg', '❌ Username: 3-20 chars, letters/numbers/_ sirf.'); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setMsg('signupMsg', '❌ Sahi email likhein.'); return; }
  if (pw.length < 6)  { setMsg('signupMsg', '❌ Password min 6 characters.'); return; }
  if (pw !== cpw)     { setMsg('signupMsg', '❌ Passwords match nahi!'); return; }
  btnLoad('signupBtn', true);
  try {
    const c = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(c.user, { displayName: un });
    showScreen('welcomeScreen');
    showWelcomePopup(un, 500, true);
    toast('✅ Account ban gaya! 500🪙 mile!', 'success');
    syncUser(c.user.uid, { username: un, email: em });
  } catch(e) {
    setMsg('signupMsg', fbErr(e.code));
    btnLoad('signupBtn', false, '📝 Account Banayein');
  }
}

async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn','googleSignupBtn'].forEach(id => $(id) && ($(id).disabled = true));
  try {
    const r    = await signInWithPopup(auth, GP);
    const name = r.user.displayName || r.user.email.split('@')[0];
    const isNew = r._tokenResponse?.isNewUser || false;
    showScreen('welcomeScreen');
    showWelcomePopup(name, isNew ? 500 : curData?.coins || 0, isNew);
    toast('✅ Google se login!', 'success');
    syncUser(r.user.uid, { username: name, email: r.user.email });
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') setMsg('loginMsg', fbErr(e.code));
  }
  ['googleLoginBtn','googleSignupBtn'].forEach(id => $(id) && ($(id).disabled = false));
}

async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth);
    guestN = 0;
    showScreen('welcomeScreen');
    toast('👤 Guest mode — 3 sawaal free!', 'info', 4000);
  } catch(e) {
    setMsg('loginMsg', fbErr(e.code));
    btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)');
  }
}

async function doLogout() {
  await signOut(auth);
  curUser = curData = null;
  updateHeader();
  showScreen('authScreen');
  toast('👋 Phir aana!', 'info');
}

async function doForgot() {
  const em = $('loginEmail').value.trim();
  if (!em) { setMsg('loginMsg', '❌ Pehle email likhein!'); return; }
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg', '📧 Reset email bhej diya!', 'success');
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); }
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
}

// ═══════════════════════════════════════════
//  AUTH STATE
// ═══════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  curUser = user;
  if (user) {
    if (!user.isAnonymous) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) curData = snap.data();
      } catch(e) { console.warn('Auth state:', e.message); }
      updateHeader();
    }
    if ($('authScreen')?.classList.contains('active')) {
      showScreen('welcomeScreen');
      if (curData) showWelcomePopup(curData.username, curData.coins);
    }
  } else {
    curData = null;
    updateHeader();
    showScreen('authScreen');
  }
});

// ═══════════════════════════════════════════
//  QUIZ — LOAD DATA
// ═══════════════════════════════════════════
async function loadQuran() {
  try {
    quranData = await (await fetch('quran_full.json')).json();
    console.log('✅ Quran loaded:', quranData.length);
  } catch(e) { console.error('❌ Quran load fail:', e); }
}

// ═══════════════════════════════════════════
//  QUIZ — START
// ═══════════════════════════════════════════
function startGame() {
  const fp = parseInt($('fromPara').value);
  const tp = parseInt($('toPara').value);
  const er = $('selectError');
  er.classList.add('hidden');
  if (isNaN(fp) || isNaN(tp) || fp < 1 || tp > 30 || fp > tp) {
    er.textContent = '❌ Galat range! Para 1–30, From ≤ To.'; er.classList.remove('hidden'); return;
  }
  if (!quranData.length) {
    er.textContent = '❌ Quran data load nahi hua. Reload karein.'; er.classList.remove('hidden'); return;
  }
  selAyats = quranData.filter(a => { const p = ((a.page-1)/20|0)+1; return p>=fp && p<=tp; });
  if (!selAyats.length) {
    er.textContent = '❌ Is range mein ayat nahi mile.'; er.classList.remove('hidden'); return;
  }
  qIdx=0; score=0; usedI=[]; surahC={}; timeArr=[]; hints=0; survOn=true;
  sessionCorrect=0; sessionTotal=0;
  mode   = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  totalQ = mode === 'timed' ? 10 : 9999;
  $('hintBtn').disabled = false;
  $('hintInfo').textContent = `Hint: 0/${MAX_H}`;
  $('survivalAnswer').classList.add('hidden');
  nextQ();
  showScreen('quizScreen');
}

// ═══════════════════════════════════════════
//  QUIZ — NEXT QUESTION
// ═══════════════════════════════════════════
function nextQ() {
  ['quizError','quizResult','survivalAnswer'].forEach(id => $(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  $('nextBtn')?.classList.add('hidden');
  // Re-enable check button for new question
  const cb = $('checkBtn');
  if (cb) cb.disabled = false;
  $('hintBtn').disabled = hints >= MAX_H;
  $('hintInfo').textContent = `Hint: ${hints}/${MAX_H}`;
  if (qIdx >= totalQ || usedI.length >= selAyats.length) { endQuiz(); return; }
  let i, t = 0;
  do { i = Math.floor(Math.random() * selAyats.length); t++; }
  while (usedI.includes(i) && t < 1000);
  usedI.push(i);
  curAyat = selAyats[i];
  typeText(curAyat.text);
  qIdx++;
  updateQuizStats();
  startT = Date.now();
  if (mode === 'timed') startTimer(30);
  else $('timer').textContent = '';
}

function updateQuizStats() {
  const acc = sessionTotal > 0 ? Math.round((sessionCorrect/sessionTotal)*100) : 0;
  $('scoreBoard').innerHTML = `
    <span>Score: <b>${score}/${qIdx}</b></span>
    <span style="margin:0 8px;color:var(--text-muted)">|</span>
    <span>🎯 ${acc}%</span>
  `;
  $('quizProgress').textContent =
    mode === 'practice' ? `🎯 Practice — Sawal: ${qIdx}` :
    mode === 'survival' ? `💥 Survival — Sawal: ${qIdx}` :
    `⏱️ ${qIdx} / ${totalQ}`;
}

// ═══════════════════════════════════════════
//  QUIZ — TYPING EFFECT
// ═══════════════════════════════════════════
function typeText(text) {
  const el = $('ayatText');
  el.textContent = '';
  let i = 0;
  const go = () => { if (i < text.length) { el.textContent += text[i++]; setTimeout(go, 20); } };
  go();
}

// ═══════════════════════════════════════════
//  QUIZ — TIMER
// ═══════════════════════════════════════════
function startTimer(sec) {
  let t = sec;
  const el = $('timer');
  el.textContent = `⏱️ ${t}s`; el.classList.remove('urgent');
  if (qTmr) clearInterval(qTmr);
  qTmr = setInterval(() => {
    t--;
    el.textContent = `⏱️ ${t}s`;
    if (t <= 10) el.classList.add('urgent');
    if (t <= 0) {
      clearInterval(qTmr);
      el.textContent = "⏱️ Time's up!"; el.classList.remove('urgent');
      timeArr.push(sec);
      sessionTotal++;
      showRes('⏱️ Waqt khatam!', false);
      $('nextBtn')?.classList.remove('hidden');
    }
  }, 1000);
}

// ═══════════════════════════════════════════
//  QUIZ — CHECK ANSWER
// ═══════════════════════════════════════════
function checkAnswer() {
  // Lock check button to prevent multi-submit abuse
  const cb = $('checkBtn');
  if (cb) cb.disabled = true;
  if (mode === 'timed' && qTmr) clearInterval(qTmr);
  const ts   = Math.round((Date.now() - startT) / 1000);
  const para = $('user_para').value.trim();
  const pip  = $('user_page_in_para').value.trim();
  const pg   = $('user_page').value.trim();
  const sur  = $('user_surah').value.trim().toLowerCase();
  const rk   = $('user_ruku').value.trim();
  const ay   = $('user_ayat').value.trim();

  ['quizError','quizResult'].forEach(id => $(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer').classList.add('hidden');

  if (!para) { showErr('❌ Para Number zaroori hai!'); return; }

  const pn  = parseInt(curAyat.page);
  const ap  = ((pn-1)/20|0)+1;
  const aip = ((pn-1)%20)+1;

  let parts = [], opt = 0;
  const pOk = parseInt(para) === ap;
  if (!pOk) parts.push(`❌ Para Galat! Sahi: ${ap}`);
  let pipOk = true;
  if (pip) { pipOk = parseInt(pip) === aip-1; if (!pipOk) parts.push(`❌ Page in Para Galat! Sahi: ${aip-1}`); }
  if (pg)  { if (parseInt(pg) === pn) opt++; else parts.push(`❌ Page No. Galat! Sahi: ${pn}`); }
  if (sur) { if (curAyat.surah_name.toLowerCase().includes(sur)) opt++; else parts.push(`❌ Surah Galat! Sahi: ${curAyat.surah_name}`); }
  if (rk && curAyat.ruku_no !== undefined)  { if (parseInt(rk)===curAyat.ruku_no) opt++; else parts.push(`❌ Ruku Galat! Sahi: ${curAyat.ruku_no}`); }
  if (ay && curAyat.ayat_no !== undefined)  { if (parseInt(ay)===curAyat.ayat_no) opt++; else parts.push(`❌ Ayat No. Galat! Sahi: ${curAyat.ayat_no}`); }

  const ok = pOk && (pip ? pipOk : true);
  sessionTotal++;

  if (ok) {
    score++;
    sessionCorrect++;
    surahC[curAyat.surah_name] = (surahC[curAyat.surah_name]||0)+1;
    timeArr.push(ts);

    // Calculate coins
    const earned = calcCoins(ts, opt, hints, mode === 'survival');
    const speedLabel = ts <= 5 ? '⚡ Super Fast!' : ts <= 10 ? '🏃 Fast!' : ts <= 20 ? '👍 Good' : '🐢 Slow';

    // Update local coins immediately
    if (curData) {
      curData.coins = (curData.coins || 0) + earned;
      updateHeader();
    }

    // Save to Firestore
    addCoinsToFirestore(earned, 1, 1);

    // Show result with coins breakdown
    let msg = `✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span>`;
    msg += `<br><small style="color:var(--text-muted)">${speedLabel} (${ts}s)`;
    if (opt > 0) msg += ` | +${opt*5}🪙 optional`;
    if (hints > 0) msg += ` | -${hints*5}🪙 hint`;
    msg += `</small>`;
    showRes(msg, true);

    // Streak bonus
    if (sessionCorrect % 10 === 0) {
      toast(`🔥 ${sessionCorrect} sahi! +50🪙 streak bonus!`, 'success', 3000);
      if (curData) curData.coins += 50;
      addCoinsToFirestore(50, 0, 0);
      updateHeader();
    }
  } else {
    sessionTotal > 0 && addCoinsToFirestore(0, 0, 1); // just update total count
    showRes(parts.join('<br>') || '❌ Galat!', false);
    if (mode === 'survival') {
      survOn = false;
      $('survivalAnswer').innerHTML = `<b>Sahi Jawab:</b><br>Surah: <b>${curAyat.surah_name}</b> | Para: <b>${ap}</b> | Page: <b>${pn}</b> | PiP: <b>${aip-1}</b>`;
      $('survivalAnswer').classList.remove('hidden');
      setTimeout(endQuiz, 2200);
      return;
    }
  }

  $('nextBtn')?.classList.remove('hidden');
  updateQuizStats();
  hints = 0; // reset hints per question
}

function showRes(msg, ok) {
  const d = $('quizResult');
  d.innerHTML = msg;
  d.className = ok ? 'result' : 'error';
  d.classList.remove('hidden');
  if (ok) setTimeout(() => d.classList.add('hidden'), 5000);
}

function showErr(msg) {
  const e = $('quizError');
  e.textContent = msg; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 2500);
}

// ═══════════════════════════════════════════
//  QUIZ — HINT
// ═══════════════════════════════════════════
function showHint() {
  if (hints >= MAX_H) return;
  hints++;
  $('hintInfo').textContent = `Hint: ${hints}/${MAX_H}`;
  if (hints >= MAX_H) $('hintBtn').disabled = true;
  const ap = ((parseInt(curAyat.page)-1)/20|0)+1;
  const s2 = curAyat.surah_name.split(' ').slice(0,2).join(' ');
  const e  = $('quizError');
  e.innerHTML = `💡 <b>Hint (-5🪙):</b> Surah: <b>${s2}...</b>, Para: <b>${ap}</b>`;
  e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 3500);
}

// ═══════════════════════════════════════════
//  QUIZ — END
// ═══════════════════════════════════════════
function endQuiz() {
  if (qTmr) clearInterval(qTmr);

  const avg  = timeArr.length ? Math.round(timeArr.reduce((a,b)=>a+b,0)/timeArr.length) : 0;
  const fast = timeArr.length ? Math.min(...timeArr) : 0;
  const acc  = sessionTotal > 0 ? Math.round((sessionCorrect/sessionTotal)*100) : 0;
  const totalEarned = (curData?.coins || 0);

  let best = '', mx = 0;
  Object.entries(surahC).forEach(([s,c]) => { if(c>mx){mx=c;best=s;} });

  // Speed badge
  const speedBadge = avg <= 8 ? '⚡ Speed Master' : avg <= 15 ? '🏃 Quick Player' : '📚 Careful Reader';

  $('finalResult').innerHTML = `
    <div class="result-grid">
      <div class="result-item">
        <span class="ri-icon">🧠</span>
        <span class="ri-val">${score}/${qIdx}</span>
        <span class="ri-lbl">Score</span>
      </div>
      <div class="result-item">
        <span class="ri-icon">🎯</span>
        <span class="ri-val">${acc}%</span>
        <span class="ri-lbl">Accuracy</span>
      </div>
      <div class="result-item">
        <span class="ri-icon">⏱️</span>
        <span class="ri-val">${avg}s</span>
        <span class="ri-lbl">Avg Speed</span>
      </div>
      <div class="result-item">
        <span class="ri-icon">⚡</span>
        <span class="ri-val">${fast}s</span>
        <span class="ri-lbl">Fastest</span>
      </div>
      <div class="result-item result-item-wide">
        <span class="ri-icon">🪙</span>
        <span class="ri-val">${(curData?.coins||0).toLocaleString()}</span>
        <span class="ri-lbl">Total Coins</span>
      </div>
      <div class="result-item result-item-wide">
        <span class="ri-icon">📖</span>
        <span class="ri-val" style="font-size:.95rem">${best || '—'}</span>
        <span class="ri-lbl">Best Surah</span>
      </div>
    </div>
    <div class="speed-badge">${speedBadge}</div>
    <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">
      ${mode==='survival'&&!survOn ? '💥 Survival Khatam!' : '🎉 Mubarak!'}
    </div>
  `;
  showScreen('resultScreen');
}

function resetGame(home) {
  qIdx=0; score=0; usedI=[]; surahC={}; timeArr=[];
  hints=0; survOn=true; sessionCorrect=0; sessionTotal=0;
  if (qTmr) clearInterval(qTmr);
  $('hintBtn').disabled = false;
  $('hintInfo').textContent = `Hint: 0/${MAX_H}`;
  showScreen(home ? 'welcomeScreen' : 'paraSelectScreen');
}

// ═══════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════
function rmD(t) { return t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, ''); }

function doSearch(e) {
  if (e) e.preventDefault();
  const q  = rmD($('searchInput').value.trim().toLowerCase());
  const rd = $('searchResults');
  if (!q)              { rd.innerHTML = '<em>Kuch likhein...</em>'; return; }
  if (!quranData.length) { rd.innerHTML = '<em>Data load ho raha hai...</em>'; return; }
  const found = quranData.filter(a =>
    rmD(a.text.toLowerCase()).includes(q) ||
    rmD(a.surah_name.toLowerCase()).includes(q) ||
    String(a.page) === q ||
    String(((a.page-1)/20|0)+1) === q
  ).slice(0, 30);
  if (!found.length) { rd.innerHTML = '<b>Koi result nahi mila.</b>'; return; }
  const hl = t => t.split(/(\s+)/).map(w => rmD(w.toLowerCase())===q ? `<mark>${w}</mark>` : w).join('');
  rd.innerHTML = found.map(r => {
    const ap = ((r.page-1)/20|0)+1;
    return `<div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank')">
      <b>Ayat:</b> ${hl(r.text)}<br>
      <b>Surah:</b> ${hl(r.surah_name)} | <b>Page:</b> ${r.page} | <b>Para:</b> ${ap}
      <span style="float:right;color:#aad">🔗</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════
on('tabLogin',   'click', () => switchTab('login'));
on('tabSignup',  'click', () => switchTab('signup'));
on('loginBtn',   'click', doLogin);
on('signupBtn',  'click', doSignup);
on('googleLoginBtn',  'click', doGoogle);
on('googleSignupBtn', 'click', doGoogle);
on('guestBtn',   'click', doGuest);
on('logoutBtn',  'click', doLogout);
on('forgotBtn',  'click', doForgot);

on('toggleLoginPw', 'click', function() {
  const i = $('loginPassword');
  i.type = i.type==='password' ? 'text' : 'password';
  this.textContent = i.type==='password' ? '👁️' : '🙈';
});
on('toggleSignupPw', 'click', function() {
  const i = $('signupPassword');
  i.type = i.type==='password' ? 'text' : 'password';
  this.textContent = i.type==='password' ? '👁️' : '🙈';
});

on('loginPassword',   'keydown', e => { if(e.key==='Enter') doLogin(); });
on('signupConfirmPw', 'keydown', e => { if(e.key==='Enter') doSignup(); });

on('feedbackBtn',     'click', () => showScreen('contactScreen'));
on('goParaSelect',    'click', () => showScreen('paraSelectScreen'));
on('backFromPara',    'click', () => showScreen('welcomeScreen'));
on('backFromQuiz',    'click', () => showScreen('welcomeScreen'));
on('backFromContact', 'click', () => showScreen(curUser && !curUser.isAnonymous ? 'welcomeScreen' : 'authScreen'));
on('goHomeBtn',       'click', () => resetGame(true));
on('playAgainBtn',    'click', () => resetGame(false));
on('nextBtn',         'click', nextQ);
on('hintBtn',         'click', showHint);

on('paraForm',   'submit', e => { e.preventDefault(); startGame(); });
on('answerForm', 'submit', e => { e.preventDefault(); checkAnswer(); });
on('searchForm', 'submit', doSearch);
on('searchInput','keydown', e => { if(e.key==='Enter') doSearch(e); });
on('modeForm',   'change',  () => { mode = document.querySelector('input[name="quizMode"]:checked')?.value||'practice'; });

on('toggleSearchBtn', 'click', () => {
  const sc = $('searchContainer'), btn = $('toggleSearchBtn');
  if (sc.style.display==='none'||!sc.style.display) {
    sc.style.display='block'; btn.textContent='❌ Band Karein'; $('searchInput')?.focus();
  } else { sc.style.display='none'; btn.textContent='🔎 Search'; }
});

on('guestToSignup', 'click', () => {
  $('guestModal').style.display='none'; showScreen('authScreen'); switchTab('signup');
});
on('guestContinue', 'click', () => { $('guestModal').style.display='none'; });

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
loadQuran();
