'use strict';

// ═══════════════════════════════════════════
//  ENVIRONMENT CONFIG
// ═══════════════════════════════════════════
const CONFIG = {
  FIREBASE_CONFIG: {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "quran-quiz-3ee30.firebaseapp.com",
    databaseURL: process.env.FIREBASE_DB_URL || "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "quran-quiz-3ee30",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "quran-quiz-3ee30.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_ID || "362662301719",
    appId: process.env.FIREBASE_APP_ID || "1:362662301719:web:e5fa7bd4adf633758e8c52",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-CVQTH5SS0X"
  },
  GUEST_QUESTION_LIMIT: 3,
  GRACE_PERIOD_SEC: 15,
  BOOT_FAILSAFE_MS: 8000,
  FIRESTORE_TIMEOUT_MS: 5000,
  MATCH_AUTO_CANCEL_MS: 60000,
  SUBMIT_COOLDOWN_MS: 500,
  TOKEN_BUCKET_RATE_LIMIT: 5,
  MAX_HINTS: 2,
  POOL_EXTRA: 20,
  BRUTE_FORCE_MAX_ATTEMPTS: 5,
  BRUTE_FORCE_TIMEOUT_MS: 300000
};

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
  getFirestore, doc, setDoc, getDoc, updateDoc,
  increment, serverTimestamp, onSnapshot,
  arrayUnion, arrayRemove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase, ref, set, get, onValue, remove, update, push, off,
  runTransaction as rtdbRunTransaction, onDisconnect as rtdbOnDisconnect
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// ═══════════════════════════════════════════
//  FIREBASE INIT
// ═══════════════════════════════════════════
const firebaseApp = initializeApp(CONFIG.FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);
const GP = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  MANAGERS
// ═══════════════════════════════════════════
class ListenerManager {
  constructor() { this.listeners = new Map(); }
  add(id, unsub) {
    if (this.listeners.has(id)) {
      try { this.listeners.get(id)?.(); } catch(e) {}
    }
    this.listeners.set(id, unsub);
  }
  remove(id) {
    const unsub = this.listeners.get(id);
    if (unsub) { try { unsub(); } catch(e) {} this.listeners.delete(id); }
  }
  removeAll() {
    this.listeners.forEach(unsub => { try { unsub(); } catch(e) {} });
    this.listeners.clear();
  }
}

class TimerManager {
  constructor() { this.timers = new Map(); this.intervals = new Map(); }
  setTimeout(id, callback, delay) {
    this.clearTimeout(id);
    const timer = setTimeout(() => {
      try { callback(); } catch(e) { console.error('Timer error:', e); }
      this.timers.delete(id);
    }, delay);
    this.timers.set(id, timer);
    return timer;
  }
  setInterval(id, callback, interval) {
    this.clearInterval(id);
    const timer = setInterval(() => {
      try { callback(); } catch(e) { console.error('Interval error:', e); }
    }, interval);
    this.intervals.set(id, timer);
    return timer;
  }
  clearTimeout(id) {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
  }
  clearInterval(id) {
    const timer = this.intervals.get(id);
    if (timer) { clearInterval(timer); this.intervals.delete(id); }
  }
  clearAll() {
    this.timers.forEach(t => clearTimeout(t));
    this.intervals.forEach(t => clearInterval(t));
    this.timers.clear();
    this.intervals.clear();
  }
}

class RateLimiter {
  constructor(maxRequests = 5, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    return false;
  }
}

class BruteForceProtection {
  constructor() { this.attempts = new Map(); }
  recordAttempt(email) {
    const key = email.toLowerCase();
    if (!this.attempts.has(key)) this.attempts.set(key, []);
    const list = this.attempts.get(key);
    list.push(Date.now());
    const cutoff = Date.now() - CONFIG.BRUTE_FORCE_TIMEOUT_MS;
    this.attempts.set(key, list.filter(t => t > cutoff));
  }
  isBlocked(email) {
    const key = email.toLowerCase();
    if (!this.attempts.has(key)) return false;
    const list = this.attempts.get(key);
    const cutoff = Date.now() - CONFIG.BRUTE_FORCE_TIMEOUT_MS;
    const recentAttempts = list.filter(t => t > cutoff);
    return recentAttempts.length >= CONFIG.BRUTE_FORCE_MAX_ATTEMPTS;
  }
  getBlockRemainingMs(email) {
    const key = email.toLowerCase();
    if (!this.attempts.has(key)) return 0;
    const list = this.attempts.get(key);
    if (list.length === 0) return 0;
    const oldestAttempt = list[0];
    const elapsed = Date.now() - oldestAttempt;
    const remaining = CONFIG.BRUTE_FORCE_TIMEOUT_MS - elapsed;
    return Math.max(0, remaining);
  }
  reset(email) { this.attempts.delete(email.toLowerCase()); }
}

// ═══════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════
let quranData = [], quranLoading = false;
let curUser = null, curData = null;
let guestN = 0, _guestQuestionsAnswered = 0;
let selAyats = [], curAyat = null;
let qIdx = 0, score = 0, totalQ = 10, mode = 'practice';
let usedI = [], surahC = {}, startT = 0;
let timeArr = [], survOn = true, hints = 0;
let sessionCorrect = 0, sessionTotal = 0;

const timerManager = new TimerManager();
const listenerManager = new ListenerManager();
const coinRateLimiter = new RateLimiter(5, 60000);
const bruteForceProtection = new BruteForceProtection();

let _userUnsub = null, _isConnected = false;
let _authResolved = false;
let _lastSubmitTime = 0;

// MATCH STATE
const TABLES = {
  starter: { name: '🪵 Starter', fee: 200, totalQ: 7, firstTo: 4, winCoins: 400 },
  bronze: { name: '🥉 Bronze', fee: 500, totalQ: 9, firstTo: 5, winCoins: 1000 },
  silver: { name: '🥈 Silver', fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000 },
  gold: { name: '🥇 Gold', fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000 },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};

function freshMatchState() {
  return {
    tableKey: null, matchId: null, myRole: null,
    opponentName: null,
    myScore: 0, oppScore: 0,
    myQIdx: 0, currentAyatIndex: -1,
    answered: false, feeDeducted: false,
    inSuddenDeath: false, _ended: false,
    _refunding: false,
    listeners: new ListenerManager(),
    timers: new TimerManager(),
    disconnectGraceTimer: null,
  };
}

let MS = freshMatchState();
let _joining = false;

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => {
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
};

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id);
  if (sc) {
    sc.classList.add('active');
    window.scrollTo(0, 0);
    if (isMobile()) {
      setTimeout(() => { document.activeElement?.blur?.(); }, 100);
    }
  }
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer');
    if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn');
    if (b) b.textContent = '🔎 Search';
  }
}

function toast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = `position:fixed;bottom:20px;left:10px;right:10px;z-index:99999;max-width:500px;margin:0 auto;padding:12px 16px;background:var(--bg-card);border-radius:12px;font-size:14px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.3);font-family:Tajawal,sans-serif;`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast toast-${type} toast-show`;
  if (t._tmr) clearTimeout(t._tmr);
  t._tmr = timerManager.setTimeout(`toast_${Date.now()}`, () => {
    t.classList.remove('toast-show');
  }, dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${type} show`;
  if (isMobile()) {
    setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  }
}

function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.className = 'auth-msg';
    m.textContent = '';
  });
}

