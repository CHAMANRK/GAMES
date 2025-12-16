// search.js
// Contains search logic and utility to remove Arabic diacritics.
// Exposes searchAyats() globally, used by the search form in index.html.

(function (w, d) {
  // Remove Arabic diacritics (harakat, tashkeel)
  function removeDiacritics(text) {
    if (!text) return '';
    return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  }

  function searchAyats() {
    const inputRaw = (d.getElementById('searchInput') && d.getElementById('searchInput').value) || '';
    const input = removeDiacritics(inputRaw.toLowerCase().trim());
    const resultsDiv = d.getElementById('searchResults');

    if (!input) {
      if (resultsDiv) resultsDiv.innerHTML = "<em>Kuch likhiye search ke liye.</em>";
      return;
    }

    const qdata = (w.QuranData && w.QuranData.getAll()) || [];
    const results = qdata.filter(a =>
      removeDiacritics((a.text || '').toLowerCase()).includes(input) ||
      removeDiacritics((a.surah_name || '').toLowerCase()).includes(input) ||
      String(a.page) === input ||
      String(((a.page - 1) / 20 | 0) + 1) === input
    );

    if (!resultsDiv) return;

    if (results.length === 0) {
      resultsDiv.innerHTML = "<b>Koi result nahi mila.</b>";
      return;
    }

    const html = results.map(r => {
      const highlightExactWord = (text) => {
        const words = (text || '').split(/(\s+)/); // preserve spaces
        return words.map(word => {
          const wordClean = removeDiacritics(word.toLowerCase());
          if (wordClean === input) {
            return `<mark style="background-color: yellow">${word}</mark>`;
          }
          return word;
        }).join('');
      };

      const highlightedText = highlightExactWord(r.text);
      const highlightedSurah = highlightExactWord(r.surah_name);

      return `
        <div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank');">
          <b>Ayat:</b> ${highlightedText} <br>
          <b>Surah:</b> ${highlightedSurah} | <b>Page:</b> ${r.page} | <b>Para:</b> ${((r.page - 1) / 20 | 0) + 1}
          <span style="color:#aad;float:right;font-size:1em;">🔗 Open page</span>
        </div>
      `;
    }).join("");

    resultsDiv.innerHTML = html;
  }

  // Expose functions
  w.removeDiacritics = removeDiacritics;
  w.searchAyats = searchAyats;

  // Also keep Enter-key behavior consistent (attach here, since DOM may already be present)
  document.addEventListener('DOMContentLoaded', function () {
    const si = document.getElementById('searchInput');
    if (si) {
      si.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { searchAyats(); e.preventDefault(); }
      });
    }
  });
})(window, document);