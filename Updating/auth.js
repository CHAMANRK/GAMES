// auth.js - Firebase authentication helpers (integrated OTP send/verify + robust reCAPTCHA)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ---------- FIREBASE CONFIG (keep your values) ----------
const firebaseConfig = {
  apiKey: "AIzaSyCZ-vU4OZvkVFGFURaFeU7D6WP9ns5Z3Mo",
  authDomain: "najiful85-quran-quiz.firebaseapp.com",
  projectId: "najiful85-quran-quiz",
  storageBucket: "najiful85-quran-quiz.firebasestorage.app",
  messagingSenderId: "1092950659336",
  appId: "1:1092950659336:web:261eaa0f386c9499e3dcbd",
  measurementId: "G-JXD7NEF42Z"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Global state for phone auth
window.confirmationResult = window.confirmationResult || null;
window.recaptchaVerifier = window.recaptchaVerifier || null;
window.recaptchaWidgetId = window.recaptchaWidgetId || null;

// ================= UI TOGGLES =================
function togglePhoneForm(show) {
  const loginButtons = document.getElementById('loginButtons');
  const phoneForm = document.getElementById('phoneForm');
  if (loginButtons) loginButtons.classList.toggle('hidden', show);
  if (phoneForm) phoneForm.classList.toggle('hidden', !show);

  if (show) {
    // Delay a little so the container becomes visible before rendering reCAPTCHA
    setTimeout(setupRecaptcha, 250);
  } else {
    // Optional: clear recaptcha when hiding
    // (keeps it clean and allows fresh render on next open)
    try {
      if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
        window.recaptchaVerifier.clear();
      }
    } catch (e) { /* ignore */ }
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
    // Also hide OTP section and show send button if present
    document.getElementById('otpSection')?.classList.add('hidden');
    document.getElementById('sendOtpBtn')?.classList.remove('hidden');
  }
}

function toggleEmailForm(show) {
  const loginButtons = document.getElementById('loginButtons');
  const emailForm = document.getElementById('emailForm');
  if (loginButtons) loginButtons.classList.toggle('hidden', show);
  if (emailForm) emailForm.classList.toggle('hidden', !show);
}

// ================= 1. GOOGLE LOGIN =================
async function loginWithGoogle() {
  try {
    if (window.location.protocol === 'file:') {
      alert("⚠️ Google Login requires localhost or https. Run 'python -m http.server 8000' or host on https.");
      return;
    }
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will handle UI
  } catch (error) {
    alert("Google Error: " + (error?.message || error));
    console.error('Google sign-in error:', error);
  }
}

// ================= 2. PHONE LOGIN (reCAPTCHA + OTP) =================
// Helper: ensure container is visible
function containerIsVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetHeight > 0;
}

// Robust reCAPTCHA setup with retry if needed
function setupRecaptcha() {
  const container = document.getElementById('recaptcha-container');
  if (!container) {
    console.warn('Recaptcha container not found');
    return;
  }

  // If already initialized, do nothing
  if (window.recaptchaVerifier) return;

  if (!containerIsVisible(container)) {
    // Retry after short delay so CSS transitions/rendering can finish
    setTimeout(setupRecaptcha, 250);
    return;
  }

  try {
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
      'size': 'normal',
      'callback': (response) => {
        console.log('reCAPTCHA solved:', response);
      }
    }, auth);

    // render returns promise with widgetId
    window.recaptchaVerifier.render()
      .then(widgetId => {
        window.recaptchaWidgetId = widgetId;
        console.log('reCAPTCHA rendered, widgetId=', widgetId);
      })
      .catch(err => {
        console.warn('reCAPTCHA render failed', err);
        try { window.recaptchaVerifier.clear(); } catch(e){/*ignore*/ }
        window.recaptchaVerifier = null;
        window.recaptchaWidgetId = null;
      });
  } catch (e) {
    console.error('Error initializing reCAPTCHA:', e);
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
  }
}