function btnLoad(id, loading, orig) {
  const b = $(id);
  if (!b) return;
  b.disabled = loading;
  if (loading) {
    b._orig = b.textContent;
    b.textContent = '⏳';
    b.style.pointerEvents = 'none';
    b.style.opacity = '0.6';
  } else {
    b.textContent = orig || b._orig || b.textContent;
    b.style.pointerEvents = 'auto';
    b.style.opacity = '1';
  }
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isValidUsername(username) { return username && username.length >= 3 && username.length <= 20 && /^[a-zA-Z0-9_]+$/.test(username); }
function isValidPassword(password) { return password && password.length >= 6; }
function isValidParaRange(from, to) { return !isNaN(from) && !isNaN(to) && from >= 1 && to <= 30 && from <= to; }

// ═══════════════════════════════════════════
//  BOOT LOADER
// ═══════════════════════════════════════════
function hideBootLoader(force = false) {
  if (_authResolved && !force) return;
  _authResolved = true;
  const bl = $('bootLoader');
  if (!bl) return;
  bl.style.transition = 'opacity 0.45s ease';
  bl.style.opacity = '0';
  timerManager.setTimeout('bootHide', () => { bl.style.display = 'none'; }, 480);
}

const _bootFailsafeId = `bootFailsafe_${Date.now()}`;
timerManager.setTimeout(_bootFailsafeId, () => {
  if (!_authResolved) {
    console.warn('⚠️ Boot failsafe triggered');
    hideBootLoader(true);
    showScreen('authScreen');
    toast('⚠️ Connection slow — dobara try karein', 'error', 5000);
  }
}, CONFIG.BOOT_FAILSAFE_MS);

// ═══════════════════════════════════════════
//  LANGUAGE
// ═══════════════════════════════════════════
let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
function applyLang(lang) {
  if (!['hinglish', 'english'].includes(lang)) return;
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
  timeSpent = Math.max(0, Math.min(300, parseInt(timeSpent) || 0));
  optCorrect = Math.max(0, parseInt(optCorrect) || 0);
  hintsUsed = Math.max(0, Math.min(CONFIG.MAX_HINTS, parseInt(hintsUsed) || 0));
  let c = timeSpent <= 5 ? 15 : timeSpent <= 10 ? 12 : timeSpent <= 15 ? 10 : timeSpent <= 20 ? 8 : timeSpent <= 30 ? 6 : 5;
  c += optCorrect * 5;
  c -= hintsUsed * 5;
  if (isSurvival) c += 20;
  return Math.max(0, Math.min(500, c));
}

async function addCoinsToFirestore(amount, correct, total) {
  if (!curUser || curUser.isAnonymous) return;
  if (!amount && !correct && !total) return;
  if (!coinRateLimiter.canMakeRequest()) return;

  try {
    const userRef = doc(db, 'users', curUser.uid);
    const upd = { lastPlayed: serverTimestamp() };
    if (amount > 0) upd.coins = increment(Math.max(0, amount));
    if (correct > 0) upd.totalCorrect = increment(correct);
    if (total > 0) upd.totalGames = increment(total);
    await updateDoc(userRef, upd);
    if ((correct > 0 || total > 0) && curData) {
      const nc = (curData.totalCorrect || 0) + correct;
      const nt = (curData.totalGames || 0) + total;
      if (nt > 0) {
        const accuracy = Math.round((nc / nt) * 100);
        updateDoc(userRef, { accuracy }).catch(() => {});
      }
    }
  } catch(e) {
    console.error('Coins save error:', e.message);
  }
}

// ═══════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════
function openProfilePanel() {
  if (curUser && !curUser.isAnonymous) {
    getDoc(doc(db, 'users', curUser.uid))
      .then(snap => {
        if (snap.exists()) {
          curData = snap.data();
          refreshProfilePanel();
        }
      })
      .catch(e => console.warn('Profile refresh error:', e));
  }
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
  const s = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  s('ppUsername', esc(curData.username || curUser.displayName || 'Player'));
  s('ppRole', isHafiz ? '👑 Hafiz' : curData.role === 'admin' ? '🛡️ Admin' : '🎮 Player');
  s('ppCoins', (curData.coins || 0).toLocaleString());
  s('ppAccuracy', (curData.accuracy || 0) + '%');
  s('ppGames', curData.totalGames || 0);
  const uidEl = $('ppUidVal'); if (uidEl) uidEl.textContent = curUser.uid;
  const av = $('ppAvatarCircle'); if (av) av.textContent = isHafiz ? '👑' : '👤';
  const pb = $('profileBtnIcon'); if (pb) pb.textContent = isHafiz ? '👑' : '👤';
}

function setupUidCopy() {
  on('ppUidCopy', 'click', () => {
    const uid = curUser?.uid;
    if (!uid) return;
    const done = () => {
      const el = $('ppUidCopied');
      if (el) {
        el.classList.remove('hidden');
        timerManager.setTimeout('uidCopyHide', () => { el.classList.add('hidden'); }, 2000);
      }
    };
    navigator.clipboard.writeText(uid)
      .then(done)
      .catch(() => {
        const ta = document.createElement('textarea');
        ta.value = uid;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      });
  });
}

// ═══════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════
function updateHeader() {
  const pb = $('profileBtn'), hc = $('hdrCoins'), hv = $('hdrCoinsVal'), gl = $('guestLogoutPill');
  if (curUser && !curUser.isAnonymous) {
    pb?.classList.remove('hidden');
    hc?.classList.remove('hidden');
    if (hv) hv.textContent = (curData?.coins || 0).toLocaleString();
    if (gl) gl.style.display = 'none';
    refreshProfilePanel();
  } else if (curUser?.isAnonymous) {
    pb?.classList.add('hidden');
    hc?.classList.add('hidden');
    if (gl) gl.style.display = 'flex';
  } else {
    pb?.classList.add('hidden');
    hc?.classList.add('hidden');
    if (gl) gl.style.display = 'none';
  }
}

function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup');
  if (!p) return;
  const wn = $('wpName'), wc = $('wpCoins');
  if (wn) wn.textContent = isNew ? `Ahlan, ${esc(name)}! 🌙` : `Marhaba, ${esc(name)}! 🌙`;
  if (wc) wc.textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  timerManager.setTimeout('welcomePopupHide', () => { p.classList.remove('show'); }, 4000);
}

// ���══════════════════════════════════════════
//  FIRESTORE
// ═══════════════════════════════════════════
async function syncUser(uid, data) {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(userRef);
        if (existing.exists()) return;
        const newData = {
          uid, username: data.username || 'Player', email: data.email || '',
          coins: 500, xp: 0, level: 1, accuracy: 0, totalGames: 0, totalWins: 0,
          totalCorrect: 0, streak: 0, bestStreak: 0, avgSpeed: 0, fastestAnswer: 0,
          lastLogin: serverTimestamp(), createdAt: serverTimestamp(),
          isHafiz: false, role: 'user', avatar: 'default', onlineMode: true,
          badges: [], friends: [], friendRequests: [], bookmarks: []
        };
        tx.set(userRef, newData);
        curData = newData;
      });
    } else {
      curData = snap.data();
      const upd = { lastLogin: serverTimestamp() };
      if (!curData.onlineMode) { upd.onlineMode = true; curData.onlineMode = true; }
      if (!curData.friendRequests) { upd.friendRequests = []; }
      if (!curData.friends) { upd.friends = []; }
      updateDoc(userRef, upd).catch(() => {});
    }
    startUserListener(uid);
  } catch(e) {
    console.error('syncUser error:', e.code || e.message);
  }
}

function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
  _userUnsub = onSnapshot(
    doc(db, 'users', uid),
    snap => { if (snap.exists()) { curData = snap.data(); updateHeader(); } },
    err => console.warn('UserListener error:', err.message)
  );
}

function stopUserListener() {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
}

// ═══════════════════════════════════════════
//  AUTH ERRORS
// ═══════════════════════════════════════════
function fbErr(code) {
  const m = {
    'auth/email-already-in-use': '❌ Email pehle se registered hai.',
    'auth/invalid-email': '❌ Sahi email likhein.',
    'auth/user-not-found': '❌ Email registered nahi.',
    'auth/wrong-password': '❌ Password galat hai.',
    'auth/invalid-credential': '❌ Email ya password galat hai.',
    'auth/weak-password': '❌ Password min 6 chars chahiye.',
    'auth/too-many-requests': '❌ Zyada try — baad mein koshish karein.',
    'auth/network-request-failed': '❌ Internet check karein.',
    'auth/popup-blocked': '❌ Popup block — allow karein.',
  };
  return m[code] || `❌ Error: ${code}`;
}

// ═══════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════
function switchTab(tab) {
  if (!['login', 'signup'].includes(tab)) return;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  const panel = $(`${tab}Panel`);
  if (panel) panel.classList.add('active');
  clearMsgs();
  if (isMobile()) {
    setTimeout(() => {
      const firstInput = panel?.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 200);
  }
}

async function doLogin() {
  clearMsgs();
  const emailEl = $('loginEmail');
  const pwEl = $('loginPassword');
  if (!emailEl || !pwEl) {
    console.error('Login form elements not found');
    setMsg('loginMsg', '❌ Form error - refresh page');
    return;
  }
  const email = emailEl.value.trim();
  const pw = pwEl.value;

  if (!email || !pw) {
    setMsg('loginMsg', '❌ Email aur password likhein!');
    return;
  }
  if (!isValidEmail(email)) {
    setMsg('loginMsg', '❌ Sahi email likhein.');
    return;
  }
  if (!isValidPassword(pw)) {
    setMsg('loginMsg', '❌ Password min 6 chars.');
    return;
  }

  if (bruteForceProtection.isBlocked(email)) {
    const remainingMs = bruteForceProtection.getBlockRemainingMs(email);
    const remainingSec = Math.ceil(remainingMs / 1000);
    setMsg('loginMsg', `❌ Zyada attempts — ${remainingSec}s wait karein.`);
    return;
  }

  btnLoad('loginBtn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await syncUser(cred.user.uid, {
      username: cred.user.displayName || email.split('@')[0],
      email: cred.user.email
    });
    emailEl.value = '';
    pwEl.value = '';
    bruteForceProtection.reset(email);
    showScreen('welcomeScreen');
    toast('✅ Login ho gaye!', 'success');
    if (curData) {
      showWelcomePopup(curData.username || 'Player', curData.coins || 0);
    }
  } catch(e) {
    console.error('Login error:', e.code);
    bruteForceProtection.recordAttempt(email);
    const errorMsg = fbErr(e.code);
    setMsg('loginMsg', errorMsg);
    if (bruteForceProtection.isBlocked(email)) {
      const remainingMs = bruteForceProtection.getBlockRemainingMs(email);
      const remainingSec = Math.ceil(remainingMs / 1000);
      setMsg('loginMsg', `${errorMsg}\n⏱️ ${remainingSec}s ruko...`);
    }
    btnLoad('loginBtn', false, '🔐 Login');
  }
}

async function doSignup() {
  clearMsgs();
  const unEl = $('signupUsername');
  const emEl = $('signupEmail');
  const pwEl = $('signupPassword');
  const cpwEl = $('signupConfirmPw');
  if (!unEl || !emEl || !pwEl || !cpwEl) {
    console.error('Signup form elements not found');
    setMsg('signupMsg', '❌ Form error - refresh page');
    return;
  }
  const un = unEl.value.trim();
  const em = emEl.value.trim();
  const pw = pwEl.value;
  const cpw = cpwEl.value;

  if (!un || !em || !pw || !cpw) {
    setMsg('signupMsg', '❌ Sab fields bharen!');
    return;
  }
  if (!isValidUsername(un)) {
    setMsg('signupMsg', '❌ Username: 3-20 chars, letters/numbers/_ sirf.');
    return;
  }
  if (!isValidEmail(em)) {
    setMsg('signupMsg', '❌ Sahi email likhein.');
    return;
  }
  if (!isValidPassword(pw)) {
    setMsg('signupMsg', '❌ Password min 6 chars.');
    return;
  }
  if (pw !== cpw) {
    setMsg('signupMsg', '❌ Passwords match nahi!');
    return;
  }

  btnLoad('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(cred.user, { displayName: un });
    await syncUser(cred.user.uid, { username: un, email: em });
    unEl.value = '';
    emEl.value = '';
    pwEl.value = '';
    cpwEl.value = '';
    showScreen('welcomeScreen');
    showWelcomePopup(un, 500, true);
    toast('✅ Account ban gaya! 500🪙 mile!', 'success');
  } catch(e) {
    console.error('Signup error:', e.code);
    const errorMsg = fbErr(e.code);
    setMsg('signupMsg', errorMsg);
    btnLoad('signupBtn', false, '📝 Account Banayein');
  }
}

