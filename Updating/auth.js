// auth.js - Firebase authentication helpers (patched)
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

// YOUR FIREBASE CONFIG
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

// Global variable for confirmation result (Phone Auth)
window.confirmationResult = null;
window.recaptchaVerifier = window.recaptchaVerifier || null;
window.recaptchaWidgetId = window.recaptchaWidgetId || null;

// ================= UI TOGGLES =================
function togglePhoneForm(show) {
  const loginButtons = document.getElementById('loginButtons');
  const phoneForm = document.getElementById('phoneForm');
  if (loginButtons) loginButtons.classList.toggle('hidden', show);
  if (phoneForm) phoneForm.classList.toggle('hidden', !show);
  if (show) setupRecaptcha(); // Init Recaptcha when form opens
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
      alert("⚠️ Google Login requires localhost. Run 'python -m http.server 8000' or serve via http/https");
      return;
    }
    await signInWithPopup(auth, googleProvider);
    // Auth state listener will handle UI transition
  } catch (error) {
    alert("Google Error: " + (error?.message || error));
  }
}

// ================= 2. PHONE LOGIN =================
// NOTE: RecaptchaVerifier constructor signature: new RecaptchaVerifier(container, params, auth)
function setupRecaptcha() {
  try {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
        'size': 'normal',
        'callback': (response) => {
          console.log("Recaptcha solved:", response);
        }
      }, auth);
      // store widget id (render returns a Promise)
      window.recaptchaVerifier.render()
        .then(widgetId => { window.recaptchaWidgetId = widgetId; })
        .catch(err => { console.warn("Recaptcha render warning:", err); });
    }
  } catch (e) {
    console.error("Recaptcha init error:", e);
  }
}

async function sendOTP() {
  let phoneNumber = (document.getElementById('phoneNumber')?.value || "").trim();
  if (!phoneNumber) return alert("Please enter phone number");

  // Normalize (remove spaces) and basic E.164-ish check
  phoneNumber = phoneNumber.replace(/\s+/g, '');
  if (!/^\+\d{6,15}$/.test(phoneNumber)) {
    return alert("Please enter phone number in international format with country code, e.g. +919876543210");
  }

  const appVerifier = window.recaptchaVerifier;
  if (!appVerifier) {
    return alert("reCAPTCHA not initialized. Please open the phone form again.");
  }

  try {
    const confirmationResultLocal = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    window.confirmationResult = confirmationResultLocal;
    document.getElementById('otpSection')?.classList.remove('hidden');
    document.getElementById('sendOtpBtn')?.classList.add('hidden');
    alert("OTP Sent!");
  } catch (error) {
    console.error("sendOTP error:", error);
    alert("SMS Error: " + (error?.message || error));

    // Try to clear/reset recaptcha safely
    try {
      if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
        window.recaptchaVerifier.clear();
      } else if (window.grecaptcha && typeof window.grecaptcha.reset === 'function' && window.recaptchaWidgetId !== null) {
        // fallback to grecaptcha reset if available
        window.grecaptcha.reset(window.recaptchaWidgetId);
      }
    } catch (e) {
      console.warn("Error while clearing recaptcha:", e);
    } finally {
      window.recaptchaVerifier = null;
      window.recaptchaWidgetId = null;
    }
  }
}

async function verifyOTP() {
  const code = (document.getElementById('otpCode')?.value || "").trim();
  if (!code) return alert("Enter OTP");

  try {
    if (!window.confirmationResult) {
      return alert("No confirmation result found. Please request OTP again.");
    }
    await window.confirmationResult.confirm(code);
    // onAuthStateChanged will handle UI transition
  } catch (error) {
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
    alert("Login Failed: " + (error?.message || error));
  }
}

async function signupWithEmail() {
  const email = document.getElementById('emailInput')?.value || "";
  const pass = document.getElementById('passwordInput')?.value || "";

  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    // Automatically logs in after signup
  } catch (error) {
    alert("Signup Failed: " + (error?.message || error));
  }
}

// ================= 4. GUEST LOGIN =================
async function loginAsGuest() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    alert("Guest Error: " + (error?.message || error));
  }
}

// ================= PROFILE & LOGOUT =================
function saveProfile() {
  const name = document.getElementById('setupName')?.value;
  if (name) {
    localStorage.setItem('quran_user', name);
    // In real app, save to Firestore here
    if (window.UI && typeof window.UI.showSection === 'function') {
      window.UI.showSection('welcomeScreen');
    } else {
      // fallback
      window.location.href = window.location.href;
    }
  }
}

function logoutUser() {
  signOut(auth).then(() => {
    window.location.reload();
  }).catch((e) => {
    console.error("Logout error:", e);
  });
}

// ================= STATE LISTENER =================
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User Active:", user.uid);
    // Check if user has a name in localstorage or db
    if (localStorage.getItem('quran_user')) {
      if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('welcomeScreen');
    } else {
      if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('profileSetupScreen');
    }
  } else {
    // user signed out — show auth screen
    if (window.UI && typeof window.UI.showSection === 'function') window.UI.showSection('authScreen');
  }
});

// Expose functions
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
