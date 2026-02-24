// ═══════════════════════════════════════════
//  config.js — App-wide constants & Firebase config
//  Edit karne ki zaroorat sirf isi file mein hogi
// ═══════════════════════════════════════════

export const CONFIG = {
  // ── Firebase (apne values yahan rakhein) ──
  FIREBASE_CONFIG: {
    apiKey:            "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
    authDomain:        "quran-quiz-3ee30.firebaseapp.com",
    databaseURL:       "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
    projectId:         "quran-quiz-3ee30",
    storageBucket:     "quran-quiz-3ee30.firebasestorage.app",
    messagingSenderId: "362662301719",
    appId:             "1:362662301719:web:e5fa7bd4adf633758e8c52",
    measurementId:     "G-CVQTH5SS0X"
  },

  // ── Quiz ──
  GUEST_QUESTION_LIMIT:   3,
  MAX_HINTS:              2,
  POOL_EXTRA:             20,
  SUBMIT_COOLDOWN_MS:     500,

  // ── Match ──
  GRACE_PERIOD_SEC:       15,
  MATCH_AUTO_CANCEL_MS:   60000,

  // ── App Boot ──
  BOOT_FAILSAFE_MS:       8000,
  FIRESTORE_TIMEOUT_MS:   5000,

  // ── Security ──
  TOKEN_BUCKET_RATE_LIMIT:      5,
  BRUTE_FORCE_MAX_ATTEMPTS:     5,
  BRUTE_FORCE_TIMEOUT_MS:       300000,
  COIN_RATE_LIMIT_MAX:          5,
  COIN_RATE_LIMIT_WINDOW_MS:    60000,
};

export const TABLES = {
  starter: { name: '🪵 Starter', fee: 200,  totalQ: 7,  firstTo: 4, winCoins: 400   },
  bronze:  { name: '🥉 Bronze',  fee: 500,  totalQ: 9,  firstTo: 5, winCoins: 1000  },
  silver:  { name: '🥈 Silver',  fee: 1000, totalQ: 11, firstTo: 6, winCoins: 2000  },
  gold:    { name: '🥇 Gold',    fee: 2500, totalQ: 13, firstTo: 7, winCoins: 5000  },
  diamond: { name: '💎 Diamond', fee: 5000, totalQ: 15, firstTo: 8, winCoins: 10000 },
};