async function sendOTP() {
  try {
    let phoneNumber = (document.getElementById('phoneNumber')?.value || "").trim();
    if (!phoneNumber) {
      alert("Please enter phone number in international format (e.g., +919876543210)");
      return;
    }

    // Normalize
    phoneNumber = phoneNumber.replace(/\s+/g, '');
    if (!/^\+\d{6,15}$/.test(phoneNumber)) {
      alert("Please enter a valid international phone number (e.g., +919876543210)");
      return;
    }

    // Ensure recaptcha is initialized
    setupRecaptcha();
    const appVerifier = window.recaptchaVerifier;
    if (!appVerifier) {
      alert("reCAPTCHA not initialized. Please open the phone form again.");
      return;
    }

    const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    window.confirmationResult = confirmation;

    // Show OTP section in UI
    document.getElementById('otpSection')?.classList.remove('hidden');
    document.getElementById('sendOtpBtn')?.classList.add('hidden');
    alert("OTP Sent!");
  } catch (error) {
    console.error('sendOTP error:', error);
    alert("SMS Error: " + (error?.message || error));

    // Try reset recaptcha so user can retry
    try {
      if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
        window.recaptchaVerifier.clear();
      } else if (window.grecaptcha && typeof window.grecaptcha.reset === 'function' && window.recaptchaWidgetId != null) {
        window.grecaptcha.reset(window.recaptchaWidgetId);
      }
    } catch (e) {
      console.warn('Error while resetting reCAPTCHA', e);
    } finally {
      window.recaptchaVerifier = null;
      window.recaptchaWidgetId = null;
    }
  }
}

async function verifyOTP() {
  try {
    const code = (document.getElementById('otpCode')?.value || "").trim();
    if (!code) {
      alert("Enter OTP");
      return;
    }

    if (!window.confirmationResult) {
      alert("No confirmation result. Please request OTP again.");
      return;
    }

    await window.confirmationResult.confirm(code);
    // onAuthStateChanged will handle UI
  } catch (error) {
    console.error('verifyOTP error:', error);
    alert("Invalid OTP: " + (error?.message || error));
  }
}

// ================= 3. EMAIL LOGIN / SIGNUP =================
async function loginWithEmail() {
  const email = document.getElementById('emailInput')?.value || "";
  const pass = document.getElementById('passwordInput')?.value || "";

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    console.error('loginWithEmail error:', error);
    alert("Login Failed: " + (error?.message || error));
  }
}

async function signupWithEmail() {
  const email = document.getElementById('emailInput')?.value || "";
  const pass = document.getElementById('passwordInput')?.value || "";

  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    // auto-logged in
  } catch (error) {
    console.error('signupWithEmail error:', error);
    alert("Signup Failed: " + (error?.message || error));
  }
}

// ================= 4. GUEST LOGIN =================
async function loginAsGuest() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error('loginAsGuest error:', error);
    alert("Guest Error: " + (error?.message || error));
  }
}

// ================= PROFILE & LOGOUT =================
function saveProfile() {
  const name = document.getElementById('setupName')?.value;
  if (name) {
    localStorage.setItem('quran_user', name);
    if (window.UI && typeof window.UI.showSection === 'function') {
      window.UI.showSection('welcomeScreen');
    } else {
      window.location.reload();
    }
  }
}

function logoutUser() {
  signOut(auth).then(() => {
    window.location.reload();
  }).catch((e) => {
    console.error('logout error:', e);
    alert('Logout failed: ' + (e?.message || e));
  });
}

// ================= STATE LISTENER =================
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User Active:", user.uid, "isAnonymous:", user.isAnonymous);
    if (localStorage.getItem('quran_user')) {
      if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('welcomeScreen');
    } else {
      if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('profileSetupScreen');
    }
  } else {
    // Show auth screen if signed out
    if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('authScreen');
  }
});

// Expose functions to global
window.Auth = {
  loginWithGoogle,
  loginAsGuest,
  togglePhoneForm,
  toggleEmailForm,
  sendOTP,
  verifyOTP,
  loginWithEmail,
  signupWithEmail,
  saveProfile,
  logoutUser,
  setupRecaptcha
};
