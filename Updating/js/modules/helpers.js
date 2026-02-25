// ═══════════════════════════════════════════
//  helpers.js — Shared pure utility functions
//  (No Firebase, No DOM — zero dependencies)
//  Circular dependency fix: quiz.js aur auth.js
//  dono yahan se import karte hain
// ═══════════════════════════════════════════

export const isValidEmail    = e  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const isValidUsername = un => un && un.length >= 3 && un.length <= 20 && /^[a-zA-Z0-9_]+$/.test(un);
export const isValidPassword = pw => pw && pw.length >= 6;
export const isValidParaRange = (f, t) => !isNaN(f) && !isNaN(t) && f >= 1 && t <= 30 && f <= t;
