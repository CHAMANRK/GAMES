// ============================================
// firebase-config.js
// Firebase initialize karna — sab files yahan se import karenge
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJ-1FJFVj4jsP2or-szVmqHaN5XpmlIwE",
  authDomain: "quran-quiz-1c052.firebaseapp.com",
  databaseURL: "https://quran-quiz-1c052-default-rtdb.firebaseio.com",
  projectId: "quran-quiz-1c052",
  storageBucket: "quran-quiz-1c052.firebasestorage.app",
  messagingSenderId: "428336069514",
  appId: "1:428336069514:web:70f92890abd0b244312673",
  measurementId: "G-PBGM14CRFD"
};

// Initialize
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const analytics = getAnalytics(app);

export { app, auth, db, rtdb, analytics };
