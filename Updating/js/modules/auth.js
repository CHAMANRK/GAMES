// ═══════════════════════════════════════════
//  auth.js — Login, Signup, Google, Guest,
//            Logout, ForgotPassword
//  Fixes: bruteForce cleanup, missing listeners
// ═══════════════════════════════════════════

import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInAnonymously,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { doc, getDoc }  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

import { auth, db, rtdb, GP } from './firebase.js';
import { CONFIG }              from '../../config.js';
import { BruteForceProtection } from './managers.js';
import { $, on, isMobile, btnLoad, setMsg, clearMsgs, showScreen, toast, showWelcomePopup, isBootDone, hideBootLoader } from './ui.js';
import { syncUser, startUserListener, stopUserListener, updateHeader } from './user.js';
import { leaveMatchCleanup } from './online-match.js';
import { listenerManager, timerManager } from '../state/appState.js';

const bfp = new BruteForceProtection();

// ── Validators ──
export const isValidEmail    = e  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const isValidUsername = un => un && un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);
export const isValidPassword = pw => pw && pw.length >= 6;
export const isValidParaRange = (f, t) => !isNaN(f) && !isNaN(t) && f >= 1 && t <= 30 && f <= t;

// ── Firebase error messages ──
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

// ── Tab switch ──
export function switchTab(tab) {
  if (!['login', 'signup'].includes(tab)) return;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
  if (isMobile()) {
    setTimeout(() => $(`${tab}Panel`)?.querySelector('input')?.focus(), 200);
  }
}

// ── Login ──
export async function doLogin() {
  clearMsgs();
  const emailEl = $('loginEmail'), pwEl = $('loginPassword');
  const email   = emailEl?.value.trim() || '';
  const pw      = pwEl?.value          || '';

  if (!email || !pw)              return setMsg('loginMsg', '❌ Email aur password likhein!');
  if (!isValidEmail(email))       return setMsg('loginMsg', '❌ Sahi email likhein.');
  if (!isValidPassword(pw))       return setMsg('loginMsg', '❌ Password min 6 chars.');

  if (bfp.isBlocked(email)) {
    const sec = Math.ceil(bfp.remainingMs(email) / 1000);
    return setMsg('loginMsg', `❌ Zyada attempts — ${sec}s wait karein.`);
  }

  btnLoad('loginBtn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await syncUser(cred.user.uid, { username: cred.user.displayName || email.split('@')[0], email: cred.user.email });
    if (emailEl) emailEl.value = '';
    if (pwEl)    pwEl.value    = '';
    bfp.reset(email);
    showScreen('welcomeScreen');
    toast('✅ Login ho gaye!', 'success');
    const { curData } = await import('../state/appState.js');
    if (curData) showWelcomePopup(curData.username || 'Player', curData.coins || 0);
  } catch (e) {
    console.error('Login error:', e.code);
    bfp.record(email);
    let msg = fbErr(e.code);
    if (bfp.isBlocked(email)) msg += `\n⏱️ ${Math.ceil(bfp.remainingMs(email) / 1000)}s ruko...`;
    setMsg('loginMsg', msg);
    btnLoad('loginBtn', false, '🔐 Login');
  }
}

// ── Signup ──
export async function doSignup() {
  clearMsgs();
  const un  = $('signupUsername')?.value.trim()   || '';
  const em  = $('signupEmail')?.value.trim()      || '';
  const pw  = $('signupPassword')?.value          || '';
  const cpw = $('signupConfirmPw')?.value         || '';

  if (!un || !em || !pw || !cpw)   return setMsg('signupMsg', '❌ Sab fields bharen!');
  if (!isValidUsername(un))        return setMsg('signupMsg', '❌ Username: 3-20 chars, letters/numbers/_ sirf.');
  if (!isValidEmail(em))           return setMsg('signupMsg', '❌ Sahi email likhein.');
  if (!isValidPassword(pw))        return setMsg('signupMsg', '❌ Password min 6 chars.');
  if (pw !== cpw)                  return setMsg('signupMsg', '❌ Passwords match nahi!');

  btnLoad('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await updateProfile(cred.user, { displayName: un });
    await syncUser(cred.user.uid, { username: un, email: em });
    ['signupUsername','signupEmail','signupPassword','signupConfirmPw']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    showScreen('welcomeScreen');
    showWelcomePopup(un, 500, true);
    toast('✅ Account ban gaya! 500🪙 mile!', 'success');
  } catch (e) {
    console.error('Signup error:', e.code);
    setMsg('signupMsg', fbErr(e.code));
    btnLoad('signupBtn', false, '📝 Account Banayein');
  }
}

