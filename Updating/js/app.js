'use strict';

// ═══════════════════════════════════════════
//  FIREBASE IMPORTS
// ═══════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInAnonymously, GoogleAuthProvider,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, getDocs, collection, query, where,
  increment, serverTimestamp, onSnapshot, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase, ref, set, get, onValue, remove, update, push, off, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// ═══════════════════════════════════════════
//  FIREBASE INIT
// ═══════════════════════════════════════════
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
//  GLOBAL STATE
// ═══════════════════════════════════════════
let quranData = [], quranLoading = false;
let curUser = null, curData = null, guestN = 0;
let selAyats = [], curAyat = null;
let qIdx = 0, score = 0, totalQ = 10, mode = 'practice';
let usedI = [], surahC = {}, startT = 0, qTmr = null;
let timeArr = [], survOn = true, hints = 0;
let sessionCorrect = 0, sessionTotal = 0;
let _autoNextTmr = null;
let _userUnsub = null;
let _isConnected = false;
const MAX_H = 2;

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const $  = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id);
  if (sc) sc.classList.add('active');
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer'); if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn'); if (b) b.textContent = '🔎 Search';
  }
}

function toast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) { t = document.createElement('div'); t.id = '_toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = `toast toast-${type} toast-show`;
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => t.classList.remove('toast-show'), dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${type} show`;
}

function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.className = 'auth-msg'; m.textContent = '';
  });
}

function btnLoad(id, loading, orig) {
  const b = $(id); if (!b) return;
  b.disabled = loading;
  if (loading) { b._orig = b.textContent; b.textContent = '⏳'; }
  else b.textContent = orig || b._orig || b.textContent;
}

// ═══════════════════════════════════════════
//  LANGUAGE
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
//  COINS
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
  if (!curUser || curUser.isAnonymous) return;
  if (amount === 0 && correct === 0 && total === 0) return;
  try {
    const ref2   = doc(db, 'users', curUser.uid);
    const updates = { lastPlayed: serverTimestamp() };
    if (amount  > 0) updates.coins        = increment(amount);
    if (correct > 0) updates.totalCorrect = increment(correct);
    if (total   > 0) updates.totalGames   = increment(total);
    await updateDoc(ref2, updates);
    if ((correct > 0 || total > 0) && curData) {
      const newCorrect = (curData.totalCorrect || 0) + correct;
      const newTotal   = (curData.totalGames   || 0) + total;
      if (newTotal > 0) {
        const acc = Math.round((newCorrect / newTotal) * 100);
        updateDoc(ref2, { accuracy: acc }).catch(() => {});
      }
    }
  } catch(e) { console.warn('Coins save error:', e.message); }
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
  const s = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  s('ppUsername', curData.username || curUser.displayName || 'Player');
  s('ppRole', isHafiz ? '👑 Hafiz' : (curData.role === 'admin' ? '🛡️ Admin' : '🎮 Player'));
  s('ppCoins', (curData.coins || 0).toLocaleString());
  s('ppAccuracy', (curData.accuracy || 0) + '%');
  s('ppGames', curData.totalGames || 0);
  const uidEl = $('ppUidVal'); if (uidEl) uidEl.textContent = curUser.uid;
  const av = $('ppAvatarCircle'); if (av) av.textContent = isHafiz ? '👑' : '👤';
  const pb = $('profileBtnIcon'); if (pb) pb.textContent = isHafiz ? '👑' : '👤';
}

function setupUidCopy() {
  on('ppUidCopy', 'click', () => {
    const uid = curUser?.uid; if (!uid) return;
    const showCopied = () => {
      const el = $('ppUidCopied');
      if (el) { el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 2000); }
    };
    navigator.clipboard.writeText(uid).then(showCopied).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = uid; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      showCopied();
    });
  });
}

// ═══════════════════════════════════════════
//  HEADER
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
    const gl = $('guestLogoutPill'); if (gl) gl.style.display = 'none';
  } else if (curUser && curUser.isAnonymous) {
    if (profileBtn) profileBtn.classList.add('hidden');
    if (hdrCoins)   hdrCoins.classList.add('hidden');
    const gl = $('guestLogoutPill');
    if (gl) gl.style.display = 'flex';
  } else {
    if (profileBtn) profileBtn.classList.add('hidden');
    if (hdrCoins)   hdrCoins.classList.add('hidden');
    const gl = $('guestLogoutPill'); if (gl) gl.style.display = 'none';
  }
}

function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup'); if (!p) return;
  const wpName  = $('wpName');
  const wpCoins = $('wpCoins');
  if (wpName)  wpName.textContent  = isNew ? `Ahlan, ${name}! 🌙` : `Marhaba, ${name}! 🌙`;
  if (wpCoins) wpCoins.textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  setTimeout(() => p.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  FIRESTORE — SYNC & REALTIME LISTENER
// ═══════════════════════════════════════════
async function syncUser(uid, data) {
  try {
    const r2   = doc(db, 'users', uid);
    const snap = await getDoc(r2);
    if (!snap.exists()) {
      const nd = {
        uid,
        username:     data.username || 'Player',
        email:        data.email || '',
        coins:        500,
        xp:           0,
        level:        1,
        accuracy:     0,
        totalGames:   0,
        totalWins:    0,
        totalCorrect: 0,
        streak:       0,
        bestStreak:   0,
        avgSpeed:     0,
        fastestAnswer:0,
        lastLogin:    serverTimestamp(),
        createdAt:    serverTimestamp(),
        isHafiz:      false,
        role:         'user',
        avatar:       'default',
        onlineMode:   true, // all registered users can play online
        badges:       [],
        friends:      [],
        friendRequests: [],
        bookmarks:    []
      };
      await setDoc(r2, nd);
      curData = nd;
    } else {
      curData = snap.data();
      // Ensure onlineMode is true for all existing registered users
      if (!curData.onlineMode) {
        updateDoc(r2, { onlineMode: true, lastLogin: serverTimestamp() }).catch(() => {});
        curData.onlineMode = true;
      } else {
        updateDoc(r2, { lastLogin: serverTimestamp() }).catch(() => {});
      }
    }
    startUserListener(uid);
  } catch(e) { console.warn('Firestore syncUser:', e.code || e.message); }
}

function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
  _userUnsub = onSnapshot(doc(db, 'users', uid), snap => {
    if (snap.exists()) {
      curData = snap.data();
      updateHeader();
    }
  }, err => console.warn('UserListener error:', err.message));
}

function stopUserListener() {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
}

// ═══════════════════════════════════════════
//  FIREBASE ERROR MESSAGES
// ═══════════════════════════════════════════
function fbErr(code) {
  const map = {
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
  };
  return map[code] || `❌ Error: ${code}`;
}

// ═══════════════════════════════════════════
//  AUTH — TAB SWITCH
// ═══════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  const panel = $(`${tab}Panel`);
  if (panel) panel.classList.add('active');
  clearMsgs();
}

// ═══════════════════════════════════════════
//  AUTH — LOGIN
// ═══════════════════════════════════════════
async function doLogin() {
  clearMsgs();
  const emailEl = $('loginEmail');
  const pwEl    = $('loginPassword');
  if (!emailEl || !pwEl) return;
  const email = emailEl.value.trim();
  const pw    = pwEl.value;
  if (!email || !pw) { setMsg('loginMsg', '❌ Email aur password likhein!'); return; }
  btnLoad('loginBtn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await syncUser(cred.user.uid, {
      username: cred.user.displayName || email.split('@')[0],
      email:    cred.user.email
    });
    showScreen('welcomeScreen');
    toast('✅ Login ho gaye!', 'success');
    if (curData) showWelcomePopup(curData.username || 'Player', curData.coins || 0);
  } catch(e) {
    setMsg('loginMsg', fbErr(e.code));
    btnLoad('loginBtn', false, '🔐 Login');
  }
}

// ═══════════════════════════════════════════
//  AUTH — SIGNUP
// ═══════════════════════════════════════════
async function doSignup() {
  clearMsgs();
  const unEl  = $('signupUsername');
  const emEl  = $('signupEmail');
  const pwEl  = $('signupPassword');
  const cpwEl = $('signupConfirmPw');
  if (!unEl || !emEl || !pwEl || !cpwEl) return;
  const un  = unEl.value.trim();
  const em  = emEl.value.trim();
  const pw  = pwEl.value;
  const cpw = cpwEl.value;
  if (!un || !em || !pw || !cpw) { setMsg('signupMsg', '❌ Sab fields bharen!'); return; }
  if (un.length < 3 || un.length > 20 || !/^[a-zA-Z0-9_]+$/.test(un)) {
    setMsg('signupMsg', '❌ Username: 3-20 chars, letters/numbers/_ sirf.'); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    setMsg('signupMsg', '❌ Sahi email likhein.'); return;
  }
  if (pw.length < 6)  { setMsg('signupMsg', '❌ Password min 6 characters.'); return; }
  if (pw !== cpw)     { setMsg('signupMsg', '❌ Passwords match nahi!'); return; }
  btnLoad('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(cred.user, { displayName: un });
    await syncUser(cred.user.uid, { username: un, email: em });
    showScreen('welcomeScreen');
    showWelcomePopup(un, 500, true);
    toast('✅ Account ban gaya! 500🪙 mile!', 'success');
  } catch(e) {
    setMsg('signupMsg', fbErr(e.code));
    btnLoad('signupBtn', false, '📝 Account Banayein');
  }
}

// ═══════════════════════════════════════════
//  AUTH — GOOGLE
// ═══════════════════════════════════════════
async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => { const el = $(id); if (el) el.disabled = true; });
  try {
    const result = await signInWithPopup(auth, GP);
    const user   = result.user;
    const name   = user.displayName || user.email.split('@')[0];
    const isNew  = result._tokenResponse?.isNewUser || false;
    await syncUser(user.uid, { username: name, email: user.email });
    showScreen('welcomeScreen');
    showWelcomePopup(name, isNew ? 500 : (curData?.coins || 0), isNew);
    toast('✅ Google se login!', 'success');
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') setMsg('loginMsg', fbErr(e.code));
  }
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => { const el = $(id); if (el) el.disabled = false; });
}

// ═══════════════════════════════════════════
//  AUTH — GUEST
// ═══════════════════════════════════════════
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

// ═══════════════════════════════════════════
//  AUTH — LOGOUT
// ═══════════════════════════════════════════
async function doLogout() {
  leaveMatchCleanup(false);
  stopUserListener();
  await signOut(auth);
  curUser = null; curData = null;
  updateHeader();
  showScreen('authScreen');
  toast('👋 Phir aana!', 'info');
}

// ═══════════════════════════════════════════
//  AUTH — FORGOT PASSWORD
// ═══════════════════════════════════════════
async function doForgot() {
  const emEl = $('loginEmail'); if (!emEl) return;
  const em = emEl.value.trim();
  if (!em) { setMsg('loginMsg', '❌ Pehle email likhein!'); return; }
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg', '📧 Reset email bhej diya!', 'success');
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); }
}

// ═══════════════════════════════════════════
//  AUTH STATE OBSERVER
// ═══════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  curUser = user;
  if (user) {
    if (!user.isAnonymous) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) { curData = snap.data(); updateHeader(); }
      } catch(e) { console.warn('Auth state getDoc:', e.message); }
      startUserListener(user.uid);
    }
    if ($('authScreen')?.classList.contains('active')) {
      showScreen('welcomeScreen');
      if (curData) showWelcomePopup(curData.username || 'Player', curData.coins || 0);
    }
  } else {
    stopUserListener();
    curUser = null; curData = null;
    updateHeader();
    showScreen('authScreen');
  }
});

// ═══════════════════════════════════════════
//  RTDB CONNECTION MONITOR
// ═══════════════════════════════════════════
onValue(ref(rtdb, '.info/connected'), snap => {
  _isConnected = snap.val() === true;
});

// ═══════════════════════════════════════════
//  QURAN DATA — LAZY LOAD
// ═══════════════════════════════════════════
async function loadQuran() {
  if (quranData.length || quranLoading) return;
  quranLoading = true;
  try {
    quranData = await (await fetch('quran_full.json')).json();
    console.log('✅ Quran loaded:', quranData.length);
  } catch(e) {
    console.error('❌ Quran load fail:', e);
  } finally {
    quranLoading = false;
  }
}

// ═══════════════════════════════════════════
//  QUIZ — START
// ═══════════════════════════════════════════
async function startGame() {
  const er = $('selectError');
  if (er) er.classList.add('hidden');
  if (!quranData.length) {
    if (er) { er.textContent = '⏳ Data load ho raha hai...'; er.classList.remove('hidden'); }
    await loadQuran();
    if (!quranData.length) {
      if (er) { er.textContent = '❌ Quran data load nahi hua. Reload karein.'; er.classList.remove('hidden'); }
      return;
    }
    if (er) er.classList.add('hidden');
  }
  const fp = parseInt($('fromPara').value);
  const tp = parseInt($('toPara').value);
  if (isNaN(fp) || isNaN(tp) || fp < 1 || tp > 30 || fp > tp) {
    if (er) { er.textContent = '❌ Galat range!'; er.classList.remove('hidden'); } return;
  }
  selAyats = quranData.filter(a => { const p = ((a.page-1)/20|0)+1; return p >= fp && p <= tp; });
  if (!selAyats.length) {
    if (er) { er.textContent = '❌ Is range mein ayat nahi mile.'; er.classList.remove('hidden'); } return;
  }
  qIdx = 0; score = 0; usedI = []; surahC = {}; timeArr = [];
  hints = 0; survOn = true; sessionCorrect = 0; sessionTotal = 0;
  mode   = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  totalQ = mode === 'timed' ? 10 : 9999;
  const hb = $('hintBtn'); if (hb) hb.disabled = false;
  const hi = $('hintInfo'); if (hi) hi.textContent = `Hint: 0/${MAX_H}`;
  const sa = $('survivalAnswer'); if (sa) sa.classList.add('hidden');
  nextQ();
  showScreen('quizScreen');
}

// ═══════════════════════════════════════════
//  QUIZ — NEXT QUESTION
// ═══════════════════════════════════════════
function nextQ() {
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  const nb = $('nextBtn'); if (nb) { nb.textContent = '➡️ Agla Sawal'; nb.classList.add('hidden'); }
  ['quizError','quizResult','survivalAnswer'].forEach(id => $(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  const cb = $('checkBtn'); if (cb) cb.disabled = false;
  hints = 0;
  const hb = $('hintBtn');  if (hb) hb.disabled = false;
  const hi = $('hintInfo'); if (hi) hi.textContent = `Hint: 0/${MAX_H}`;
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
  else { const tm = $('timer'); if (tm) tm.textContent = ''; }
}

function updateQuizStats() {
  const acc = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  const sb = $('scoreBoard');
  if (sb) sb.innerHTML = `<span>Score: <b>${score}/${qIdx}</b></span><span style="margin:0 8px;color:var(--text-muted)">|</span><span>🎯 ${acc}%</span>`;
  const qp = $('quizProgress');
  if (qp) qp.textContent = mode === 'practice' ? `🎯 Practice — Sawal: ${qIdx}` : mode === 'survival' ? `💥 Survival — Sawal: ${qIdx}` : `⏱️ ${qIdx} / ${totalQ}`;
}

function typeText(text) {
  const el = $('ayatText'); if (!el) return;
  el.textContent = ''; let i = 0;
  const go = () => { if (i < text.length) { el.textContent += text[i++]; setTimeout(go, 20); } };
  go();
}

function startTimer(sec) {
  const el = $('timer'); if (!el) return;
  let t = sec;
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
      const nb = $('nextBtn'); if (nb) nb.classList.remove('hidden');
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

  const ts   = Math.round((Date.now() - startT) / 1000);
  const para = $('user_para')?.value.trim()           || '';
  const pip  = $('user_page_in_para')?.value.trim()   || '';
  const pg   = $('user_page')?.value.trim()           || '';
  const sur  = $('user_surah')?.value.trim().toLowerCase() || '';
  const rk   = $('user_ruku')?.value.trim()           || '';
  const ay   = $('user_ayat')?.value.trim()           || '';

  ['quizError','quizResult'].forEach(id => $(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer')?.classList.add('hidden');

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
  if (rk && curAyat.ruku_no !== undefined) { if (parseInt(rk) === curAyat.ruku_no) opt++; else parts.push(`❌ Ruku Galat! Sahi: ${curAyat.ruku_no}`); }
  if (ay && curAyat.ayat_no !== undefined) { if (parseInt(ay) === curAyat.ayat_no) opt++; else parts.push(`❌ Ayat No. Galat! Sahi: ${curAyat.ayat_no}`); }

  const ok = pOk && (pip ? pipOk : true);
  sessionTotal++;

  if (ok) {
    score++; sessionCorrect++;
    surahC[curAyat.surah_name] = (surahC[curAyat.surah_name] || 0) + 1;
    timeArr.push(ts);
    const earned = calcCoins(ts, opt, hints, mode === 'survival');
    const speedLabel = ts <= 5 ? '⚡ Super Fast!' : ts <= 10 ? '🏃 Fast!' : ts <= 20 ? '👍 Good' : '🐢 Slow';
    addCoinsToFirestore(earned, 1, 1);
    let msg = `✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span>`;
    msg += `<br><small style="color:var(--text-muted)">${speedLabel} (${ts}s)`;
    if (opt > 0) msg += ` | +${opt*5}🪙 optional`;
    if (hints > 0) msg += ` | -${hints*5}🪙 hint`;
    msg += `</small>`;
    showRes(msg, true);
    if (sessionCorrect % 10 === 0) {
      toast(`🔥 ${sessionCorrect} sahi! +50🪙 streak bonus!`, 'success', 3000);
      addCoinsToFirestore(50, 0, 0);
    }
  } else {
    if (sessionTotal > 0) addCoinsToFirestore(0, 0, 1);
    showRes(parts.join('<br>') || '❌ Galat!', false);
    if (mode === 'survival') {
      survOn = false;
      const sa = $('survivalAnswer');
      if (sa) {
        sa.innerHTML = `<b>Sahi Jawab:</b><br>Surah: <b>${curAyat.surah_name}</b> | Para: <b>${ap}</b> | Page: <b>${pn}</b> | PiP: <b>${aip-1}</b>`;
        sa.classList.remove('hidden');
      }
      setTimeout(endQuiz, 2200); return;
    }
  }

  $('nextBtn')?.classList.remove('hidden');
  updateQuizStats();
  hints = 0;
  startAutoNext();
}

function startAutoNext() {
  if (_autoNextTmr) clearInterval(_autoNextTmr);
  let cd = 5;
  const nb = $('nextBtn');
  if (nb) nb.textContent = `➡️ Agla Sawal (${cd}s)`;
  _autoNextTmr = setInterval(() => {
    cd--;
    if (nb) nb.textContent = cd > 0 ? `➡️ Agla Sawal (${cd}s)` : '➡️ Agla Sawal';
    if (cd <= 0) { clearInterval(_autoNextTmr); _autoNextTmr = null; nextQ(); }
  }, 1000);
}

function showRes(msg, ok) {
  const d = $('quizResult'); if (!d) return;
  d.innerHTML = msg;
  d.className = ok ? 'result' : 'error';
  d.classList.remove('hidden');
  if (ok) setTimeout(() => d.classList.add('hidden'), 5000);
}

function showErr(msg) {
  const e = $('quizError'); if (!e) return;
  e.textContent = msg; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 2500);
}

function showHint() {
  if (hints >= MAX_H) return; hints++;
  const hi = $('hintInfo'); if (hi) hi.textContent = `Hint: ${hints}/${MAX_H}`;
  const hb = $('hintBtn');  if (hb && hints >= MAX_H) hb.disabled = true;
  const ap = ((parseInt(curAyat.page)-1)/20|0)+1;
  const s2 = curAyat.surah_name.split(' ').slice(0,2).join(' ');
  const e  = $('quizError'); if (!e) return;
  e.innerHTML = `💡 <b>Hint (-5🪙):</b> Surah: <b>${s2}...</b>, Para: <b>${ap}</b>`;
  e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 3500);
}

function endQuiz() {
  if (qTmr) clearInterval(qTmr);
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  const avg  = timeArr.length ? Math.round(timeArr.reduce((a,b) => a+b, 0) / timeArr.length) : 0;
  const fast = timeArr.length ? Math.min(...timeArr) : 0;
  const acc  = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  let best = '', mx = 0;
  Object.entries(surahC).forEach(([s,c]) => { if (c > mx) { mx = c; best = s; } });
  const speedBadge = avg <= 8 ? '⚡ Speed Master' : avg <= 15 ? '🏃 Quick Player' : '📚 Careful Reader';
  const fr = $('finalResult');
  if (fr) fr.innerHTML = `
    <div class="result-grid">
      <div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${score}/${qIdx}</span><span class="ri-lbl">Score</span></div>
      <div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div>
      <div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div>
      <div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins||0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${best || '—'}</span><span class="ri-lbl">Best Surah</span></div>
    </div>
    <div class="speed-badge">${speedBadge}</div>
    <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${mode === 'survival' && !survOn ? '💥 Survival Khatam!' : '🎉 Mubarak!'}</div>`;
  showScreen('resultScreen');
}

function resetGame(home) {
  qIdx = 0; score = 0; usedI = []; surahC = {}; timeArr = [];
  hints = 0; survOn = true; sessionCorrect = 0; sessionTotal = 0;
  if (qTmr) clearInterval(qTmr);
  if (_autoNextTmr) { clearInterval(_autoNextTmr); _autoNextTmr = null; }
  const hb = $('hintBtn'); if (hb) hb.disabled = false;
  const hi = $('hintInfo'); if (hi) hi.textContent = `Hint: 0/${MAX_H}`;
  showScreen(home ? 'welcomeScreen' : 'paraSelectScreen');
}

// ═══════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════
function rmD(t) { return t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, ''); }

function doSearch(e) {
  if (e) e.preventDefault();
  const inp = $('searchInput'); if (!inp) return;
  const q  = rmD(inp.value.trim().toLowerCase());
  const rd = $('searchResults'); if (!rd) return;
  if (!q) { rd.innerHTML = '<em>Kuch likhein...</em>'; return; }
  if (!quranData.length) { rd.innerHTML = '<em>Data load ho raha hai...</em>'; return; }
  const found = quranData.filter(a =>
    rmD(a.text.toLowerCase()).includes(q) ||
    rmD(a.surah_name.toLowerCase()).includes(q) ||
    String(a.page) === q ||
    String(((a.page-1)/20|0)+1) === q
  ).slice(0, 30);
  if (!found.length) { rd.innerHTML = '<b>Koi result nahi mila.</b>'; return; }
  const hl = t => t.split(/(\s+)/).map(w => rmD(w.toLowerCase()) === q ? `<mark>${w}</mark>` : w).join('');
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
//  ONLINE MATCHMAKING
// ═══════════════════════════════════════════
const TABLES = {
  starter: { name: '🪵 Starter', fee: 200,  totalQ: 7,  firstTo: 4, winCoins: 400   },
  bronze:  { name: '🥉 Bronze',  fee: 500,  totalQ: 9,  firstTo: 5, winCoins: 1000  },
  silver:  { name: '🥈 Silver',  fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000  },
  gold:    { name: '🥇 Gold',    fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000  },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};

let matchState = {
  tableKey:           null,
  matchId:            null,
  myRole:             null,
  opponentName:       null,
  myScore:            0,
  oppScore:           0,
  matchQ:             0,
  matchAyat:          null,
  answered:           false,
  feeDeducted:        false,
  waitTimer:          null,
  matchTimerInterval: null,
  autoCancel:         null,
  listeners:          []
};

function openOnlineLobby() {
  // Guest users cannot play online — only registered users can
  if (!curUser || curUser.isAnonymous) {
    toast('❌ Online khelne ke liye login karo!', 'error');
    showScreen('authScreen'); return;
  }
  loadQuran(); // pre-load in background
  const coins = curData?.coins || 0;
  const lobbyInfo = $('lobbyCoinsInfo');
  if (lobbyInfo) lobbyInfo.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} — Koi bhi table chuniye!`;

  // No coin lock — just disable buttons for tables user can't afford
  const locked = $('onlineLocked'), grid = $('tablesGrid');
  if (locked) locked.classList.add('hidden');
  if (grid) grid.style.opacity = '1';

  // Enable/disable based on coins (can afford the fee)
  Object.entries(TABLES).forEach(([key, t]) => {
    const btnId = `join${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const btn = $(btnId);
    if (btn) {
      btn.disabled = coins < t.fee;
      btn.title = coins < t.fee ? `${t.fee}🪙 chahiye` : '';
    }
  });
  showScreen('onlineLobbyScreen');
}

async function joinTable(tableKey) {
  if (!curUser || !curData) return;
  if (!_isConnected) { toast('❌ Internet connection check karein!', 'error'); return; }
  const table = TABLES[tableKey];
  const coins = curData.coins || 0;
  if (coins < table.fee) { toast(`❌ ${table.fee}🪙 chahiye!`, 'error'); return; }

  await loadQuran(); // ensure data ready
  if (!quranData.length) { toast('❌ Quran data load nahi hua!', 'error'); return; }

  // Deduct fee upfront (refunded if no match found)
  try {
    await updateDoc(doc(db, 'users', curUser.uid), { coins: increment(-table.fee) });
  } catch(e) {
    toast('❌ Coins deduct mein error. Dobara try karein.', 'error'); return;
  }

  matchState.tableKey    = tableKey;
  matchState.myScore     = 0;
  matchState.oppScore    = 0;
  matchState.matchQ      = 0;
  matchState.matchAyat   = null;
  matchState.answered    = false;
  matchState.feeDeducted = true;

  showScreen('matchWaitScreen');
  const wi = $('matchWaitInfo'); if (wi) wi.textContent = table.name;

  const waitStart = Date.now();
  matchState.waitTimer = setInterval(() => {
    const el = $('matchWaitTimer');
    if (el) el.textContent = `${Math.floor((Date.now() - waitStart) / 1000)}s`;
  }, 500);

  await findOrCreateMatch(tableKey);
}

// ── runTransaction fixes race condition ──
async function findOrCreateMatch(tableKey) {
  const queueRef = ref(rtdb, `queues/${tableKey}`);
  let joinedAsP2    = false;
  let matchIdToJoin = null;
  let opponentData  = null;

  try {
    const txResult = await runTransaction(queueRef, currentData => {
      if (currentData === null) {
        // Empty queue → we are P1
        return {
          matchId:   '',
          uid:       curUser.uid,
          username:  curData.username || 'Player',
          table:     tableKey,
          timestamp: Date.now()
        };
      } else {
        // Someone waiting → we are P2
        // But make sure it's not ourselves (e.g. multiple tabs)
        if (currentData.uid === curUser.uid) {
          // Same user, treat as P1 (cancel old entry)
          return {
            matchId:   '',
            uid:       curUser.uid,
            username:  curData.username || 'Player',
            table:     tableKey,
            timestamp: Date.now()
          };
        }
        joinedAsP2    = true;
        matchIdToJoin = currentData.matchId;
        opponentData  = currentData;
        return; // abort transaction (don't modify queue)
      }
    });
  } catch(e) {
    console.error('Queue transaction error:', e);
    refundFee(tableKey);
    toast('❌ Matchmaking error. Dobara try karein.', 'error');
    showScreen('onlineLobbyScreen'); return;
  }

  if (joinedAsP2) {
    // ── P2 PATH ── Wait for P1 to write matchId
    let attempts = 0;
    while ((!matchIdToJoin || matchIdToJoin === '') && attempts < 20) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const snap = await get(queueRef);
        if (snap.exists()) {
          const mid = snap.val().matchId;
          if (mid && mid !== '') matchIdToJoin = mid;
        } else {
          // Queue was removed — P1 cancelled
          break;
        }
      } catch(e) {}
      attempts++;
    }
    if (!matchIdToJoin) {
      refundFee(tableKey);
      toast('❌ Match setup mein dikkat. Dobara try karein.', 'error');
      showScreen('onlineLobbyScreen'); return;
    }
    // Remove queue entry once P2 joins
    try { await remove(queueRef); } catch(e) {}
    matchState.matchId      = matchIdToJoin;
    matchState.myRole       = 'p2';
    matchState.opponentName = opponentData?.username || 'Player';
    await joinAsP2(matchIdToJoin, tableKey);

  } else {
    // ── P1 PATH ── Create match node, update queue with matchId
    let matchId;
    try {
      const newRef = push(ref(rtdb, `matches/${tableKey}`));
      matchId = newRef.key;
    } catch(e) {
      refundFee(tableKey);
      toast('❌ Match create error.', 'error');
      showScreen('onlineLobbyScreen'); return;
    }
    matchState.matchId = matchId;
    matchState.myRole  = 'p1';

    try {
      await set(ref(rtdb, `matches/${tableKey}/${matchId}`), {
        status:    'waiting',
        table:     tableKey,
        p1:        { uid: curUser.uid, name: curData.username || 'Player', score: 0 },
        p2:        { uid: null, name: null, score: 0 },
        currentQ:  0,
        ayatIndex: -1,
        createdAt: Date.now()
      });
      await update(queueRef, { matchId });
    } catch(e) {
      console.error('Match/queue write error:', e);
      refundFee(tableKey);
      toast('❌ Match create error. Dobara try karein.', 'error');
      showScreen('onlineLobbyScreen'); return;
    }

    waitForOpponent(tableKey, matchId);

    // Auto-cancel after 60s — refund fee
    matchState.autoCancel = setTimeout(async () => {
      try {
        const snap = await get(ref(rtdb, `matches/${tableKey}/${matchId}`));
        if (snap.exists() && snap.val().status === 'waiting') {
          leaveMatchCleanup(false);
          refundFee(tableKey);
          toast('⏰ Koi opponent nahi mila. Coins wapas mil gaye!', 'info', 4000);
          showScreen('onlineLobbyScreen');
        }
      } catch(e) {}
    }, 60000);
  }
}

async function refundFee(tableKey) {
  if (!matchState.feeDeducted || !curUser) return;
  const fee = TABLES[tableKey]?.fee || 0;
  if (fee <= 0) return;
  matchState.feeDeducted = false;
  await updateDoc(doc(db, 'users', curUser.uid), { coins: increment(fee) }).catch(() => {});
}

function waitForOpponent(tableKey, matchId) {
  const matchRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(matchRef, snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.status === 'active' && data.p2?.uid) {
      off(matchRef);
      matchState.opponentName = data.p2.name;
      startOnlineMatch(tableKey, matchId, data);
    }
  }, err => {
    console.warn('waitForOpponent error:', err);
  });
  matchState.listeners.push({ ref: matchRef, fn: unsub });
}

async function joinAsP2(matchId, tableKey) {
  if (!quranData.length) await loadQuran();
  const matchRef  = ref(rtdb, `matches/${tableKey}/${matchId}`);

  // Verify match exists and is still waiting
  let matchSnap;
  try {
    matchSnap = await get(matchRef);
  } catch(e) {
    refundFee(tableKey);
    toast('❌ Match data nahi mila.', 'error');
    showScreen('onlineLobbyScreen'); return;
  }

  if (!matchSnap.exists()) {
    refundFee(tableKey);
    toast('❌ Match nahi mila — shayad cancel ho gaya.', 'error');
    showScreen('onlineLobbyScreen'); return;
  }

  if (matchSnap.val().status !== 'waiting') {
    refundFee(tableKey);
    toast('❌ Match pehle se shuru ho gaya.', 'error');
    showScreen('onlineLobbyScreen'); return;
  }

  const ayatIndex = Math.floor(Math.random() * quranData.length);
  try {
    await update(matchRef, {
      status:     'active',
      'p2/uid':   curUser.uid,
      'p2/name':  curData.username || 'Player',
      'p2/score': 0,
      currentQ:   1,
      ayatIndex
    });
  } catch(e) {
    refundFee(tableKey);
    toast('❌ Match join error.', 'error');
    showScreen('onlineLobbyScreen'); return;
  }

  const snap = await get(matchRef);
  if (snap.exists()) {
    startOnlineMatch(tableKey, matchId, snap.val());
  }
}

function startOnlineMatch(tableKey, matchId, initialData) {
  clearInterval(matchState.waitTimer);
  clearTimeout(matchState.autoCancel);
  matchState.autoCancel  = null;
  matchState.feeDeducted = false;
  matchState.matchQ      = initialData.currentQ || 1;

  showScreen('onlineMatchScreen');

  const isP1 = matchState.myRole === 'p1';
  const n1 = $('myName'),  n2 = $('oppName');
  const s1 = $('myScore'), s2 = $('oppScore');
  if (n1) n1.textContent = curData.username || 'Player';
  if (n2) n2.textContent = matchState.opponentName || 'Opponent';
  if (s1) s1.textContent = 0;
  if (s2) s2.textContent = 0;

  // Load first question if we have ayatIndex
  if (initialData.ayatIndex >= 0 && initialData.currentQ > 0) {
    loadMatchQuestion(initialData.ayatIndex, initialData.currentQ, TABLES[tableKey].totalQ);
  }

  const matchRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  let prevQ = matchState.matchQ;
  const unsub = onValue(matchRef, snap => {
    if (!snap.exists()) { handleMatchEnd(false, 'Match data mila nahi'); return; }
    const data  = snap.val();
    const table = TABLES[tableKey];
    const myData  = isP1 ? data.p1 : data.p2;
    const oppData = isP1 ? data.p2 : data.p1;

    const ms1 = $('myScore'),  ms2 = $('oppScore');
    if (ms1) ms1.textContent = myData?.score  || 0;
    if (ms2) ms2.textContent = oppData?.score || 0;
    matchState.myScore  = myData?.score  || 0;
    matchState.oppScore = oppData?.score || 0;

    if (matchState.myScore  >= table.firstTo) { handleMatchEnd(true);  return; }
    if (matchState.oppScore >= table.firstTo) { handleMatchEnd(false); return; }
    if (data.currentQ > table.totalQ)         { handleMatchEnd(matchState.myScore > matchState.oppScore); return; }

    // Load new question only when currentQ changes
    if (data.ayatIndex >= 0 && data.currentQ > 0 && data.currentQ !== prevQ) {
      prevQ = data.currentQ;
      matchState.matchQ = data.currentQ;
      loadMatchQuestion(data.ayatIndex, data.currentQ, table.totalQ);
    }
  }, err => {
    console.warn('Match listener error:', err);
  });
  matchState.listeners.push({ ref: matchRef, fn: unsub });
}

function loadMatchQuestion(ayatIndex, qNum, total) {
  if (!quranData[ayatIndex]) return;
  matchState.matchAyat = quranData[ayatIndex];
  matchState.answered  = false;

  const cb = $('matchCheckBtn'); if (cb) cb.disabled = false;
  $('matchAnswerForm')?.reset();
  const mr = $('matchResult'); if (mr) mr.classList.add('hidden');
  const mp = $('matchProgress'); if (mp) mp.textContent = `Sawal ${qNum} / ${total}`;

  const el = $('matchAyatText');
  if (el) {
    el.textContent = ''; let i = 0;
    const go = () => {
      if (i < matchState.matchAyat.text.length) { el.textContent += matchState.matchAyat.text[i++]; setTimeout(go, 18); }
    };
    go();
  }
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
    if (t <= 0) {
      clearInterval(matchState.matchTimerInterval);
      if (!matchState.answered) submitMatchAnswer(true);
    }
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

  const para = $('match_para')?.value.trim() || '';
  const pip  = $('match_pip')?.value.trim()  || '';
  if (!para) {
    matchState.answered = false;
    if (cb) cb.disabled = false;
    toast('❌ Para zaroori hai!', 'error'); return;
  }

  const ayat  = matchState.matchAyat;
  const pn    = parseInt(ayat.page);
  const ap    = ((pn-1)/20|0)+1;
  const aip   = ((pn-1)%20)+1;
  const pOk   = parseInt(para) === ap;
  const pipOk = pip ? parseInt(pip) === aip-1 : true;

  if (pOk && pipOk) {
    const scoreField = matchState.myRole === 'p1' ? 'p1/score' : 'p2/score';
    const matchRef   = ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`);
    try {
      await update(matchRef, { [scoreField]: matchState.myScore + 1 });
    } catch(e) { console.warn('Score update error:', e); }
    showMatchResult('✅ Sahi! +1 point', true);
  } else {
    showMatchResult(`❌ Galat! Para: ${ap}, PiP: ${aip-1}`, false);
  }
  await nextMatchQuestion();
}

