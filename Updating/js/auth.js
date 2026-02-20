// ============================================
// auth.js — Firebase Authentication
// Login | Signup | Google | Guest | Logout
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
import { showToast } from './ui.js';

// ── State ──────────────────────────────────
let currentUser = null;
let currentUserData = null;
let guestQuestionCount = 0;
const GUEST_LIMIT = 3;

const googleProvider = new GoogleAuthProvider();

// ── Get Current User ───────────────────────
export function getCurrentUser()     { return currentUser; }
export function getCurrentUserData() { return currentUserData; }
export function isGuest() {
  return currentUser && currentUser.isAnonymous;
}

// ── Tab Switch ─────────────────────────────
export function switchTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

  // Update panels
  document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`${tab}Panel`)?.classList.add('active');

  // Clear messages
  clearAuthMsg();
}

// ── Player Type Selection ──────────────────
export function selectPlayerType(type) {
  document.querySelectorAll('.player-type-option').forEach(opt => {
    opt.classList.remove('selected');
  });
  const selected = document.querySelector(`[data-type="${type}"]`);
  if (selected) selected.classList.add('selected');

  const input = document.getElementById('signupPlayerType');
  if (input) input.value = type;
}

// ── Toggle Password Visibility ─────────────
export function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

// ── Show Auth Message ──────────────────────
function showAuthMsg(msg, type = 'error', panelId = null) {
  // Find active panel's message div
  const activePanel = panelId
    ? document.getElementById(panelId)
    : document.querySelector('.auth-form-panel.active');

  const msgDiv = activePanel?.querySelector('.auth-msg');
  if (!msgDiv) return;

  msgDiv.textContent = msg;
  msgDiv.className = `auth-msg ${type} show`;
  setTimeout(() => msgDiv.classList.remove('show'), 5000);
}

function clearAuthMsg() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.classList.remove('show');
    m.textContent = '';
  });
}

// ── Set Button Loading ─────────────────────
function setBtnLoading(btnId, loading, text = '') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = '⏳ Intezaar karein...';
  } else {
    btn.textContent = text || btn.dataset.originalText || btn.textContent;
  }
}

// ── Validate ───────────────────────────────
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(pw) {
  return pw.length >= 6;
}
function validateUsername(un) {
  return un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);
}

// ── Create User Document in Firestore ──────
async function createUserDoc(uid, data) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      uid,
      username:    data.username || 'Player',
      email:       data.email || '',
      playerType:  data.playerType || 'beginner',
      coins:       500,
      xp:          0,
      level:       1,
      accuracy:    0,
      totalGames:  0,
      totalWins:   0,
      totalCorrect:0,
      streak:      0,
      lastLogin:   serverTimestamp(),
      createdAt:   serverTimestamp(),
      isGuest:     data.isGuest || false,
      isHafiz:     false,
      role:        'user',
      avatar:      'default',
      onlineMode:  false,   // unlock hoga 800 coins par
      badges:      [],
      friends:     [],
      bookmarks:   [],
      notification: [],
    });
  } else {
    // Just update last login
    await updateDoc(userRef, { lastLogin: serverTimestamp() });
  }
}

// ── Load User Data ─────────────────────────
async function loadUserData(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    currentUserData = snap.data();
    updateHeaderUI(currentUserData);
    checkOnlineModeUnlock(currentUserData);
  }
}