async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => {
    const el = $(id);
    if (el) {
      el.disabled = true;
      btnLoad(id, true);
    }
  });
  try {
    const result = await signInWithPopup(auth, GP);
    const user = result.user;
    const name = user.displayName || user.email.split('@')[0];
    const isNew = result._tokenResponse?.isNewUser || false;
    await syncUser(user.uid, { username: name, email: user.email });
    showScreen('welcomeScreen');
    showWelcomePopup(name, isNew ? 500 : (curData?.coins || 0), isNew);
    toast('✅ Google se login!', 'success');
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      setMsg('loginMsg', fbErr(e.code));
    }
  }
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => {
    const el = $(id);
    if (el) {
      el.disabled = false;
      btnLoad(id, false);
    }
  });
}

async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth);
    guestN = 0;
    _guestQuestionsAnswered = 0;
    showScreen('welcomeScreen');
    toast('👤 Guest mode — 3 sawaal free!', 'info', 4000);
  } catch(e) {
    setMsg('loginMsg', fbErr(e.code));
    btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)');
  }
}

async function doLogout() {
  leaveMatchCleanup(false);
  stopUserListener();
  listenerManager.removeAll();
  timerManager.clearAll();
  await signOut(auth);
  curUser = null;
  curData = null;
  bruteForceProtection.attempts = new Map();
  updateHeader();
  showScreen('authScreen');
  toast('👋 Phir aana!', 'info');
}

async function doForgot() {
  const em = $('loginEmail')?.value.trim();
  if (!em) {
    setMsg('loginMsg', '❌ Pehle email likhein!');
    return;
  }
  if (!isValidEmail(em)) {
    setMsg('loginMsg', '❌ Sahi email likhein.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg', '📧 Reset email bhej diya!', 'success');
    timerManager.setTimeout('resetMsg', () => {
      const msg = $('loginMsg');
      if (msg) msg.className = 'auth-msg';
    }, 5000);
  } catch(e) {
    setMsg('loginMsg', fbErr(e.code));
  }
}

// ─── Auth State ────────────────────
onAuthStateChanged(auth, async user => {
  curUser = user;
  if (user) {
    if (!user.isAnonymous) {
      try {
        const snap = await Promise.race([
          getDoc(doc(db, 'users', user.uid)),
          new Promise((_, rej) => timerManager.setTimeout('firestoreTimeout', () => {
            rej(new Error('Firestore timeout'));
          }, CONFIG.FIRESTORE_TIMEOUT_MS))
        ]);
        if (snap.exists()) {
          curData = snap.data();
          updateHeader();
        }
      } catch(e) {
        console.warn('User data load skip:', e.message);
      }
      startUserListener(user.uid);
    }
    updateHeader();
    showScreen('welcomeScreen');
    if (!_authResolved && curData) {
      showWelcomePopup(curData.username || 'Player', curData.coins || 0);
    } else if (!_authResolved && !user.isAnonymous && !curData) {
      timerManager.setTimeout('welcomePopupDelay', () => {
        if (curData) showWelcomePopup(curData.username || 'Player', curData.coins || 0);
      }, 1500);
    }
  } else {
    stopUserListener();
    curUser = null;
    curData = null;
    updateHeader();
    showScreen('authScreen');
  }
  timerManager.clearTimeout(_bootFailsafeId);
  hideBootLoader();
});

onValue(ref(rtdb, '.info/connected'), snap => {
  _isConnected = snap.val() === true;
});

// ═══════════════════════════════════════════
//  QURAN DATA
// ═══════════════════════════════════════════
async function loadQuran(retries = 0, maxRetries = 3) {
  if (quranData.length || quranLoading) return;
  quranLoading = true;
  try {
    const response = await fetch('quran_full.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    quranData = await response.json();
    if (!Array.isArray(quranData) || quranData.length === 0) {
      throw new Error('Invalid Quran data format');
    }
    console.log('✅ Quran loaded:', quranData.length, 'ayats');
  } catch(e) {
    console.error('❌ Quran load fail:', e.message);
    if (retries < maxRetries) {
      const delay = Math.pow(2, retries) * 2000;
      quranLoading = false;
      await sleep(delay);
      return loadQuran(retries + 1, maxRetries);
    }
    quranData = [];
    toast('❌ Quran data load fail', 'error', 5000);
  } finally {
    quranLoading = false;
  }
}

// ═══════════════════════════════════════════
//  QUIZ
// ═══════════════════════════════════════════
async function startGame() {
  const er = $('selectError');
  if (er) er.classList.add('hidden');
  if (curUser?.isAnonymous && _guestQuestionsAnswered >= CONFIG.GUEST_QUESTION_LIMIT) {
    if (er) {
      er.textContent = '❌ 3 free questions khatam! Account banao!';
      er.classList.remove('hidden');
    }
    toast('👤 Upgrade karo aur unlimited khelo!', 'info', 4000);
    showScreen('authScreen');
    switchTab('signup');
    return;
  }
  if (!quranData.length) {
    if (er) {
      er.textContent = '⏳ Data load ho raha hai...';
      er.classList.remove('hidden');
    }
    await loadQuran();
    if (!quranData.length) {
      if (er) {
        er.textContent = '❌ Quran data load nahi hua.';
        er.classList.remove('hidden');
      }
      return;
    }
    if (er) er.classList.add('hidden');
  }
  const fp = parseInt($('fromPara')?.value);
  const tp = parseInt($('toPara')?.value);
  if (!isValidParaRange(fp, tp)) {
    if (er) {
      er.textContent = '❌ Para 1-30 ke beech!';
      er.classList.remove('hidden');
    }
    return;
  }
  selAyats = quranData.filter(a => {
    const para = a.para || (((a.page - 1) / 20 | 0) + 1);
    return para >= fp && para <= tp;
  });
  if (!selAyats.length) {
    if (er) {
      er.textContent = '❌ Is range mein ayat nahi mile.';
      er.classList.remove('hidden');
    }
    return;
  }
  qIdx = 0;
  score = 0;
  usedI = [];
  surahC = {};
  timeArr = [];
  hints = 0;
  survOn = true;
  sessionCorrect = 0;
  sessionTotal = 0;
  mode = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  totalQ = mode === 'timed' ? 10 : 9999;
  const hb = $('hintBtn');
  if (hb) hb.disabled = false;
  const hi = $('hintInfo');
  if (hi) hi.textContent = `Hint: 0/${CONFIG.MAX_HINTS}`;
  $('survivalAnswer')?.classList.add('hidden');
  nextQ();
  showScreen('quizScreen');
}

function nextQ() {
  timerManager.clearInterval('quizTimer');
  const nb = $('nextBtn');
  if (nb) {
    nb.textContent = '➡️ Agla Sawal';
    nb.classList.add('hidden');
  }
  ['quizError', 'quizResult', 'survivalAnswer'].forEach(id => {
    $(id)?.classList.add('hidden');
  });
  $('answerForm')?.reset();
  const cb = $('checkBtn');
  if (cb) cb.disabled = false;
  hints = 0;
  const hb = $('hintBtn');
  if (hb) hb.disabled = false;
  const hi = $('hintInfo');
  if (hi) hi.textContent = `Hint: 0/${CONFIG.MAX_HINTS}`;
  if (qIdx >= totalQ || usedI.length >= selAyats.length) {
    endQuiz();
    return;
  }
  let i, t = 0;
  do {
    i = Math.floor(Math.random() * selAyats.length);
    t++;
  } while (usedI.includes(i) && t < 1000);
  usedI.push(i);
  curAyat = selAyats[i];
  if (!curAyat) {
    endQuiz();
    return;
  }
  typeText(curAyat.text, 'ayatText');
  const para = curAyat.para || (((curAyat.page - 1) / 20 | 0) + 1);
  const _maxPip = para === 29 ? 24 : para === 30 ? 25 : 20;
  const _pipInp = $('user_page_in_para');
  if (_pipInp) {
    _pipInp.max = _maxPip;
    _pipInp.placeholder = `PiP (1-${_maxPip})`;
  }
  qIdx++;
  updateQuizStats();
  startT = Date.now();
  if (mode === 'timed') {
    startTimer(30);
  } else {
    const tm = $('timer');
    if (tm) tm.textContent = '';
  }
}

function updateQuizStats() {
  const acc = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  const sb = $('scoreBoard');
  if (sb) {
    sb.innerHTML = `<span>Score: <b>${score}/${qIdx}</b></span><span style="margin:0 8px;color:var(--text-muted)">|</span><span>🎯 ${acc}%</span>`;
  }
  const qp = $('quizProgress');
  if (qp) {
    if (mode === 'practice') {
      qp.textContent = `🎯 Practice — Sawal: ${qIdx}`;
    } else if (mode === 'survival') {
      qp.textContent = `💥 Survival — Sawal: ${qIdx}`;
    } else {
      qp.textContent = `⏱️ ${qIdx} / ${totalQ}`;
    }
  }
}

function typeText(text, elId, instant = false) {
  const el = $(elId);
  if (!el || !text) return;
  el.textContent = '';
  if (instant) {
    el.textContent = text;
    return;
  }
  let i = 0;
  const typeChar = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      timerManager.setTimeout(`typeChar_${Date.now()}_${i}`, typeChar, 20);
    }
  };
  typeChar();
}