async function nextMatchQuestion() {
  await new Promise(r => setTimeout(r, 1500));
  if (matchState.myRole !== 'p1') return; // Only P1 advances questions
  const table    = TABLES[matchState.tableKey];
  const nextQNum = matchState.matchQ + 1;
  if (nextQNum > table.totalQ) return; // match will end via listener
  const matchRef  = ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`);
  const ayatIndex = Math.floor(Math.random() * quranData.length);
  try {
    await update(matchRef, { currentQ: nextQNum, ayatIndex });
  } catch(e) { console.warn('Next question update error:', e); }
}

function showMatchResult(msg, ok) {
  const el = $('matchResult'); if (!el) return;
  el.textContent   = msg;
  el.className     = ok ? 'result' : 'error';
  el.style.display = 'block';
  el.classList.remove('hidden');
}

function handleMatchEnd(won, reason = '') {
  leaveMatchCleanup(false);
  const table = TABLES[matchState.tableKey];
  const icon  = won ? '🏆' : '😔';
  const title = won ? 'Jeet Gaye!' : 'Haare!';
  const coins = won ? table.winCoins : 0;

  const ri = $('matchResultIcon');  if (ri) ri.textContent = icon;
  const rt = $('matchResultTitle'); if (rt) rt.textContent = title;
  const rs = $('matchResultScores');
  if (rs) rs.innerHTML = `
    <div style="display:flex;justify-content:center;gap:30px;font-size:1.1rem;font-weight:700">
      <span style="color:var(--emerald)">Aap: ${matchState.myScore}</span>
      <span style="color:var(--text-muted)">VS</span>
      <span style="color:#ff9090">${matchState.opponentName || 'Opp'}: ${matchState.oppScore}</span>
    </div>`;
  const rc = $('matchResultCoins');
  if (rc) rc.innerHTML = won
    ? `<div style="color:var(--gold);font-size:1.2rem;font-weight:700">+${coins} 🪙 Jeet ki coins!</div>`
    : `<div style="color:var(--text-muted)">Koi coins nahi — agali baar!</div>`;

  if (won && coins > 0 && curUser) {
    updateDoc(doc(db, 'users', curUser.uid), { coins: increment(coins), totalWins: increment(1) }).catch(() => {});
    toast(`🏆 Jeet Gaye! +${coins}🪙`, 'success', 4000);
  }

  if (matchState.matchId && matchState.tableKey) {
    remove(ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`)).catch(() => {});
  }
  showScreen('matchResultScreen');
}

