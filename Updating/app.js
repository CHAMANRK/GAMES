// ═══════════════════════════════════════════════════════════════
//  app.js — COMBINED SINGLE FILE (app-core + app-game + app-online + entry)
//  Bugs Fixed:
//  [BUG-1] MS was used in cancelMatchBtn but not imported in original app.js
//  [BUG-2] Dynamic import inside cancelMatchBtn replaced with top-level import
//  [BUG-3] Accuracy update race condition in _addCoins fixed (local optimistic calc)
//  [BUG-4] Missing resetSubmit() call after timeOut in submitMatchAnswer added
//  [BUG-5] _buildPool: empty quranData guard improved
//  [BUG-6] ppContactBtn keyboard accessibility (keypress) listener added
// ═══════════════════════════════════════════════════════════════
'use strict';

// ── Firebase Imports ──
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInAnonymously,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  doc, setDoc, getDoc, updateDoc, increment,
  serverTimestamp, onSnapshot, runTransaction, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase,
  ref, set, get, onValue, remove, update, push, off,
  runTransaction as rtdbTx,
  onDisconnect as rtdbOnDisconnect
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// ═══════════════════════════════════════════
//  SECTION 1: CONFIG & FIREBASE INIT
// ═══════════════════════════════════════════

const CONFIG = {
  FIREBASE_CONFIG: {
    apiKey:            "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
    authDomain:        "quran-quiz-3ee30.firebaseapp.com",
    databaseURL:       "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
    projectId:         "quran-quiz-3ee30",
    storageBucket:     "quran-quiz-3ee30.firebasestorage.app",
    messagingSenderId: "362662301719",
    appId:             "1:362662301719:web:e5fa7bd4adf633758e8c52",
    measurementId:     "G-CVQTH5SS0X"
  },
  GUEST_QUESTION_LIMIT:     3,
  MAX_HINTS:                2,
  POOL_EXTRA:               20,
  SUBMIT_COOLDOWN_MS:       500,
  GRACE_PERIOD_SEC:         15,
  MATCH_AUTO_CANCEL_MS:     60000,
  BOOT_FAILSAFE_MS:         8000,
  FIRESTORE_TIMEOUT_MS:     5000,
  BRUTE_FORCE_MAX_ATTEMPTS: 5,
  BRUTE_FORCE_TIMEOUT_MS:   300000,
  COIN_RATE_LIMIT_MAX:      5,
  COIN_RATE_LIMIT_WINDOW_MS:60000,
};

const TABLES = {
  starter: { name: '🪵 Starter', fee: 200,  totalQ: 7,  firstTo: 4, winCoins: 400   },
  bronze:  { name: '🥉 Bronze',  fee: 500,  totalQ: 9,  firstTo: 5, winCoins: 1000  },
  silver:  { name: '🥈 Silver',  fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000  },
  gold:    { name: '🥇 Gold',    fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000  },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};

const _app  = initializeApp(CONFIG.FIREBASE_CONFIG);
const auth  = getAuth(_app);
const db    = getFirestore(_app);
const rtdb  = getDatabase(_app);
const GP    = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  SECTION 2: MANAGERS
// ═══════════════════════════════════════════

class TimerManager {
  constructor() { this._t = new Map(); this._i = new Map(); }
  setTimeout(id, cb, ms) {
    this.clearTimeout(id);
    const t = setTimeout(() => { try { cb(); } catch(e){} this._t.delete(id); }, ms);
    this._t.set(id, t); return t;
  }
  setInterval(id, cb, ms) {
    this.clearInterval(id);
    const t = setInterval(() => { try { cb(); } catch(e){} }, ms);
    this._i.set(id, t); return t;
  }
  clearTimeout(id)  { const t = this._t.get(id); if (t !== undefined) { clearTimeout(t);  this._t.delete(id); } }
  clearInterval(id) { const t = this._i.get(id); if (t !== undefined) { clearInterval(t); this._i.delete(id); } }
  clearAll() { this._t.forEach(t => clearTimeout(t)); this._i.forEach(t => clearInterval(t)); this._t.clear(); this._i.clear(); }
}

class ListenerManager {
  constructor() { this._m = new Map(); }
  add(id, fn)  { if (this._m.has(id)) { try { this._m.get(id)(); } catch(_){} } this._m.set(id, fn); }
  remove(id)   { const fn = this._m.get(id); if (fn) { try { fn(); } catch(_){} this._m.delete(id); } }
  removeAll()  { this._m.forEach(fn => { try { fn(); } catch(_){} }); this._m.clear(); }
}

class RateLimiter {
  constructor(max, win) { this._max = max; this._win = win; this._r = []; }
  canRequest() {
    const now = Date.now();
    this._r = this._r.filter(t => now - t < this._win);
    if (this._r.length < this._max) { this._r.push(now); return true; }
    return false;
  }
}

class BruteForceProtection {
  constructor() { this._m = new Map(); }
  _clean(k) {
    const cut = Date.now() - CONFIG.BRUTE_FORCE_TIMEOUT_MS;
    const l   = (this._m.get(k) || []).filter(t => t > cut);
    this._m.set(k, l); return l;
  }
  record(email)      { const k = email.toLowerCase(); const l = this._clean(k); l.push(Date.now()); this._m.set(k, l); }
  isBlocked(email)   { return this._clean(email.toLowerCase()).length >= CONFIG.BRUTE_FORCE_MAX_ATTEMPTS; }
  remainingMs(email) { const l = this._clean(email.toLowerCase()); return l.length ? Math.max(0, CONFIG.BRUTE_FORCE_TIMEOUT_MS - (Date.now() - l[0])) : 0; }
  reset(email)       { this._m.delete(email.toLowerCase()); }
}

// ═══════════════════════════════════════════
//  SECTION 3: APP STATE
// ═══════════════════════════════════════════

const timerManager    = new TimerManager();
const listenerManager = new ListenerManager();
const coinRateLimiter = new RateLimiter(CONFIG.COIN_RATE_LIMIT_MAX, CONFIG.COIN_RATE_LIMIT_WINDOW_MS);
const bfp             = new BruteForceProtection();

let _curUser   = null;
let _curData   = null;
let _connected = false;
const getCurUser   = () => _curUser;
const getCurData   = () => _curData;
const isConnected  = () => _connected;
const setCurUser   = u  => { _curUser = u; };
const setCurData   = d  => { _curData = d; };
const setConnected = v  => { _connected = v; };

let _guestAnswered = 0;
const getGuestAnswered   = () => _guestAnswered;
const incGuestAnswered   = () => { _guestAnswered++; };
const resetGuestCounters = () => { _guestAnswered = 0; };

const quizState = {
  quranData: [], quranLoading: false, selAyats: [], curAyat: null,
  qIdx: 0, score: 0, totalQ: 10, mode: 'practice', usedI: [],
  surahC: {}, startT: 0, timeArr: [], survOn: true, hints: 0,
  sessionCorrect: 0, sessionTotal: 0,
};
function resetQuizState() {
  Object.assign(quizState, { qIdx:0, score:0, usedI:[], surahC:{}, timeArr:[],
    hints:0, survOn:true, sessionCorrect:0, sessionTotal:0 });
}

function freshMatchState() {
  return {
    tableKey: null, matchId: null, myRole: null, opponentName: null,
    myScore: 0, oppScore: 0, myQIdx: 0, currentAyatIndex: -1,
    answered: false, feeDeducted: false, inSuddenDeath: false,
    _ended: false, _refunding: false,
    listeners: new ListenerManager(), timers: new TimerManager(),
    disconnectGraceTimer: null,
  };
}
const MS = freshMatchState();
const resetMS = () => { const f = freshMatchState(); Object.keys(f).forEach(k => { MS[k] = f[k]; }); };

let _joiningVal = false;
const getJoining = () => _joiningVal;
const setJoining = v => { _joiningVal = v; };

let _lastSubmit = 0;
const getLastSubmit = () => _lastSubmit;
const setLastSubmit = () => { _lastSubmit = Date.now(); };
const resetSubmit   = () => { _lastSubmit = 0; };

let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
const setLang = lang => { currentLang = lang; localStorage.setItem('nqg_lang', lang); };

// ═══════════════════════════════════════════
//  SECTION 4: UI HELPERS
// ═══════════════════════════════════════════

const $  = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

const isMobile = (() => {
  const r = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return () => r;
})();

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\//g,'&#x2F;');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const _uiTimers = new TimerManager();

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id);
  if (sc) { sc.classList.add('active'); window.scrollTo(0,0); if (isMobile()) setTimeout(() => document.activeElement?.blur?.(), 100); }
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer'); if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn'); if (b) b.textContent = '🔎 Search';
  }
}

let _toastEl = null;
function toast(msg, type = 'info', dur = 3000) {
  if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.id = '_toast'; document.body.appendChild(_toastEl); }
  _toastEl.textContent = msg;
  _toastEl.className   = `toast toast-${type} toast-show`;
  _uiTimers.setTimeout('toast', () => _toastEl.classList.remove('toast-show'), dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.className   = `auth-msg ${type} show`;
  if (isMobile()) setTimeout(() => el.scrollIntoView({ behavior:'smooth', block:'center' }), 100);
}
function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => { m.className = 'auth-msg'; m.textContent = ''; });
}

const _origTexts = new WeakMap();
function btnLoad(id, loading, fallback) {
  const b = $(id); if (!b) return;
  if (loading) {
    _origTexts.set(b, b.textContent);
    b.disabled = true; b.textContent = '⏳'; b.style.pointerEvents = 'none'; b.style.opacity = '0.6';
  } else {
    b.disabled = false; b.textContent = fallback || _origTexts.get(b) || b.textContent;
    b.style.pointerEvents = 'auto'; b.style.opacity = '1';
  }
}

let _bootDone = false;
function hideBootLoader(force = false) {
  if (_bootDone && !force) return;
  _bootDone = true;
  const bl = $('bootLoader'); if (!bl) return;
  bl.style.transition = 'opacity 0.45s ease'; bl.style.opacity = '0';
  _uiTimers.setTimeout('bootHide', () => { bl.style.display = 'none'; }, 480);
}
const isBootDone = () => _bootDone;

function typeText(text, elId, instant = false) {
  const el = $(elId); if (!el || !text) return;
  el.textContent = '';
  if (instant) { el.textContent = text; return; }
  _uiTimers.clearTimeout('typeText');
  let i = 0;
  const tick = () => { if (i < text.length) { el.textContent += text[i++]; _uiTimers.setTimeout('typeText', tick, 20); } };
  tick();
}

