// ═══════════════════════════════════════════
//  firebase.js — Firebase init & exports
//  Sirf ek baar initialize hota hai, baaki
//  modules yahan se import karte hain
// ═══════════════════════════════════════════

import { initializeApp }    from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider }
                             from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore }      from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getDatabase }       from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";
import { CONFIG }            from '../../config.js';

const firebaseApp = initializeApp(CONFIG.FIREBASE_CONFIG);

export const auth  = getAuth(firebaseApp);
export const db    = getFirestore(firebaseApp);
export const rtdb  = getDatabase(firebaseApp);
export const GP    = new GoogleAuthProvider();
