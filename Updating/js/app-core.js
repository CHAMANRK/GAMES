// ═══════════════════════════════════════════════════════════════
//  app-core.js
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
  BOOT_FAILSAFE_MS:       8000,
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
// ═══════════════════════════════════════════

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
export function hideBootLoader(force = false) {
  if (_bootDone && !force) return;
  _bootDone = true;
  const bl = $('bootLoader'); if (!bl) return;
  bl.style.transition = 'opacity 0.45s ease'; bl.style.opacity = '0';
  _uiTimers.setTimeout('bootHide', () => { bl.style.display = 'none'; }, 480);
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
    const d = getCurData(); if (d) showWelcomePopup(d.username||'Player', d.coins||0);
  } catch(e) {
    bfp.record(email);
    let msg = fbErr(e.code);
    if (bfp.isBlocked(email)) msg += `\n⏱️ ${Math.ceil(bfp.remainingMs(email)/1000)}s ruko...`;
    setMsg('loginMsg', msg); btnLoad('loginBtn', false, '🔐 Login');
  }
}

export async function doSignup() {
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

export async function doGoogle() {
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

export async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth);
    resetGuestCounters();
    showScreen('welcomeScreen');
    toast('👤 Guest mode — 3 sawaal free!','info', 4000);
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)'); }
}

export async function doLogout() {
  // leaveMatchCleanup called from app.js to avoid circular dep
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

export async function doForgot() {
  const em = $('loginEmail')?.value.trim();
  if (!em)                return setMsg('loginMsg','❌ Pehle email likhein!');
  if (!isValidEmail(em))  return setMsg('loginMsg','❌ Sahi email likhein.');
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg','📧 Reset email bhej diya!','success');
    timerManager.setTimeout('resetMsg', () => { const el=$('loginMsg'); if(el) el.className='auth-msg'; }, 5000);
  } catch(e) { setMsg('loginMsg', fbErr(e.code)); }
}

export function initAuthListener() {
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

export function doSearch(e) {
  if (e) e.preventDefault();
  const raw = $('searchInput')?.value.trim() || '';
  timerManager.clearTimeout('searchDebounce');
  timerManager.setTimeout('searchDebounce', () => performSearch(raw), 300);
}

// ═══════════════════════════════════════════
//  SECTION 9: FRIENDS
// ═══════════════════════════════════════════

export async function searchFriend() {
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

export function startFriendsListener() {
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

export function stopFriendsListener() { listenerManager.remove('friendsListener'); }

function showFriendMsg(msg, type) {
  const el=$('addFriendMsg'); if(!el) return;
  el.textContent=msg; el.className=`auth-msg ${type} show`;
}