function spawnCoinParticles(fromEl, toEl, count = 18) {
  if (!fromEl || !toEl) return;
  const fR = fromEl.getBoundingClientRect(), tR = toEl.getBoundingClientRect();
  const startX = fR.left + fR.width/2, startY = fR.top + fR.height/2;
  const endX   = tR.left + tR.width/2, endY   = tR.top  + tR.height/2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.textContent = '🪙';
    const sz = 12 + Math.random() * 12;
    p.style.cssText = `position:fixed;left:${startX}px;top:${startY}px;font-size:${sz}px;transform:translate(-50%,-50%);pointer-events:none;z-index:99997;opacity:1;will-change:transform,opacity;`;
    document.body.appendChild(p);
    const delay = Math.random()*250, spread=(Math.random()-.5)*120, arc=-(Math.random()*80+40), dur=500+Math.random()*400;
    const dx = endX-startX+spread, dy = endY-startY;
    _uiTimers.setTimeout(`cp_${i}`, () => {
      const anim = p.animate([
        { transform:'translate(-50%,-50%) scale(1)', opacity:1, offset:0 },
        { transform:`translate(calc(-50% + ${dx*.4}px),calc(-50% + ${arc}px)) scale(1.2)`, opacity:1, offset:0.4 },
        { transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.4)`, opacity:0, offset:1 },
      ], { duration:dur, easing:'cubic-bezier(0.22,1,0.36,1)', fill:'forwards' });
      anim.onfinish = () => p.remove();
    }, delay);
  }
}

function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup'); if (!p) return;
  const wn = $('wpName'), wc = $('wpCoins');
  if (wn) wn.textContent = isNew ? `Ahlan, ${esc(name)}! 🌙` : `Marhaba, ${esc(name)}! 🌙`;
  if (wc) wc.textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  _uiTimers.setTimeout('welcomeHide', () => p.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  SECTION 5: VALIDATORS
// ═══════════════════════════════════════════

const isValidEmail     = e  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isValidUsername  = un => un && un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);
const isValidPassword  = pw => pw && pw.length >= 6;
const isValidParaRange = (f, t) => !isNaN(f) && !isNaN(t) && f >= 1 && t <= 30 && f <= t;

// ═══════════════════════════════════════════
//  SECTION 6: USER (Firestore sync, header, profile panel)
// ═══════════════════════════════════════════

const _ppTimers = new TimerManager();
let _userUnsub  = null;

async function syncUser(uid, data) {
  try {
    const userRef = doc(db, 'users', uid);
    const snap    = await getDoc(userRef);
    if (!snap.exists()) {
      await runTransaction(db, async tx => {
        const existing = await tx.get(userRef);
        if (existing.exists()) return;
        const newData = {
          uid, username: data.username || 'Player', email: data.email || '',
          coins: 500, xp:0, level:1, accuracy:0, totalGames:0, totalWins:0,
          totalCorrect:0, streak:0, bestStreak:0, avgSpeed:0, fastestAnswer:0,
          lastLogin: serverTimestamp(), createdAt: serverTimestamp(),
          isHafiz:false, role:'user', avatar:'default', onlineMode:true,
          badges:[], friends:[], friendRequests:[], bookmarks:[]
        };
        tx.set(userRef, newData);
        setCurData(newData);
      });
    } else {
      setCurData(snap.data());
      const upd = { lastLogin: serverTimestamp() };
      const d   = snap.data();
      if (!d.onlineMode)     upd.onlineMode     = true;
      if (!d.friendRequests) upd.friendRequests = [];
      if (!d.friends)        upd.friends        = [];
      updateDoc(userRef, upd).catch(() => {});
    }
    startUserListener(uid);
  } catch(e) { console.error('syncUser error:', e.message); }
}

function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
  _userUnsub = onSnapshot(doc(db,'users',uid),
    snap => { if (snap.exists()) { setCurData(snap.data()); updateHeader(); } },
    err  => console.warn('UserListener error:', err.message)
  );
}

function stopUserListener() { if (_userUnsub) { _userUnsub(); _userUnsub = null; } }

function updateHeader() {
  const curUser = getCurUser(), curData = getCurData();
  const pb = $('profileBtn'), hc = $('hdrCoins'), hv = $('hdrCoinsVal'), gl = $('guestLogoutPill');
  if (curUser && !curUser.isAnonymous) {
    pb?.classList.remove('hidden'); hc?.classList.remove('hidden');
    if (hv) hv.textContent = (curData?.coins || 0).toLocaleString();
    if (gl) gl.style.display = 'none';
    refreshProfilePanel();
  } else if (curUser?.isAnonymous) {
    pb?.classList.add('hidden'); hc?.classList.add('hidden');
    if (gl) gl.style.display = 'flex';
  } else {
    pb?.classList.add('hidden'); hc?.classList.add('hidden');
    if (gl) gl.style.display = 'none';
  }
}

function refreshProfilePanel() {
  const curUser = getCurUser(), curData = getCurData();
  if (!curUser || curUser.isAnonymous || !curData) return;
  const isHafiz = curData.isHafiz || false;
  const s = (id, v) => { const el=$(id); if(el) el.textContent=v; };
  s('ppUsername', esc(curData.username || curUser.displayName || 'Player'));
  s('ppRole',     isHafiz ? '👑 Hafiz' : curData.role === 'admin' ? '🛡️ Admin' : '🎮 Player');
  s('ppCoins',    (curData.coins    || 0).toLocaleString());
  s('ppAccuracy', (curData.accuracy || 0) + '%');
  s('ppGames',     curData.totalGames || 0);
  const uidEl = $('ppUidVal'); if (uidEl) uidEl.textContent = curUser.uid;
  const av    = $('ppAvatarCircle'); if (av) av.textContent = isHafiz ? '👑' : '👤';
  const pb    = $('profileBtnIcon'); if (pb) pb.textContent = isHafiz ? '👑' : '👤';
}

function openProfilePanel()  { refreshProfilePanel(); $('profilePanel')?.classList.add('open'); $('profileOverlay')?.classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeProfilePanel() { $('profilePanel')?.classList.remove('open'); $('profileOverlay')?.classList.add('hidden'); document.body.style.overflow=''; }

function setupUidCopy() {
  on('ppUidCopy', 'click', () => {
    const uid = getCurUser()?.uid; if (!uid) return;
    const done = () => { const el=$('ppUidCopied'); if(el){ el.classList.remove('hidden'); _ppTimers.setTimeout('uidCopyHide',()=>el.classList.add('hidden'),2000); } };
    navigator.clipboard.writeText(uid).then(done).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = uid; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
    });
  });
}

// ═══════════════════════════════════════════
//  SECTION 7: AUTH
// ═══════════════════════════════════════════

function fbErr(code) {
  const m = {
    'auth/email-already-in-use':  '❌ Email pehle se registered hai.',
    'auth/invalid-email':         '❌ Sahi email likhein.',
    'auth/user-not-found':        '❌ Email registered nahi.',
    'auth/wrong-password':        '❌ Password galat hai.',
    'auth/invalid-credential':    '❌ Email ya password galat hai.',
    'auth/weak-password':         '❌ Password min 6 chars chahiye.',
    'auth/too-many-requests':     '❌ Zyada try — baad mein koshish karein.',
    'auth/network-request-failed':'❌ Internet check karein.',
    'auth/popup-blocked':         '❌ Popup block — allow karein.',
  };
  return m[code] || `❌ Error: ${code}`;
}

function switchTab(tab) {
  if (!['login','signup'].includes(tab)) return;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
  if (isMobile()) setTimeout(() => $(`${tab}Panel`)?.querySelector('input')?.focus(), 200);
}

async function doLogin() {
  clearMsgs();
  const emailEl = $('loginEmail'), pwEl = $('loginPassword');
  const email   = emailEl?.value.trim() || '';
  const pw      = pwEl?.value || '';
  if (!email || !pw)        return setMsg('loginMsg','❌ Email aur password likhein!');
  if (!isValidEmail(email)) return setMsg('loginMsg','❌ Sahi email likhein.');
  if (!isValidPassword(pw)) return setMsg('loginMsg','❌ Password min 6 chars.');
  if (bfp.isBlocked(email)) { const sec=Math.ceil(bfp.remainingMs(email)/1000); return setMsg('loginMsg',`❌ Zyada attempts — ${sec}s wait karein.`); }
  btnLoad('loginBtn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await syncUser(cred.user.uid, { username: cred.user.displayName || email.split('@')[0], email: cred.user.email });
    if (emailEl) emailEl.value = ''; if (pwEl) pwEl.value = '';
    bfp.reset(email); showScreen('welcomeScreen'); toast('✅ Login ho gaye!','success');
    const d = getCurData(); if (d) showWelcomePopup(d.username||'Player', d.coins||0);
  } catch(e) {
    bfp.record(email);
    let msg = fbErr(e.code);
    if (bfp.isBlocked(email)) msg += `\n⏱️ ${Math.ceil(bfp.remainingMs(email)/1000)}s ruko...`;
    setMsg('loginMsg', msg); btnLoad('loginBtn', false, '🔐 Login');
  }
}

async function doSignup() {
  clearMsgs();
  const un  = $('signupUsername')?.value.trim()  || '';
  const em  = $('signupEmail')?.value.trim()     || '';
  const pw  = $('signupPassword')?.value         || '';
  const cpw = $('signupConfirmPw')?.value        || '';
  if (!un||!em||!pw||!cpw)    return setMsg('signupMsg','❌ Sab fields bharen!');
  if (!isValidUsername(un))   return setMsg('signupMsg','❌ Username: 3-20 chars, letters/numbers/_ sirf.');
  if (!isValidEmail(em))      return setMsg('signupMsg','❌ Sahi email likhein.');
  if (!isValidPassword(pw))   return setMsg('signupMsg','❌ Password min 6 chars.');
  if (pw !== cpw)             return setMsg('signupMsg','❌ Passwords match nahi!');
  btnLoad('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(cred.user, { displayName: un });
    await syncUser(cred.user.uid, { username: un, email: em });
    ['signupUsername','signupEmail','signupPassword','signupConfirmPw'].forEach(id=>{ const el=$(id); if(el) el.value=''; });
    showScreen('welcomeScreen'); showWelcomePopup(un, 500, true); toast('✅ Account ban gaya! 500🪙 mile!','success');
  } catch(e) { setMsg('signupMsg', fbErr(e.code)); btnLoad('signupBtn', false, '📝 Account Banayein'); }
}

async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn','googleSignupBtn'].forEach(id => btnLoad(id, true));
  try {
    const result = await signInWithPopup(auth, GP);
    const user   = result.user;
    const name   = user.displayName || user.email.split('@')[0];
    const isNew  = result._tokenResponse?.isNewUser || false;
    await syncUser(user.uid, { username: name, email: user.email });
    showScreen('welcomeScreen');
    showWelcomePopup(name, isNew ? 500 : (getCurData()?.coins || 0), isNew);
    toast('✅ Google se login!','success');
  } catch(e) { if (e.code !== 'auth/popup-closed-by-user') setMsg('loginMsg', fbErr(e.code)); }
  ['googleLoginBtn','googleSignupBtn'].forEach(id => btnLoad(id, false));
}

async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth);
    resetGuestCounters();
    showScreen('welcomeScreen');
    toast('👤 Guest mode — 3 sawaal free!','info', 4000);
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)'); }
}

async function doLogout() {
  leaveMatchCleanup(false);
  stopUserListener();
  listenerManager.removeAll();
  timerManager.clearAll();
  await signOut(auth);
  setCurUser(null); setCurData(null);
  bfp._m.clear();
  updateHeader();
  showScreen('authScreen');
  toast('👋 Phir aana!','info');
}

async function doForgot() {
  const em = $('loginEmail')?.value.trim();
  if (!em)                return setMsg('loginMsg','❌ Pehle email likhein!');
  if (!isValidEmail(em))  return setMsg('loginMsg','❌ Sahi email likhein.');
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg','📧 Reset email bhej diya!','success');
    timerManager.setTimeout('resetMsg', () => { const el=$('loginMsg'); if(el) el.className='auth-msg'; }, 5000);
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); }
}

function initAuthListener() {
  onValue(ref(rtdb, '.info/connected'), snap => { setConnected(snap.val() === true); });

  timerManager.setTimeout('bootFailsafe', () => {
    if (!isBootDone()) {
      hideBootLoader(true); showScreen('authScreen');
      toast('⚠️ Connection slow — dobara try karein','error', 5000);
    }
  }, CONFIG.BOOT_FAILSAFE_MS);

  onAuthStateChanged(auth, async user => {
    timerManager.clearTimeout('bootFailsafe');
    setCurUser(user);
    if (user) {
      if (!user.isAnonymous) {
        try {
          const snap = await Promise.race([
            getDoc(doc(db,'users',user.uid)),
            new Promise((_,rej) => timerManager.setTimeout('fsto', () => rej(new Error('timeout')), CONFIG.FIRESTORE_TIMEOUT_MS))
          ]);
          if (snap.exists()) { setCurData(snap.data()); updateHeader(); }
        } catch(e) { console.warn('User data load skip:', e.message); }
        startUserListener(user.uid);
      }
      updateHeader(); showScreen('welcomeScreen');
      if (!isBootDone() && getCurData()) {
        const d = getCurData(); showWelcomePopup(d.username||'Player', d.coins||0);
      } else if (!isBootDone() && !user.isAnonymous) {
        timerManager.setTimeout('welcomeDelay', () => { const d=getCurData(); if(d) showWelcomePopup(d.username||'Player',d.coins||0); }, 1500);
      }
    } else {
      stopUserListener(); setCurUser(null); setCurData(null); updateHeader(); showScreen('authScreen');
    }
    hideBootLoader();
  });
}

// ═══════════════════════════════════════════
//  SECTION 8: SEARCH
// ═══════════════════════════════════════════

function normalizeArabic(t) {
  if (!t) return '';
  return String(t)
    .replace(/\uFEFF/g,'')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
    .replace(/[\u0622\u0623\u0624\u0625\u0626\u0671]/g,'\u0627')
    .replace(/\u0629/g,'\u0647')
    .trim().toLowerCase();
}

function performSearch(raw) {
  const q  = normalizeArabic(raw);
  const rd = $('searchResults'); if (!rd) return;
  if (!q) { rd.innerHTML = '<em>Kuch likhein...</em>'; return; }
  if (!quizState.quranData.length) { rd.innerHTML = '<em>Data load ho raha hai...</em>'; return; }
  const found = quizState.quranData.filter(a => {
    if (normalizeArabic(a.text).includes(q))       return true;
    if (normalizeArabic(a.surah_name).includes(q)) return true;
    if (String(a.page) === raw.trim())             return true;
    const para = a.para || (((a.page-1)/20|0)+1);
    if (String(para) === raw.trim())               return true;
    return false;
  }).slice(0,30);
  if (!found.length) { rd.textContent = 'Koi result nahi mila.'; return; }
  rd.innerHTML = '';
  found.forEach(r => {
    const para = r.para || (((r.page-1)/20|0)+1);
    const div  = document.createElement('div');
    div.className = 'search-result';
    div.addEventListener('click', () => window.open(`https://quran.com/page/${r.page}`,'_blank'));
    div.textContent = `${r.text} — Surah: ${r.surah_name} | Page: ${r.page} | Para: ${para}`;
    rd.appendChild(div);
  });
}

function doSearch(e) {
  if (e) e.preventDefault();
  const raw = $('searchInput')?.value.trim() || '';
  timerManager.clearTimeout('searchDebounce');
  timerManager.setTimeout('searchDebounce', () => performSearch(raw), 300);
}

// ═══════════════════════════════════════════
//  SECTION 9: FRIENDS
// ═══════════════════════════════════════════

async function searchFriend() {
  const uid     = $('friendUidInput')?.value.trim();
  const preview = $('friendSearchPreview');
  const msg     = $('addFriendMsg');
  if (msg)     { msg.className='auth-msg'; msg.textContent=''; }
  if (preview) { preview.innerHTML=''; }
  if (!uid)  { showFriendMsg('❌ UID likhein!','error'); return; }
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) { showFriendMsg('❌ Login karein!','error'); return; }
  if (uid === curUser.uid)             { showFriendMsg('❌ Khud ko friend nahi kar sakte!','error'); return; }
  try {
    const snap = await getDoc(doc(db,'users',uid));
    if (!snap.exists()) { showFriendMsg('❌ User nahi mila.','error'); return; }
    const data    = snap.data();
    const curData = getCurData();
    const friends = curData?.friends || [];
    const already = friends.includes(uid);
    const pending = (curData?.friendRequests || []).includes(uid);
    if (preview) {
      preview.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'friend-preview-card';
      card.innerHTML = `<div class="friend-preview-avatar">👤</div>
        <div class="friend-preview-info">
          <div class="friend-preview-name">${esc(data.username||'Player')}</div>
          <div class="friend-preview-stats">🪙 ${(data.coins||0).toLocaleString()} | 🎯 ${data.accuracy||0}%</div>
          <div class="friend-preview-uid">${esc(uid.slice(0,20))}...</div>
        </div>`;
      if (!already) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary friend-action-btn';
        btn.style.cssText = 'margin-top:10px;width:100%;padding:10px';
        btn.textContent = pending ? '✅ Request Bheja' : '➕ Friend Request Bhejo';
        btn.disabled    = pending;
        if (!pending) btn.addEventListener('click', () => _sendFriendRequest(uid, data.username));
        card.appendChild(btn);
      } else {
        const tag = document.createElement('div');
        tag.style.cssText = 'color:var(--emerald);font-size:0.82rem;margin-top:8px;font-family:Tajawal,sans-serif';
        tag.textContent = '✅ Pehle se dost hai';
        card.appendChild(tag);
      }
      preview.appendChild(card);
    }
  } catch(e) { showFriendMsg('❌ Error. Dobara try karein.','error'); }
}

