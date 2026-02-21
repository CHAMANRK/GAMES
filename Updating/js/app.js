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
import {
  getDatabase, ref, set, get, onValue, remove, update, push, off
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

const firebaseApp = initializeApp({
  apiKey:            "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
  authDomain:        "quran-quiz-3ee30.firebaseapp.com",
  databaseURL:       "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
  projectId:         "quran-quiz-3ee30",
  storageBucket:     "quran-quiz-3ee30.firebasestorage.app",
  messagingSenderId: "362662301719",
  appId:             "1:362662301719:web:e5fa7bd4adf633758e8c52",
  measurementId:     "G-CVQTH5SS0X"
});
const auth = getAuth(firebaseApp);
const db   = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);
const GP   = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
let quranData = [], curUser = null, curData = null, guestN = 0;
let selAyats = [], curAyat = null;
let qIdx = 0, score = 0, totalQ = 10, mode = 'practice';
let usedI = [], surahC = {}, startT = 0, qTmr = null;
let timeArr = [], survOn = true, hints = 0;
let sessionCorrect = 0, sessionTotal = 0;
let _autoNextTmr = null;
const MAX_H = 2;

// ═══════════════════════════════════════════
//  COINS SYSTEM
// ═══════════════════════════════════════════
function calcCoins(timeSpent, optCorrect, hintsUsed, isSurvival) {
  let coins = 0;
  if      (timeSpent <= 5)  coins = 15;
  else if (timeSpent <= 10) coins = 12;
  else if (timeSpent <= 15) coins = 10;
  else if (timeSpent <= 20) coins = 8;
  else if (timeSpent <= 30) coins = 6;
  else                      coins = 5;
  coins += optCorrect * 5;
  coins -= hintsUsed * 5;
  if (isSurvival) coins += 20;
  return Math.max(0, coins);
}

async function addCoinsToFirestore(amount, correct, total) {
  if (!curUser || curUser.isAnonymous || amount === 0) return;
  try {
    const r2 = doc(db, 'users', curUser.uid);
    const newCoins   = (curData?.coins       || 0) + amount;
    const newCorrect = (curData?.totalCorrect|| 0) + correct;
    const newTotal   = (curData?.totalGames  || 0) + total;
    const accuracy   = newTotal > 0 ? Math.round((newCorrect / newTotal) * 100) : 0;
    await updateDoc(r2, { coins: increment(amount), totalCorrect: increment(correct), totalGames: increment(total), accuracy, lastPlayed: serverTimestamp() });
    if (curData) { curData.coins = newCoins; curData.totalCorrect = newCorrect; curData.totalGames = newTotal; curData.accuracy = accuracy; }
    updateHeader();
  } catch(e) { console.warn('Coins save error:', e.message); }
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
    const sc = $('searchContainer'); if (sc) sc.style.display = 'none';
    const tb = $('toggleSearchBtn'); if (tb) tb.textContent = '🔎 Search';
  }
}

function toast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) { t = document.createElement('div'); t.id = '_toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = `toast toast-${type} toast-show`;
  clearTimeout(t._tmr); t._tmr = setTimeout(() => t.classList.remove('toast-show'), dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.className = `auth-msg ${type} show`;
}

function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => { m.className = 'auth-msg'; m.textContent = ''; });
}

function btnLoad(id, loading, orig) {
  const b = $(id); if (!b) return;
  b.disabled = loading;
  if (loading) { b._o = b.textContent; b.textContent = '⏳'; }
  else b.textContent = orig || b._o || b.textContent;
}

// ═══════════════════════════════════════════
//  LANGUAGE SYSTEM
// ═══════════════════════════════════════════
let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem('nqg_lang', lang);
  const bH = $('btnHinglish'), bE = $('btnEnglish');
  if (bH) bH.classList.toggle('active', lang === 'hinglish');
  if (bE) bE.classList.toggle('active', lang === 'english');
}

