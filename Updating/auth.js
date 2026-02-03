// auth.js - Complete Authentication + Firestore sync + Phone OTP (reCAPTCHA)
// Replace your existing auth.js with this file. Include in index.html as:
// <script type="module" src="auth.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --------------------
// 1) Firebase config - keep your values
// --------------------
const firebaseConfig = {
  apiKey: "AIzaSyCZ-vU4OZvkVFGFURaFeU7D6WP9ns5Z3Mo",
  authDomain: "najiful85-quran-quiz.firebaseapp.com",
  projectId: "najiful85-quran-quiz",
  storageBucket: "najiful85-quran-quiz.firebasestorage.app",
  messagingSenderId: "1092950659336",
  appId: "1:1092950659336:web:261eaa0f386c9499e3dcbd",
  measurementId: "G-JXD7NEF42Z"
};

// --------------------
// 2) Initialize Firebase
// --------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --------------------
// 3) Utility helpers
// --------------------
function friendly(msg) {
  try { alert(msg); } catch (e) { console.log('MSG:', msg); }
}
function safeId(id) { return document.getElementById(id) || null; }
function updateProfileNameUI(name) {
  const el1 = safeId('profileName');
  const el2 = safeId('profile-name');
  if (el1) el1.innerText = name;
  if (el2) el2.innerText = name;
}
function updateCoinsUI(n) {
  const el = safeId('displayCoins');
  if (el) el.innerText = (typeof n === 'number') ? n : String(el.innerText || '0');
}

// --------------------
// 4) Google sign-in
// --------------------
async function loginWithGoogle() {
  try {
    if (window.location.protocol === 'file:') {
      friendly("Google sign-in requires localhost or HTTPS. For local testing run: python -m http.server 8000");
      return;
    }
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error('Google sign-in error', error);
    if (error?.code === 'auth/unauthorized-domain') {
      friendly("Google sign-in blocked: add your domain in Firebase Console → Authentication → Authorized domains.");
    } else {
      friendly("Google Error: " + (error?.message || error));
    }
  }
}

// --------------------
// 5) Email signup / login with friendly validation
// --------------------
async function signupWithEmail() {
  const email = (safeId('emailInput')?.value || "").trim();
  const pass = (safeId('passwordInput')?.value || "").trim();
  if (!email) { friendly("Please enter email address"); return; }
  if (!pass) { friendly("Please enter a password"); return; }
  if (pass.length < 6) { friendly("Password should be at least 6 characters"); return; }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    console.error('Signup error', error);
    if (error?.code === 'auth/email-already-in-use') friendly("This email is already registered. Try logging in.");
    else friendly("Signup failed: " + (error?.message || error));
  }
}
async function loginWithEmail() {
  const email = (safeId('emailInput')?.value || "").trim();
  const pass = (safeId('passwordInput')?.value || "").trim();
  if (!email) { friendly("Please enter your email address"); return; }
  if (!pass) { friendly("Please enter your password"); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    console.error('Email login error', error);
    if (error?.code === 'auth/user-not-found') friendly("No account found with this email.");
    else if (error?.code === 'auth/wrong-password') friendly("Incorrect password.");
    else friendly("Login failed: " + (error?.message || error));
  }
}

// --------------------
// 6) Anonymous guest sign-in
// --------------------
async function loginAsGuest() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error('Guest login error', error);
    if (error?.code === 'auth/operation-not-allowed') {
      friendly("Guest login disabled in Firebase console. Enable Anonymous sign-in in Authentication -> Sign-in method.");
    } else friendly("Guest login failed: " + (error?.message || error));
  }
}

// --------------------
// 7) Logout
// --------------------
async function logoutUser() {
  try {
    await signOut(auth);
    window.location.reload();
  } catch (error) {
    console.error('Logout error', error);
    friendly("Logout failed: " + (error?.message || error));
  }
}

// --------------------
// 8) Firestore: sync user (create on first login, update lastSeen)
// --------------------
async function syncUserProfile(user) {
  if (!user) return;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const base = {
      displayName: user.displayName || (user.isAnonymous ? "Guest" : ""),
      email: user.email || "",
      photoURL: user.photoURL || "",
      lastSeen: serverTimestamp()
    };
    if (!snap.exists()) {
      await setDoc(userRef, {
        ...base,
        coins: 100,
        tier: 'Beginner',
        accuracy: 0,
        isHafizVerified: false,
        createdAt: serverTimestamp()
      });
      console.log('Created user doc:', user.uid);
    } else {
      await updateDoc(userRef, { ...base });
      console.log('Updated user doc lastSeen for', user.uid);
    }

    // Update UI coins & name from db
    const fresh = await getDoc(userRef);
    if (fresh.exists()) {
      const data = fresh.data();
      if (data.displayName) updateProfileNameUI(data.displayName);
      if (typeof data.coins === 'number') updateCoinsUI(data.coins);
    }
  } catch (e) {
    console.error('syncUserProfile error', e);
  }
}

// --------------------
// 9) Phone auth (reCAPTCHA + send OTP + verify)
// --------------------
window.confirmationResult = window.confirmationResult || null;
window.recaptchaVerifier = window.recaptchaVerifier || null;
window.recaptchaWidgetId = window.recaptchaWidgetId || null;

function containerVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetHeight > 0;
}