async function _sendFriendRequest(targetUid, targetName) {
  const curUser = getCurUser(); if (!curUser) return;
  try {
    await updateDoc(doc(db,'users',targetUid), { friendRequests: arrayUnion(curUser.uid) });
    showFriendMsg(`✅ ${esc(targetName)} ko request bheja!`,'success');
  } catch(e) { showFriendMsg('❌ Request bhejne mein error.','error'); }
}

async function _acceptRequest(senderUid) {
  const curUser = getCurUser(); if (!curUser) return;
  try {
    await updateDoc(doc(db,'users',curUser.uid), { friends: arrayUnion(senderUid), friendRequests: arrayRemove(senderUid) });
    await updateDoc(doc(db,'users',senderUid),   { friends: arrayUnion(curUser.uid) });
    toast('✅ Friend request accept!','success');
  } catch(e) { toast('❌ Error accepting request.','error'); }
}

async function _rejectRequest(senderUid) {
  const curUser = getCurUser(); if (!curUser) return;
  try { await updateDoc(doc(db,'users',curUser.uid), { friendRequests: arrayRemove(senderUid) }); toast('Request reject ho gayi.','info'); }
  catch(e) { toast('❌ Error.','error'); }
}

async function _unfriend(targetUid) {
  const curUser = getCurUser(); if (!curUser) return;
  try {
    await updateDoc(doc(db,'users',curUser.uid), { friends: arrayRemove(targetUid) });
    await updateDoc(doc(db,'users',targetUid),   { friends: arrayRemove(curUser.uid) });
    toast('Dost list se hata diya.','info');
  } catch(e) { toast('❌ Error.','error'); }
}

function startFriendsListener() {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) return;
  const unsub = onSnapshot(doc(db,'users',curUser.uid), async snap => {
    if (!snap.exists()) return;
    const data    = snap.data();
    const friends = data.friends        || [];
    const pending = data.friendRequests || [];
    const pl = $('pendingList'), pLabel = $('pendingLabel');
    if (pl) {
      pl.innerHTML = '';
      if (pending.length) {
        if (pLabel) pLabel.style.display='block';
        for (const uid of pending.slice(0,10)) {
          try {
            const ps = await getDoc(doc(db,'users',uid)); if (!ps.exists()) continue;
            const pd  = ps.data();
            const row = document.createElement('div'); row.className='friend-card';
            row.innerHTML = `<div class="friend-avatar">👤</div><div class="friend-info"><div class="friend-name">${esc(pd.username||'Player')}</div></div>`;
            const acc = document.createElement('button'); acc.className='friend-action-btn accept-btn'; acc.textContent='✅ Accept'; acc.addEventListener('click',()=>_acceptRequest(uid));
            const rej = document.createElement('button'); rej.className='friend-action-btn reject-btn'; rej.textContent='❌'; rej.addEventListener('click',()=>_rejectRequest(uid));
            row.appendChild(acc); row.appendChild(rej); pl.appendChild(row);
          } catch(_){}
        }
      } else { if (pLabel) pLabel.style.display='none'; }
    }
    const fl = $('friendsList'); if (!fl) return;
    fl.innerHTML = '';
    if (!friends.length) { fl.innerHTML='<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Koi dost nahi — UID se dhundein!</div>'; return; }
    for (const uid of friends.slice(0,20)) {
      try {
        const fs = await getDoc(doc(db,'users',uid)); if (!fs.exists()) continue;
        const fd  = fs.data(); const row = document.createElement('div'); row.className='friend-card';
        const unBtn = document.createElement('button'); unBtn.className='friend-action-btn unfriend-btn'; unBtn.textContent='🚫 Hata'; unBtn.addEventListener('click',()=>_unfriend(uid));
        row.innerHTML=`<div class="friend-avatar">👤</div><div class="friend-info"><div class="friend-name">${esc(fd.username||'Player')}</div><div class="friend-uid">${esc(uid.slice(0,16))}...</div></div>`;
        row.appendChild(unBtn); fl.appendChild(row);
      } catch(_){}
    }
  }, err => console.warn('Friends listener error:', err.message));
  listenerManager.add('friendsListener', unsub);
}

