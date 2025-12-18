(function (w, d) {
  // 1. Arabic diacritics hatane wala function
  function removeDiacritics(text) {
    if (!text) return '';
    // Ye regex saari zabar, zair, pesh aur tashkeel ko hata deta hai
    return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  }

  function searchAyats() {
    const inputRaw = (d.getElementById('searchInput') && d.getElementById('searchInput').value) || '';
    // Input se tashkeel hatana aur normalize karna
    const input = removeDiacritics(inputRaw.toLowerCase().trim());
    const resultsDiv = d.getElementById('searchResults');

    if (!input) {
      if (resultsDiv) resultsDiv.innerHTML = "<em>Kuch likhiye search ke liye.</em>";
      return;
    }

    // Quran Data fetch karna (script.js ya global variable se)
    const qdata = (w.quranData) || (w.QuranData && w.QuranData.getAll()) || [];
    
    // 2. Filter Logic: Jo bina tashkeel ke poori phrase match kare
    const results = qdata.filter(a => {
      const plainText = removeDiacritics((a.text || '').toLowerCase());
      const plainSurah = removeDiacritics((a.surah_name || '').toLowerCase());
      return plainText.includes(input) || plainSurah.includes(input) || String(a.page) === input;
    });

    if (!resultsDiv) return;

    if (results.length === 0) {
      resultsDiv.innerHTML = "<b>Koi result nahi mila.</b>";
      return;
    }

    // 3. Display Results (Bina highlight error ke)
    resultsDiv.innerHTML = results.map(r => {
      return `
        <div class="search-result" style="border-bottom:1px solid #eee; padding:10px; cursor:pointer;" 
             onclick="window.open('https://quran.com/page/${r.page}','_blank');">
          <div style="direction: rtl; font-size: 1.3em; font-family: 'Amiri', serif; margin-bottom: 8px;">
            ${r.text}
          </div>
          <div style="font-size: 0.9em; color: #555;">
            <b>Surah:</b> ${r.surah_name} | <b>Page:</b> ${r.page} | <b>Para:</b> ${((r.page - 1) / 20 | 0) + 1}
            <span style="color:#007bff; float:right;">🔗 Open page</span>
          </div>
        </div>
      `;
    }).join("");
  }

  w.removeDiacritics = removeDiacritics;
  w.searchAyats = searchAyats;

  // Enter key support
  d.addEventListener('DOMContentLoaded', function () {
    const si = d.getElementById('searchInput');
    if (si) {
      si.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          searchAyats();
        }
      });
    }
  });
})(window, document);
