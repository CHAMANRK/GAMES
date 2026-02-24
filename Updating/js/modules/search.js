// ═══════════════════════════════════════════
//  search.js — Quran text search
//  Fix: debounced, safe HTML output
// ═══════════════════════════════════════════

import { $, esc }       from './ui.js';
import { timerManager } from '../state/appState.js';
import { quizState }    from '../state/appState.js';

function normalizeArabic(t) {
  if (!t) return '';
  t = String(t)
    .replace(/\uFEFF/g, '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u0622\u0623\u0624\u0625\u0626\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647');
  return t.trim().toLowerCase();
}

function performSearch(raw) {
  const q  = normalizeArabic(raw);
  const rd = $('searchResults');
  if (!rd) return;

  if (!q) { rd.innerHTML = '<em>Kuch likhein...</em>'; return; }
  if (!quizState.quranData.length) { rd.innerHTML = '<em>Data load ho raha hai...</em>'; return; }

  const found = quizState.quranData.filter(a => {
    if (normalizeArabic(a.text).includes(q))       return true;
    if (normalizeArabic(a.surah_name).includes(q)) return true;
    if (String(a.page) === raw.trim())             return true;
    const para = a.para || (((a.page - 1) / 20 | 0) + 1);
    if (String(para) === raw.trim())              return true;
    return false;
  }).slice(0, 30);

  if (!found.length) { rd.textContent = 'Koi result nahi mila.'; return; }

  // Safe DOM rendering — no raw innerHTML with user data
  rd.innerHTML = '';
  found.forEach(r => {
    const para = r.para || (((r.page - 1) / 20 | 0) + 1);
    const div  = document.createElement('div');
    div.className = 'search-result';
    div.addEventListener('click', () => window.open(`https://quran.com/page/${r.page}`, '_blank'));
    div.textContent = `${r.text} — Surah: ${r.surah_name} | Page: ${r.page} | Para: ${para}`;
    rd.appendChild(div);
  });
}

// ── Debounced search on submit ──
export function doSearch(e) {
  if (e) e.preventDefault();
  const raw = $('searchInput')?.value.trim() || '';
  timerManager.clearTimeout('searchDebounce');
  timerManager.setTimeout('searchDebounce', () => performSearch(raw), 300);
}