function stopFriendsListener() { listenerManager.remove('friendsListener'); }

function showFriendMsg(msg, type) {
  const el=$('addFriendMsg'); if(!el) return;
  el.textContent=msg; el.className=`auth-msg ${type} show`;
}

// ═══════════════════════════════════════════
//  SECTION 10: QURAN DATA LOADER
// ═══════════════════════════════════════════

async function loadQuran(retries = 0, maxRetries = 3) {
  if (quizState.quranData.length || quizState.quranLoading) return;
  quizState.quranLoading = true;
  try {
    const res = await fetch('quran_full.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quizState.quranData = await res.json();
    if (!Array.isArray(quizState.quranData) || !quizState.quranData.length)
      throw new Error('Invalid data format');
    console.log('✅ Quran loaded:', quizState.quranData.length, 'ayats');
  } catch(e) {
    console.error('❌ Quran load fail:', e.message);
    if (retries < maxRetries) {
      quizState.quranLoading = false;
      await new Promise(r => setTimeout(r, Math.pow(2, retries) * 2000));
      return loadQuran(retries + 1, maxRetries);
    }
    quizState.quranData = [];
    toast('❌ Quran data load fail', 'error', 5000);
  } finally {
    quizState.quranLoading = false;
  }
}

// ═══════════════════════════════════════════
//  SECTION 11: SOLO QUIZ LOGIC
// ═══════════════════════════════════════════

const getPara = a => a.para || (((a.page - 1) / 20 | 0) + 1);
const getPip  = a => a.pip  || (((parseInt(a.page) - 1) % 20) + 1);

async function startGame() {
  const er = $('selectError');
  if (er) er.classList.add('hidden');

  const curUser = getCurUser();
  if (curUser?.isAnonymous && getGuestAnswered() >= CONFIG.GUEST_QUESTION_LIMIT) {
    if (er) { er.textContent = '❌ 3 free questions khatam! Account banao!'; er.classList.remove('hidden'); }
    const gm = $('guestModal');
    if (gm) gm.style.display = 'flex';
    else { showScreen('authScreen'); switchTab('signup'); }
    return;
  }

  if (!quizState.quranData.length) {
    if (er) { er.textContent = '⏳ Data load ho raha hai...'; er.classList.remove('hidden'); }
    await loadQuran();
    if (!quizState.quranData.length) {
      if (er) { er.textContent = '❌ Quran data load nahi hua.'; er.classList.remove('hidden'); }
      return;
    }
    if (er) er.classList.add('hidden');
  }

  const fp = parseInt($('fromPara')?.value);
  const tp = parseInt($('toPara')?.value);
  if (!isValidParaRange(fp, tp)) {
    if (er) { er.textContent = '❌ Para 1-30 ke beech!'; er.classList.remove('hidden'); }
    return;
  }

  quizState.selAyats = quizState.quranData.filter(a => {
    const para = getPara(a);
    return para >= fp && para <= tp;
  });

  if (!quizState.selAyats.length) {
    if (er) { er.textContent = '❌ Is range mein ayat nahi mile.'; er.classList.remove('hidden'); }
    return;
  }

  resetQuizState();
  quizState.mode   = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  quizState.totalQ = quizState.mode === 'timed' ? 10 : 9999;

  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);
  $('survivalAnswer')?.classList.add('hidden');

  nextQ();
  showScreen('quizScreen');
}

function nextQ() {
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');

  const nb = $('nextBtn');
  if (nb) { nb.textContent = '➡️ Agla Sawal'; nb.classList.add('hidden'); }

  ['quizError','quizResult','survivalAnswer'].forEach(id => $(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  $('checkBtn') && ($('checkBtn').disabled = false);

  quizState.hints = 0;
  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);

  if (quizState.qIdx >= quizState.totalQ || quizState.usedI.length >= quizState.selAyats.length) {
    endQuiz(); return;
  }

  let idx, tries = 0;
  do { idx = Math.floor(Math.random() * quizState.selAyats.length); tries++; }
  while (quizState.usedI.includes(idx) && tries < 1000);
  quizState.usedI.push(idx);
  quizState.curAyat = quizState.selAyats[idx];

  if (!quizState.curAyat) { endQuiz(); return; }

  typeText(quizState.curAyat.text, 'ayatText');

  const para   = getPara(quizState.curAyat);
  const maxPip = para === 29 ? 24 : para === 30 ? 25 : 20;
  const pipInp = $('user_page_in_para');
  if (pipInp) { pipInp.max = maxPip; pipInp.placeholder = `PiP (1-${maxPip})`; }

  quizState.qIdx++;
  _updateQuizStats();
  quizState.startT = Date.now();

  if (quizState.mode === 'timed') _startTimer(30);
  else { const tm = $('timer'); if (tm) tm.textContent = ''; }
}

function checkAnswer() {
  const now = Date.now();
  if (now - getLastSubmit() < CONFIG.SUBMIT_COOLDOWN_MS) return;
  setLastSubmit();

  const cb = $('checkBtn');
  if (cb?.disabled) return;
  if (cb) cb.disabled = true;
  timerManager.clearInterval('quizTimer');

  const ts  = Math.round((Date.now() - quizState.startT) / 1000);
  const para = $('user_para')?.value.trim()         || '';
  const pip  = $('user_page_in_para')?.value.trim() || '';
  const pg   = $('user_page')?.value.trim()          || '';
  const sur  = $('user_surah')?.value.trim().toLowerCase() || '';
  const rk   = $('user_ruku')?.value.trim()          || '';
  const ay   = $('user_ayat')?.value.trim()           || '';

  ['quizError','quizResult'].forEach(id => $(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer')?.classList.add('hidden');

  if (!para) { _showErr('❌ Para Number zaroori hai!'); if(cb) cb.disabled=false; resetSubmit(); return; }
  const paraNum = parseInt(para);
  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) { _showErr('❌ Para 1-30 ke beech!'); if(cb) cb.disabled=false; resetSubmit(); return; }

  const ayat = quizState.curAyat;
  const ap   = getPara(ayat);
  const aip  = getPip(ayat);
  const pn   = parseInt(ayat.page);

  let parts = [], opt = 0;
  const pOk = paraNum === ap;
  if (!pOk) parts.push(`❌ Para Galat! Sahi: ${ap}`);

  let pipOk = true;
  if (pip) {
    const pipNum = parseInt(pip);
    if (isNaN(pipNum)) { parts.push('❌ PiP number likhein!'); pipOk=false; }
    else if (pipNum !== aip) { parts.push(`❌ PiP Galat! Sahi: ${aip}`); pipOk=false; }
  }
  if (pg)  { const pgNum=parseInt(pg);  if(!isNaN(pgNum) && pgNum===pn) opt++; else if(!isNaN(pgNum)) parts.push(`❌ Page Galat! Sahi: ${pn}`); }
  if (sur) { if (ayat.surah_name.toLowerCase().includes(sur)) opt++; else parts.push(`❌ Surah Galat! Sahi: ${esc(ayat.surah_name)}`); }
  if (rk && ayat.ruku_no !== undefined)  { const rkN=parseInt(rk);  if(!isNaN(rkN) && rkN===ayat.ruku_no) opt++; else if(!isNaN(rkN)) parts.push(`❌ Ruku Galat! Sahi: ${ayat.ruku_no}`); }
  if (ay && ayat.ayat_no !== undefined)  { const ayN=parseInt(ay);  if(!isNaN(ayN) && ayN===ayat.ayat_no) opt++; else if(!isNaN(ayN)) parts.push(`❌ Ayat Galat! Sahi: ${ayat.ayat_no}`); }

  const ok = pOk && (pip ? pipOk : true);
  quizState.sessionTotal++;

  if (ok) {
    quizState.score++; quizState.sessionCorrect++;
    quizState.surahC[ayat.surah_name] = (quizState.surahC[ayat.surah_name] || 0) + 1;
    quizState.timeArr.push(ts);
    const earned = _calcCoins(ts, opt, quizState.hints, quizState.mode === 'survival');
    const spd    = ts<=5?'⚡ Super Fast!': ts<=10?'🏃 Fast!': ts<=20?'👍 Good':'🐢 Slow';
    _addCoins(earned, 1, 1);
    const msgParts = [`✅ Sahi! +${earned}🪙  ${spd} (${ts}s)`];
    if (opt>0)             msgParts.push(`+${opt*5}🪙 optional`);
    if (quizState.hints>0) msgParts.push(`-${quizState.hints*5}🪙 hint`);
    _showRes(msgParts.join(' | '), true);
    if (quizState.sessionCorrect % 10 === 0) { toast(`🔥 ${quizState.sessionCorrect} sahi! +50🪙!`,'success',3000); _addCoins(50,0,0); }
  } else {
    if (quizState.sessionTotal > 0) _addCoins(0,0,1);
    _showRes(parts.join('\n') || '❌ Galat!', false);
    if (quizState.mode === 'survival') {
      quizState.survOn = false;
      const sa = $('survivalAnswer');
      if (sa) { sa.textContent = `Sahi Jawab: Surah: ${ayat.surah_name} | Para: ${ap} | Page: ${pn} | PiP: ${aip}`; sa.classList.remove('hidden'); }
      timerManager.setTimeout('survivalEnd', endQuiz, 2200);
      return;
    }
  }

  if (ok || quizState.mode !== 'survival') {
    incGuestAnswered();
    const curUser = getCurUser();
    if (curUser?.isAnonymous && getGuestAnswered() >= CONFIG.GUEST_QUESTION_LIMIT) {
      timerManager.clearInterval('autoNext');
      const gm = $('guestModal');
      if (gm) gm.style.display = 'flex';
      return;
    }
  }

  $('nextBtn')?.classList.remove('hidden');
  _updateQuizStats();
  quizState.hints = 0;
  _startAutoNext();
}

function showHint() {
  if (quizState.hints >= CONFIG.MAX_HINTS || !quizState.curAyat) return;
  quizState.hints++;
  const hi = $('hintInfo'); if (hi) hi.textContent = `Hint: ${quizState.hints}/${CONFIG.MAX_HINTS}`;
  const hb = $('hintBtn');  if (hb && quizState.hints >= CONFIG.MAX_HINTS) hb.disabled = true;
  const ap = getPara(quizState.curAyat);
  const s2 = quizState.curAyat.surah_name.split(' ').slice(0,2).join(' ');
  const e  = $('quizError'); if (!e) return;
  e.textContent = `💡 Hint (-5🪙): Surah: ${s2}..., Para: ${ap}`;
  e.classList.remove('hidden');
  timerManager.setTimeout('hideHint', () => e.classList.add('hidden'), 3500);
}

function endQuiz() {
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');

  let avg=0, fast=0;
  if (quizState.timeArr.length) {
    const sum = quizState.timeArr.reduce((a,b)=>a+b,0);
    avg  = Math.round(sum / quizState.timeArr.length);
    fast = Math.min(...quizState.timeArr);
  }

  const acc  = quizState.sessionTotal > 0 ? Math.round((quizState.sessionCorrect/quizState.sessionTotal)*100) : 0;
  let best='', mx=0;
  Object.entries(quizState.surahC).forEach(([s,c]) => { if(c>mx){mx=c;best=s;} });
  const spd     = avg<=8?'⚡ Speed Master': avg<=15?'🏃 Quick Player':'📚 Careful Reader';
  const curData = getCurData();

  const fr = $('finalResult');
  if (fr) {
    fr.innerHTML = `
      <div class="result-grid">
        <div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${quizState.score}/${quizState.qIdx}</span><span class="ri-lbl">Score</span></div>
        <div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div>
        <div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div>
        <div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div>
        <div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins||0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div>
        <div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${esc(best)||'—'}</span><span class="ri-lbl">Best Surah</span></div>
      </div>
      <div class="speed-badge">${spd}</div>
      <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${quizState.mode==='survival'&&!quizState.survOn?'💥 Survival Khatam!':'🎉 Mubarak!'}</div>
    `;
  }
  showScreen('resultScreen');
}

function resetGame(goHome) {
  resetQuizState();
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');
  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);
  showScreen(goHome ? 'welcomeScreen' : 'paraSelectScreen');
}

// ── Game Internal Helpers ──

async function _addCoins(amount, correct, total) {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous)   return;
  if (!amount && !correct && !total)     return;
  if (!coinRateLimiter.canRequest())     return;
  try {
    const userRef = doc(db,'users',curUser.uid);
    const upd     = { lastPlayed: serverTimestamp() };
    if (amount  > 0) upd.coins        = increment(Math.max(0, amount));
    if (correct > 0) upd.totalCorrect = increment(correct);
    if (total   > 0) upd.totalGames   = increment(total);
    // [BUG-3 FIX] Use optimistic local calc to avoid race condition
    if ((correct > 0 || total > 0) && getCurData()) {
      const cd = getCurData();
      const nc = (cd.totalCorrect||0) + correct;
      const nt = (cd.totalGames||0)  + total;
      if (nt > 0) upd.accuracy = Math.round((nc/nt)*100);
    }
    await updateDoc(userRef, upd);
  } catch(e) { console.error('Coins save error:', e.message); }
}