function startTimer(sec) {
  const el = $('timer');
  if (!el) return;
  timerManager.clearInterval('quizTimer');
  let t = sec;
  el.textContent = `⏱️ ${t}s`;
  el.classList.remove('urgent');
  timerManager.setInterval('quizTimer', () => {
    t--;
    el.textContent = `⏱️ ${t}s`;
    if (t <= 10) el.classList.add('urgent');
    if (t <= 0) {
      timerManager.clearInterval('quizTimer');
      el.textContent = "⏱️ Time's up!";
      el.classList.remove('urgent');
      timeArr.push(sec);
      sessionTotal++;
      const cb = $('checkBtn');
      if (cb) cb.disabled = true;
      showRes('⏱️ Waqt khatam!', false);
      $('nextBtn')?.classList.remove('hidden');
      startAutoNext();
    }
  }, 1000);
}

function checkAnswer() {
  const now = Date.now();
  if (now - _lastSubmitTime < CONFIG.SUBMIT_COOLDOWN_MS) {
    return;
  }
  _lastSubmitTime = now;
  const cb = $('checkBtn');
  if (cb && cb.disabled) return;
  if (cb) cb.disabled = true;
  timerManager.clearInterval('quizTimer');
  const ts = Math.round((Date.now() - startT) / 1000);
  const para = $('user_para')?.value.trim() || '';
  const pip = $('user_page_in_para')?.value.trim() || '';
  const pg = $('user_page')?.value.trim() || '';
  const sur = $('user_surah')?.value.trim().toLowerCase() || '';
  const rk = $('user_ruku')?.value.trim() || '';
  const ay = $('user_ayat')?.value.trim() || '';
  ['quizError', 'quizResult'].forEach(id => { $(id)?.classList.add('hidden'); });
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer')?.classList.add('hidden');
  if (!para) {
    showErr('❌ Para Number zaroori hai!');
    if (cb) cb.disabled = false;
    _lastSubmitTime = 0;
    return;
  }
  const paraNum = parseInt(para);
  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) {
    showErr('❌ Para 1-30 ke beech!');
    if (cb) cb.disabled = false;
    _lastSubmitTime = 0;
    return;
  }
  const pn = parseInt(curAyat.page);
  const ap = curAyat.para || (((pn - 1) / 20 | 0) + 1);
  const aip = curAyat.pip || (((pn - 1) % 20) + 1);
  let parts = [], opt = 0;
  const pOk = paraNum === ap;
  if (!pOk) parts.push(`❌ Para Galat! Sahi: ${ap}`);
  let pipOk = true;
  if (pip) {
    const pipNum = parseInt(pip);
    if (isNaN(pipNum)) {
      parts.push('❌ PiP number likhein!');
      pipOk = false;
    } else if (pipNum !== aip) {
      parts.push(`❌ PiP Galat! Sahi: ${aip}`);
      pipOk = false;
    }
  }
  if (pg) {
    const pgNum = parseInt(pg);
    if (isNaN(pgNum)) {
      parts.push('❌ Page number likhein!');
    } else if (pgNum === pn) {
      opt++;
    } else {
      parts.push(`❌ Page Galat! Sahi: ${pn}`);
    }
  }
  if (sur) {
    if (curAyat.surah_name.toLowerCase().includes(sur)) {
      opt++;
    } else {
      parts.push(`❌ Surah Galat! Sahi: ${curAyat.surah_name}`);
    }
  }
  if (rk && curAyat.ruku_no !== undefined) {
    const rkNum = parseInt(rk);
    if (isNaN(rkNum)) {
      parts.push('❌ Ruku number likhein!');
    } else if (rkNum === curAyat.ruku_no) {
      opt++;
    } else {
      parts.push(`❌ Ruku Galat! Sahi: ${curAyat.ruku_no}`);
    }
  }
  if (ay && curAyat.ayat_no !== undefined) {
    const ayNum = parseInt(ay);
    if (isNaN(ayNum)) {
      parts.push('❌ Ayat number likhein!');
    } else if (ayNum === curAyat.ayat_no) {
      opt++;
    } else {
      parts.push(`❌ Ayat Galat! Sahi: ${curAyat.ayat_no}`);
    }
  }
  const ok = pOk && (pip ? pipOk : true);
  sessionTotal++;
  if (ok) {
    score++;
    sessionCorrect++;
    surahC[curAyat.surah_name] = (surahC[curAyat.surah_name] || 0) + 1;
    timeArr.push(ts);
    const earned = calcCoins(ts, opt, hints, mode === 'survival');
    const spd = ts <= 5 ? '⚡ Super Fast!' : ts <= 10 ? '🏃 Fast!' : ts <= 20 ? '👍 Good' : '🐢 Slow';
    addCoinsToFirestore(earned, 1, 1);
    let msg = `✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span><br><small style="color:var(--text-muted)">${spd} (${ts}s)`;
    if (opt > 0) msg += ` | +${opt * 5}🪙 optional`;
    if (hints > 0) msg += ` | -${hints * 5}🪙 hint`;
    msg += `</small>`;
    showRes(msg, true);
    if (sessionCorrect % 10 === 0) {
      toast(`🔥 ${sessionCorrect} sahi! +50🪙!`, 'success', 3000);
      addCoinsToFirestore(50, 0, 0);
    }
  } else {
    if (sessionTotal > 0) addCoinsToFirestore(0, 0, 1);
    showRes(parts.join('<br>') || '❌ Galat!', false);
    if (mode === 'survival') {
      survOn = false;
      const sa = $('survivalAnswer');
      if (sa) {
        sa.innerHTML = `<b>Sahi Jawab:</b><br>Surah: <b>${curAyat.surah_name}</b> | Para: <b>${ap}</b> | Page: <b>${pn}</b> | PiP: <b>${aip}</b>`;
        sa.classList.remove('hidden');
      }
      timerManager.setTimeout('survivalEnd', endQuiz, 2200);
      return;
    }
  }
  _guestQuestionsAnswered++;
  $('nextBtn')?.classList.remove('hidden');
  updateQuizStats();
  hints = 0;
  startAutoNext();
}

function startAutoNext() {
  timerManager.clearInterval('autoNext');
  let cd = 5;
  const nb = $('nextBtn');
  if (nb) nb.textContent = `➡️ Agla Sawal (${cd}s)`;
  timerManager.setInterval('autoNext', () => {
    cd--;
    if (nb) nb.textContent = cd > 0 ? `➡️ Agla Sawal (${cd}s)` : '➡️ Agla Sawal';
    if (cd <= 0) {
      timerManager.clearInterval('autoNext');
      nextQ();
    }
  }, 1000);
}

function showRes(msg, ok) {
  const d = $('quizResult');
  if (!d) return;
  d.innerHTML = msg;
  d.className = ok ? 'result' : 'error';
  d.classList.remove('hidden');
  if (ok) {
    timerManager.setTimeout('hideRes', () => {
      d.classList.add('hidden');
    }, 5000);
  }
}

function showErr(msg) {
  const e = $('quizError');
  if (!e) return;
  e.textContent = msg;
  e.classList.remove('hidden');
  timerManager.setTimeout('hideErr', () => {
    e.classList.add('hidden');
  }, 2500);
}

function showHint() {
  if (hints >= CONFIG.MAX_HINTS) return;
  if (!curAyat) return;
  hints++;
  const hi = $('hintInfo');
  if (hi) hi.textContent = `Hint: ${hints}/${CONFIG.MAX_HINTS}`;
  const hb = $('hintBtn');
  if (hb && hints >= CONFIG.MAX_HINTS) hb.disabled = true;
  const ap = curAyat.para || (((parseInt(curAyat.page) - 1) / 20 | 0) + 1);
  const s2 = curAyat.surah_name.split(' ').slice(0, 2).join(' ');
  const e = $('quizError');
  if (!e) return;
  e.innerHTML = `💡 <b>Hint (-5🪙):</b> Surah: <b>${esc(s2)}...</b>, Para: <b>${ap}</b>`;
  e.classList.remove('hidden');
  timerManager.setTimeout('hideHint', () => {
    e.classList.add('hidden');
  }, 3500);
}

function endQuiz() {
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');
  let avg = 0, fast = 0;
  if (timeArr.length > 0) {
    const sum = timeArr.reduce((a, b) => a + b, 0);
    avg = Math.round(sum / timeArr.length);
    fast = Math.min(...timeArr);
  }
  const acc = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;
  let best = '', mx = 0;
  Object.entries(surahC).forEach(([s, c]) => {
    if (c > mx) {
      mx = c;
      best = s;
    }
  });
  const spd = avg <= 8 ? '⚡ Speed Master' : avg <= 15 ? '🏃 Quick Player' : '📚 Careful Reader';
  const fr = $('finalResult');
  if (fr) {
    fr.innerHTML = `<div class="result-grid">
      <div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${score}/${qIdx}</span><span class="ri-lbl">Score</span></div>
      <div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div>
      <div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div>
      <div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins || 0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div>
      <div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${esc(best) || '—'}</span><span class="ri-lbl">Best Surah</span></div>
    </div>
    <div class="speed-badge">${spd}</div>
    <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${mode === 'survival' && !survOn ? '💥 Survival Khatam!' : '🎉 Mubarak!'}</div>`;
  }
  showScreen('resultScreen');
}

function resetGame(home) {
  qIdx = 0;
  score = 0;
  usedI = [];
  surahC = {};
  timeArr = [];
  hints = 0;
  survOn = true;
  sessionCorrect = 0;
  sessionTotal = 0;
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');
  $('hintBtn') && ($('hintBtn').disabled = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);
  showScreen(home ? 'welcomeScreen' : 'paraSelectScreen');
}

// ═══════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════
function normalizeArabic(t) {
  if (!t) return '';
  t = String(t);
  t = t.replace(/\uFEFF/g, '');
  t = t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '');
  t = t.replace(/[\u0622\u0623\u0624\u0625\u0626\u0671]/g, '\u0627');
  t = t.replace(/\u0629/g, '\u0647');
  return t.trim().toLowerCase();
}