function setupRecaptcha() {
  const container = safeId('recaptcha-container');
  if (!container) {
    console.warn('recaptcha container not found');
    return;
  }
  if (window.recaptchaVerifier) return;

  if (!containerVisible(container)) {
    setTimeout(setupRecaptcha, 250);
    return;
  }

  try {
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
      'size': 'normal',
      'callback': token => { console.log('reCAPTCHA solved'); }
    }, auth);

    window.recaptchaVerifier.render()
      .then(widgetId => {
        window.recaptchaWidgetId = widgetId;
        console.log('reCAPTCHA rendered widgetId=', widgetId);
      })
      .catch(err => {
        console.warn('reCAPTCHA render failed', err);
        try { window.recaptchaVerifier.clear(); } catch (_) {}
        window.recaptchaVerifier = null;
        window.recaptchaWidgetId = null;
      });
  } catch (err) {
    console.error('setupRecaptcha exception', err);
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
  }
}

async function sendOTP() {
  try {
    let phoneNumber = (safeId('phoneNumber')?.value || "").trim();
    if (!phoneNumber) { friendly("Please enter your phone number with country code (e.g., +919876543210)"); return; }
    phoneNumber = phoneNumber.replace(/\s+/g, '');
    if (!/^\+\d{6,15}$/.test(phoneNumber)) { friendly("Enter phone in international format like +919876543210"); return; }

    setupRecaptcha();
    const appVerifier = window.recaptchaVerifier;
    if (!appVerifier) {
      friendly("reCAPTCHA not initialized. Open phone form and try again.");
      return;
    }

    const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    window.confirmationResult = confirmation;

    safeId('otpSection')?.classList.remove('hidden');
    safeId('sendOtpBtn')?.classList.add('hidden');
    friendly("OTP sent. Enter the code you received.");
  } catch (error) {
    console.error('sendOTP error', error);
    friendly("SMS Error: " + (error?.message || error));
    try {
      if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') window.recaptchaVerifier.clear();
      else if (window.grecaptcha && typeof window.grecaptcha.reset === 'function' && window.recaptchaWidgetId != null) window.grecaptcha.reset(window.recaptchaWidgetId);
    } catch (e) { console.warn('recaptcha reset failed', e); }
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
  }
}

async function verifyOTP() {
  try {
    const code = (safeId('otpCode')?.value || "").trim();
    if (!code) { friendly("Please enter the OTP"); return; }
    if (!window.confirmationResult) { friendly("No OTP requested. Please request OTP again."); return; }
    await window.confirmationResult.confirm(code);
  } catch (error) {
    console.error('verifyOTP error', error);
    friendly("Invalid OTP: " + (error?.message || error));
  }
}

// --------------------
// 10) Toggle UI for Phone / Email forms
// --------------------
function togglePhoneForm(show) {
  const loginButtons = safeId('loginButtons');
  const phoneForm = safeId('phoneForm');
  if (loginButtons) loginButtons.classList.toggle('hidden', show);
  if (phoneForm) phoneForm.classList.toggle('hidden', !show);

  if (show) {
    setTimeout(() => { try { setupRecaptcha(); } catch (e) { console.warn(e); } }, 250);
  } else {
    try { if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') window.recaptchaVerifier.clear(); } catch(e){}
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
    safeId('otpSection')?.classList.add('hidden');
    safeId('sendOtpBtn')?.classList.remove('hidden');
  }
}

function toggleEmailForm(show) {
  const loginButtons = safeId('loginButtons');
  const emailForm = safeId('emailForm');
  if (loginButtons) loginButtons.classList.toggle('hidden', show);
  if (emailForm) emailForm.classList.toggle('hidden', !show);
}

// --------------------
// 11) Save Profile (profile setup screen)
// --------------------
async function saveProfile() {
  const name = (safeId('setupName')?.value || "").trim();
  if (!name) { friendly("Please enter display name"); return; }
  const ageGroup = safeId('setupAge')?.value || '';
  const gender = safeId('setupGender')?.value || '';

  const user = auth.currentUser;
  if (user) {
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { displayName: name, ageGroup, gender, lastSeen: serverTimestamp() });
      updateProfileNameUI(name);
      friendly("Profile saved");
      window.UI?.showSection?.('welcomeScreen');
    } catch (err) {
      console.error('saveProfile error', err);
      friendly("Profile save failed: " + (err?.message || err));
    }
  } else {
    try {
      localStorage.setItem('quran_user', JSON.stringify({ name, ageGroup, gender }));
      updateProfileNameUI(name);
      friendly("Profile saved locally. Sign up later to keep it in cloud.");
      window.UI?.showSection?.('welcomeScreen');
    } catch (e) {
      console.error('local save error', e);
      friendly("Could not save profile locally");
    }
  }
}

// --------------------
// 12) Auth state listener
// --------------------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    window.currentUser = user;
    console.log("User signed in:", user.uid, "anonymous:", user.isAnonymous);
    await syncUserProfile(user);

    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists() && snap.data().displayName) updateProfileNameUI(snap.data().displayName);
      else updateProfileNameUI(user.displayName || (user.isAnonymous ? 'Guest' : ''));
    } catch (e) {
      updateProfileNameUI(user.displayName || (user.isAnonymous ? 'Guest' : ''));
    }

    if (safeId('login-btn')) safeId('login-btn').style.display = 'none';
    if (safeId('logout-btn')) safeId('logout-btn').style.display = 'block';
  } else {
    window.currentUser = null;
    console.log("User signed out");
    if (safeId('login-btn')) safeId('login-btn').style.display = 'block';
    if (safeId('logout-btn')) safeId('logout-btn').style.display = 'none';
  }
});

// --------------------
// 13) Expose functions
// --------------------
window.Auth = {
  loginWithGoogle,
  signupWithEmail,
  loginWithEmail,
  loginAsGuest,
  logoutUser,
  setupRecaptcha,
  sendOTP,
  verifyOTP,
  saveProfile,
  togglePhoneForm,
  toggleEmailForm
};

console.log("auth.js loaded. window.Auth available:", Object.keys(window.Auth));