function _calcCoins(ts, opt, hints, isSurvival) {
  ts=Math.max(0,Math.min(300,ts||0)); opt=Math.max(0,opt||0); hints=Math.max(0,Math.min(CONFIG.MAX_HINTS,hints||0));
  let c = ts<=5?15: ts<=10?12: ts<=15?10: ts<=20?8: ts<=30?6: 5;
  c += opt*5 - hints*5;
  if (isSurvival) c += 20;
  return Math.max(0,Math.min(500,c));
}

function _showRes(msg, ok) {
  const d = $('quizResult'); if(!d) return;
  d.textContent=msg; d.className=ok?'result':'error'; d.classList.remove('hidden');
  if (ok) timerManager.setTimeout('hideRes',()=>d.classList.add('hidden'),5000);
}

function _showErr(msg) {
  const e=$('quizError'); if(!e) return;
  e.textContent=msg; e.classList.remove('hidden');
  timerManager.setTimeout('hideErr',()=>e.classList.add('hidden'),2500);
}

function _updateQuizStats() {
  const acc = quizState.sessionTotal>0 ? Math.round((quizState.sessionCorrect/quizState.sessionTotal)*100) : 0;
  const sb  = $('scoreBoard');
  if (sb) sb.textContent=`Score: ${quizState.score}/${quizState.qIdx}  |  🎯 ${acc}%`;
  const qp  = $('quizProgress');
  if (qp) qp.textContent = quizState.mode==='practice'?`🎯 Practice — Sawal: ${quizState.qIdx}`
                          : quizState.mode==='survival' ?`💥 Survival — Sawal: ${quizState.qIdx}`
                          :`⏱️ ${quizState.qIdx} / ${quizState.totalQ}`;
}

function _startTimer(sec) {
  const el=$('timer'); if(!el) return;
  timerManager.clearInterval('quizTimer');
  let t=sec; el.textContent=`⏱️ ${t}s`; el.classList.remove('urgent');
  timerManager.setInterval('quizTimer',()=>{
    t--; el.textContent=`⏱️ ${t}s`; if(t<=10) el.classList.add('urgent');
    if (t<=0) {
      timerManager.clearInterval('quizTimer'); el.textContent="⏱️ Time's up!"; el.classList.remove('urgent');
      quizState.timeArr.push(sec); quizState.sessionTotal++;
      $('checkBtn')&&($('checkBtn').disabled=true);
      _showRes('⏱️ Waqt khatam!',false); $('nextBtn')?.classList.remove('hidden'); _startAutoNext();
    }
  },1000);
}

function _startAutoNext() {
  timerManager.clearInterval('autoNext');
  let cd=5; const nb=$('nextBtn');
  if (nb) nb.textContent=`➡️ Agla Sawal (${cd}s)`;
  timerManager.setInterval('autoNext',()=>{
    cd--; if(nb) nb.textContent=cd>0?`➡️ Agla Sawal (${cd}s)`:'➡️ Agla Sawal';
    if (cd<=0){ timerManager.clearInterval('autoNext'); nextQ(); }
  },1000);
}

// ═══════════════════════════════════════════
//  SECTION 12: ONLINE MATCH
// ═══════════════════════════════════════════