// ── Google auth ──
export async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => btnLoad(id, true));
  try {
    const result = await signInWithPopup(auth, GP);
    const user   = result.user;
    const name   = user.displayName || user.email.split('@')[0];
    const isNew  = result._tokenResponse?.isNewUser || false;
    await syncUser(user.uid, { username: name, email: user.email });
    showScreen('welcomeScreen');
    const { curData } = await import('../state/appState.js');
    showWelcomePopup(name, isNew ? 500 : (curData?.coins || 0), isNew);
    toast('✅ Google se login!', 'success');
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') setMsg('loginMsg', fbErr(e.code));
  }
  ['googleLoginBtn', 'googleSignupBtn'].forEach(id => btnLoad(id, false));
}

// ── Guest ──
export async function doGuest() {
  btnLoad('guestBtn', true);
  try {
    await signInAnonymously(auth);
    const state = await import('../state/appState.js');
    state.resetGuestCounters();
    showScreen('welcomeScreen');
    toast('👤 Guest mode — 3 sawaal free!', 'info', 4000);
  } catch (e) {
    setMsg('loginMsg', fbErr(e.code));
    btnLoad('guestBtn', false, '👤 Guest (3 sawaal free)');
  }
}

// ── Logout ──
export async function doLogout() {
  leaveMatchCleanup(false);
  stopUserListener();
  listenerManager.removeAll();
  timerManager.clearAll();
  await signOut(auth);
  const state = await import('../state/appState.js');
  state.setCurUser(null);
  state.setCurData(null);
  bfp._map.clear();
  updateHeader();
  showScreen('authScreen');
  toast('👋 Phir aana!', 'info');
}

// ── Forgot password ──
export async function doForgot() {
  const em = $('loginEmail')?.value.trim();
  if (!em)                return setMsg('loginMsg', '❌ Pehle email likhein!');
  if (!isValidEmail(em))  return setMsg('loginMsg', '❌ Sahi email likhein.');
  try {
    await sendPasswordResetEmail(auth, em);
    setMsg('loginMsg', '📧 Reset email bhej diya!', 'success');
    timerManager.setTimeout('resetMsg', () => {
      const el = $('loginMsg');
      if (el) el.className = 'auth-msg';
    }, 5000);
  } catch (e) {
    setMsg('loginMsg', fbErr(e.code));
  }
}

// ── Auth state listener (boot sequence) ──
export function initAuthListener() {
  let _isConnected = false;

  // Failsafe: agar 8 seconds mein bhi kuch na ho toh forcefully hide karo
  timerManager.setTimeout('bootFailsafe', () => {
    if (!isBootDone()) {
      console.warn('⚠️ Boot failsafe triggered');
      hideBootLoader(true);
      showScreen('authScreen');
      toast('⚠️ Connection slow — dobara try karein', 'error', 5000);
    }
  }, CONFIG.BOOT_FAILSAFE_MS);

  // RTDB connection status
  try {
    onValue(ref(rtdb, '.info/connected'), snap => {
      _isConnected = snap.val() === true;
      import('../state/appState.js').then(s => s.setConnected(_isConnected)).catch(() => {});
    });
  } catch (e) {
    console.warn('RTDB connection listener error:', e.message);
  }

  // ── MAIN FIX: try-catch-finally ensures hideBootLoader() HAMESHA chale ──
  onAuthStateChanged(auth, async user => {
    // Failsafe cancel karo — ab hum handle kar rahe hain
    timerManager.clearTimeout('bootFailsafe');

    try {
      const state = await import('../state/appState.js');
      state.setCurUser(user);

      if (user) {
        if (!user.isAnonymous) {
          try {
            const snap = await Promise.race([
              getDoc(doc(db, 'users', user.uid)),
              new Promise((_, rej) =>
                timerManager.setTimeout('firestoreTimeout', () => rej(new Error('timeout')), CONFIG.FIRESTORE_TIMEOUT_MS)
              )
            ]);
            if (snap.exists()) {
              state.setCurData(snap.data());
              updateHeader();
            }
          } catch (e) {
            console.warn('User data load skip:', e.message);
          }
          try { startUserListener(user.uid); } catch (e) { console.warn('startUserListener error:', e); }
        }
        try { updateHeader(); } catch (e) { console.warn('updateHeader error:', e); }
        showScreen('welcomeScreen');

        if (!isBootDone() && state.getCurData()) {
          const d = state.getCurData();
          showWelcomePopup(d.username || 'Player', d.coins || 0);
        } else if (!isBootDone() && !user.isAnonymous) {
          timerManager.setTimeout('welcomeDelay', () => {
            const d = state.getCurData();
            if (d) showWelcomePopup(d.username || 'Player', d.coins || 0);
          }, 1500);
        }
      } else {
        try { stopUserListener(); } catch (e) {}
        state.setCurUser(null);
        state.setCurData(null);
        try { updateHeader(); } catch (e) { console.warn('updateHeader error:', e); }
        showScreen('authScreen');
      }
    } catch (e) {
      // Koi bhi unexpected error aaye — phir bhi boot loader hide karo
      console.error('Auth listener critical error:', e);
      showScreen('authScreen');
    } finally {
      // ✅ CRITICAL FIX: Ye HAMESHA chalega — error ho ya na ho
      hideBootLoader();
    }
  });
    }