function leaveMatchCleanup(doRefund = false) {
  clearInterval(matchState.waitTimer);
  clearInterval(matchState.matchTimerInterval);
  clearTimeout(matchState.autoCancel);
  matchState.autoCancel = null;
  matchState.listeners.forEach(l => {
    try { if (l && l.ref) off(l.ref); } catch(e) {}
  });
  matchState.listeners = [];
  if (matchState.tableKey) {
    // Remove from queue if we were waiting
    remove(ref(rtdb, `queues/${matchState.tableKey}`)).catch(() => {});
    // If P1 and match still in waiting state, remove match node
    if (matchState.matchId && matchState.myRole === 'p1') {
      remove(ref(rtdb, `matches/${matchState.tableKey}/${matchState.matchId}`)).catch(() => {});
    }
  }
  if (doRefund && matchState.feeDeducted && matchState.tableKey) {
    refundFee(matchState.tableKey);
  }
  matchState.feeDeducted = false;
}

// ═══════════════════════════════════════════
//  EXIT MATCH CONFIRM
// ═══════════════════════════════════════════
function showExitMatchModal() {
  const m = $('exitMatchModal');
  if (m) m.style.display = 'flex';
}
function hideExitMatchModal() {
  const m = $('exitMatchModal');
  if (m) m.style.display = 'none';
}