async function openOnlineLobby() {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) { toast('❌ Login karo pehle!','error'); showScreen('authScreen'); return; }
  loadQuran();
  showScreen('onlineLobbyScreen');
  try { const snap=await getDoc(doc(db,'users',curUser.uid)); if(snap.exists()) setCurData(snap.data()); } catch(_){}
  const coins = getCurData()?.coins || 0;
  const li    = $('lobbyCoinsInfo');
  if (li) li.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} — Table chuniye!`;
  Object.entries(TABLES).forEach(([key,t]) => {
    const id  = `join${key.charAt(0).toUpperCase()+key.slice(1)}`;
    const btn = $(id); if (!btn) return;
    if (coins < t.fee) { btn.disabled=true; btn.textContent=`🔒 ${t.fee}🪙 chahiye`; }
    else               { btn.disabled=false; btn.textContent=`Join (${t.fee}🪙)`; }
  });
}

async function joinTable(tableKey) {
  const curUser = getCurUser();
  if (!curUser || !getCurData())  { toast('❌ Login karein!','error'); return; }
  if (!isConnected())             { toast('❌ Internet check karein!','error'); return; }
  if (getJoining())               { toast('⏳ Thoda ruko...','info'); return; }
  if (MS.matchId || MS.myRole)    leaveMatchCleanup(false);

  setJoining(true);
  const table = TABLES[tableKey];
  if (!table) { setJoining(false); toast('❌ Invalid table!','error'); return; }

  try { const snap=await getDoc(doc(db,'users',curUser.uid)); if(snap.exists()) setCurData(snap.data()); } catch(_){}

  const coins = getCurData()?.coins || 0;
  if (coins < table.fee) { setJoining(false); toast(`❌ ${table.fee}🪙 chahiye! Aapke paas: ${coins}🪙`,'error'); return; }

  if (!quizState.quranData.length) {
    toast('⏳ Data load ho raha hai...','info');
    await loadQuran();
    if (!quizState.quranData.length) { setJoining(false); toast('❌ Quran data load nahi hua!','error'); return; }
  }

  Object.assign(MS, freshMatchState());
  MS.tableKey    = tableKey;
  MS.feeDeducted = false;

  try {
    await runTransaction(db, async tx => {
      const userRef = doc(db,'users',curUser.uid);
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists()) throw new Error('User not found');
      if ((userDoc.data().coins||0) < table.fee) throw new Error('Insufficient coins');
      tx.update(userRef, { coins: increment(-table.fee) });
    });
    MS.feeDeducted = true;
  } catch(e) { setJoining(false); toast('❌ Coins deduct error. Try again.','error'); return; }

  showScreen('matchWaitScreen');
  $('matchWaitInfo')  && ($('matchWaitInfo').textContent  = table.name);
  $('matchWaitTimer') && ($('matchWaitTimer').textContent = '0s');

  const waitStart = Date.now();
  MS.timers.setInterval('matchWait',()=>{ const el=$('matchWaitTimer'); if(el) el.textContent=`${Math.floor((Date.now()-waitStart)/1000)}s`; },1000);

  try { await _findOrCreateMatch(tableKey); } finally { setJoining(false); }
}

async function _findOrCreateMatch(tableKey) {
  const curUser = getCurUser(), curData = getCurData();
  const qRef    = ref(rtdb, `queues/${tableKey}`);
  let txResult  = { asP2:false, p2MatchId:null, oppData:null };

  try {
    await rtdbTx(qRef, current => {
      if (!current || current.uid === curUser.uid) {
        return { uid:curUser.uid, username:curData?.username||'Player', matchId:'', ts:Date.now() };
      }
      txResult.asP2=true; txResult.p2MatchId=current.matchId; txResult.oppData=current;
      return;
    });
  } catch(e) { await _doRefund(); toast('❌ Matchmaking error. Retry karein.','error'); showScreen('onlineLobbyScreen'); return; }

  if (txResult.asP2) {
    let p2MatchId=txResult.p2MatchId, tries=0;
    while ((!p2MatchId||p2MatchId==='') && tries<16) {
      await new Promise(r=>setTimeout(r,500));
      try { const snap=await get(qRef); if(!snap.exists()){p2MatchId=null;break;} const mid=snap.val()?.matchId; if(mid&&mid!=='') p2MatchId=mid; } catch(_){}
      tries++;
    }
    if (!p2MatchId) { await _doRefund(); toast('❌ Match nahi mila. Retry karein.','error'); showScreen('onlineLobbyScreen'); return; }
    MS.matchId=p2MatchId; MS.myRole='p2'; MS.opponentName=txResult.oppData?.username||'Player';
    await _p2JoinMatch(p2MatchId, tableKey, qRef);
  } else {
    let matchId;
    try {
      matchId=push(ref(rtdb,`matches/${tableKey}`)).key; MS.matchId=matchId; MS.myRole='p1';
      const tbl=TABLES[tableKey];
      await set(ref(rtdb,`matches/${tableKey}/${matchId}`),{
        status:'waiting', table:tableKey, totalQ:tbl.totalQ, questionPool:[],
        p1:{uid:curUser.uid,name:curData?.username||'Player',score:0,qIdx:0,connected:true},
        p2:{uid:'',name:'',score:0,qIdx:0,connected:false},
        winner:'', createdAt:Date.now()
      });
      await update(qRef,{matchId});
    } catch(e) { await _doRefund(); toast('❌ Match create error.','error'); showScreen('onlineLobbyScreen'); return; }

    _p1WaitForOpponent(tableKey, matchId);

    MS.timers.setTimeout('matchAutoCancel', async()=>{
      try {
        const snap=await get(ref(rtdb,`matches/${tableKey}/${matchId}`));
        if (snap.exists()&&snap.val().status==='waiting') {
          await remove(ref(rtdb,`matches/${tableKey}/${matchId}`)).catch(()=>{});
          await remove(qRef).catch(()=>{});
          MS.matchId=null; MS.myRole=null; leaveMatchCleanup(false); await _doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!','info',4000); showScreen('onlineLobbyScreen');
        }
      } catch(_){}
    }, CONFIG.MATCH_AUTO_CANCEL_MS);
  }
}

function _p1WaitForOpponent(tableKey, matchId) {
  const mRef  = ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap=>{
    if (!snap.exists()) return;
    const d=snap.val();
    if (d.status==='active'&&d.p2?.uid) { MS.listeners.remove(`p1Wait_${matchId}`); MS.opponentName=d.p2.name; startOnlineMatch(tableKey,matchId,d); }
  }, err=>console.warn('P1 wait error:',err.message));
  MS.listeners.add(`p1Wait_${matchId}`,unsub);
}

async function _p2JoinMatch(matchId, tableKey, qRef) {
  const curUser=getCurUser(), curData=getCurData();
  const mRef=ref(rtdb,`matches/${tableKey}/${matchId}`);
  let snap; try{snap=await get(mRef);}catch(_){await _doRefund();toast('❌ Match data error.','error');showScreen('onlineLobbyScreen');return;}
  if (!snap.exists()){await _doRefund();toast('❌ Match cancel ho gaya.','error');showScreen('onlineLobbyScreen');return;}
  if (snap.val().status!=='waiting'){await _doRefund();toast('❌ Match pehle se start ho gaya.','error');showScreen('onlineLobbyScreen');return;}
  const tbl=TABLES[tableKey];
  // [BUG-5 FIX] Guard against empty quranData in pool builder
  if (!quizState.quranData.length) { await _doRefund(); toast('❌ Quran data missing!','error'); showScreen('onlineLobbyScreen'); return; }
  const questionPool=_buildPool(tbl.totalQ+CONFIG.POOL_EXTRA);
  try {
    await update(mRef,{ status:'active', questionPool, 'p2/uid':curUser.uid, 'p2/name':curData?.username||'Player', 'p2/score':0, 'p2/qIdx':0, 'p2/connected':true });
  } catch(_){await _doRefund();toast('❌ Match join error.','error');showScreen('onlineLobbyScreen');return;}
  if (qRef) remove(qRef).catch(()=>{});
  const finalSnap=await get(mRef).catch(()=>null);
  if (finalSnap?.exists()) startOnlineMatch(tableKey,matchId,finalSnap.val());
}

function _buildPool(size) {
  if (!quizState.quranData.length) return [];
  const idx=Array.from({length:quizState.quranData.length},(_,i)=>i);
  for(let i=idx.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
  return idx.slice(0,size);
}

function startOnlineMatch(tableKey, matchId, initData) {
  MS.timers.clearInterval('matchWait');
  MS.timers.clearTimeout('matchAutoCancel');
  MS.feeDeducted=false; MS.myQIdx=0; MS.inSuddenDeath=false;
  showScreen('onlineMatchScreen'); _hidePopups();

  const curData=getCurData();
  if($('myName'))  $('myName').textContent  = curData?.username||'Player';
  if($('oppName')) $('oppName').textContent = MS.opponentName||'Opponent';
  if($('myScore')) $('myScore').textContent = '0';
  if($('oppScore'))$('oppScore').textContent= '0';

  const myConnRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`);
  set(myConnRef,true).catch(()=>{}); rtdbOnDisconnect(myConnRef).set(false).catch(()=>{});

  const pool=initData.questionPool||[];
  if (pool.length) { MS.currentAyatIndex=pool[0]; _showMatchQuestion(pool[0],1,TABLES[tableKey].totalQ); }
  _triggerMatchStartParticles();

  const mRef  = ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap=>{
    if (MS._ended) return;
    if (!snap.exists()) { _handleMatchEnd(false,'opponent_left'); return; }
    const d=snap.val(), tbl=TABLES[tableKey], isP1=MS.myRole==='p1';
    const myD=isP1?d.p1:d.p2, opD=isP1?d.p2:d.p1;
    if($('myScore'))  $('myScore').textContent  = myD?.score||0;
    if($('oppScore')) $('oppScore').textContent = opD?.score||0;
    MS.myScore=myD?.score||0; MS.oppScore=opD?.score||0;

    if (opD?.connected===false&&!MS.disconnectGraceTimer&&(d.status==='active'||d.status==='sudden_death')) {
      _showDisconnectGrace(CONFIG.GRACE_PERIOD_SEC);
      MS.disconnectGraceTimer=timerManager.setTimeout(`dg_${matchId}`,async()=>{
        try {
          const fresh=await get(mRef); if(!fresh.exists()) return;
          const freshOp=isP1?fresh.val().p2:fresh.val().p1;
          if (freshOp?.connected===false&&fresh.val().status!=='finished') {
            await rtdbTx(ref(rtdb,`matches/${tableKey}/${matchId}/winner`),c=>(c&&c!=='')?undefined:MS.myRole);
            await update(mRef,{status:'finished'}); _handleMatchEnd(true,'opponent_left');
          } else { MS.disconnectGraceTimer=null; _hideDisconnectGrace(); }
        } catch(_){MS.disconnectGraceTimer=null;}
      },CONFIG.GRACE_PERIOD_SEC*1000);
    } else if (opD?.connected===true&&MS.disconnectGraceTimer) {
      timerManager.clearTimeout(`dg_${matchId}`); MS.disconnectGraceTimer=null; _hideDisconnectGrace();
    }

    if (d.winner&&d.status==='finished') { _handleMatchEnd(d.winner===MS.myRole); return; }
    if (MS.myScore>=tbl.firstTo)  { _handleMatchEnd(true);  return; }
    if (MS.oppScore>=tbl.firstTo) { _handleMatchEnd(false); return; }

    const myDone=(myD?.qIdx||0)>=tbl.totalQ, oppDone=(opD?.qIdx||0)>=tbl.totalQ;
    if (myDone&&oppDone&&d.status==='active') {
      if (MS.myScore>MS.oppScore)       { _handleMatchEnd(true);  return; }
      if (MS.myScore<MS.oppScore)       { _handleMatchEnd(false); return; }
      if (!MS.inSuddenDeath) { MS.inSuddenDeath=true; if(MS.myRole==='p2') update(mRef,{status:'sudden_death'}).catch(()=>{}); _enterSuddenDeath(d.questionPool,myD?.qIdx||0); }
      return;
    }
    if (d.status==='sudden_death'&&!MS.inSuddenDeath) { MS.inSuddenDeath=true; _enterSuddenDeath(d.questionPool,myD?.qIdx||0); return; }
    const newQIdx=myD?.qIdx||0;
    if (newQIdx>MS.myQIdx) { MS.myQIdx=newQIdx; if(d.questionPool?.[newQIdx]!==undefined) MS.currentAyatIndex=d.questionPool[newQIdx]; }
  }, err=>console.warn('Match listener err:',err.message));
  MS.listeners.add(`matchListener_${matchId}`,unsub);
}

function _enterSuddenDeath(pool, currentQIdx) {
  _showSuddenDeathBanner();
  const sdIdx=pool?.[currentQIdx];
  if (sdIdx!==undefined) { MS.currentAyatIndex=sdIdx; const mp=$('matchProgress'); if(mp)mp.textContent='⚡ SUDDEN DEATH'; _showMatchQuestion(sdIdx,null,null,true); }
}

function _showMatchQuestion(ayatIndex, qNum, totalQ, isSuddenDeath=false) {
  const ayat=quizState.quranData[ayatIndex]; if(!ayat) return;
  MS.answered=false;
  if (!isSuddenDeath) { const mp=$('matchProgress'); if(mp) mp.textContent=qNum&&totalQ?`Sawal ${qNum} / ${totalQ}`:`Sawal ${qNum}`; }
  const el=$('matchAyatText'); if(el) el.textContent=ayat.text;
  $('matchAnswerForm')?.reset(); $('matchCheckBtn')&&($('matchCheckBtn').disabled=false);
  const mr=$('matchResult'); if(mr){mr.classList.add('hidden');mr.textContent='';}
  const para=ayat.para||(((ayat.page-1)/20|0)+1), maxPip=para===29?24:para===30?25:20;
  const pipInp=$('match_pip'); if(pipInp){pipInp.max=maxPip;pipInp.placeholder=`PiP (1-${maxPip})`;}
  _startMatchTimer(30);
}

function _startMatchTimer(sec) {
  MS.timers.clearInterval('matchTimer');
  let t=sec; const f=$('matchTimerFill'),txt=$('matchTimer');
  if(f) f.style.width='100%'; if(txt) txt.textContent=`${t}s`;
  MS.timers.setInterval('matchTimer',()=>{
    t--; if(f) f.style.width=`${(t/sec)*100}%`; if(txt) txt.textContent=`${t}s`;
    if (t<=0){MS.timers.clearInterval('matchTimer'); if(!MS.answered) submitMatchAnswer(true);}
  },1000);
}

