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

// ================= UI TOGGLES =================
function togglePhoneForm(show) {
    document.getElementById('loginButtons').classList.toggle('hidden', show);
    document.getElementById('phoneForm').classList.toggle('hidden', !show);
    if(show) setupRecaptcha(); // Init Recaptcha when form opens
}

function toggleEmailForm(show) {
    document.getElementById('loginButtons').classList.toggle('hidden', show);
    document.getElementById('emailForm').classList.toggle('hidden', !show);
}

// ================= 1. GOOGLE LOGIN =================
async function loginWithGoogle() {
    try {
        if(window.location.protocol === 'file:') {
            alert("⚠️ Google Login requires localhost. Run 'python -m http.server 8000'");
            return;
        }
        await signInWithPopup(auth, googleProvider);
        // Auth state listener handles redirect
    } catch (error) {
        alert("Google Error: " + error.message);
    }
}

// ================= 2. PHONE LOGIN =================
function setupRecaptcha() {
    if(!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
            'size': 'normal',
            'callback': (response) => {
                // reCAPTCHA solved
                console.log("Recaptcha Solved");
            }
        });
        window.recaptchaVerifier.render();
    }
}

async function sendOTP() {
    const phoneNumber = document.getElementById('phoneNumber').value;
    const appVerifier = window.recaptchaVerifier;

    if(!phoneNumber) return alert("Please enter phone number");

    try {
        const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
        window.confirmationResult = confirmationResult;
        document.getElementById('otpSection').classList.remove('hidden');
        document.getElementById('sendOtpBtn').classList.add('hidden');
        alert("OTP Sent!");
    } catch (error) {
        console.error(error);
        alert("SMS Error: " + error.message);
        if(window.recaptchaVerifier) window.recaptchaVerifier.clear(); // Reset on error
    }
}

async function verifyOTP() {
    const code = document.getElementById('otpCode').value;
    if(!code) return alert("Enter OTP");

    try {
        await window.confirmationResult.confirm(code);
        // Auth state listener will redirect
    } catch (error) {
        alert("Invalid OTP: " + error.message);
    }
}

// ================= 3. EMAIL LOGIN / SIGNUP =================
async function loginWithEmail() {
    const email = document.getElementById('emailInput').value;
    const pass = document.getElementById('passwordInput').value;
    
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Login Failed: " + error.message);
    }
}

async function signupWithEmail() {
    const email = document.getElementById('emailInput').value;
    const pass = document.getElementById('passwordInput').value;

    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        // Automatically logs in after signup
    } catch (error) {
        alert("Signup Failed: " + error.message);
    }
}

// ================= 4. GUEST LOGIN =================
async function loginAsGuest() {
    try {
        await signInAnonymously(auth);
    } catch (error) {
        alert("Guest Error: " + error.message);
    }
}

// ================= PROFILE & LOGOUT =================
function saveProfile() {
    const name = document.getElementById('setupName').value;
    if(name) {
        localStorage.setItem('quran_user', name);
        // In real app, save to Firestore here
        window.UI.showSection('welcomeScreen');
    }
}

function logoutUser() {
    signOut(auth).then(() => {
        window.location.reload();
    });
}

// ================= STATE LISTENER =================
onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("User Active:", user.uid);
        // Check if user has a name in localstorage or db
        // For simplicity, always show Setup if no local name, else Home
        if(localStorage.getItem('quran_user')) {
            window.UI.showSection('welcomeScreen');
        } else {
            window.UI.showSection('profileSetupScreen');
        }
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
    logoutUser
};