// ═══════════════════════════════════════════
//  HIDDEN TASBEEH
// ═══════════════════════════════════════════
let tasbeehClickCount = 0;
let tasbeehClickTimer = null;
let tasbeehCount = 0;
let tasbeehCurrentText = 'سُبْحَانَ اللَّهِ';

function setupHiddenTasbeeh() {
  const trigger = $('hiddenTasbeehTrigger');
  if (!trigger) return;

  trigger.addEventListener('click', () => {
    tasbeehClickCount++;
    clearTimeout(tasbeehClickTimer);
    // Reset if user stops clicking for 2 seconds
    tasbeehClickTimer = setTimeout(() => { tasbeehClickCount = 0; }, 2000);

    if (tasbeehClickCount >= 7) {
      tasbeehClickCount = 0;
      clearTimeout(tasbeehClickTimer);
      openTasbeeh();
    }
  });

  // Type buttons
  document.querySelectorAll('.tasbeeh-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tasbeeh-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tasbeehCurrentText = btn.dataset.text;
      const ta = $('tasbeehArabic');
      if (ta) ta.textContent = tasbeehCurrentText;
    });
  });

  on('tasbeehTap', 'click', () => {
    tasbeehCount++;
    const tc = $('tasbeehCount');
    if (tc) {
      tc.textContent = tasbeehCount;
      tc.classList.remove('tasbeeh-pulse');
      void tc.offsetWidth; // reflow
      tc.classList.add('tasbeeh-pulse');
    }
    // Vibrate on mobile
    if (navigator.vibrate) navigator.vibrate(30);
    // Milestone toasts
    if (tasbeehCount === 33)  toast('✨ 33 — SubhanAllah!', 'success', 2000);
    if (tasbeehCount === 99)  toast('🌟 99 — Alhamdulillah!', 'success', 2000);
    if (tasbeehCount === 100) toast('💯 100 — MashaAllah!', 'success', 2500);
  });

  on('tasbeehReset', 'click', () => {
    tasbeehCount = 0;
    const tc = $('tasbeehCount');
    if (tc) tc.textContent = '0';
  });

  on('tasbeehClose', 'click', closeTasbeeh);
}