function doSearch(e) {
  if (e) e.preventDefault();
  const inp = $('searchInput');
  if (!inp) return;
  const raw = inp.value.trim();
  const q = normalizeArabic(raw);
  const rd = $('searchResults');
  if (!rd) return;
  if (!q) {
    rd.innerHTML = '<em>Kuch likhein...</em>';
    return;
  }
  if (!quranData.length) {
    rd.innerHTML = '<em>Data load ho raha hai...</em>';
    return;
  }
  const found = quranData.filter(a => {
    if (normalizeArabic(a.text).includes(q)) return true;
    if (normalizeArabic(a.surah_name).includes(q)) return true;
    if (String(a.page) === raw.trim()) return true;
    const para = a.para || (((a.page - 1) / 20 | 0) + 1);
    if (String(para) === raw.trim()) return true;
    return false;
  }).slice(0, 30);
  if (!found.length) {
    rd.innerHTML = '<b>Koi result nahi mila.</b>';
    return;
  }
  const hl = t => {
    return t.split(/(\s+)/)
      .map(w => normalizeArabic(w) === q ? `<mark>${esc(w)}</mark>` : esc(w))
      .join('');
  };
  rd.innerHTML = found.map(r => {
    const ap = r.para || (((r.page - 1) / 20 | 0) + 1);
    return `<div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank')">
      <b>Ayat:</b> ${hl(r.text)}<br>
      <b>Surah:</b> ${hl(r.surah_name)} | <b>Page:</b> ${r.page} | <b>Para:</b> ${ap}
      <span style="float:right;color:#aad">🔗</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════
function spawnCoinParticles(fromEl, toEl, count = 18) {
  if (!fromEl || !toEl) return;
  const fR = fromEl.getBoundingClientRect();
  const tR = toEl.getBoundingClientRect();
  const startX = fR.left + fR.width / 2;
  const startY = fR.top + fR.height / 2;
  const endX = tR.left + tR.width / 2;
  const endY = tR.top + tR.height / 2;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'coin-particle';
    p.textContent = '🪙';
    const sz = 12 + Math.random() * 12;
    p.style.cssText = `position:fixed;left:${startX}px;top:${startY}px;font-size:${sz}px;transform:translate(-50%,-50%);pointer-events:none;z-index:99997;opacity:1;will-change:transform,opacity;`;
    document.body.appendChild(p);

    const delay = Math.random() * 250;
    const spread = (Math.random() - 0.5) * 120;
    const arc = -(Math.random() * 80 + 40);
    const dur = 500 + Math.random() * 400;

    timerManager.setTimeout(`coinParticle_${Date.now()}_${i}`, () => {
      const dx = endX - startX + spread;
      const dy = endY - startY;
      const animation = p.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% + ${arc}px)) scale(1.2)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`, opacity: 0, offset: 1 }
      ], {
        duration: dur,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      });
      animation.onfinish = () => { p.remove(); };
    }, delay);
  }
}

// ═══════════════════════════════════════════
//  ONLINE MATCH
// ═══════════════════════════════════════════

function buildQuestionPool(size) {
  if (!quranData.length) return [];
  const indices = Array.from({ length: quranData.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, size);
}

async function openOnlineLobby() {
  if (!curUser || curUser.isAnonymous) {
    toast('❌ Login karo pehle!', 'error');
    showScreen('authScreen');
    return;
  }
  loadQuran();
  showScreen('onlineLobbyScreen');

  try {
    const freshSnap = await getDoc(doc(db, 'users', curUser.uid));
    if (freshSnap.exists()) curData = freshSnap.data();
  } catch(e) {
    console.warn('Fresh read error:', e);
  }

  const coins = curData?.coins || 0;
  const li = $('lobbyCoinsInfo');
  if (li) li.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} �� Table chuniye!`;

  const locked = $('onlineLocked'), grid = $('tablesGrid');
  if (locked) locked.classList.add('hidden');
  if (grid) grid.style.opacity = '1';

  Object.entries(TABLES).forEach(([key, t]) => {
    const id = `join${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const btn = $(id);
    if (!btn) return;

    if (coins < t.fee) {
      btn.disabled = true;
      btn.textContent = `🔒 ${t.fee}🪙 chahiye`;
    } else {
      btn.disabled = false;
      btn.textContent = `Join (${t.fee}🪙)`;
    }
  });
}

async function joinTable(tableKey) {
  if (!curUser || !curData) {
    toast('❌ Login karein!', 'error');
    return;
  }
  if (!_isConnected) {
    toast('❌ Internet check karein!', 'error');
    return;
  }
  if (_joining) {
    toast('⏳ Thoda ruko...', 'info');
    return;
  }

  if (MS.matchId || MS.myRole) {
    leaveMatchCleanup(false);
  }

  _joining = true;

  const table = TABLES[tableKey];
  if (!table) {
    _joining = false;
    toast('❌ Invalid table!', 'error');
    return;
  }

  try {
    const freshSnap = await getDoc(doc(db, 'users', curUser.uid));
    if (freshSnap.exists()) curData = freshSnap.data();
  } catch(e) {}

  const coins = curData?.coins || 0;
  if (coins < table.fee) {
    _joining = false;
    toast(`❌ ${table.fee}🪙 chahiye! Aapke paas: ${coins}🪙`, 'error');
    return;
  }

  if (!quranData.length) {
    toast('⏳ Data load ho raha hai...', 'info');
    await loadQuran();
    if (!quranData.length) {
      _joining = false;
      toast('❌ Quran data load nahi hua!', 'error');
      return;
    }
  }

  MS = freshMatchState();
  MS.tableKey = tableKey;
  MS.feeDeducted = true;

  try {
    await runTransaction(db, async (tx) => {
      const userRef = doc(db, 'users', curUser.uid);
      const userDoc = await tx.get(userRef);

      if (!userDoc.exists()) throw new Error('User not found');

      const currentCoins = userDoc.data().coins || 0;
      if (currentCoins < table.fee) {
        throw new Error('Insufficient coins');
      }

      tx.update(userRef, { coins: increment(-table.fee) });
    });
  } catch(e) {
    _joining = false;
    MS.feeDeducted = false;
    toast('❌ Coins deduct error. Try again.', 'error');
    console.error('Coin deduction error:', e);
    return;
  }

  showScreen('matchWaitScreen');
  const wi = $('matchWaitInfo');
  if (wi) wi.textContent = table.name;

  const wt = $('matchWaitTimer');
  if (wt) wt.textContent = '0s';

  const waitStart = Date.now();
  MS.timers.setInterval('matchWait', () => {
    const el = $('matchWaitTimer');
    if (el) el.textContent = `${Math.floor((Date.now() - waitStart) / 1000)}s`;
  }, 1000);

  try {
    await findOrCreateMatch(tableKey);
  } finally {
    _joining = false;
  }
}

async function findOrCreateMatch(tableKey) {
  const qRef = ref(rtdb, `queues/${tableKey}`);
  let asP2 = false, p2MatchId = null, oppData = null;

  try {
    await rtdbRunTransaction(qRef, current => {
      if (!current) {
        return {
          uid: curUser.uid,
          username: curData.username || 'Player',
          matchId: '',
          ts: Date.now()
        };
      }

      if (current.uid === curUser.uid) {
        return {
          uid: curUser.uid,
          username: curData.username || 'Player',
          matchId: '',
          ts: Date.now()
        };
      }

      asP2 = true;
      p2MatchId = current.matchId;
      oppData = current;
      return;
    });
  } catch(e) {
    console.error('Queue tx error:', e);
    await doRefund();
    toast('❌ Matchmaking error. Retry karein.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  if (asP2) {
    let tries = 0;
    while ((!p2MatchId || p2MatchId === '') && tries < 16) {
      await sleep(500);
      try {
        const snap = await get(qRef);
        if (!snap.exists()) {
          p2MatchId = null;
          break;
        }
        const mid = snap.val()?.matchId;
        if (mid && mid !== '') p2MatchId = mid;
      } catch(e) {}
      tries++;
    }

    if (!p2MatchId) {
      await doRefund();
      toast('❌ Match nahi mila. Retry karein.', 'error');
      showScreen('onlineLobbyScreen');
      return;
    }

    MS.matchId = p2MatchId;
    MS.myRole = 'p2';
    MS.opponentName = oppData?.username || 'Player';
    await p2JoinMatch(p2MatchId, tableKey, qRef);

  } else {
    let matchId;
    try {
      matchId = push(ref(rtdb, `matches/${tableKey}`)).key;
      MS.matchId = matchId;
      MS.myRole = 'p1';

      const tbl = TABLES[tableKey];

      await set(ref(rtdb, `matches/${tableKey}/${matchId}`), {
        status: 'waiting',
        table: tableKey,
        totalQ: tbl.totalQ,
        questionPool: [],
        p1: {
          uid: curUser.uid,
          name: curData.username || 'Player',
          score: 0,
          qIdx: 0,
          connected: true
        },
        p2: { uid: '', name: '', score: 0, qIdx: 0, connected: false },
        winner: '',
        createdAt: Date.now()
      });

      await update(qRef, { matchId });
    } catch(e) {
      console.error('P1 match create error:', e);
      await doRefund();
      toast('❌ Match create error.', 'error');
      showScreen('onlineLobbyScreen');
      return;
    }

    p1WaitForOpponent(tableKey, matchId);

    MS.timers.setTimeout('matchAutoCancel', async () => {
      try {
        const snap = await get(ref(rtdb, `matches/${tableKey}/${matchId}`));
        if (snap.exists() && snap.val().status === 'waiting') {
          await remove(ref(rtdb, `matches/${tableKey}/${matchId}`)).catch(() => {});
          await remove(qRef).catch(() => {});
          MS.matchId = null;
          MS.myRole = null;
          leaveMatchCleanup(false);
          await doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!', 'info', 4000);
          showScreen('onlineLobbyScreen');
        }
      } catch(e) {
        console.error('Auto-cancel error:', e);
      }
    }, CONFIG.MATCH_AUTO_CANCEL_MS);
  }
}

function p1WaitForOpponent(tableKey, matchId) {
  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);

  const unsub = onValue(
    mRef,
    snap => {
      if (!snap.exists()) return;
      const d = snap.val();

      if (d.status === 'active' && d.p2?.uid) {
        unsub();
        MS.opponentName = d.p2.name;
        startOnlineMatch(tableKey, matchId, d);
      }
    },
    err => console.warn('P1 wait error:', err.message)
  );

  MS.listeners.add(`p1WaitListener_${matchId}`, unsub);
}