// ── Update Header UI ───────────────────────
function updateHeaderUI(userData) {
  const coinEl   = document.getElementById('coinCount');
  const coinsWrap= document.getElementById('headerCoins');
  const userEl   = document.getElementById('headerUser');
  const logoutBtn= document.getElementById('logoutBtn');

  if (userData) {
    if (coinEl)    coinEl.textContent = userData.coins?.toLocaleString() || '0';
    if (coinsWrap) coinsWrap.classList.remove('hidden');
    if (userEl) {
      userEl.textContent = userData.isHafiz
        ? `👑 ${userData.username}`
        : `👤 ${userData.username}`;
      userEl.classList.remove('hidden');
    }
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (coinsWrap) coinsWrap.classList.add('hidden');
    if (userEl)    userEl.classList.add('hidden');
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// ── Check Online Mode Unlock ───────────────
function checkOnlineModeUnlock(userData) {
  if (!userData) return;
  if (!userData.onlineMode && userData.coins >= 800) {
    updateDoc(doc(db, 'users', userData.uid), { onlineMode: true });
    showToast('🎉 Online Mode unlock ho gaya! 800 coins complete!', 'success', 4000);
  }
}

// ── Show Welcome Popup ─────────────────────
function showWelcomePopup(username, coins, isNew = false) {
  const popup = document.getElementById('welcomePopup');
  if (!popup) return;

  document.getElementById('wpName').textContent =
    isNew ? `Ahlan wa Sahlan, ${username}! 🌙` : `Marhaba, ${username}! 🌙`;
  document.getElementById('wpCoins').textContent =
    isNew ? `🪙 ${coins} coins ke saath shuruwaat!` : `🪙 ${coins} coins available`;

  popup.classList.add('show');
  setTimeout(() => popup.classList.remove('show'), 4000);
}

// ═══════════════════════════════════════════
//  📧 EMAIL SIGNUP
// ═══════════════════════════════════════════
export async function signup() {
  const username   = document.getElementById('signupUsername').value.trim();
  const email      = document.getElementById('signupEmail').value.trim();
  const password   = document.getElementById('signupPassword').value;
  const confirmPw  = document.getElementById('signupConfirmPw').value;
  const playerType = document.getElementById('signupPlayerType')?.value || 'beginner';

  clearAuthMsg();

  // Validation
  if (!username || !email || !password || !confirmPw) {
    showAuthMsg('❌ Sab fields bharna zaroori hai!');
    return;
  }
  if (!validateUsername(username)) {
    showAuthMsg('❌ Username 3–20 characters, sirf letters/numbers/underscore.');
    return;
  }
  if (!validateEmail(email)) {
    showAuthMsg('❌ Sahi email address likhein.');
    return;
  }
  if (!validatePassword(password)) {
    showAuthMsg('❌ Password kam se kam 6 characters ka hona chahiye.');
    return;
  }
  if (password !== confirmPw) {
    showAuthMsg('❌ Passwords match nahi kar rahe!');
    return;
  }

  setBtnLoading('signupBtn', true);

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Update display name
    await updateProfile(cred.user, { displayName: username });

    // Firestore mein save
    await createUserDoc(cred.user.uid, { username, email, playerType, isGuest: false });
    await loadUserData(cred.user.uid);

    showWelcomePopup(username, 500, true);
    showToast('✅ Account ban gaya! Marhaba!', 'success');
    showSection('welcomeScreen');

  } catch (err) {
    showAuthMsg(getFirebaseError(err.code));
  } finally {
    setBtnLoading('signupBtn', false);
  }
}

// ═══════════════════════════════════════════
//  📧 EMAIL LOGIN
// ═══════════════════════════════════════════
export async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  clearAuthMsg();

  if (!email || !password) {
    showAuthMsg('❌ Email aur password dono likhein!');
    return;
  }

  setBtnLoading('loginBtn', true);

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    await createUserDoc(cred.user.uid, {
      username: cred.user.displayName || 'Player',
      email: cred.user.email
    });
    await loadUserData(cred.user.uid);

    showWelcomePopup(
      currentUserData?.username || 'Player',
      currentUserData?.coins || 0
    );
    showToast('✅ Login ho gaye!', 'success');
    showSection('welcomeScreen');

  } catch (err) {
    showAuthMsg(getFirebaseError(err.code));
  } finally {
    setBtnLoading('loginBtn', false);
  }
}