// ═══════════════════════════════════════════
//  PROFILE PANEL
// ═══════════════════════════════════════════
function openProfilePanel() {
  $('profilePanel')?.classList.add('open');
  $('profileOverlay')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeProfilePanel() {
  $('profilePanel')?.classList.remove('open');
  $('profileOverlay')?.classList.add('hidden');
  document.body.style.overflow = '';
}
function refreshProfilePanel() {
  if (!curUser || curUser.isAnonymous || !curData) return;
  const isHafiz = curData.isHafiz || false;
  const set2 = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set2('ppUsername', curData.username || curUser.displayName || 'Player');
  set2('ppRole',     isHafiz ? '👑 Hafiz' : (curData.role === 'admin' ? '🛡️ Admin' : '🎮 Player'));
  set2('ppCoins',    (curData.coins || 0).toLocaleString());
  set2('ppAccuracy', (curData.accuracy || 0) + '%');
  set2('ppGames',    curData.totalGames || 0);
  // Full UID
  const uidEl = $('ppUidVal');
  if (uidEl) uidEl.textContent = curUser.uid;
  const av = $('ppAvatarCircle'); if (av) av.textContent = isHafiz ? '👑' : '👤';
  const pb = $('profileBtnIcon'); if (pb) pb.textContent = isHafiz ? '👑' : '👤';
}

// UID Copy
function setupUidCopy() {
  on('ppUidCopy', 'click', () => {
    const uid = curUser?.uid;
    if (!uid) return;
    navigator.clipboard.writeText(uid).then(() => {
      const copied = $('ppUidCopied');
      if (copied) { copied.classList.remove('hidden'); setTimeout(() => copied.classList.add('hidden'), 2000); }
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = uid; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      const copied = $('ppUidCopied');
      if (copied) { copied.classList.remove('hidden'); setTimeout(() => copied.classList.add('hidden'), 2000); }
    });
  });
}

// ═══════════════════════════════════════════
//  HEADER UI
// ═══════════════════════════════════════════
function updateHeader() {
  const profileBtn  = $('profileBtn');
  const hdrCoins    = $('hdrCoins');
  const hdrCoinsVal = $('hdrCoinsVal');
  if (curUser && !curUser.isAnonymous) {
    const coins = curData?.coins || 0;
    if (profileBtn)  profileBtn.classList.remove('hidden');
    if (hdrCoins)    hdrCoins.classList.remove('hidden');
    if (hdrCoinsVal) hdrCoinsVal.textContent = coins.toLocaleString();
    refreshProfilePanel();
  } else {
    if (profileBtn) profileBtn.classList.add('hidden');
    if (hdrCoins)   hdrCoins.classList.add('hidden');
  }
}

function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup'); if (!p) return;
  $('wpName').textContent  = isNew ? `Ahlan, ${name}! 🌙` : `Marhaba, ${name}! 🌙`;
  $('wpCoins').textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show'); setTimeout(() => p.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  FIRESTORE
// ═══════════════════════════════════════════
async function syncUser(uid, data) {
  try {
    const r2   = doc(db, 'users', uid);
    const snap = await getDoc(r2);
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
      await setDoc(r2, nd); curData = nd;
    } else {
      curData = snap.data();
      updateDoc(r2, { lastLogin: serverTimestamp() }).catch(() => {});
    }
    updateHeader(); checkUnlocks();
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
    showScreen('welcomeScreen'); toast('✅ Login ho gaye!', 'success');
    syncUser(c.user.uid, { username: c.user.displayName || email.split('@')[0], email: c.user.email });
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); btnLoad('loginBtn', false, '🔐 Login'); }
}

async function doSignup() {
  clearMsgs();
  const un  = $('signupUsername').value.trim();
  const em  = $('signupEmail').value.trim();
  const pw  = $('signupPassword').value;
  const cpw = $('signupConfirmPw').value;
  if (!un || !em || !pw || !cpw) { setMsg('signupMsg', '❌ Sab fields bharen!'); return; }
  if (un.length < 3 || un.length > 20 || !/^[a-zA-Z0-9_]+$/.test(un)) { setMsg('signupMsg', '❌ Username: 3-20 chars, letters/numbers/_ sirf.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setMsg('signupMsg', '❌ Sahi email likhein.'); return; }
  if (pw.length < 6)  { setMsg('signupMsg', '❌ Password min 6 characters.'); return; }
  if (pw !== cpw)     { setMsg('signupMsg', '❌ Passwords match nahi!'); return; }
  btnLoad('signupBtn', true);
  try {
    const c = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(c.user, { displayName: un });
    showScreen('welcomeScreen'); showWelcomePopup(un, 500, true);
    toast('✅ Account ban gaya! 500🪙 mile!', 'success');
    syncUser(c.user.uid, { username: un, email: em });
  } catch(e) { setMsg('signupMsg', fbErr(e.code)); btnLoad('signupBtn', false, '📝 Account Banayein'); }
}

async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn','googleSignupBtn'].forEach(id => $(id) && ($(id).disabled = true));
  try {
    const r2   = await signInWithPopup(auth, GP);
    const name = r2.user.displayName || r2.user.email.split('@')[0];
    const isNew = r2._tokenResponse?.isNewUser || false;
    showScreen('welcomeScreen'); showWelcomePopup(name, isNew ? 500 : curData?.coins || 0, isNew);
    toast('✅ Google se login!', 'success');
    syncUser(r2.user.uid, { username: name, email: r2.user.email });
  } catch(e) { if (e.code !== 'auth/popup-closed-by-user') setMsg('loginMsg', fbErr(e.code)); }
  ['googleLoginBtn','googleSignupBtn'].forEach(id => $(id) && ($(id).disabled = false));
}

async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth); guestN = 0;
    showScreen('welcomeScreen'); toast('👤 Guest mode — 3 sawaal free!', 'info', 4000);
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)'); }
}