async function p2JoinMatch(matchId, tableKey, qRef) {
  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);

  let snap;
  try {
    snap = await get(mRef);
  } catch(e) {
    await doRefund();
    toast('❌ Match data error.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  if (!snap.exists()) {
    await doRefund();
    toast('❌ Match cancel ho gaya.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  const matchData = snap.val();
  if (matchData.status !== 'waiting') {
    await doRefund();
    toast('❌ Match pehle se start ho gaya.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  const tbl = TABLES[tableKey];
  const poolSize = tbl.totalQ + CONFIG.POOL_EXTRA;
  const questionPool = buildQuestionPool(poolSize);

  try {
    await update(mRef, {
      status: 'active',
      questionPool,
      'p2/uid': curUser.uid,
      'p2/name': curData.username || 'Player',
      'p2/score': 0,
      'p2/qIdx': 0,
      'p2/connected': true
    });
  } catch(e) {
    await doRefund();
    toast('❌ Match join error.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  if (qRef) {
    try {
      await remove(qRef);
    } catch(e) {}
  }

  const finalSnap = await get(mRef);
  if (finalSnap.exists()) {
    startOnlineMatch(tableKey, matchId, finalSnap.val());
  }
}

function startOnlineMatch(tableKey, matchId, initData) {
  MS.timers.clearInterval('matchWait');
  MS.timers.clearTimeout('matchAutoCancel');
  MS.feeDeducted = false;
  MS.myQIdx = 0;
  MS.inSuddenDeath = false;

  showScreen('onlineMatchScreen');
  hideOpponentWaitPopup();
  hideDisconnectGracePopup();
  hideSuddenDeathBanner();

  const n1 = $('myName'), n2 = $('oppName'), s1 = $('myScore'), s2 = $('oppScore');
  if (n1) n1.textContent = curData?.username || 'Player';
  if (n2) n2.textContent = MS.opponentName || 'Opponent';
  if (s1) s1.textContent = '0';
  if (s2) s2.textContent = '0';

  if (MS.matchId && MS.tableKey && MS.myRole) {
    const myConnRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`);
    set(myConnRef, true).catch(() => {});
    rtdbOnDisconnect(myConnRef).set(false).catch(() => {});
  }

  const pool = initData.questionPool || [];
  if (pool.length > 0) {
    MS.currentAyatIndex = pool[0];
    showMatchQuestion(pool[0], 1, TABLES[tableKey].totalQ);
  }

  triggerMatchStartParticles();

  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(
    mRef,
    snap => {
      if (!snap.exists()) {
        if (MS._ended) return;
        handleMatchEnd(false, 'opponent_left');
        return;
      }

      const d = snap.val();
      const tbl = TABLES[tableKey];
      const isP1 = MS.myRole === 'p1';
      const myD = isP1 ? d.p1 : d.p2;
      const opD = isP1 ? d.p2 : d.p1;

      const ms1 = $('myScore'), ms2 = $('oppScore');
      if (ms1) ms1.textContent = myD?.score || 0;
      if (ms2) ms2.textContent = opD?.score || 0;
      MS.myScore = myD?.score || 0;
      MS.oppScore = opD?.score || 0;

      const oppConnected = opD?.connected;
      if (oppConnected === false && !MS.disconnectGraceTimer &&
        (d.status === 'active' || d.status === 'sudden_death')) {

        const GRACE_SEC = CONFIG.GRACE_PERIOD_SEC;
        showDisconnectGracePopup(GRACE_SEC);

        MS.disconnectGraceTimer = timerManager.setTimeout(`disconnectGrace_${matchId}`, async () => {
          try {
            const freshSnap = await get(mRef);
            if (!freshSnap.exists()) return;

            const currD = freshSnap.val();
            const freshOpD = isP1 ? currD.p2 : currD.p1;

            if (freshOpD?.connected === false && currD.status !== 'finished') {
              const winRef = ref(rtdb, `matches/${tableKey}/${matchId}/winner`);
              try {
                await rtdbRunTransaction(winRef, current => {
                  if (current && current !== '') return;
                  return MS.myRole;
                });
                await update(mRef, { status: 'finished' });
              } catch(e) {
                console.warn('Auto-win tx err:', e);
              }

              handleMatchEnd(true, 'opponent_left');
            } else {
              MS.disconnectGraceTimer = null;
              hideDisconnectGracePopup();
            }
          } catch(e) {
            MS.disconnectGraceTimer = null;
          }
        }, GRACE_SEC * 1000);

      } else if (oppConnected === true && MS.disconnectGraceTimer) {
        timerManager.clearTimeout(`disconnectGrace_${matchId}`);
        MS.disconnectGraceTimer = null;
        hideDisconnectGracePopup();
      }

      if (d.winner && d.status === 'finished') {
        handleMatchEnd(d.winner === MS.myRole);
        return;
      }

      if (MS.myScore >= tbl.firstTo) {
        handleMatchEnd(true);
        return;
      }
      if (MS.oppScore >= tbl.firstTo) {
        handleMatchEnd(false);
        return;
      }

      const myDone = (myD?.qIdx || 0) >= tbl.totalQ;
      const oppDone = (opD?.qIdx || 0) >= tbl.totalQ;

      if (myDone && oppDone && d.status === 'active') {
        if (MS.myScore > MS.oppScore) {
          handleMatchEnd(true);
          return;
        }
        if (MS.myScore < MS.oppScore) {
          handleMatchEnd(false);
          return;
        }

        if (!MS.inSuddenDeath) {
          MS.inSuddenDeath = true;
          if (MS.myRole === 'p2') {
            update(mRef, { status: 'sudden_death' }).catch(() => {});
          }
          enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
        }
        return;
      }

      if (d.status === 'sudden_death' && !MS.inSuddenDeath) {
        MS.inSuddenDeath = true;
        enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
        return;
      }

      const newMyQIdx = myD?.qIdx || 0;
      if (newMyQIdx > MS.myQIdx) {
        MS.myQIdx = newMyQIdx;
        if (d.questionPool && d.questionPool[newMyQIdx] !== undefined) {
          MS.currentAyatIndex = d.questionPool[newMyQIdx];
        }
      }
    },
    err => console.warn('Match listener err:', err.message)
  );

  MS.listeners.add(`matchListener_${matchId}`, unsub);
}

function enterSuddenDeath(pool, currentQIdx) {
  showSuddenDeathBanner();

  const sdAyatIdx = pool ? pool[currentQIdx] : undefined;
  if (sdAyatIdx !== undefined) {
    MS.currentAyatIndex = sdAyatIdx;
    const mp = $('matchProgress');
    if (mp) mp.innerHTML = `<span class="sd-label">⚡ SUDDEN DEATH</span>`;
    showMatchQuestion(sdAyatIdx, null, null, true);
  }
}

function showMatchQuestion(ayatIndex, qNum, totalQuestions, isSuddenDeath = false) {
  if (!quranData[ayatIndex]) {
    console.warn('Invalid ayat index:', ayatIndex);
    return;
  }

  MS.answered = false;
  const ayat = quranData[ayatIndex];

  if (!isSuddenDeath) {
    const mp = $('matchProgress');
    if (mp) {
      mp.textContent = qNum && totalQuestions
        ? `Sawal ${qNum} / ${totalQuestions}`
        : `Sawal ${qNum}`;
    }
  }

  const el = $('matchAyatText');
  if (el) el.textContent = ayat.text;

  $('matchAnswerForm')?.reset();

  const cb = $('matchCheckBtn');
  if (cb) cb.disabled = false;

  const mr = $('matchResult');
  if (mr) {
    mr.classList.add('hidden');
    mr.textContent = '';
  }

  const para = ayat.para || (((ayat.page - 1) / 20 | 0) + 1);
  const _mMaxPip = para === 29 ? 24 : para === 30 ? 25 : 20;
  const _mPipInp = $('match_pip');
  if (_mPipInp) {
    _mPipInp.max = _mMaxPip;
    _mPipInp.placeholder = `PiP (1-${_mMaxPip})`;
  }

  startMatchTimer(30);
}

function startMatchTimer(sec) {
  MS.timers.clearInterval('matchTimer');

  let t = sec;
  const fill = $('matchTimerFill'), txt = $('matchTimer');

  if (fill) fill.style.width = '100%';
  if (txt) txt.textContent = `${t}s`;

  MS.timers.setInterval('matchTimer', () => {
    t--;
    if (fill) fill.style.width = `${(t / sec) * 100}%`;
    if (txt) txt.textContent = `${t}s`;

    if (t <= 0) {
      MS.timers.clearInterval('matchTimer');
      if (!MS.answered) submitMatchAnswer(true);
    }
  }, 1000);
}

async function submitMatchAnswer(timeOut = false) {
  const now = Date.now();
  if (now - _lastSubmitTime < CONFIG.SUBMIT_COOLDOWN_MS) {
    return;
  }
  _lastSubmitTime = now;

  if (MS.answered) return;
  MS.answered = true;

  MS.timers.clearInterval('matchTimer');

  const cb = $('matchCheckBtn');
  if (cb) cb.disabled = true;

  if (timeOut) {
    showMatchMsg('⏱️ Waqt khatam!', false);
    await advanceMyQuestion(false);
    return;
  }

  const para = $('match_para')?.value.trim() || '';
  const pip = $('match_pip')?.value.trim() || '';

  if (!para) {
    MS.answered = false;
    if (cb) cb.disabled = false;
    _lastSubmitTime = 0;
    toast('❌ Para zaroori hai!', 'error');
    return;
  }

  const paraNum = parseInt(para);
  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) {
    MS.answered = false;
    if (cb) cb.disabled = false;
    _lastSubmitTime = 0;
    toast('❌ Para 1-30 ke beech!', 'error');
    return;
  }

  if (!quranData[MS.currentAyatIndex]) {
    showMatchMsg('❌ Question data error', false);
    await advanceMyQuestion(false);
    return;
  }

  const ayat = quranData[MS.currentAyatIndex];
  const pn = parseInt(ayat.page);
  const ap = ayat.para || (((pn - 1) / 20 | 0) + 1);
  const aip = ayat.pip || (((pn - 1) % 20) + 1);

  const pOk = paraNum === ap;
  const pipOk = pip ? parseInt(pip) === aip : true;

  if (pOk && pipOk) {
    if (MS.inSuddenDeath) {
      const winRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/winner`);
      const mRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);

      let won = false;
      try {
        const txResult = await rtdbRunTransaction(winRef, current => {
          if (current && current !== '') return;
          return MS.myRole;
        });

        won = txResult.committed;
        if (won) {
          await update(mRef, {
            status: 'finished',
            [`${MS.myRole}/score`]: MS.myScore + 1
          });
        }
      } catch(e) {
        console.warn('SD winner tx err:', e);
      }

      showMatchMsg(`✅ Sahi! Para: ${ap}`, true);

      if (won) {
        handleMatchEnd(true, 'sudden_death_win');
      } else {
        handleMatchEnd(false, 'sudden_death_loss');
      }
      return;
    }

    const scoreField = MS.myRole === 'p1' ? 'p1/score' : 'p2/score';
    const scoreRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${scoreField}`);

    try {
      await rtdbRunTransaction(scoreRef, current => (current || 0) + 1);
    } catch(e) {
      console.warn('Score update err:', e);
    }

    showMatchMsg(`✅ Sahi! Para: ${ap}${pip ? `, PiP: ${aip}` : ''}`, true);
  } else {
    showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip}`, false);
  }

  await advanceMyQuestion(pOk && pipOk);
}

async function advanceMyQuestion(wasCorrect) {
  await sleep(1400);

  if (MS._ended) return;

  const tbl = TABLES[MS.tableKey];
  if (!tbl) return;

  const newIdx = MS.myQIdx + 1;
  const qIdxField = MS.myRole === 'p1' ? 'p1/qIdx' : 'p2/qIdx';
  const mRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);

  MS.myQIdx = newIdx;

  if (!MS.inSuddenDeath && newIdx >= tbl.totalQ) {
    try {
      await update(mRef, { [qIdxField]: newIdx });
    } catch(e) {}

    showWaitingForOpponent();
    return;
  }

  try {
    await update(mRef, { [qIdxField]: newIdx });
  } catch(e) {
    console.warn('AdvanceQ err:', e);
  }

  const mSnap = await get(mRef).catch(() => null);
  if (!mSnap || !mSnap.exists() || MS._ended) return;

  const pool = mSnap.val()?.questionPool;
  if (pool && pool[newIdx] !== undefined && !MS.inSuddenDeath) {
    MS.currentAyatIndex = pool[newIdx];
    showMatchQuestion(pool[newIdx], newIdx + 1, tbl.totalQ);
  }
}