async function submitMatchAnswer(timeOut=false) {
  const now=Date.now();
  if (now-getLastSubmit()<CONFIG.SUBMIT_COOLDOWN_MS) return;
  setLastSubmit();
  if (MS.answered) return;
  MS.answered=true; MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn')&&($('matchCheckBtn').disabled=true);
  if (timeOut) {
    resetSubmit(); // [BUG-4 FIX] resetSubmit was missing on timeout path
    _showMatchMsg('⏱️ Waqt khatam!',false);
    await _advanceQ(false);
    return;
  }

  const para=$('match_para')?.value.trim()||'', pip=$('match_pip')?.value.trim()||'';
  if (!para){MS.answered=false;$('matchCheckBtn')&&($('matchCheckBtn').disabled=false);resetSubmit();toast('❌ Para zaroori hai!','error');return;}
  const paraNum=parseInt(para);
  if(isNaN(paraNum)||paraNum<1||paraNum>30){MS.answered=false;$('matchCheckBtn')&&($('matchCheckBtn').disabled=false);resetSubmit();toast('❌ Para 1-30 ke beech!','error');return;}

  const ayat=quizState.quranData[MS.currentAyatIndex];
  if(!ayat){_showMatchMsg('❌ Question data error',false);await _advanceQ(false);return;}

  const ap=ayat.para||(((parseInt(ayat.page)-1)/20|0)+1), aip=ayat.pip||(((parseInt(ayat.page)-1)%20)+1);
  const pOk=paraNum===ap, pipOk=pip?parseInt(pip)===aip:true;

  if (pOk&&pipOk) {
    if (MS.inSuddenDeath) {
      const winRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/winner`);
      const mRef  =ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
      let won=false;
      try { const r=await rtdbTx(winRef,c=>(c&&c!=='')?undefined:MS.myRole); won=r.committed; if(won)await update(mRef,{status:'finished',[`${MS.myRole}/score`]:MS.myScore+1}); } catch(_){}
      _showMatchMsg(`✅ Sahi! Para: ${ap}`,true); _handleMatchEnd(won,won?'sudden_death_win':'sudden_death_loss'); return;
    }
    try { await rtdbTx(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/score`),c=>(c||0)+1); } catch(_){}
    _showMatchMsg(`✅ Sahi! Para: ${ap}${pip?`, PiP: ${aip}`:''}`,true);
  } else { _showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip}`,false); }
  await _advanceQ(pOk&&pipOk);
}

async function _advanceQ(wasCorrect) {
  await new Promise(r=>setTimeout(r,1400));
  if (MS._ended) return;
  const tbl=TABLES[MS.tableKey]; if(!tbl) return;
  const newIdx=MS.myQIdx+1, field=`${MS.myRole}/qIdx`, mRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
  MS.myQIdx=newIdx;
  if (!MS.inSuddenDeath&&newIdx>=tbl.totalQ){update(mRef,{[field]:newIdx}).catch(()=>{}); _showWaitingForOpponent(); return;}
  update(mRef,{[field]:newIdx}).catch(()=>{});
  const snap=await get(mRef).catch(()=>null);
  if (!snap?.exists()||MS._ended) return;
  const pool=snap.val()?.questionPool;
  if (pool?.[newIdx]!==undefined&&!MS.inSuddenDeath){MS.currentAyatIndex=pool[newIdx];_showMatchQuestion(pool[newIdx],newIdx+1,tbl.totalQ);}
}

function _showWaitingForOpponent() {
  const tbl=TABLES[MS.tableKey]||{};
  MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn')&&($('matchCheckBtn').disabled=true);
  const f=$('matchTimerFill');if(f)f.style.width='0%';
  const t=$('matchTimer');if(t)t.textContent='⏳';
  const mp=$('matchProgress');if(mp)mp.textContent=`✅ Aapne ${tbl.totalQ||''} sawaal khatam kiye — ${MS.opponentName||'Opponent'} ka intezaar...`;
  const at=$('matchAyatText');if(at)at.textContent='⏳ Opponent abhi khel raha hai...';
  const mr=$('matchResult');if(mr){mr.classList.add('hidden');mr.textContent='';}
  _showOpponentWaitPopup(true);
}

function _handleMatchEnd(won, reason='') {
  if (MS._ended) return;
  MS._ended=true;
  leaveMatchCleanup(false); _hidePopups();

  const tbl=TABLES[MS.tableKey]||{}, coins=won?(tbl.winCoins||0):0;
  if($('matchResultIcon'))  $('matchResultIcon').textContent  = won?'🏆':'😔';
  if($('matchResultTitle')) $('matchResultTitle').textContent =
    reason==='sudden_death_win'?'⚡ Sudden Death Jeet!': reason==='opponent_left'?'🏆 Opponent Chala Gaya!': won?'Jeet Gaye! 🏆':'Haare! 😔';

  let reasonText='';
  if(reason==='opponent_left')    reasonText='Opponent ne match chhod diya!';
  if(reason==='sudden_death_win') reasonText='⚡ Pehla sahi jawab — Jeet!';
  if(reason==='sudden_death_loss')reasonText='⚡ Opponent ne pehle sahi jawab diya.';
  const rs=$('matchResultScores'); if(rs) rs.textContent=`Aap: ${MS.myScore}  VS  ${MS.opponentName||'Opp'}: ${MS.oppScore}  ${reasonText}`;
  const rc=$('matchResultCoins');  if(rc) rc.textContent=won?`+${coins} 🪙 Jeet ki coins!`:'Koi coins nahi — agali baar!';

  if (won&&coins>0) {
    const curUser=getCurUser();
    if (curUser&&!curUser.isAnonymous) {
      updateDoc(doc(db,'users',curUser.uid),{coins:increment(coins),totalWins:increment(1)}).catch(()=>{});
      toast(`🏆 Jeet Gaye! +${coins}🪙`,'success',4000);
    }
  }
  if (MS.matchId&&MS.tableKey&&MS.myRole==='p1') {
    const _mid=MS.matchId,_tk=MS.tableKey;
    timerManager.setTimeout(`deleteMatch_${_mid}`,()=>remove(ref(rtdb,`matches/${_tk}/${_mid}`)).catch(()=>{}),8000);
  }
  showScreen('matchResultScreen');
  if (won) timerManager.setTimeout('victoryParticles',_triggerVictoryParticles,400);
}

function leaveMatchCleanup(refundFee=false) {
  MS.timers.clearAll(); MS.listeners.removeAll();
  if (MS.tableKey) {
    const qRef=ref(rtdb,`queues/${MS.tableKey}`), curUser=getCurUser();
    get(qRef).then(snap=>{if(snap.exists()&&snap.val()?.uid===curUser?.uid)remove(qRef).catch(()=>{});}).catch(()=>{});
    if (MS.matchId&&MS.myRole&&!MS._ended) set(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`),false).catch(()=>{});
  }
  if (refundFee) _doRefund();
}

async function _doRefund() {
  if (!MS.feeDeducted||!getCurUser()||!MS.tableKey) return;
  if (MS._refunding) return;
  MS._refunding=true; MS.feeDeducted=false;
  const fee=TABLES[MS.tableKey]?.fee||0;
  if (fee>0) {
    try { await updateDoc(doc(db,'users',getCurUser().uid),{coins:increment(fee)}); console.log(`Refunded ${fee} coins`); }
    catch(e){ console.error('Refund error:',e); }
  }
  MS._refunding=false;
}

function showExitConfirm() { const m=$('exitMatchModal'); if(m) m.style.display='flex'; }
function hideExitConfirm() { const m=$('exitMatchModal'); if(m) m.style.display='none'; }

// ── Match UI ──

function _showMatchMsg(msg, ok) {
  const el=$('matchResult'); if(!el) return;
  el.textContent=msg; el.className=ok?'result':'error'; el.classList.remove('hidden');
}

function _hidePopups() { _hideOpponentWaitPopup(); _hideDisconnectGrace(); _hideSuddenDeathBanner(); }

function _showOpponentWaitPopup(allDone=false) {
  let p=$('oppWaitPopup');
  if (!p){p=document.createElement('div');p.id='oppWaitPopup';p.style.cssText='position:fixed;inset:0;background:rgba(5,15,10,.88);backdrop-filter:blur(10px);z-index:8000;display:flex;align-items:center;justify-content:center;';document.body.appendChild(p);}
  const tbl=TABLES[MS.tableKey]||{};
  p.innerHTML=allDone
    ?`<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:32px 24px;text-align:center;max-width:320px;width:90vw;display:flex;flex-direction:column;gap:16px"><div style="font-size:2.5rem">✅</div><div style="font-family:Cinzel,serif;color:var(--gold-light)">Aapne Sawaal Poore Kiye!</div><div style="font-size:1.8rem;font-weight:900;color:var(--emerald)">${MS.myScore} points</div><div style="font-size:0.85rem;color:var(--text-muted)">Nateeja unke khatam hone par aayega</div><div class="match-spinner" style="margin:0 auto"></div></div>`
    :`<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px"><div style="font-size:2rem">⏳</div><div style="font-family:Cinzel,serif;color:var(--gold-light)">Opponent ka Intezaar</div><div class="match-spinner" style="margin:0 auto"></div></div>`;
  p.style.display='flex';
}
function _hideOpponentWaitPopup(){const p=$('oppWaitPopup');if(p)p.style.display='none';}

