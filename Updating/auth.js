// auth.js - Full Authentication + Firestore sync + Phone OTP (reCAPTCHA) + friendly messages
// Replace your existing auth.js with this file. Make sure to include it in index.html as:
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
// 1. Firebase config
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
// 2. Init Firebase
// --------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Expose for debugging (optional)
window._fb = { app, auth, db };

// --------------------
// 3. Helpers (friendly messages & simple UI helpers)
// --------------------
function friendly(msg) {
  // Replace with toast/snackbar if you have one. For now alert is simplest.
  try { alert(msg); } catch (e) { console.log('MSG:', msg); }
}

function safeId(id) { return document.getElementById(id) || null; }

// --------------------
// 4. Google Sign-In
// --------------------
export async function loginWithGoogle() {
  try {
    if (window.location.protocol === 'file:') {
      friendly("Google sign-in requires localhost or HTTPS. For local testing run: python -m http.server 8000");
      return;
    }
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will handle post-login flow
  } catch (error) {
    console.error('Google sign-in error', error);
    if (error?.code === 'auth/unauthorized-domain') {
      friendly("Google sign-in blocked: Authorized domain mein aapka site add nahi hai. Firebase Console → Authentication → Authorized domains me add karein.");
    } else {
      friendly("Google Error: " + (error?.message || error));
    }
  }
}

// --------------------
// 5. Email Signup / Login (friendly validation)
// --------------------
export async function signupWithEmail() {
  const email = (safeId('emailInput')?.value || "").trim();
  const pass = (safeId('passwordInput')?.value || "").trim();

  if (!email) { friendly("Please enter email address"); return; }
  if (!pass) { friendly("Please enter a password"); return; }
  if (pass.length < 6) { friendly("Password should be at least 6 characters"); return; }

  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged will handle DB sync
  } catch (error) {
    console.error('Signup error', error);
    if (error?.code === 'auth/email-already-in-use') friendly("This email is already registered. Try logging in.");
    else friendly("Signup failed: " + (error?.message || error));
  }
}

export async function loginWithEmail() {
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
// 6. Anonymous (Guest) Login
// --------------------
export async function loginAsGuest() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error('Guest login error', error);
    friendly("Guest login failed: " + (error?.message || error));
  }
}

// --------------------
// 7. Logout
// --------------------
export async function logoutUser() {
  try {
    await signOut(auth);
    // refresh to reset UI
    window.location.reload();
  } catch (error) {
    console.error('Logout error', error);
    friendly("Logout failed: " + (error?.message || error));
  }
}

// --------------------
// 8. Firestore: Sync user profile on first login & update lastSeen
// --------------------
async function syncUserProfile(user) {
  if (!user) return;
  const userRef = doc(db, "users", user.uid);

  try {
    const userSnap = await getDoc(userRef);

    const profileData = {
      displayName: user.displayName || (user.isAnonymous ? "Guest" : ""),
      email: user.email || "",
      photoURL: user.photoURL || "",
      lastSeen: serverTimestamp()
    };

    if (!userSnap.exists()) {
      // New user initial data
      await setDoc(userRef, {
        ...profileData,
        coins: 100, // starting coins
        tier: "Beginner",
        accuracy: 0,
        isHafizVerified: false,
        createdAt: serverTimestamp()
      });
      console.log("Created new user doc for", user.uid);
    } else {
      // Update lastSeen and photo if changed
      await updateDoc(userRef, {
        ...profileData
      });
      console.log("Updated user lastSeen for", user.uid);
    }
  } catch (e) {
    console.error('syncUserProfile error', e);
  }
}

// --------------------
// 9. Phone Auth (reCAPTCHA + OTP send/verify)
// --------------------
window.confirmationResult = window.confirmationResult || null;
window.recaptchaVerifier = window.recaptchaVerifier || null;
window.recaptchaWidgetId = window.recaptchaWidgetId || null;

function containerVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetHeight > 0;
}

