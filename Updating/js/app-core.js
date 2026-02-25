// ═══════════════════════════════════════════════════════════════
//  app-core.js — FIXED VERSION
//  1. Firebase Init & Config
//  2. App State (global variables)
//  3. UI Helpers (DOM, toast, screen nav, buttons)
//  4. Auth (login, signup, google, guest, logout)
//  5. User (profile panel, header, Firestore sync)
//  6. Search
// ═══════════════════════════════════════════════════════════════

import { initializeApp }    from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider,
         createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signInWithPopup, signInAnonymously,
         signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore,
         doc, setDoc, getDoc, updateDoc, increment,
         serverTimestamp, onSnapshot, runTransaction, arrayUnion, arrayRemove }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getDatabase,
         ref, onValue }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// ═══════════════════════════════════════════
//  SECTION 1: CONFIG & FIREBASE INIT
// ═══════════════════════════════════════════

export const CONFIG = {
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
  GUEST_QUESTION_LIMIT:   3,
  MAX_HINTS:              2,
  POOL_EXTRA:             20,
  SUBMIT_COOLDOWN_MS:     500,
  GRACE_PERIOD_SEC:       15,
  MATCH_AUTO_CANCEL_MS:   60000,
  BOOT_FAILSAFE_MS:       12000,  // ✅ FIXED: 8000 → 12000
  FIRESTORE_TIMEOUT_MS:   5000,
  BRUTE_FORCE_MAX_ATTEMPTS: 5,
  BRUTE_FORCE_TIMEOUT_MS:   300000,
  COIN_RATE_LIMIT_MAX:      5,
  COIN_RATE_LIMIT_WINDOW_MS: 60000,
};

export const TABLES = {
  starter: { name: '🪵 Starter', fee: 200,  totalQ: 7,  firstTo: 4, winCoins: 400   },
  bronze:  { name: '🥉 Bronze',  fee: 500,  totalQ: 9,  firstTo: 5, winCoins: 1000  },
  silver:  { name: '🥈 Silver',  fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000  },
  gold:    { name: '🥇 Gold',    fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000  },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};

const _app  = initializeApp(CONFIG.FIREBASE_CONFIG);
export const auth = getAuth(_app);
export const db   = getFirestore(_app);
export const rtdb = getDatabase(_app);
export const GP   = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  SECTION 2: MANAGERS (Timer, Listener, RateLimit, BruteForce)
// ═══════════════════════════════════════════

export class TimerManager {
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

export class ListenerManager {
  constructor() { this._m = new Map(); }
  add(id, fn) { if (this._m.has(id)) { try { this._m.get(id)(); } catch(_){} } this._m.set(id, fn); }
  remove(id)  { const fn = this._m.get(id); if (fn) { try { fn(); } catch(_){} this._m.delete(id); } }
  removeAll() { this._m.forEach(fn => { try { fn(); } catch(_){} }); this._m.clear(); }
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
  record(email)    { const k = email.toLowerCase(); const l = this._clean(k); l.push(Date.now()); this._m.set(k, l); }
  isBlocked(email) { return this._clean(email.toLowerCase()).length >= CONFIG.BRUTE_FORCE_MAX_ATTEMPTS; }
  remainingMs(email) { const l = this._clean(email.toLowerCase()); return l.length ? Math.max(0, CONFIG.BRUTE_FORCE_TIMEOUT_MS - (Date.now() - l[0])) : 0; }
  reset(email)     { this._m.delete(email.toLowerCase()); }
}

// ═══════════════════════════════════════════
//  SECTION 3: APP STATE
// ═══════════════════════════════════════════

export const timerManager    = new TimerManager();
export const listenerManager = new ListenerManager();
export const coinRateLimiter = new RateLimiter(CONFIG.COIN_RATE_LIMIT_MAX, CONFIG.COIN_RATE_LIMIT_WINDOW_MS);

let _curUser   = null;
let _curData   = null;
let _connected = false;
export const getCurUser   = ()    => _curUser;
export const getCurData   = ()    => _curData;
export const isConnected  = ()    => _connected;
export const setCurUser   = u     => { _curUser = u; };
export const setCurData   = d     => { _curData = d; };
export const setConnected = v     => { _connected = v; };

let _guestAnswered = 0;
export const getGuestAnswered   = ()  => _guestAnswered;
export const incGuestAnswered   = ()  => { _guestAnswered++; };
export const resetGuestCounters = ()  => { _guestAnswered = 0; };

export const quizState = {
  quranData: [], quranLoading: false, selAyats: [], curAyat: null,
  qIdx: 0, score: 0, totalQ: 10, mode: 'practice', usedI: [],
  surahC: {}, startT: 0, timeArr: [], survOn: true, hints: 0,
  sessionCorrect: 0, sessionTotal: 0,
};
export function resetQuizState() {
  Object.assign(quizState, { qIdx:0, score:0, usedI:[], surahC:{}, timeArr:[],
    hints:0, survOn:true, sessionCorrect:0, sessionTotal:0 });
}

export function freshMatchState() {
  return {
    tableKey: null, matchId: null, myRole: null, opponentName: null,
    myScore: 0, oppScore: 0, myQIdx: 0, currentAyatIndex: -1,
    answered: false, feeDeducted: false, inSuddenDeath: false,
    _ended: false, _refunding: false,
    listeners: new ListenerManager(), timers: new TimerManager(),
    disconnectGraceTimer: null,
  };
}
export const MS = freshMatchState();
export const resetMS = () => { const f = freshMatchState(); Object.keys(f).forEach(k => { MS[k] = f[k]; }); };
let _joiningVal = false;
export const getJoining = () => _joiningVal;
export const setJoining = v => { _joiningVal = v; };

let _lastSubmit = 0;
export const getLastSubmit = () => _lastSubmit;
export const setLastSubmit = () => { _lastSubmit = Date.now(); };
export const resetSubmit   = () => { _lastSubmit = 0; };

export let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
export const setLang = lang => { currentLang = lang; localStorage.setItem('nqg_lang', lang); };

// ═══════════════════════════════════════════
//  SECTION 4: UI HELPERS
// ═════════════════════════════���═════════════

export const $  = id => document.getElementById(id);
export const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

export const isMobile = (() => {
  const r = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return () => r;
})();

export function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\//g,'&#x2F;');
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const _uiTimers = new TimerManager();

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id);
  if (sc) { sc.classList.add('active'); window.scrollTo(0,0); if (isMobile()) setTimeout(() => document.activeElement?.blur?.(), 100); }
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer'); if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn'); if (b) b.textContent = '🔎 Search';
  }
}

