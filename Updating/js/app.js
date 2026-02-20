// ============================================
// app.js
// Screen navigation + app initialize
// ============================================

import { loadQuranData } from './quiz.js';

// ── Screen Navigation ──────────────────────
export function showSection(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });

  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
  }

  // Search bar band karo agar welcome screen nahi
  if (id !== 'welcomeScreen') {
    const sc = document.getElementById('searchContainer');
    const btn = document.getElementById('toggleSearchBtn');
    if (sc) sc.style.display = 'none';
    if (btn) btn.innerText = '🔎 Search';
  }

  // Focus heading for accessibility
  setTimeout(() => {
    const heading = document.querySelector(`#${id} .main-heading`);
    if (heading) heading.focus();
  }, 200);
}

// ── Search Toggle ──────────────────────────
export function toggleSearch() {
  const sc = document.getElementById('searchContainer');
  const btn = document.getElementById('toggleSearchBtn');
  if (!sc || !btn) return;

  if (sc.style.display === 'none' || sc.style.display === '') {
    sc.style.display = 'block';
    btn.innerText = '❌ Band Karein';
    const input = document.getElementById('searchInput');
    if (input) input.focus();
  } else {
    sc.style.display = 'none';
    btn.innerText = '🔎 Search';
  }
}

// ── App Initialize ─────────────────────────
async function initApp() {
  // Quran data load karo
  await loadQuranData();

  // Global functions (HTML onclick ke liye)
  window.showSection = showSection;
  window.toggleSearch = toggleSearch;
}

// ── DOM Ready ──────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