function showWaitingForOpponent() {
  const tbl = TABLES[MS.tableKey] || {};

  MS.timers.clearInterval('matchTimer');

  const cb = $('matchCheckBtn');
  if (cb) cb.disabled = true;

  const fill = $('matchTimerFill');
  if (fill) fill.style.width = '0%';

  const txt = $('matchTimer');
  if (txt) txt.textContent = '⏳';

  const mp = $('matchProgress');
  if (mp) {
    mp.textContent = `✅ Aapne ${tbl.totalQ || ''} sawaal khatam kiye — ${MS.opponentName || 'Opponent'} ka intezaar...`;
  }

  const at = $('matchAyatText');
  if (at) at.textContent = '⏳ Opponent abhi khel raha hai...';

  const mr = $('matchResult');
  if (mr) {
    mr.classList.add('hidden');
    mr.textContent = '';
  }

  showOpponentWaitPopup(true);
}

function showMatchMsg(msg, ok) {
  const el = $('matchResult');
  if (!el) return;
  el.textContent = msg;
  el.className = ok ? 'result' : 'error';
  el.classList.remove('hidden');
}

function handleMatchEnd(won, reason = '') {
  if (MS._ended) return;
  MS._ended = true;

  leaveMatchCleanup(false);
  hideOpponentWaitPopup();
  hideDisconnectGracePopup();
  hideSuddenDeathBanner();

  const tbl = TABLES[MS.tableKey] || {};
  const coins = won ? (tbl.winCoins || 0) : 0;

  const ri = $('matchResultIcon');
  if (ri) ri.textContent = won ? '🏆' : '😔';

  const rt = $('matchResultTitle');
  if (rt) {
    if (reason === 'sudden_death_win') {
      rt.textContent = '⚡ Sudden Death Jeet!';
    } else if (reason === 'opponent_left') {
      rt.textContent = '🏆 Opponent Chala Gaya!';
    } else {
      rt.textContent = won ? 'Jeet Gaye! 🏆' : 'Haare! 😔';
    }
  }

  let reasonText = '';
  if (reason === 'opponent_left') {
    reasonText = '<div style="color:var(--gold);font-size:0.85rem;margin-top:4px">Opponent ne match chhod diya!</div>';
  }
  if (reason === 'sudden_death_win') {
    reasonText = '<div style="color:#f0c96a;font-size:0.85rem;margin-top:4px">⚡ Pehla sahi jawab — Jeet!</div>';
  }
  if (reason === 'sudden_death_loss') {
    reasonText = '<div style="color:var(--text-muted);font-size:0.85rem;margin-top:4px">⚡ Opponent ne pehle sahi jawab diya.</div>';
  }

  const rs = $('matchResultScores');
  if (rs) {
    rs.innerHTML = `<div style="display:flex;justify-content:center;gap:30px;font-size:1.1rem;font-weight:700">
      <span style="color:var(--emerald)">Aap: ${MS.myScore}</span>
      <span style="color:var(--text-muted)">VS</span>
      <span style="color:#ff9090">${MS.opponentName || 'Opp'}: ${MS.oppScore}</span>
    </div>${reasonText}`;
  }

  const rc = $('matchResultCoins');
  if (rc) {
    rc.innerHTML = won
      ? `<div style="color:var(--gold);font-size:1.2rem;font-weight:700">+${coins} 🪙 Jeet ki coins!</div>`
      : `<div style="color:var(--text-muted)">Koi coins nahi — agali baar!</div>`;
  }

  if (won && coins > 0 && curUser && !curUser.isAnonymous) {
    updateDoc(doc(db, 'users', curUser.uid), {
      coins: increment(coins),
      totalWins: increment(1)
    }).catch(() => {});

    toast(`🏆 Jeet Gaye! +${coins}🪙`, 'success', 4000);
  }

  if (MS.matchId && MS.tableKey) {
    const _mid = MS.matchId, _tk = MS.tableKey, _role = MS.myRole;
    timerManager.setTimeout(`deleteMatch_${_mid}`, () => {
      if (_role === 'p1') {
        remove(ref(rtdb, `matches/${_tk}/${_mid}`)).catch(() => {});
      }
    }, 8000);
  }

  showScreen('matchResultScreen');

  if (won) {
    timerManager.setTimeout('victoryParticles', triggerVictoryParticles, 400);
  }
}

function triggerMatchStartParticles() {
  const myBox = $('myPlayerBox');
  const oppBox = $('oppPlayerBox');
  const vsEl = $('matchVsEl');
  if (!vsEl) return;

  timerManager.setTimeout('matchStartParticles', () => {
    spawnCoinParticles(myBox, vsEl, 14);
    timerManager.setTimeout('matchStartParticles2', () => {
      spawnCoinParticles(oppBox, vsEl, 14);
    }, 120);
  }, 400);
}

function triggerVictoryParticles() {
  const fromEl = $('matchResultIcon');
  const toEl = $('hdrCoins');
  if (!fromEl || !toEl) return;

  spawnCoinParticles(fromEl, toEl, 20);
  timerManager.setTimeout('victoryParticles2', () => {
    spawnCoinParticles(fromEl, toEl, 15);
  }, 300);
  timerManager.setTimeout('victoryParticles3', () => {
    spawnCoinParticles(fromEl, toEl, 10);
  }, 600);
}