let _toastEl = null;
export function toast(msg, type = 'info', dur = 3000) {
  if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.id = '_toast'; document.body.appendChild(_toastEl); }
  _toastEl.textContent = msg;
  _toastEl.className   = `toast toast-${type} toast-show`;
  _uiTimers.setTimeout('toast', () => _toastEl.classList.remove('toast-show'), dur);
}

export function setMsg(id, msg, type = 'error') {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.className   = `auth-msg ${type} show`;
  if (isMobile()) setTimeout(() => el.scrollIntoView({ behavior:'smooth', block:'center' }), 100);
}
export function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => { m.className = 'auth-msg'; m.textContent = ''; });
}

const _origTexts = new WeakMap();
export function btnLoad(id, loading, fallback) {
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
let _bootHideTimeoutId = null; // ✅ FIXED: Track timeout ID

export function hideBootLoader(force = false) {
  if (_bootDone && !force) return;
  _bootDone = true;
  const bl = $('bootLoader'); if (!bl) return;
  
  // ✅ FIXED: Clear previous timeout before setting new one
  if (_bootHideTimeoutId) {
    _uiTimers.clearTimeout('bootHide');
    _bootHideTimeoutId = null;
  }
  
  bl.style.transition = 'opacity 0.45s ease'; 
  bl.style.opacity = '0';
  _bootHideTimeoutId = _uiTimers.setTimeout('bootHide', () => { 
    bl.style.display = 'none';
    _bootHideTimeoutId = null;
  }, 480);
}
export const isBootDone = () => _bootDone;

export function typeText(text, elId, instant = false) {
  const el = $(elId); if (!el || !text) return;
  el.textContent = '';
  if (instant) { el.textContent = text; return; }
  _uiTimers.clearTimeout('typeText');
  let i = 0;
  const tick = () => { if (i < text.length) { el.textContent += text[i++]; _uiTimers.setTimeout('typeText', tick, 20); } };
  tick();
}

export function spawnCoinParticles(fromEl, toEl, count = 18) {
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

export function showWelcomePopup(name, coins, isNew = false) {
  const p = $('welcomePopup'); if (!p) return;
  const wn = $('wpName'), wc = $('wpCoins');
  if (wn) wn.textContent = isNew ? `Ahlan, ${esc(name)}! 🌙` : `Marhaba, ${esc(name)}! 🌙`;
  if (wc) wc.textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  _uiTimers.setTimeout('welcomeHide', () => p.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  SECTION 5: VALIDATORS (shared, no circular dep)
// ═══════════════════════════════════════════

export const isValidEmail     = e  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const isValidUsername  = un => un && un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);
export const isValidPassword  = pw => pw && pw.length >= 6;
export const isValidParaRange = (f, t) => !isNaN(f) && !isNaN(t) && f >= 1 && t <= 30 && f <= t;

// ═══════════════════════════════════════════
//  SECTION 6: USER (Firestore sync, header, profile panel)
// ═══════════════════════════════════════════

const _ppTimers = new TimerManager();
let _userUnsub  = null;

export async function syncUser(uid, data) {
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

export function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
  _userUnsub = onSnapshot(doc(db,'users',uid),
    snap => { if (snap.exists()) { setCurData(snap.data()); updateHeader(); } },
    err  => console.warn('UserListener error:', err.message)
  );
}

export function stopUserListener() { if (_userUnsub) { _userUnsub(); _userUnsub = null; } }

export function updateHeader() {
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

export function refreshProfilePanel() {
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

export function openProfilePanel()  { refreshProfilePanel(); $('profilePanel')?.classList.add('open'); $('profileOverlay')?.classList.remove('hidden'); document.body.style.overflow='hidden'; }
export function closeProfilePanel() { $('profilePanel')?.classList.remove('open'); $('profileOverlay')?.classList.add('hidden'); document.body.style.overflow=''; }

export function setupUidCopy() {
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

const bfp = new BruteForceProtection();

export function fbErr(code) {
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

export function switchTab(tab) {
  if (!['login','signup'].includes(tab)) return;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
  if (isMobile()) setTimeout(() => $(`${tab}Panel`)?.querySelector('input')?.focus(), 200);
}

export async function doLogin() {
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
    const d = getCurData(); if (d) show