function openTasbeeh() {
  const overlay = $('tasbeehOverlay');
  if (overlay) overlay.style.display = 'flex';
  const ta = $('tasbeehArabic');
  if (ta) ta.textContent = tasbeehCurrentText;
}

function closeTasbeeh() {
  const overlay = $('tasbeehOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ═══════════════════════════════════════════
//  FRIENDS SYSTEM
// ═══════════════════════════════════════════
async function openFriendsScreen() {
  if (!curUser || curUser.isAnonymous) {
    toast('❌ Login karo pehle!', 'error');
    showScreen('authScreen'); return;
  }
  showScreen('friendsScreen');
  await loadFriendsList();
}

async function loadFriendsList() {
  const listEl    = $('friendsList');
  const pendEl    = $('pendingList');
  const pendLabel = $('pendingLabel');
  if (!listEl) return;

  listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Loading...</div>';

  try {
    const snap = await getDoc(doc(db, 'users', curUser.uid));
    if (!snap.exists()) return;
    const data = snap.data();
    const friends = data.friends || [];
    const pendingIn = data.friendRequests || []; // UIDs who sent request to me

    // Render friends
    if (!friends.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Abhi koi dost nahi — UID se add karein!</div>';
    } else {
      const friendDocs = await Promise.all(friends.map(uid => getDoc(doc(db, 'users', uid)).catch(() => null)));
      listEl.innerHTML = friendDocs.map((fsnap, i) => {
        if (!fsnap || !fsnap.exists()) return '';
        const fd = fsnap.data();
        return `<div class="friend-card">
          <div class="friend-avatar">👤</div>
          <div class="friend-info">
            <div class="friend-name">${escHtml(fd.username || 'Player')}</div>
            <div class="friend-uid">🆔 ${fd.uid?.substring(0,12) || '—'}...</div>
          </div>
          <button class="friend-action-btn unfriend-btn" onclick="unfriendUser('${friends[i]}','${escHtml(fd.username || 'Player')}')">🗑️ Unfriend</button>
        </div>`;
      }).filter(Boolean).join('') || '<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px">Koi dost nahi</div>';
    }

    // Render pending requests
    if (!pendingIn.length) {
      if (pendEl) pendEl.innerHTML = '';
      if (pendLabel) pendLabel.style.display = 'none';
    } else {
      if (pendLabel) pendLabel.style.display = 'block';
      const pendDocs = await Promise.all(pendingIn.map(uid => getDoc(doc(db, 'users', uid)).catch(() => null)));
      if (pendEl) {
        pendEl.innerHTML = pendDocs.map((psnap, i) => {
          if (!psnap || !psnap.exists()) return '';
          const pd = psnap.data();
          return `<div class="friend-card">
            <div class="friend-avatar">👤</div>
            <div class="friend-info">
              <div class="friend-name">${escHtml(pd.username || 'Player')}</div>
              <div class="friend-uid">Friend request bheja</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="friend-action-btn accept-btn" onclick="acceptFriend('${pendingIn[i]}','${escHtml(pd.username || 'Player')}')">✅</button>
              <button class="friend-action-btn reject-btn" onclick="rejectFriend('${pendingIn[i]}')">❌</button>
            </div>
          </div>`;
        }).filter(Boolean).join('');
      }
    }
  } catch(e) {
    console.warn('loadFriendsList error:', e);
    listEl.innerHTML = '<div style="color:#ff9090;font-size:0.88rem;text-align:center;padding:16px">Error loading friends.</div>';
  }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function addFriend() {
  if (!curUser || curUser.isAnonymous) return;
  const input = $('friendUidInput');
  const msgEl = $('addFriendMsg');
  if (!input || !msgEl) return;
  const uid = input.value.trim();
  if (!uid) { setMsg('addFriendMsg', '❌ UID likhein!'); return; }
  if (uid === curUser.uid) { setMsg('addFriendMsg', '❌ Apni khud ki UID nahi add kar sakte!'); return; }

  setMsg('addFriendMsg', '⏳ Dhoondh raha hoon...', 'success');
  try {
    const targetSnap = await getDoc(doc(db, 'users', uid));
    if (!targetSnap.exists()) { setMsg('addFriendMsg', '❌ Koi user nahi mila is UID se.'); return; }
    const targetData = targetSnap.data();

    // Check if already friends
    const mySnap = await getDoc(doc(db, 'users', curUser.uid));
    const myData = mySnap.data();
    if ((myData.friends || []).includes(uid)) {
      setMsg('addFriendMsg', '✅ Pehle se dost hain!'); return;
    }
    // Send friend request to target user (add to their friendRequests)
    await updateDoc(doc(db, 'users', uid), { friendRequests: arrayUnion(curUser.uid) });
    setMsg('addFriendMsg', `✅ Friend request bhej diya: ${escHtml(targetData.username || 'Player')}!`, 'success');
    input.value = '';
  } catch(e) {
    console.warn('addFriend error:', e);
    setMsg('addFriendMsg', '❌ Error. Dobara koshish karein.');
  }
}

window.unfriendUser = async function(friendUid, name) {
  if (!curUser) return;
  if (!confirm(`${name} ko unfriend karein?`)) return;
  try {
    await updateDoc(doc(db, 'users', curUser.uid), { friends: arrayRemove(friendUid) });
    await updateDoc(doc(db, 'users', friendUid), { friends: arrayRemove(curUser.uid) });
    toast(`🗑️ ${name} ko unfriend kar diya.`, 'info');
    await loadFriendsList();
  } catch(e) { toast('❌ Unfriend error.', 'error'); }
};

window.acceptFriend = async function(fromUid, name) {
  if (!curUser) return;
  try {
    // Add each other as friends, remove from requests
    await updateDoc(doc(db, 'users', curUser.uid), {
      friends: arrayUnion(fromUid),
      friendRequests: arrayRemove(fromUid)
    });
    await updateDoc(doc(db, 'users', fromUid), {
      friends: arrayUnion(curUser.uid)
    });
    toast(`✅ ${name} aapka dost ban gaya!`, 'success');
    await loadFriendsList();
  } catch(e) { toast('❌ Accept error.', 'error'); }
};

window.rejectFriend = async function(fromUid) {
  if (!curUser) return;
  try {
    await updateDoc(doc(db, 'users', curUser.uid), { friendRequests: arrayRemove(fromUid) });
    toast('Request reject kar diya.', 'info');
    await loadFriendsList();
  } catch(e) { toast('❌ Reject error.', 'error'); }
};

// ═══════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════

// Auth tabs
on('tabLogin',  'click', () => switchTab('login'));
on('tabSignup', 'click', () => switchTab('signup'));

// Auth buttons
on('loginBtn',        'click', doLogin);
on('signupBtn',       'click', doSignup);
on('googleLoginBtn',  'click', doGoogle);
on('googleSignupBtn', 'click', doGoogle);
on('guestBtn',        'click', doGuest);
on('forgotBtn',       'click', doForgot);

// Password visibility toggles
on('toggleLoginPw', 'click', function() {
  const i = $('loginPassword'); if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
  this.textContent = i.type === 'password' ? '👁️' : '🙈';
});
on('toggleSignupPw', 'click', function() {
  const i = $('signupPassword'); if (!i) return;
  i.type = i.type === 'password' ? 'text' : 'password';
  this.textContent = i.type === 'password' ? '👁️' : '🙈';
});

// Enter key shortcuts
on('loginPassword',   'keydown', e => { if (e.key === 'Enter') doLogin(); });
on('signupConfirmPw', 'keydown', e => { if (e.key === 'Enter') doSignup(); });

// Navigation
on('goParaSelect',    'click', () => { loadQuran(); showScreen('paraSelectScreen'); });
on('backFromPara',    'click', () => showScreen('welcomeScreen'));
on('backFromQuiz',    'click', () => showScreen('welcomeScreen'));
on('backFromContact', 'click', () => showScreen(curUser && !curUser.isAnonymous ? 'welcomeScreen' : 'authScreen'));
on('goHomeBtn',       'click', () => resetGame(true));
on('playAgainBtn',    'click', () => resetGame(false));
on('nextBtn',         'click', nextQ);
on('hintBtn',         'click', showHint);

// Friends page
on('goFriends',       'click', openFriendsScreen);
on('backFromFriends', 'click', () => showScreen('welcomeScreen'));
on('addFriendBtn',    'click', addFriend);
on('friendUidInput',  'keydown', e => { if (e.key === 'Enter') addFriend(); });

// Forms
on('paraForm',    'submit', e => { e.preventDefault(); startGame(); });
on('answerForm',  'submit', e => { e.preventDefault(); checkAnswer(); });
on('searchForm',  'submit', doSearch);
on('searchInput', 'keydown', e => { if (e.key === 'Enter') doSearch(e); });
on('modeForm',    'change', () => {
  mode = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
});

// Search toggle
on('toggleSearchBtn', 'click', () => {
  const sc = $('searchContainer'), btn = $('toggleSearchBtn'); if (!sc || !btn) return;
  const vis = sc.style.display === 'block';
  sc.style.display = vis ? 'none' : 'block';
  btn.textContent  = vis ? '🔎 Search' : '❌ Band Karein';
  if (!vis) $('searchInput')?.focus();
});

// Guest modal
on('guestToSignup', 'click', () => {
  const gm = $('guestModal'); if (gm) gm.style.display = 'none';
  showScreen('authScreen'); switchTab('signup');
});
on('guestContinue', 'click', () => {
  const gm = $('guestModal'); if (gm) gm.style.display = 'none';
});

// Profile panel
on('profileBtn',     'click', openProfilePanel);
on('ppCloseBtn',     'click', closeProfilePanel);
on('profileOverlay', 'click', closeProfilePanel);
on('ppLogoutBtn',    'click', () => { closeProfilePanel(); doLogout(); });

// Contact from settings panel
on('ppContactBtn', 'click', () => { closeProfilePanel(); showScreen('contactScreen'); });

// Language
on('btnHinglish', 'click', () => applyLang('hinglish'));
on('btnEnglish',  'click', () => applyLang('english'));

// Online Match
on('goOnlineMatch',     'click', openOnlineLobby);
on('backFromLobby',     'click', () => showScreen('welcomeScreen'));
on('joinStarter',       'click', () => joinTable('starter'));
on('joinBronze',        'click', () => joinTable('bronze'));
on('joinSilver',        'click', () => joinTable('silver'));
on('joinGold',          'click', () => joinTable('gold'));
on('joinDiamond',       'click', () => joinTable('diamond'));
on('cancelMatchBtn',    'click', () => { leaveMatchCleanup(true);  showScreen('onlineLobbyScreen'); });

// Exit match with confirm dialog
on('exitMatchBtn', 'click', showExitMatchModal);
on('exitMatchCancel', 'click', hideExitMatchModal);
on('exitMatchConfirm', 'click', () => {
  hideExitMatchModal();
  leaveMatchCleanup(false);
  showScreen('welcomeScreen');
});

on('matchPlayAgainBtn', 'click', () => openOnlineLobby());
on('matchGoHomeBtn',    'click', () => showScreen('welcomeScreen'));
on('matchAnswerForm',   'submit', e => { e.preventDefault(); submitMatchAnswer(false); });

// UID Copy
setupUidCopy();

// Feedback button removed from home — now in settings panel
// (backFromContact still navigates back correctly)

// Guest logout event
document.addEventListener('guestLogout', () => { doLogout(); });

// Apply saved language on load
applyLang(currentLang);

// Setup hidden tasbeeh
setupHiddenTasbeeh();