function leaveMatchCleanup(refund = false) {
  MS.timers.clearAll();
  MS.listeners.removeAll();

  if (MS.tableKey) {
    const qRef = ref(rtdb, `queues/${MS.tableKey}`);
    get(qRef)
      .then(snap => {
        if (snap.exists() && snap.val()?.uid === curUser?.uid) {
          remove(qRef).catch(() => {});
        }
      })
      .catch(() => {});

    if (MS.matchId && MS.myRole && !MS._ended) {
      set(ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`), false)
        .catch(() => {});
    }
  }

  if (refund) doRefund();
}

async function doRefund() {
  if (!MS.feeDeducted || !curUser || !MS.tableKey) return;
  if (MS._refunding) return;

  MS._refunding = true;
  MS.feeDeducted = false;

  const fee = TABLES[MS.tableKey]?.fee || 0;
  if (fee > 0) {
    try {
      await updateDoc(doc(db, 'users', curUser.uid), {
        coins: increment(fee)
      });
      console.log(`Refunded ${fee} coins`);
    } catch(e) {
      console.error('Refund error:', e);
    }
  }

  MS._refunding = false;
}

// ═══════════════════════════════════════════
//  SUDDEN DEATH BANNER
// ═══════════════════════════════════════════
function showSuddenDeathBanner() {
  let el = $('suddenDeathBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suddenDeathBanner';
    el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:linear-gradient(135deg,#1a0800,#2a1000);border-bottom:2px solid #d4a84380;animation:sdSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both`;
    el.innerHTML = `<style>@keyframes sdSlideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
      <span style="font-size:1.3rem;margin-right:10px">⚡</span>
      <span style="font-family:Cinzel,serif;font-weight:900;font-size:1rem;background:linear-gradient(135deg,#f0c96a,#d4a843);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">SUDDEN DEATH</span>
      <span style="font-size:1.3rem;margin-left:10px">⚡</span>
      <span style="font-size:0.78rem;color:var(--text-muted);margin-left:12px;font-family:Tajawal,sans-serif">Pehla sahi jawab jeetega!</span>`;
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

function hideSuddenDeathBanner() {
  const el = $('suddenDeathBanner');
  if (el) el.style.display = 'none';
}

// ═══════════════════════════════════════════
//  OPPONENT WAIT POPUP
// ═══════════════════════════════════════════
function showOpponentWaitPopup(allDone = false) {
  let popup = $('oppWaitPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'oppWaitPopup';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(5,15,10,.88);backdrop-filter:blur(10px);z-index:8000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(popup);
  }

  if (allDone) {
    const tbl = TABLES[MS.tableKey] || {};
    popup.innerHTML = `<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:32px 24px;text-align:center;max-width:320px;width:90vw;display:flex;flex-direction:column;gap:16px;box-shadow:0 0 40px #00c47215">
      <div style="font-size:2.5rem">✅</div>
      <div style="font-family:Cinzel,serif;font-size:1.05rem;color:var(--gold-light)">Aapne Sawaal Poore Kiye!</div>
      <div style="font-size:1.8rem;font-weight:900;color:var(--emerald)">${MS.myScore} <span style="color:var(--text-muted);font-size:0.9rem">points</span></div>
      <div style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif;line-height:1.6">
        ${MS.opponentName || 'Opponent'} abhi khel raha hai...<br>
        <span style="color:var(--gold);font-size:0.8rem">Nateeja unke khatam hone par aayega</span>
      </div>
      <div class="match-spinner" style="margin:0 auto"></div>
    </div>`;
  } else {
    popup.innerHTML = `<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:2rem">⏳</div>
      <div style="font-family:Cinzel,serif;font-size:1.1rem;color:var(--gold-light)">Opponent ka Intezaar</div>
      <div style="font-size:0.88rem;color:var(--text-muted);font-family:Tajawal,sans-serif">Opponent abhi sawaal submit kar raha hai...</div>
      <div class="match-spinner" style="margin:0 auto"></div>
    </div>`;
  }

  popup.style.display = 'flex';
}

function hideOpponentWaitPopup() {
  const p = $('oppWaitPopup');
  if (p) p.style.display = 'none';
}

// ═══════════════════════════════════════════
//  DISCONNECT GRACE
// ═══════════════════════════════════════════
function showDisconnectGracePopup(seconds = 5) {
  let popup = $('disconnectGracePopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'disconnectGracePopup';
    popup.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a0808,#100404);border:1px solid #c4293b60;border-radius:16px;padding:16px 24px;text-align:center;max-width:320px;width:90vw;z-index:9500;box-shadow:0 0 30px #c4293b30;animation:graceSlide 0.4s cubic-bezier(0.34,1.56,0.64,1) both;`;
    document.head.insertAdjacentHTML('beforeend', `<style>@keyframes graceSlide{from{opacity:0;transform:translateX(-50%) translateY(60px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>`);
    document.body.appendChild(popup);
  }

  let countdown = seconds;
  if (popup._interval) {
    timerManager.clearInterval(popup._interval);
    popup._interval = null;
  }

  popup.innerHTML = `
    <div style="font-size:1.8rem;margin-bottom:6px">📡</div>
    <div style="font-family:Cinzel,serif;color:var(--gold-light);font-size:0.95rem;margin-bottom:4px">Opponent Disconnect!</div>
    <div id="graceCountdownTxt" style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif">
      ${countdown}s intezaar karo...
    </div>
  `;

  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';

  popup._interval = setInterval(() => {
    countdown--;
    const txt = $('graceCountdownTxt');
    if (txt) {
      if (countdown > 0) txt.textContent = `${countdown}s intezaar karo...`;
      else txt.textContent = 'Match khatam kar raha hai...';
    }
    if (countdown <= 0) {
      clearInterval(popup._interval);
      popup._interval = null;
    }
  }, 1000);
}

function hideDisconnectGracePopup() {
  const p = $('disconnectGracePopup');
  if (p) {
    if (p._interval) {
      clearInterval(p._interval);
      p._interval = null;
    }
    p.style.display = 'none';
  }
}

// ═══════════════════════════════════════════
//  EXIT CONFIRM
// ═══════════════════════════════════════════
function showExitConfirm() {
  const m = $('exitMatchModal');
  if (m) m.style.display = 'flex';
}

function hideExitConfirm() {
  const m = $('exitMatchModal');
  if (m) m.style.display = 'none';
}

// ═══════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Auth Tabs
  on('tabLogin', 'click', (e) => { e.preventDefault(); switchTab('login'); });
  on('tabSignup', 'click', (e) => { e.preventDefault(); switchTab('signup'); });

  // Auth Forms
  on('loginBtn', 'click', (e) => { e.preventDefault(); doLogin(); });
  on('signupBtn', 'click', (e) => { e.preventDefault(); doSignup(); });
  on('googleLoginBtn', 'click', (e) => { e.preventDefault(); doGoogle(); });
  on('googleSignupBtn', 'click', (e) => { e.preventDefault(); doGoogle(); });
  on('guestBtn', 'click', (e) => { e.preventDefault(); doGuest(); });
  on('forgotBtn', 'click', (e) => { e.preventDefault(); doForgot(); });

  // Keyboard
  on('loginEmail', 'keypress', (e) => { if (e.key === 'Enter') doLogin(); });
  on('loginPassword', 'keypress', (e) => { if (e.key === 'Enter') doLogin(); });
  on('signupConfirmPw', 'keypress', (e) => { if (e.key === 'Enter') doSignup(); });

  // Password Toggle
  on('toggleLoginPw', 'click', (e) => {
    e.preventDefault();
    const i = $('loginPassword');
    if (i) {
      i.type = i.type === 'password' ? 'text' : 'password';
      e.target.textContent = i.type === 'password' ? '👁️' : '🙈';
    }
  });
  on('toggleSignupPw', 'click', (e) => {
    e.preventDefault();
    const i = $('signupPassword');
    if (i) {
      i.type = i.type === 'password' ? 'text' : 'password';
      e.target.textContent = i.type === 'password' ? '👁️' : '🙈';
    }
  });

  // Quiz
  on('paraForm', 'submit', (e) => { e.preventDefault(); startGame(); });
  on('answerForm', 'submit', (e) => { e.preventDefault(); checkAnswer(); });
  on('checkBtn', 'click', (e) => { e.preventDefault(); checkAnswer(); });
  on('nextBtn', 'click', (e) => { e.preventDefault(); nextQ(); });
  on('hintBtn', 'click', (e) => { e.preventDefault(); showHint(); });
  on('goParaSelect', 'click', () => { loadQuran(); showScreen('paraSelectScreen'); });
  on('backFromQuiz', 'click', () => showScreen('welcomeScreen'));
  on('goHomeBtn', 'click', () => resetGame(true));
  on('playAgainBtn', 'click', () => resetGame(false));

  // Profile
  on('profileBtn', 'click', openProfilePanel);
  on('ppCloseBtn', 'click', closeProfilePanel);
  on('profileOverlay', 'click', closeProfilePanel);
  on('ppLogoutBtn', 'click', () => { closeProfilePanel(); doLogout(); });

  // Language
  on('btnHinglish', 'click', () => applyLang('hinglish'));
  on('btnEnglish', 'click', () => applyLang('english'));

  // Search
  on('searchForm', 'submit', doSearch);
  on('toggleSearchBtn', 'click', () => {
    const sc = $('searchContainer'), btn = $('toggleSearchBtn');
    if (sc && btn) {
      const vis = sc.style.display === 'block';
      sc.style.display = vis ? 'none' : 'block';
      btn.textContent = vis ? '🔎 Search' : '❌ Band Karein';
      if (!vis) setTimeout(() => $('searchInput')?.focus(), 100);
    }
  });

  // Online Match
  on('goOnlineMatch', 'click', openOnlineLobby);
  on('backFromLobby', 'click', () => showScreen('welcomeScreen'));
  on('joinStarter', 'click', () => joinTable('starter'));
  on('joinBronze', 'click', () => joinTable('bronze'));
  on('joinSilver', 'click', () => joinTable('silver'));
  on('joinGold', 'click', () => joinTable('gold'));
  on('joinDiamond', 'click', () => joinTable('diamond'));
  on('cancelMatchBtn', 'click', async () => {
    if (MS.matchId && MS.tableKey && MS.myRole === 'p1') {
      const mRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
      try {
        const snap = await get(mRef);
        if (snap.exists() && snap.val().status === 'waiting') {
          await remove(mRef).catch(() => {});
          await remove(ref(rtdb, `queues/${MS.tableKey}`)).catch(() => {});
          MS.matchId = null;
          MS.myRole = null;
        }
      } catch(e) {}
    }
    leaveMatchCleanup(true);
    showScreen('onlineLobbyScreen');
  });

  // Exit Match
  on('exitMatchBtn', 'click', showExitConfirm);
  on('exitMatchCancel', 'click', hideExitConfirm);
  on('exitMatchConfirm', 'click', async () => {
    hideExitConfirm();
    leaveMatchCleanup(false);
    showScreen('welcomeScreen');
  });

  // Match Result
  on('matchPlayAgainBtn', 'click', () => openOnlineLobby());
  on('matchGoHomeBtn', 'click', () => showScreen('welcomeScreen'));
  on('matchAnswerForm', 'submit', (e) => { e.preventDefault(); submitMatchAnswer(false); });

  setupUidCopy();
  applyLang(currentLang);
});

// Mobile Optimizations
if (isMobile()) {
  document.addEventListener('touchstart', function() {}, false);
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, false);
}

document.addEventListener('wheel', function(event) {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });