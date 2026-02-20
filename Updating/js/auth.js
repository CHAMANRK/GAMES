// ============================================
// auth.js — Firebase Authentication
// Fast login: target < 3 seconds
// ============================================

import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInAnonymously,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { showSection } from './app.js';
import { showToast }   from './ui.js';

// ── State ──────────────────────────────────
let currentUser     = null;
let currentUserData = null;
let guestQCount     = 0;
const GUEST_LIMIT   = 3;
const googleProvider = new GoogleAuthProvider();

// ── Getters ────────────────────────────────
export function getCurrentUser()     { return currentUser; }
export function getCurrentUserData() { return currentUserData; }
export function isGuest()            { return currentUser?.isAnonymous || false; }

// ── Tab Switch ─────────────────────────────
export function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`${tab}Panel`)?.classList.add('active');
  clearAuthMsg();
}

// ── Player Type ────────────────────────────
export function selectPlayerType(type) {
  document.querySelectorAll('.player-type-option').forEach(o => o.classList.remove('selected'));
  document.querySelector(`[data-type="${type}"]`)?.classList.add('selected');
  const inp = document.getElementById('signupPlayerType');
  if (inp) inp.value = type;
}

// ── Password Toggle ────────────────────────
export function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
}

// ── Auth Message ───────────────────────────
function showAuthMsg(msg, type = 'error') {
  const panel  = document.querySelector('.auth-form-panel.active');
  const msgDiv = panel?.querySelector('.auth-msg');
  if (!msgDiv) return;
  msgDiv.textContent = msg;
  msgDiv.className   = `auth-msg ${type} show`;
}
function clearAuthMsg() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.className  = 'auth-msg';
    m.textContent = '';
  });
}

// ── Button State ───────────────────────────
function btnLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = on;
  if (on) {
    btn.dataset.orig = btn.textContent;
    btn.textContent  = '⏳';
  } else {
    btn.textContent = btn.dataset.orig || btn.textContent;
  }
}

// ── Validation ─────────────────────────────
const isValidEmail = e  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isValidPw    = pw => pw.length >= 6;
const isValidUN    = un => un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);

// ── Create/Update Firestore Doc ────────────
// Background mein — login ko block nahi karta
async function syncUserDoc(uid, data) {
  try {
    const ref  = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        username:     data.username    || 'Player',
        email:        data.email       || '',
        playerType:   data.playerType  || 'beginner',
        coins:        500,
        xp:           0,
        level:        1,
        accuracy:     0,
        totalGames:   0,
        totalWins:    0,
        totalCorrect: 0,
        streak:       0,
        lastLogin:    serverTimestamp(),
        createdAt:    serverTimestamp(),
        isGuest:      false,
        isHafiz:      false,
        role:         'user',
        avatar:       'default',
        onlineMode:   false,
        badges:       [],
        friends:      [],
        bookmarks:    [],
        notifications:[],
      });
      currentUserData = { uid, username: data.username, coins: 500, isHafiz: false };
    } else {
      currentUserData = snap.data();
      // Update last login in background
      updateDoc(ref, { lastLogin: serverTimestamp() }).catch(() => {});
    }
    updateHeaderUI(currentUserData);
    checkOnlineUnlock(currentUserData);
  } catch (e) {
    console.warn('Firestore sync error:', e);
  }
}

// ── Load User Data ─────────────────────────
async function loadUserData(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      currentUserData = snap.data();
      updateHeaderUI(currentUserData);
      checkOnlineUnlock(currentUserData);
    }
  } catch (e) {
    console.warn('Load user error:', e);
  }
}

// ── Header UI ──────────────────────────────
function updateHeaderUI(u) {
  const coinEl    = document.getElementById('coinCount');
  const coinsWrap = document.getElementById('headerCoins');
  const userEl    = document.getElementById('headerUser');
  const logoutBtn = document.getElementById('logoutBtn');

  if (u && !u.isGuest) {
    if (coinEl)    coinEl.textContent = (u.coins || 0).toLocaleString();
    if (coinsWrap) coinsWrap.classList.remove('hidden');
    if (userEl) {
      userEl.textContent = u.isHafiz ? `👑 ${u.username}` : `👤 ${u.username}`;
      userEl.classList.remove('hidden');
    }
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (coinsWrap) coinsWrap.classList.add('hidden');
    if (userEl)    userEl.classList.add('hidden');
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// ── Online Mode Unlock ─────────────────────
function checkOnlineUnlock(u) {
  if (!u || u.onlineMode) return;
  if ((u.coins || 0) >= 800) {
    updateDoc(doc(db, 'users', u.uid), { onlineMode: true }).catch(() => {});
    showToast('🎉 Online Mode unlock! 800 coins complete!', 'success', 4000);
  }
}

// ── Welcome Popup ──────────────────────────
function showWelcome(username, coins, isNew = false) {
  const popup = document.getElementById('welcomePopup');
  if (!popup) return;
  document.getElementById('wpName').textContent  =
    isNew ? `Ahlan wa Sahlan, ${username}! 🌙` : `Marhaba, ${username}! 🌙`;
  document.getElementById('wpCoins').textContent =
    isNew ? `🪙 ${coins} coins ke saath shuruwaat!` : `🪙 ${coins} coins available`;
  popup.classList.add('show');
  setTimeout(() => popup.classList.remove('show'), 4000);
}

// ── After Login: go home fast ──────────────
function afterLogin(username, coins, isNew = false) {
  showSection('welcomeScreen');          // PEHLE screen change
  showWelcome(username, coins, isNew);   // phir popup
}

// ═══════════════════════════════════════════
//  📧 SIGNUP
// ═══════════════════════════════════════════
export async function signup() {
  const username  = document.getElementById('signupUsername').value.trim();
  const email     = document.getElementById('signupEmail').value.trim();
  const password  = document.getElementById('signupPassword').value;
  const confirmPw = document.getElementById('signupConfirmPw').value;
  const pType     = document.getElementById('signupPlayerType')?.value || 'beginner';

  clearAuthMsg();

  if (!username || !email || !password || !confirmPw) {
    showAuthMsg('❌ Sab fields bharna zaroori hai!'); return;
  }
  if (!isValidUN(username)) {
    showAuthMsg('❌ Username: 3–20 chars, letters/numbers/underscore sirf.'); return;
  }
  if (!isValidEmail(email)) {
    showAuthMsg('❌ Sahi email likhein.'); return;
  }
  if (!isValidPw(password)) {
    showAuthMsg('❌ Password min 6 characters.'); return;
  }
  if (password !== confirmPw) {
    showAuthMsg('❌ Passwords match nahi!'); return;
  }

  btnLoading('signupBtn', true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });

    // Screen pe jao FORAN — Firestore background mein
    afterLogin(username, 500, true);
    showToast('✅ Account ban gaya! Marhaba!', 'success');

    // Background sync — UI block nahi karega
    syncUserDoc(cred.user.uid, { username, email, playerType: pType });

  } catch (err) {
    showAuthMsg(getErr(err.code));
    btnLoading('signupBtn', false);
  }
}

// ═══════════════════════════════════════════
//  📧 LOGIN
// ═══════════════════════════════════════════
export async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  clearAuthMsg();
  if (!email || !password) {
    showAuthMsg('❌ Email aur password dono likhein!'); return;
  }

  btnLoading('loginBtn', true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    // Screen change FORAN
    const displayName = cred.user.displayName || email.split('@')[0];
    afterLogin(displayName, 0);
    showToast('✅ Login ho gaye!', 'success');

    // Firestore background mein load
    syncUserDoc(cred.user.uid, {
      username: displayName,
      email:    cred.user.email
    });

  } catch (err) {
    showAuthMsg(getErr(err.code));
    btnLoading('loginBtn', false);
  }
}

// ═══════════════════════════════════════════
//  🔵 GOOGLE LOGIN
// ═══════════════════════════════════════════
export async function loginWithGoogle() {
  clearAuthMsg();
  btnLoading('googleLoginBtn', true);
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user   = result.user;
    const isNew  = result._tokenResponse?.isNewUser || false;
    const name   = user.displayName || user.email.split('@')[0];

    afterLogin(name, isNew ? 500 : 0, isNew);
    showToast('✅ Google se login ho gaye!', 'success');

    syncUserDoc(user.uid, {
      username:   name,
      email:      user.email,
      playerType: 'beginner'
    });

  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAuthMsg(getErr(err.code));
    }
    btnLoading('googleLoginBtn', false);
  }
}

// ═══════════════════════════════════════════
//  👤 GUEST
// ═══════════════════════════════════════════
export async function loginAsGuest() {
  clearAuthMsg();
  btnLoading('guestBtn', true);
  try {
    await signInAnonymously(auth);
    guestQCount = 0;
    showSection('welcomeScreen');
    showToast('👤 Guest mode — 3 sawaal ke baad login zaroori!', 'info', 4000);
  } catch (err) {
    showAuthMsg(getErr(err.code));
    btnLoading('guestBtn', false);
  }
}

// ── Guest Limit Check ──────────────────────
export function checkGuestLimit() {
  if (!isGuest()) return false;
  guestQCount++;
  if (guestQCount >= GUEST_LIMIT) {
    document.getElementById('guestLimitModal')?.classList.remove('hidden');
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════
//  🔑 FORGOT PASSWORD
// ═══════════════════════════════════════════
export async function forgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { showAuthMsg('❌ Pehle email likhein!'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthMsg('📧 Password reset email bhej diya!', 'success');
  } catch (err) {
    showAuthMsg(getErr(err.code));
  }
}

// ═══════════════════════════════════════════
//  🚪 LOGOUT
// ═══════════════════════════════════════════
export async function logout() {
  try {
    await signOut(auth);
    currentUser = currentUserData = null;
    updateHeaderUI(null);
    showSection('authScreen');
    showToast('👋 Logout ho gaye. Phir aana!', 'info');
  } catch {
    showToast('❌ Logout mein masla hua.', 'error');
  }
}

// ═══════════════════════════════════════════
//  🔄 AUTH STATE OBSERVER
// ═══════════════════════════════════════════
export function initAuth() {
  // window.Auth PEHLE set karo — HTML buttons ke liye
  window.Auth = {
    login, signup, loginWithGoogle, loginAsGuest,
    logout, switchTab, selectPlayerType, togglePw, forgotPassword
  };

  // Auth state observe
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      if (!user.isAnonymous) {
        // Background mein load — screen already show ho chuki hogi
        loadUserData(user.uid);
      } else {
        updateHeaderUI({ username: 'Guest', isGuest: true });
      }
      // Agar abhi bhi auth screen pe hain
      if (document.getElementById('authScreen')?.classList.contains('active')) {
        showSection('welcomeScreen');
      }
    } else {
      currentUser = currentUserData = null;
      updateHeaderUI(null);
      // Sirf auth screen pe jao agar koi protected screen pe ho
      const active = document.querySelector('.screen.active');
      if (active && active.id !== 'authScreen') {
        showSection('authScreen');
      }
    }
  });
}

// ── Error Messages ─────────────────────────
function getErr(code) {
  return {
    'auth/email-already-in-use':   '❌ Yeh email pehle se registered hai.',
    'auth/invalid-email':          '❌ Sahi email format likhein.',
    'auth/user-not-found':         '❌ Yeh email registered nahi.',
    'auth/wrong-password':         '❌ Password galat hai.',
    'auth/invalid-credential':     '❌ Email ya password galat hai.',
    'auth/weak-password':          '❌ Password min 6 characters hona chahiye.',
    'auth/too-many-requests':      '❌ Zyada try — thodi der baad koshish karein.',
    'auth/network-request-failed': '❌ Internet check karein.',
    'auth/popup-blocked':          '❌ Popup block hai — browser mein allow karein.',
  }[code] || `❌ Error: ${code}`;
}