function _showDisconnectGrace(seconds=15){
  let p=$('disconnectGracePopup');
  if(!p){p=document.createElement('div');p.id='disconnectGracePopup';p.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a0808,#100404);border:1px solid #c4293b60;border-radius:16px;padding:16px 24px;text-align:center;max-width:320px;width:90vw;z-index:9500;display:none;';document.body.appendChild(p);}
  p.innerHTML=`<div style="font-size:1.8rem;margin-bottom:6px">📡</div><div style="font-family:Cinzel,serif;color:var(--gold-light);font-size:0.95rem">Opponent Disconnect!</div><div id="graceCountdown" style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif">${seconds}s intezaar karo...</div>`;
  p.style.display='flex'; p.style.flexDirection='column';
  let cd=seconds;
  timerManager.setInterval('graceCountdown',()=>{
    cd--; const el=$('graceCountdown'); if(el) el.textContent=cd>0?`${cd}s intezaar karo...`:'Match khatam kar raha hai...';
    if(cd<=0) timerManager.clearInterval('graceCountdown');
  },1000);
}
function _hideDisconnectGrace(){timerManager.clearInterval('graceCountdown');const p=$('disconnectGracePopup');if(p)p.style.display='none';}

function _showSuddenDeathBanner(){
  let el=$('suddenDeathBanner');
  if(!el){el=document.createElement('div');el.id='suddenDeathBanner';el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:linear-gradient(135deg,#1a0800,#2a1000);border-bottom:2px solid #d4a84380;';el.innerHTML='<span style="font-size:1.3rem;margin-right:10px">⚡</span><span style="font-family:Cinzel,serif;font-weight:900;font-size:1rem;color:var(--gold-light)">SUDDEN DEATH</span><span style="font-size:1.3rem;margin-left:10px">⚡</span><span style="font-size:0.78rem;color:var(--text-muted);margin-left:12px;font-family:Tajawal,sans-serif">Pehla sahi jawab jeetega!</span>';document.body.appendChild(el);}
  el.style.display='flex';
}
function _hideSuddenDeathBanner(){const el=$('suddenDeathBanner');if(el)el.style.display='none';}

function _triggerMatchStartParticles(){
  const myBox=$('myPlayerBox'),oppBox=$('oppPlayerBox'),vsEl=$('matchVsEl');if(!vsEl)return;
  timerManager.setTimeout('matchStartP',()=>{spawnCoinParticles(myBox,vsEl,14);timerManager.setTimeout('matchStartP2',()=>spawnCoinParticles(oppBox,vsEl,14),120);},400);
}
function _triggerVictoryParticles(){
  const from=$('matchResultIcon'),to=$('hdrCoins');if(!from||!to)return;
  spawnCoinParticles(from,to,20);timerManager.setTimeout('vp2',()=>spawnCoinParticles(from,to,15),300);timerManager.setTimeout('vp3',()=>spawnCoinParticles(from,to,10),600);
}

// ═══════════════════════════════════════════
//  SECTION 13: STARS BACKGROUND
// ═══════════════════════════════════════════

(function initStars() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('starsCanvas'); if (!c) return;
  const x = c.getContext('2d');
  let s = [];
  const rs = () => { c.width=innerWidth; c.height=innerHeight; };
  const is = () => {
    s=[];
    const n=Math.floor(c.width*c.height/8000);
    for(let i=0;i<n;i++) s.push({x:Math.random()*c.width,y:Math.random()*c.height,r:Math.random()*1.2+.2,a:Math.random(),sp:Math.random()*.005+.001,col:Math.random()>.7?'#d4a843':'#00c472'});
  };
  const dr = () => {
    x.clearRect(0,0,c.width,c.height);
    s.forEach(p=>{
      p.a+=p.sp; if(p.a>1||p.a<0)p.sp=-p.sp;
      x.save(); x.globalAlpha=Math.abs(Math.sin(p.a)); x.beginPath(); x.arc(p.x,p.y,p.r,0,Math.PI*2);
      x.fillStyle=p.col; x.shadowBlur=6; x.shadowColor=p.col; x.fill(); x.restore();
    });
    requestAnimationFrame(dr);
  };
  rs(); is(); dr();
  addEventListener('resize',()=>{rs();is();});
})();

// ═══════════════════════════════════════════
//  SECTION 14: ENTRY POINT — DOM READY
// ═══════════════════════════════════════════

initAuthListener();

document.addEventListener('DOMContentLoaded', () => {

  // ── Auth buttons ──
  on('tabLogin',       'click', e => { e.preventDefault(); switchTab('login');  });
  on('tabSignup',      'click', e => { e.preventDefault(); switchTab('signup'); });
  on('loginBtn',       'click', e => { e.preventDefault(); doLogin();           });
  on('signupBtn',      'click', e => { e.preventDefault(); doSignup();          });
  on('googleLoginBtn', 'click', e => { e.preventDefault(); doGoogle();          });
  on('googleSignupBtn','click', e => { e.preventDefault(); doGoogle();          });
  on('guestBtn',       'click', e => { e.preventDefault(); doGuest();           });
  on('forgotBtn',      'click', e => { e.preventDefault(); doForgot();          });
  on('forgotBtn',      'keypress', e => { if(e.key==='Enter'||e.key===' ') { e.preventDefault(); doForgot(); } });
  on('guestLogoutPill','click', () => doLogout());

  // Keyboard shortcuts
  on('loginEmail',    'keypress', e => { if(e.key==='Enter') doLogin();  });
  on('loginPassword', 'keypress', e => { if(e.key==='Enter') doLogin();  });
  on('signupConfirmPw','keypress',e => { if(e.key==='Enter') doSignup(); });

  // Password toggles
  on('toggleLoginPw', 'click', e => {
    const i=$('loginPassword'); if(i){i.type=i.type==='password'?'text':'password'; e.target.textContent=i.type==='password'?'👁️':'🙈';}
  });
  on('toggleSignupPw','click', e => {
    const i=$('signupPassword'); if(i){i.type=i.type==='password'?'text':'password'; e.target.textContent=i.type==='password'?'👁️':'🙈';}
  });

  // ── Guest limit modal ──
  on('guestToSignup','click', () => {
    const gm=$('guestModal'); if(gm) gm.style.display='none';
    showScreen('authScreen'); switchTab('signup');
  });
  on('guestContinue','click', () => {
    const gm=$('guestModal'); if(gm) gm.style.display='none';
  });

  // ── Quiz ──
  on('paraForm',    'submit', e => { e.preventDefault(); startGame();    });
  on('answerForm',  'submit', e => { e.preventDefault(); checkAnswer();  });
  on('nextBtn',     'click',  e => { e.preventDefault(); nextQ();        });
  on('hintBtn',     'click',  e => { e.preventDefault(); showHint();     });
  on('goParaSelect','click',  () => { loadQuran(); showScreen('paraSelectScreen'); });
  on('backFromPara','click',  () => showScreen('welcomeScreen'));
  on('backFromQuiz','click',  () => showScreen('welcomeScreen'));
  on('goHomeBtn',   'click',  () => resetGame(true));
  on('playAgainBtn','click',  () => resetGame(false));

  // ── Profile ──
  on('profileBtn',     'click', openProfilePanel);
  on('ppCloseBtn',     'click', closeProfilePanel);
  on('profileOverlay', 'click', closeProfilePanel);
  on('ppLogoutBtn',    'click', () => { closeProfilePanel(); doLogout(); });
  // [BUG-6 FIX] ppContactBtn keyboard listener added for accessibility
  on('ppContactBtn',   'click',    () => { closeProfilePanel(); showScreen('contactScreen'); });
  on('ppContactBtn',   'keypress', e => { if(e.key==='Enter'||e.key===' ') { closeProfilePanel(); showScreen('contactScreen'); } });
  setupUidCopy();

  // ── Language ──
  const applyLang = lang => {
    if (!['hinglish','english'].includes(lang)) return;
    setLang(lang);
    $('btnHinglish')?.classList.toggle('active', lang==='hinglish');
    $('btnEnglish')?.classList.toggle('active',  lang==='english');
  };
  on('btnHinglish','click',()=>applyLang('hinglish'));
  on('btnEnglish', 'click',()=>applyLang('english'));
  applyLang(currentLang);

  // ── Search ──
  on('searchForm',     'submit', doSearch);
  on('toggleSearchBtn','click', () => {
    const sc=$('searchContainer'), btn=$('toggleSearchBtn');
    if (sc&&btn){
      const vis=sc.style.display==='block';
      sc.style.display=vis?'none':'block';
      btn.textContent =vis?'🔎 Search':'❌ Band Karein';
      if (!vis) setTimeout(()=>$('searchInput')?.focus(),100);
    }
  });

  // ── Online match ──
  on('goOnlineMatch',  'click', openOnlineLobby);
  on('backFromLobby',  'click', ()=>showScreen('welcomeScreen'));
  on('joinStarter',    'click', ()=>joinTable('starter'));
  on('joinBronze',     'click', ()=>joinTable('bronze'));
  on('joinSilver',     'click', ()=>joinTable('silver'));
  on('joinGold',       'click', ()=>joinTable('gold'));
  on('joinDiamond',    'click', ()=>joinTable('diamond'));

  // [BUG-1 & BUG-2 FIX] MS is now in same scope — no import needed, no dynamic import needed
  on('cancelMatchBtn','click', async()=>{
    if (MS.matchId && MS.tableKey && MS.myRole === 'p1') {
      const mRef = ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
      const snap = await get(mRef).catch(()=>null);
      if (snap?.exists() && snap.val().status === 'waiting') {
        await remove(mRef).catch(()=>{});
        await remove(ref(rtdb,`queues/${MS.tableKey}`)).catch(()=>{});
        MS.matchId=null; MS.myRole=null;
      }
    }
    leaveMatchCleanup(true); showScreen('onlineLobbyScreen');
  });

  on('matchAnswerForm','submit', e=>{e.preventDefault();submitMatchAnswer(false);});
  on('exitMatchBtn',   'click', showExitConfirm);
  on('exitMatchCancel','click', hideExitConfirm);
  on('exitMatchConfirm','click',()=>{ hideExitConfirm(); leaveMatchCleanup(false); showScreen('welcomeScreen'); });
  on('matchPlayAgainBtn','click',()=>openOnlineLobby());
  on('matchGoHomeBtn',  'click',()=>showScreen('welcomeScreen'));

  // ── Friends ──
  on('goFriends',      'click', ()=>{ showScreen('friendsScreen'); startFriendsListener(); });
  on('backFromFriends','click', ()=>{ showScreen('welcomeScreen'); stopFriendsListener();  });
  on('searchFriendBtn','click', searchFriend);
  on('friendUidInput', 'keypress',e=>{if(e.key==='Enter')searchFriend();});

  // ── Contact ──
  on('backFromContact','click',()=>showScreen('welcomeScreen'));

  // ── Tasbeeh (7-click on logo) ──
  let clickCount=0;
  const trigger=$('hiddenTasbeehTrigger');
  if (trigger){
    trigger.addEventListener('click',()=>{
      clickCount++;
      if(clickCount>=7){clickCount=0;const o=$('tasbeehOverlay');if(o)o.style.display='flex';}
    });
  }
  $('tasbeehClose')&&$('tasbeehClose').addEventListener('click',()=>{const o=$('tasbeehOverlay');if(o)o.style.display='none';});
  $('tasbeehReset')&&$('tasbeehReset').addEventListener('click',()=>{const c=$('tasbeehCount');if(c)c.textContent='0';});
  $('tasbeehTap')  &&$('tasbeehTap').addEventListener('click',()=>{
    const cnt=$('tasbeehCount');
    if(cnt){const n=(parseInt(cnt.textContent)||0)+1;cnt.textContent=n;cnt.classList.add('tasbeeh-pulse');cnt.addEventListener('animationend',()=>cnt.classList.remove('tasbeeh-pulse'),{once:true});}
  });
  document.querySelectorAll('.tasbeeh-type-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tasbeeh-type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const txt=$('tasbeehArabic'); if(txt) txt.textContent=btn.dataset.text||'';
      $('tasbeehCount')&&($('tasbeehCount').textContent='0');
    });
    if(btn.dataset.type==='subhan'){const txt=$('tasbeehArabic');if(txt)txt.textContent=btn.dataset.text||'';}
  });

  // ── Copyright year ──
  const yr=document.getElementById('copyrightYear'); if(yr) yr.textContent=new Date().getFullYear();

  // ── Mobile optimizations ──
  if(isMobile()){
    document.addEventListener('touchstart',()=>{},false);
    let lastTouchEnd=0;
    document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<=300)e.preventDefault();lastTouchEnd=now;},false);
  }
  document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{passive:false});
});
