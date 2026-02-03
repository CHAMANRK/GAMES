// phone-auth.js - standalone phone auth with robust reCAPTCHA + OTP send/verify
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Use same firebaseConfig as main app
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

// widget state
window.phoneAuth = window.phoneAuth || {};
window.phoneAuth.recaptchaVerifier = null;
window.phoneAuth.recaptchaWidgetId = null;
window.phoneAuth.confirmationResult = null;

const phoneInput = document.getElementById('phoneNumber');
const sendOtpBtn = document.getElementById('sendOtpBtn');
const otpSection = document.getElementById('otpSection');
const otpInput = document.getElementById('otpCode');
const verifyOtpBtn = document.getElementById('verifyOtpBtn');
const messageDiv = document.getElementById('message');
const resetBtn = document.getElementById('resetBtn');

function showMessage(msg, type = 'info') {
  messageDiv.textContent = msg || '';
  messageDiv.style.color = (type === 'error') ? '#e57373' : (type === 'success' ? '#4CAF50' : '#8A9A95');
}

function ensureVisible(container) {
  const cs = getComputedStyle(container);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && container.offsetHeight > 0;
}

function setupRecaptchaOnce() {
  const container = document.getElementById('recaptcha-container');
  if (!container) { console.warn('recaptcha container missing'); return; }

  if (window.phoneAuth.recaptchaVerifier) return;
  if (!ensureVisible(container)) {
    setTimeout(setupRecaptchaOnce, 250);
    return;
  }

  try {
    window.phoneAuth.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
      'size': 'normal',
      'callback': (token) => { console.log('reCAPTCHA solved', token); }
    }, auth);

    window.phoneAuth.recaptchaVerifier.render()
      .then(widgetId => {
        window.phoneAuth.recaptchaWidgetId = widgetId;
        console.log('reCAPTCHA rendered:', widgetId);
      })
      .catch(e => {
        console.warn('reCAPTCHA render failed', e);
        try { window.phoneAuth.recaptchaVerifier.clear(); } catch(_) {}
        window.phoneAuth.recaptchaVerifier = null;
      });
  } catch (e) {
    console.error('setupRecaptcha exception', e);
    window.phoneAuth.recaptchaVerifier = null;
  }
}

async function sendOTP() {
  showMessage('');
  let phone = (phoneInput.value || '').trim();
  if (!phone) return showMessage('Please enter phone number', 'error');
  phone = phone.replace(/\s+/g, '');
  if (!/^\+\d{6,15}$/.test(phone)) return showMessage('Enter phone in international format', 'error');

  setupRecaptchaOnce();
  const appVerifier = window.phoneAuth.recaptchaVerifier;
  if (!appVerifier) return showMessage('reCAPTCHA not ready. Open the phone form and try again.', 'error');

  try {
    showMessage('Sending OTP...', 'info');
    const confirmation = await signInWithPhoneNumber(auth, phone, appVerifier);
    window.phoneAuth.confirmationResult = confirmation;
    otpSection.classList.remove('hidden');
    sendOtpBtn.classList.add('hidden');
    showMessage('OTP sent. Enter it below.', 'success');
  } catch (err) {
    console.error('sendOTP error', err);
    showMessage('SMS Error: ' + (err?.message || err), 'error');
    try { if (window.phoneAuth.recaptchaVerifier && typeof window.phoneAuth.recaptchaVerifier.clear === 'function') window.phoneAuth.recaptchaVerifier.clear(); } catch(e){}
    window.phoneAuth.recaptchaVerifier = null;
  }
}

async function verifyOTP() {
  showMessage('');
  const code = (otpInput.value || '').trim();
  if (!code) return showMessage('Enter OTP', 'error');
  if (!window.phoneAuth.confirmationResult) return showMessage('Request OTP first', 'error');

  try {
    showMessage('Verifying...', 'info');
    const cred = await window.phoneAuth.confirmationResult.confirm(code);
    console.log('Phone sign-in success', cred);
    showMessage('Phone verified. Redirecting...', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 800);
  } catch (err) {
    console.error('verify error', err);
    showMessage('Invalid OTP: ' + (err?.message || err), 'error');
  }
}

function resetAll() {
  try { if (window.phoneAuth.recaptchaVerifier && typeof window.phoneAuth.recaptchaVerifier.clear === 'function') window.phoneAuth.recaptchaVerifier.clear(); } catch(e){}
  window.phoneAuth.recaptchaVerifier = null;
  window.phoneAuth.recaptchaWidgetId = null;
  window.phoneAuth.confirmationResult = null;
  otpSection.classList.add('hidden');
  sendOtpBtn.classList.remove('hidden');
  otpInput.value = '';
  showMessage('');
}

sendOtpBtn?.addEventListener('click', sendOTP);
verifyOtpBtn?.addEventListener('click', verifyOTP);
resetBtn?.addEventListener('click', resetAll);

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(setupRecaptchaOnce, 300);
});