async function doLogout() {
  leaveMatchCleanup();
  await signOut(auth); curUser = curData = null;
  updateHeader(); showScreen('authScreen'); toast('👋 Phir aana!', 'info');
}

async function doForgot() {
  const em = $('loginEmail').value.trim();
  if (!em) { setMsg('loginMsg', '❌ Pehle email likhein!'); return; }
  try { await sendPasswordResetEmail(auth, em); setMsg('loginMsg', '📧 Reset email bhej diya!', 'success'); }
  catch(e) { setMsg('loginMsg', fbErr(e.code)); }
}

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active'); clearMsgs();
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
    curData = null; updateHeader(); showScreen('authScreen');
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
  const er = $('selectError'); er.classList.add('hidden');
  if (isNaN(fp) || isNaN(tp) || fp < 1 || tp > 30 || fp > tp) { er.textContent = '❌ Galat range!'; er.classList.remove('hidden'); return; }
  if (!quranData.length) { er.textContent = '❌ Quran data load nahi hua.'; er.classList.remove('hidden'); return; }
  selAyats = quranData.filter(a => { const p = ((a.page-1)/20|0)+1; return p>=fp && p<=tp; });
  if (!selAyats.length) { er.textContent = '❌ Is range mein ayat nahi mile.'; er.classList.remove('hidden'); return; }
  qIdx=0; score=0; usedI=[]; surahC={}; timeArr=[]; hints=0; survOn=true; sessionCorrect=0; sessionTotal=0;
  mode   = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  totalQ = mode === 'timed' ? 10 : 9999;
  $('hintBtn').disabled = false;
  $('hintInfo').textContent = `Hint: 0/${MAX_H}`;
  $('survivalAnswer').classList.add('hidden');
  nextQ(); showScreen('quizScreen');
}