export function setupRecaptcha() {
  const container = safeId('recaptcha-container');
  if (!container) {
    console.warn('Recaptcha container not found');
    return;
  }

  // If already created, do nothing
  if (window.recaptchaVerifier) return;

  // If container is hidden (due to transition), retry a bit
  if (!containerVisible(container)) {
    setTimeout(setupRecaptcha, 250);
    return;
  }

  try {
    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
      'size': 'normal',
      'callback': (token) => {
        console.log('reCAPTCHA solved', token);
      }
    }, auth);

    window.recaptchaVerifier.render()
      .then(widgetId => {
        window.recaptchaWidgetId = widgetId;
        console.log('reCAPTCHA rendered, widgetId=', widgetId);
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

export async function sendOTP() {
  try {
    let phoneNumber = (safeId('phoneNumber')?.value || "").trim();
    if (!phoneNumber) { friendly("Please enter your phone number with country code (e.g., +919876543210)"); return; }

    // normalize spaces
    phoneNumber = phoneNumber.replace(/\s+/g, '');
    if (!/^\+\d{6,15}$/.test(phoneNumber)) {
      friendly("Please enter phone in international format like +919876543210");
      return;
    }

    setupRecaptcha();
    const appVerifier = window.recaptchaVerifier;
    if (!appVerifier) {
      friendly("reCAPTCHA not initialized. Please open the phone form and try again.");
      return;
    }

    const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    window.confirmationResult = confirmation;

    // update UI
    safeId('otpSection')?.classList.remove('hidden');
    safeId('sendOtpBtn')?.classList.add('hidden');
    friendly("OTP sent. Check your phone and enter the code.");
  } catch (error) {
    console.error('sendOTP error', error);
    friendly("SMS Error: " + (error?.message || error));
    // try reset recaptcha to allow retry
    try {
      if (window.recaptchaVerifier && typeof window.recaptchaVerifier.clear === 'function') {
        window.recaptchaVerifier.clear();
      } else if (window.grecaptcha && typeof window.grecaptcha.reset === 'function' && window.recaptchaWidgetId != null) {
        window.grecaptcha.reset(window.recaptchaWidgetId);
      }
    } catch (e) { console.warn('recaptcha reset failed', e); }
    window.recaptchaVerifier = null;
    window.recaptchaWidgetId = null;
  }
}

export async function verifyOTP() {
  try {
    const code = (safeId('otpCode')?.value || "").trim();
    if (!code) { friendly("Please enter the OTP"); return; }
    if (!window.confirmationResult) { friendly("No OTP request found. Please request OTP again."); return; }

    await window.confirmationResult.confirm(code);
    // onAuthStateChanged will handle post-login
  } catch (error) {
    console.error('verifyOTP error', error);
    friendly("Invalid OTP: " + (error?.message || error));
  }
}

// --------------------
// 10. Profile Save (from Profile Setup screen)
// --------------------
export async function saveProfile() {
  const name = (safeId('setupName')?.value || "").trim();
  if (!name) { friendly("Please enter display name"); return; }
  const ageGroupEl = safeId('setupAge') || null;
  const ageGroup = ageGroupEl ? ageGroupEl.value : ''; // optional
  const genderEl = safeId('setupGender') || null;
  const gender = genderEl ? genderEl.value : '';

  const user = auth.currentUser;
  if (user) {
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: name,
        ageGroup,
        gender,
        lastSeen: serverTimestamp()
      });
      // Update UI
      const profileName = safeId('profile-name') || safeId('profileName');
      if (profileName) profileName.innerText = name;
      friendly("Profile saved");
      window.UI?.showSection?.('welcomeScreen');
    } catch (err) {
      console.error('saveProfile error', err);
      friendly("Profile save failed: " + (err?.message || err));
    }
  } else {
    // Guest: store locally until they register
    try {
      localStorage.setItem('quran_user', JSON.stringify({ name, ageGroup, gender }));
      const profileName = safeId('profile-name') || safeId('profileName');
      if (profileName) profileName.innerText = name;
      friendly("Profile saved locally. Sign up later to keep it in cloud.");
      window.UI?.showSection?.('welcomeScreen');
    } catch (e) {
      console.error('local saveProfile error', e);
      friendly("Could not save profile locally");
    }
  }
}

// --------------------
// 11. Auth State Listener
// --------------------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    window.currentUser = user;
    console.log("User signed in:", user.uid, "isAnonymous:", user.isAnonymous);

    // Sync to Firestore
    await syncUserProfile(user);

    // Update profile name in UI if element present
    const profileEl = safeId('profile-name') || safeId('profileName');
    if (profileEl) {
      // try Firestore value for displayName (more reliable)
      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);
        if (snap.exists() && snap.data().displayName) profileEl.innerText = snap.data().displayName;
        else profileEl.innerText = user.displayName || (user.isAnonymous ? 'Guest' : '');
      } catch (e) {
        profileEl.innerText = user.displayName || (user.isAnonymous ? 'Guest' : '');
      }
    }

    // Toggle login/logout buttons (if present)
    if (safeId('login-btn')) safeId('login-btn').style.display = 'none';
    if (safeId('logout-btn')) safeId('logout-btn').style.display = 'block';

  } else {
    // Not signed in
    window.currentUser = null;
    console.log("User signed out");
    if (safeId('login-btn')) safeId('login-btn').style.display = 'block';
    if (safeId('logout-btn')) safeId('logout-btn').style.display = 'none';
  }
});

// --------------------
// 12. Expose to window for HTML to use
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
  saveProfile
};