// ═══════════════════════════════════════════
//  🔵 GOOGLE LOGIN
// ═══════════════════════════════════════════
export async function loginWithGoogle() {
  clearAuthMsg();
  setBtnLoading('googleLoginBtn', true);

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const isNew = result._tokenResponse?.isNewUser || false;

    await createUserDoc(user.uid, {
      username: user.displayName || user.email.split('@')[0],
      email: user.email,
      playerType: 'beginner',
      isGuest: false
    });
    await loadUserData(user.uid);

    showWelcomePopup(
      currentUserData?.username || user.displayName,
      currentUserData?.coins || 500,
      isNew
    );
    showToast('✅ Google se login ho gaye!', 'success');
    showSection('welcomeScreen');

  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAuthMsg(getFirebaseError(err.code));
    }
  } finally {
    setBtnLoading('googleLoginBtn', false);
  }
}

// ═══════════════════════════════════════════
//  👤 GUEST LOGIN
// ═══════════════════════════════════════════
export async function loginAsGuest() {
  clearAuthMsg();
  setBtnLoading('guestBtn', true);

  try {
    await signInAnonymously(auth);
    guestQuestionCount = 0;
    showToast('👤 Guest mode — 3 sawaal ke baad login zaroori!', 'info', 4000);
    showSection('welcomeScreen');

  } catch (err) {
    showAuthMsg(getFirebaseError(err.code));
  } finally {
    setBtnLoading('guestBtn', false);
  }
}

// ── Guest Question Limit ───────────────────
export function incrementGuestQuestion() {
  if (!isGuest()) return false;
  guestQuestionCount++;
  if (guestQuestionCount >= GUEST_LIMIT) {
    showGuestLimitModal();
    return true; // limit reached
  }
  return false;
}

function showGuestLimitModal() {
  const modal = document.getElementById('guestLimitModal');
  if (modal) modal.classList.remove('hidden');
}

// ═══════════════════════════════════════════
//  🔑 FORGOT PASSWORD
// ═══════════════════════════════════════════
export async function forgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) {
    showAuthMsg('❌ Pehle email likhein!');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthMsg('📧 Password reset email bhej diya gaya!', 'success');
  } catch (err) {
    showAuthMsg(getFirebaseError(err.code));
  }
}

// ═══════════════════════════════════════════
//  🚪 LOGOUT
// ═══════════════════════════════════════════
export async function logout() {
  try {
    await signOut(auth);
    currentUser = null;
    currentUserData = null;
    updateHeaderUI(null);
    showSection('authScreen');
    showToast('👋 Logout ho gaye. Phir aana!', 'info');
  } catch (err) {
    showToast('❌ Logout mein masla hua.', 'error');
  }
}

// ═══════════════════════════════════════════
//  🔄 AUTH STATE OBSERVER
// ═══════════════════════════════════════════
export function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;

      if (!user.isAnonymous) {
        await loadUserData(user.uid);
      } else {
        // Guest — sirf local state
        updateHeaderUI({ username: 'Guest', coins: 0, isGuest: true });
      }

      // Agar auth screen par hain toh welcome par jao
      const authScreen = document.getElementById('authScreen');
      if (authScreen?.classList.contains('active')) {
        showSection('welcomeScreen');
      }

    } else {
      currentUser = null;
      currentUserData = null;
      updateHeaderUI(null);
      showSection('authScreen');
    }
  });

  // Global functions
  window.Auth = {
    login,
    signup,
    loginWithGoogle,
    loginAsGuest,
    logout,
    switchTab,
    selectPlayerType,
    togglePw,
    forgotPassword
  };
}

// ── Firebase Error Messages ────────────────
function getFirebaseError(code) {
  const errors = {
    'auth/email-already-in-use':    '❌ Yeh email pehle se registered hai.',
    'auth/invalid-email':           '❌ Email ka format galat hai.',
    'auth/user-not-found':          '❌ Yeh email registered nahi hai.',
    'auth/wrong-password':          '❌ Password galat hai.',
    'auth/weak-password':           '❌ Password zyada kamzor hai — 6+ characters.',
    'auth/too-many-requests':       '❌ Zyada try — kuch der baad koshish karein.',
    'auth/network-request-failed':  '❌ Internet connection check karein.',
    'auth/popup-blocked':           '❌ Popup block ho gaya — allow karein.',
    'auth/invalid-credential':      '❌ Email ya password galat hai.',
  };
  return errors[code] || `❌ Kuch masla hua: ${code}`;
}