// ═══════════════════════════════════════════
//  QUIZ — NEXT QUESTION
// ═══════════════════════════════════════════
function nextQ() {
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  const nb = $('nextBtn'); if (nb) nb.textContent = '➡️ Agla Sawal';
  ['quizError','quizResult','survivalAnswer'].forEach(id => $(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  $('nextBtn')?.classList.add('hidden');
  const cb = $('checkBtn'); if (cb) cb.disabled = false;
  $('hintBtn').disabled = hints >= MAX_H;
  $('hintInfo').textContent = `Hint: ${hints}/${MAX_H}`;
  if (qIdx >= totalQ || usedI.length >= selAyats.length) { endQuiz(); return; }
  let i, t = 0;
  do { i = Math.floor(Math.random() * selAyats.length); t++; }
  while (usedI.includes(i) && t < 1000);
  usedI.push(i); curAyat = selAyats[i];
  typeText(curAyat.text); qIdx++; updateQuizStats(); startT = Date.now();
  if (mode === 'timed') startTimer(30); else $('timer').textContent = '';
}

function updateQuizStats() {
  const acc = sessionTotal > 0 ? Math.round((sessionCorrect/sessionTotal)*100) : 0;
  $('scoreBoard').innerHTML = `<span>Score: <b>${score}/${qIdx}</b></span><span style="margin:0 8px;color:var(--text-muted)">|</span><span>🎯 ${acc}%</span>`;
  $('quizProgress').textContent = mode === 'practice' ? `🎯 Practice — Sawal: ${qIdx}` : mode === 'survival' ? `💥 Survival — Sawal: ${qIdx}` : `⏱️ ${qIdx} / ${totalQ}`;
}

function typeText(text) {
  const el = $('ayatText'); el.textContent = ''; let i = 0;
  const go = () => { if (i < text.length) { el.textContent += text[i++]; setTimeout(go, 20); } }; go();
}

function startTimer(sec) {
  let t = sec; const el = $('timer');
  el.textContent = `⏱️ ${t}s`; el.classList.remove('urgent');
  if (qTmr) clearInterval(qTmr);
  qTmr = setInterval(() => {
    t--; el.textContent = `⏱️ ${t}s`;
    if (t <= 10) el.classList.add('urgent');
    if (t <= 0) {
      clearInterval(qTmr); el.textContent = "⏱️ Time's up!"; el.classList.remove('urgent');
      timeArr.push(sec); sessionTotal++;
      const cb = $('checkBtn'); if (cb) cb.disabled = true;
      showRes('⏱️ Waqt khatam!', false);
      $('nextBtn')?.classList.remove('hidden');
      // Auto-next after time's up too
      startAutoNext();
    }
  }, 1000);
}

// ═══════════════════════════════════════════
//  QUIZ — CHECK ANSWER
// ═══════════════════════════════════════════
function checkAnswer() {
  const cb = $('checkBtn');
  if (cb && cb.disabled) return;
  if (cb) cb.disabled = true;
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  if (mode === 'timed' && qTmr) clearInterval(qTmr);

  const ts  = Math.round((Date.now() - startT) / 1000);
  const para= $('user_para').value.trim();
  const pip = $('user_page_in_para').value.trim();
  const pg  = $('user_page').value.trim();
  const sur = $('user_surah').value.trim().toLowerCase();
  const rk  = $('user_ruku').value.trim();
  const ay  = $('user_ayat').value.trim();

  ['quizError','quizResult'].forEach(id => $(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer').classList.add('hidden');

  if (!para) { showErr('❌ Para Number zaroori hai!'); if (cb) cb.disabled = false; return; }

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
  if (rk && curAyat.ruku_no !== undefined) { if (parseInt(rk)===curAyat.ruku_no) opt++; else parts.push(`❌ Ruku Galat! Sahi: ${curAyat.ruku_no}`); }
  if (ay && curAyat.ayat_no !== undefined) { if (parseInt(ay)===curAyat.ayat_no) opt++; else parts.push(`❌ Ayat No. Galat! Sahi: ${curAyat.ayat_no}`); }

  const ok = pOk && (pip ? pipOk : true);
  sessionTotal++;

  if (ok) {
    score++; sessionCorrect++; surahC[curAyat.surah_name] = (surahC[curAyat.surah_name]||0)+1; timeArr.push(ts);
    const earned = calcCoins(ts, opt, hints, mode === 'survival');
    const speedLabel = ts <= 5 ? '⚡ Super Fast!' : ts <= 10 ? '🏃 Fast!' : ts <= 20 ? '👍 Good' : '🐢 Slow';
    if (curData) { curData.coins = (curData.coins || 0) + earned; updateHeader(); }
    addCoinsToFirestore(earned, 1, 1);
    let msg = `✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span>`;
    msg += `<br><small style="color:var(--text-muted)">${speedLabel} (${ts}s)`;
    if (opt > 0) msg += ` | +${opt*5}🪙 optional`;
    if (hints > 0) msg += ` | -${hints*5}🪙 hint`;
    msg += `</small>`;
    showRes(msg, true);
    if (sessionCorrect % 10 === 0) {
      toast(`🔥 ${sessionCorrect} sahi! +50🪙 streak bonus!`, 'success', 3000);
      if (curData) curData.coins += 50;
      addCoinsToFirestore(50, 0, 0); updateHeader();
    }
  } else {
    sessionTotal > 0 && addCoinsToFirestore(0, 0, 1);
    showRes(parts.join('<br>') || '❌ Galat!', false);
    if (mode === 'survival') {
      survOn = false;
      $('survivalAnswer').innerHTML = `<b>Sahi Jawab:</b><br>Surah: <b>${curAyat.surah_name}</b> | Para: <b>${ap}</b> | Page: <b>${pn}</b> | PiP: <b>${aip-1}</b>`;
      $('survivalAnswer').classList.remove('hidden');
      setTimeout(endQuiz, 2200); return;
    }
  }

  $('nextBtn')?.classList.remove('hidden');
  updateQuizStats(); hints = 0;
  startAutoNext();
}

function startAutoNext() {
  if (_autoNextTmr) clearInterval(_autoNextTmr);
  let cd = 5; const nb = $('nextBtn');
  if (nb) nb.textContent = `➡️ Agla Sawal (${cd}s)`;
  _autoNextTmr = setInterval(() => {
    cd--;
    if (nb) nb.textContent = cd > 0 ? `➡️ Agla Sawal (${cd}s)` : '➡️ Agla Sawal';
    if (cd <= 0) { clearInterval(_autoNextTmr); _autoNextTmr = null; nextQ(); }
  }, 1000);
}

function showRes(msg, ok) {
  const d = $('quizResult'); d.innerHTML = msg;
  d.className = ok ? 'result' : 'error'; d.classList.remove('hidden');
  if (ok) setTimeout(() => d.classList.add('hidden'), 5000);
}
function showErr(msg) {
  const e = $('quizError'); e.textContent = msg; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 2500);
}

function showHint() {
  if (hints >= MAX_H) return; hints++;
  $('hintInfo').textContent = `Hint: ${hints}/${MAX_H}`;
  if (hints >= MAX_H) $('hintBtn').disabled = true;
  const ap = ((parseInt(curAyat.page)-1)/20|0)+1;
  const s2 = curAyat.surah_name.split(' ').slice(0,2).join(' ');
  const e  = $('quizError');
  e.innerHTML = `💡 <b>Hint (-5🪙):</b> Surah: <b>${s2}...</b>, Para: <b>${ap}</b>`;
  e.classList.remove('hidden'); setTimeout(() => e.classList.add('hidden'), 3500);
}

function endQuiz() {
  if (qTmr) clearInterval(qTmr);
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  const avg  = timeArr.length ? Math.round(timeArr.reduce((a,b)=>a+b,0)/timeArr.length) : 0;
  const fast = timeArr.length ? Math.min(...timeArr) : 0;
  const acc  = sessionTotal > 0 ? Math.round((sessionCorrect/sessionTotal)*100) : 0;
  let best = '', mx = 0;
  Object.entries(surahC).forEach(([s,c]) => { if(c>mx){mx=c;best=s;} });
  const speedBadge = avg <= 8 ? '⚡ Speed Master' : avg <= 15 ? '🏃 Quick Player' : '📚 Careful Reader';
  $('finalResult').innerHTML = `
    <div class="result-grid">
      <div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${score}/${qIdx}</span><span class="ri-lbl">Score</span></div>
      <div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div>
      <div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div>
      <div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins||0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${best || '—'}</span><span class="ri-lbl">Best Surah</span></div>
    </div>
    <div class="speed-badge">${speedBadge}</div>
    <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${mode==='survival'&&!survOn ? '💥 Survival Khatam!' : '🎉 Mubarak!'}</div>`;
  showScreen('resultScreen');
}

function resetGame(home) {
  qIdx=0; score=0; usedI=[]; surahC={}; timeArr=[];
  hints=0; survOn=true; sessionCorrect=0; sessionTotal=0;
  if (qTmr) clearInterval(qTmr);
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
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
  if (!q) { rd.innerHTML = '<em>Kuch likhein...</em>'; return; }
  if (!quranData.length) { rd.innerHTML = '<em>Data load ho raha hai...</em>'; return; }
  const found = quranData.filter(a => rmD(a.text.toLowerCase()).includes(q) || rmD(a.surah_name.toLowerCase()).includes(q) || String(a.page) === q || String(((a.page-1)/20|0)+1) === q).slice(0, 30);
  if (!found.length) { rd.innerHTML = '<b>Koi result nahi mila.</b>'; return; }
  const hl = t => t.split(/(\s+)/).map(w => rmD(w.toLowerCase())===q ? `<mark>${w}</mark>` : w).join('');
  rd.innerHTML = found.map(r => {
    const ap = ((r.page-1)/20|0)+1;
    return `<div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank')"><b>Ayat:</b> ${hl(r.text)}<br><b>Surah:</b> ${hl(r.surah_name)} | <b>Page:</b> ${r.page} | <b>Para:</b> ${ap}<span style="float:right;color:#aad">🔗</span></div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  ONLINE MATCHMAKING
// ═══════════════════════════════════════════
const TABLES = {
  bronze:  { name: '🥉 Bronze',  fee: 500,  totalQ: 9,  firstTo: 5, winCoins: 1000 },
  silver:  { name: '🥈 Silver',  fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000 },
  gold:    { name: '🥇 Gold',    fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000 },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};

let matchState = {
  tableKey: null, matchId: null, myRole: null, // 'p1' or 'p2'
  opponentName: null, myScore: 0, oppScore: 0,
  matchQ: 0, matchAyat: null, answered: false,
  waitTimer: null, matchTimerInterval: null,
  listeners: []
};

function openOnlineLobby() {
  if (!curUser || curUser.isAnonymous) { toast('❌ Login karo pehle!', 'error'); showScreen('authScreen'); return; }
  const coins = curData?.coins || 0;
  const lobbyInfo = $('lobbyCoinsInfo');
  if (lobbyInfo) lobbyInfo.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()}`;

  // Check if 800 coins unlock hua
  const locked = $('onlineLocked'), grid = $('tablesGrid');
  if (coins < 800) {
    if (locked) locked.classList.remove('hidden');
    if (grid)   grid.style.opacity = '0.3';
    document.querySelectorAll('.tc-btn').forEach(b => b.disabled = true);
  } else {
    if (locked) locked.classList.add('hidden');
    if (grid)   grid.style.opacity = '1';
    // Disable tables player can't afford
    Object.entries(TABLES).forEach(([key, t]) => {
      const btn = $(`join${key.charAt(0).toUpperCase()+key.slice(1)}`);
      if (btn) btn.disabled = coins < t.fee;
    });
  }
  showScreen('onlineLobbyScreen');
}

async function joinTable(tableKey) {
  if (!curUser || !curData) return;
  const table  = TABLES[tableKey];
  const coins  = curData.coins || 0;
  if (coins < table.fee) { toast(`❌ ${table.fee}🪙 chahiye!`, 'error'); return; }

  // Deduct fee immediately
  curData.coins -= table.fee;
  updateHeader();
  await updateDoc(doc(db, 'users', curUser.uid), { coins: increment(-table.fee) });

  matchState.tableKey = tableKey;
  matchState.myScore  = 0;
  matchState.oppScore = 0;

  showScreen('matchWaitScreen');
  $('matchWaitInfo').textContent = table.name;

  // Start wait timer
  let waitSecs = 0;
  matchState.waitTimer = setInterval(() => {
    waitSecs++; const el = $('matchWaitTimer');
    if (el) el.textContent = `${waitSecs}s`;
  }, 1000);

  await findOrCreateMatch(tableKey);
}

async function findOrCreateMatch(tableKey) {
  const queueRef = ref(rtdb, `queues/${tableKey}`);
  const snap = await get(queueRef);

  if (snap.exists()) {
    // Opponent waiting — join as p2
    const qData = snap.val();
    const matchId = qData.matchId;
    await remove(queueRef);
    matchState.matchId    = matchId;
    matchState.myRole     = 'p2';
    matchState.opponentName = qData.username;
    // Start the match as p2
    await joinAsP2(matchId, tableKey);
  } else {
    // Create new match — wait as p1
    const matchId = push(ref(rtdb, `matches/${tableKey}`)).key;
    matchState.matchId = matchId;
    matchState.myRole  = 'p1';
    await set(queueRef, {
      matchId,
      uid:      curUser.uid,
      username: curData.username || 'Player',
      table:    tableKey,
      timestamp: Date.now()
    });
    // Set up match skeleton
    await set(ref(rtdb, `matches/${tableKey}/${matchId}`), {
      status: 'waiting',
      table:  tableKey,
      p1: { uid: curUser.uid, name: curData.username || 'Player', score: 0 },
      p2: { uid: null, name: null, score: 0 },
      currentQ: 0,
      ayatIndex: -1,
      createdAt: Date.now()
    });
    // Listen for p2 joining
    waitForOpponent(tableKey, matchId);
  }
}

function waitForOpponent(tableKey, matchId) {
  const matchRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const listener = onValue(matchRef, snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.status === 'active' && data.p2?.uid) {
      off(matchRef);
      matchState.opponentName = data.p2.name;
      startOnlineMatch(tableKey, matchId, data);
    }
  });
  matchState.listeners.push({ ref: matchRef, fn: listener });
}

async function joinAsP2(matchId, tableKey) {
  const matchRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const ayatIndex = Math.floor(Math.random() * quranData.length);
  await update(matchRef, {
    status: 'active',
    'p2/uid':  curUser.uid,
    'p2/name': curData.username || 'Player',
    'p2/score': 0,
    currentQ: 1,
    ayatIndex
  });
  const snap = await get(matchRef);
  startOnlineMatch(tableKey, matchId, snap.val());
}

function startOnlineMatch(tableKey, matchId, initialData) {
  clearInterval(matchState.waitTimer);
  matchState.matchQ = initialData.currentQ || 1;
  showScreen('onlineMatchScreen');

  const myName   = curData.username || 'Player';
  const oppName  = matchState.opponentName || 'Opponent';
  const isP1     = matchState.myRole === 'p1';

  $('myName').textContent  = myName;
  $('oppName').textContent = oppName;
  $('myScore').textContent  = 0;
  $('oppScore').textContent = 0;

  // Listen to match updates
  const matchRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const listener = onValue(matchRef, snap => {
    if (!snap.exists()) { handleMatchEnd(false, 'Match data mila nahi'); return; }
    const data = snap.val();
    const table = TABLES[tableKey];
    const myData  = isP1 ? data.p1 : data.p2;
    const oppData = isP1 ? data.p2 : data.p1;

    $('myScore').textContent  = myData.score  || 0;
    $('oppScore').textContent = oppData.score || 0;
    matchState.myScore  = myData.score  || 0;
    matchState.oppScore = oppData.score || 0;

    // Check win condition
    if (matchState.myScore >= table.firstTo) { handleMatchEnd(true); return; }
    if (matchState.oppScore >= table.firstTo) { handleMatchEnd(false); return; }
    if (data.currentQ > table.totalQ) { handleMatchEnd(matchState.myScore > matchState.oppScore); return; }

    // Load current question
    if (data.ayatIndex >= 0 && data.ayatIndex !== matchState.matchQ - 1) {
      matchState.matchQ = data.currentQ;
      loadMatchQuestion(data.ayatIndex, data.currentQ, table.totalQ);
    } else if (data.ayatIndex >= 0 && !matchState.matchAyat) {
      loadMatchQuestion(data.ayatIndex, data.currentQ, table.totalQ);
    }
  });
  matchState.listeners.push({ ref: matchRef, fn: listener });
}

function loadMatchQuestion(ayatIndex, qNum, total) {
  if (!quranData[ayatIndex]) return;
  matchState.matchAyat = quranData[ayatIndex];
  matchState.answered  = false;

  const cb = $('matchCheckBtn'); if (cb) cb.disabled = false;
  $('matchAnswerForm')?.reset();
  $('matchResult')?.classList.add('hidden');
  $('matchProgress').textContent = `Sawal ${qNum} / ${total}`;

  const el = $('matchAyatText');
  if (el) { el.textContent = ''; let i = 0; const go = () => { if (i < matchState.matchAyat.text.length) { el.textContent += matchState.matchAyat.text[i++]; setTimeout(go, 18); } }; go(); }

  // Timer bar
  startMatchTimer(30);
}

function startMatchTimer(sec) {
  if (matchState.matchTimerInterval) clearInterval(matchState.matchTimerInterval);
  let t = sec;
  const fill = $('matchTimerFill'), txt = $('matchTimer');
  if (fill) fill.style.width = '100%';
  if (txt)  txt.textContent = `${t}s`;
  matchState.matchTimerInterval = setInterval(() => {
    t--;
    if (fill) fill.style.width = `${(t/sec)*100}%`;
    if (txt)  txt.textContent  = `${t}s`;
    if (t <= 0) { clearInterval(matchState.matchTimerInterval); if (!matchState.answered) submitMatchAnswer(true); }
  }, 1000);
}

async function submitMatchAnswer(timeOut = false) {
  if (matchState.answered) return;
  matchState.answered = true;
  clearInterval(matchState.matchTimerInterval);

  const cb = $('matchCheckBtn'); if (cb) cb.disabled = true;

  if (timeOut) {
    showMatchResult('⏱️ Waqt khatam! Next question...', false);
    await nextMatchQuestion(); return;
  }

  const para = $('match_para')?.value.trim();
  const pip  = $('match_pip')?.value.trim();
  if (!para)  { matchState.answered = false; if (cb) cb.disabled = false; toast('❌ Para zaroori hai!', 'error'); return; }

  const ayat  = matchState.matchAyat;
  const pn    = parseInt(ayat.page);
  const ap    = ((pn-1)/20|0)+1;
  const aip   = ((pn-1)%20)+1;
  const pOk   = parseInt(para) === ap;
  const pipOk = pip ? parseInt(pip) === aip-1 : true;
  const correct = pOk && pipOk;

  if (correct) {
    // Update my score in RTDB
    const isP1 = matchState.myRole === 'p1';
    const scoreField = isP1 ? 'p1/score' : 'p2/score';
    const matchRef = ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`);
    const newScore = matchState.myScore + 1;
    await update(matchRef, { [scoreField]: newScore });
    showMatchResult('✅ Sahi! +1 point', true);
  } else {
    showMatchResult(`❌ Galat! Para: ${ap}, PiP: ${aip-1}`, false);
  }

  await nextMatchQuestion();
}

async function nextMatchQuestion() {
  await new Promise(r => setTimeout(r, 1500));
  const table  = TABLES[matchState.tableKey];
  const isP1   = matchState.myRole === 'p1';

  // Only p1 advances the question
  if (isP1) {
    const nextQNum = matchState.matchQ + 1;
    const ayatIndex = Math.floor(Math.random() * quranData.length);
    if (nextQNum > table.totalQ) return; // match will end via listener
    const matchRef = ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`);
    await update(matchRef, { currentQ: nextQNum, ayatIndex });
  }
}

function showMatchResult(msg, ok) {
  const el = $('matchResult');
  if (!el) return;
  el.textContent = msg;
  el.className   = ok ? 'result' : 'error';
  el.style.display = 'block';
  el.classList.remove('hidden');
}

function handleMatchEnd(won, reason = '') {
  // Cleanup listeners
  leaveMatchCleanup();

  const table = TABLES[matchState.tableKey];
  const icon  = won ? '🏆' : '😔';
  const title = won ? 'Jeet Gaye!' : 'Haare!';
  const coins = won ? table.winCoins : 0;

  $('matchResultIcon').textContent  = icon;
  $('matchResultTitle').textContent = title;
  $('matchResultScores').innerHTML  = `
    <div style="display:flex;justify-content:center;gap:30px;font-size:1.1rem;font-weight:700">
      <span style="color:var(--emerald)">Aap: ${matchState.myScore}</span>
      <span style="color:var(--text-muted)">VS</span>
      <span style="color:#ff9090">${matchState.opponentName || 'Opp'}: ${matchState.oppScore}</span>
    </div>`;
  $('matchResultCoins').innerHTML = won
    ? `<div style="color:var(--gold);font-size:1.2rem;font-weight:700">+${coins} 🪙 Jeet ki coins!</div>`
    : `<div style="color:var(--text-muted)">Koi coins nahi — agali baar!</div>`;

  if (won && coins > 0) {
    if (curData) curData.coins += coins;
    updateHeader();
    updateDoc(doc(db, 'users', curUser.uid), { coins: increment(coins), totalWins: increment(1) }).catch(() => {});
    toast(`🏆 Jeet Gaye! +${coins}🪙`, 'success', 4000);
  }

  // Clean up match from RTDB
  if (matchState.matchId && matchState.tableKey) {
    remove(ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`)).catch(() => {});
  }

  showScreen('matchResultScreen');
}

function leaveMatchCleanup() {
  clearInterval(matchState.waitTimer);
  clearInterval(matchState.matchTimerInterval);
  matchState.listeners.forEach(l => off(l.ref));
  matchState.listeners = [];
  // Remove from queue if waiting
  if (matchState.tableKey) {
    remove(ref(rtdb, `queues/${matchState.tableKey}`)).catch(() => {});
  }
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
on('forgotBtn',  'click', doForgot);

on('toggleLoginPw', 'click', function() {
  const i = $('loginPassword'); i.type = i.type==='password' ? 'text' : 'password';
  this.textContent = i.type==='password' ? '👁️' : '🙈';
});
on('toggleSignupPw', 'click', function() {
  const i = $('signupPassword'); i.type = i.type==='password' ? 'text' : 'password';
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
  if (sc.style.display==='none'||!sc.style.display) { sc.style.display='block'; btn.textContent='❌ Band Karein'; $('searchInput')?.focus(); }
  else { sc.style.display='none'; btn.textContent='🔎 Search'; }
});

on('guestToSignup', 'click', () => { $('guestModal').style.display='none'; showScreen('authScreen'); switchTab('signup'); });
on('guestContinue', 'click', () => { $('guestModal').style.display='none'; });

// Profile panel
on('profileBtn',     'click', openProfilePanel);
on('ppCloseBtn',     'click', closeProfilePanel);
on('profileOverlay', 'click', closeProfilePanel);
on('ppLogoutBtn',    'click', () => { closeProfilePanel(); doLogout(); });

// Language toggle
on('btnHinglish', 'click', () => applyLang('hinglish'));
on('btnEnglish',  'click', () => applyLang('english'));

// Online Match
on('goOnlineMatch',   'click', openOnlineLobby);
on('backFromLobby',   'click', () => showScreen('welcomeScreen'));
on('joinBronze',      'click', () => joinTable('bronze'));
on('joinSilver',      'click', () => joinTable('silver'));
on('joinGold',        'click', () => joinTable('gold'));
on('joinDiamond',     'click', () => joinTable('diamond'));
on('cancelMatchBtn',  'click', () => { leaveMatchCleanup(); showScreen('onlineLobbyScreen'); });
on('exitMatchBtn',    'click', () => { leaveMatchCleanup(); showScreen('welcomeScreen'); });
on('matchPlayAgainBtn','click',() => openOnlineLobby());
on('matchGoHomeBtn',  'click', () => showScreen('welcomeScreen'));
on('matchAnswerForm', 'submit', e => { e.preventDefault(); submitMatchAnswer(false); });

// UID Copy setup
setupUidCopy();

// Apply saved language
applyLang(currentLang);

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
loadQuran();
