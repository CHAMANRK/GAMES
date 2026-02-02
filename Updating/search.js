// search.js - Search functionality
(function() {
  // Utility: Remove Arabic Diacritics (Harakaat)
  function removeDiacritics(text) {
    return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  }

  // Tashkeel (Diacritics) hatane wala function
  function searchAyats() {
    const inputRaw = document.getElementById('searchInput').value.trim();
    const input = removeDiacritics(inputRaw.toLowerCase());
    const resultsDiv = document.getElementById('searchResults');

    if (!input) {
      resultsDiv.innerHTML = "<em>Kuch likhiye search ke liye.</em>";
      return;
    }

    const results = window.quranData.filter(a =>
      removeDiacritics(a.text.toLowerCase()).includes(input) ||
      removeDiacritics(a.surah_name.toLowerCase()).includes(input) ||
      String(a.page) === input ||
      String(((a.page - 1) / 20 | 0) + 1) === input
    );

    if (results.length === 0) {
      resultsDiv.innerHTML = "<b>Koi result nahi mila.</b>";
      return;
    }

    resultsDiv.innerHTML = results.map(r => {
      const highlightExactWord = (text) => {
        const words = text.split(/(\s+)/); // preserve spaces
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
  }

  // Enter par bhi search ho
  document.getElementById('searchInput').addEventListener('keydown', function(e){
    if (e.key === 'Enter') { searchAyats(); e.preventDefault(); }
  });

  // Expose to window
  window.searchAyats = searchAyats;
  window.removeDiacritics = removeDiacritics;

  window.Search = {
    searchAyats: searchAyats,
    removeDiacritics: removeDiacritics
  };
})();
