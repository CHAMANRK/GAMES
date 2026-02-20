// ============================================
// search.js
// Quran search feature
// ============================================

import { getQuranData } from './quiz.js';

// ── Remove Arabic Diacritics ───────────────
function removeDiacritics(text) {
  return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
}

// ── Main Search Function ───────────────────
export function searchAyats() {
  const inputRaw = document.getElementById('searchInput').value.trim();
  const input = removeDiacritics(inputRaw.toLowerCase());
  const resultsDiv = document.getElementById('searchResults');
  const quranData = getQuranData();

  if (!input) {
    resultsDiv.innerHTML = "<em>Kuch likhiye search ke liye.</em>";
    return;
  }

  if (!quranData || quranData.length === 0) {
    resultsDiv.innerHTML = "<em>Data load ho raha hai...</em>";
    return;
  }

  const results = quranData.filter(a =>
    removeDiacritics(a.text.toLowerCase()).includes(input) ||
    removeDiacritics(a.surah_name.toLowerCase()).includes(input) ||
    String(a.page) === input ||
    String(((a.page - 1) / 20 | 0) + 1) === input
  );

  if (results.length === 0) {
    resultsDiv.innerHTML = "<b>Koi result nahi mila.</b>";
    return;
  }

  // Max 30 results dikhao performance ke liye
  const limited = results.slice(0, 30);

  resultsDiv.innerHTML = limited.map(r => {
    const highlightExactWord = (text) => {
      const words = text.split(/(\s+)/);
      return words.map(word => {
        const wordClean = removeDiacritics(word.toLowerCase());
        if (wordClean === input) {
          return `<mark>${word}</mark>`;
        }
        return word;
      }).join('');
    };

    const highlightedText = highlightExactWord(r.text);
    const highlightedSurah = highlightExactWord(r.surah_name);
    const paraNum = ((r.page - 1) / 20 | 0) + 1;

    return `
      <div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank');">
        <b>Ayat:</b> ${highlightedText}<br>
        <b>Surah:</b> ${highlightedSurah} |
        <b>Page:</b> ${r.page} |
        <b>Para:</b> ${paraNum}
        <span style="color:#aad; float:right; font-size:1em;">🔗 Open</span>
      </div>
    `;
  }).join('');

  if (results.length > 30) {
    resultsDiv.innerHTML += `<p style="color:#bfa14a; text-align:center;">... aur ${results.length - 30} results. Zyada specific search karein.</p>`;
  }
}

// ── Setup Search Events ────────────────────
export function initSearch() {
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        searchAyats();
        e.preventDefault();
      }
    });
  }

  // Global function for HTML onclick
  window.searchAyats = searchAyats;
}
