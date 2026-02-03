import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// YOUR CONFIG
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
const provider = new GoogleAuthProvider();

// Google Login
async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, provider);
        console.log("Logged in:", result.user.displayName);
        // Direct to Home if already has name, else Profile
        window.UI.showSection('welcomeScreen'); 
    } catch (error) {
        console.error(error);
        alert("Login Failed: " + error.message);
    }
}

// Guest Login
async function loginAsGuest() {
    try {
        await signInAnonymously(auth);
        window.UI.showSection('profileSetupScreen');
    } catch (error) {
        console.error(error);
    }
}

// Save Profile Name (Local + Firebase logic placeholder)
function saveProfile() {
    const name = document.getElementById('setupName').value;
    if(name) {
        localStorage.setItem('quran_user', name);
        window.UI.showSection('welcomeScreen');
    }
}

// Auth State Listener
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Optional: Auto redirect can be enabled here
        // window.UI.showSection('welcomeScreen');
    }
});

// Expose to HTML
window.Auth = {
    loginWithGoogle,
    loginAsGuest,
    saveProfile
};
