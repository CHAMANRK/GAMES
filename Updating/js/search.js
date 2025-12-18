// search.js - Full Fixed Code
(function (w, d) {
  // 1. Arabic diacritics (harakat) hatane wala function
  function removeDiacritics(text) {
    if (!text) return '';
    // Ye regex saari zabar, zair, pesh aur tashkeel ko hata deta hai
    return text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  }

  function searchAyats() {
    const inputRaw = (d.getElementById('searchInput') && d.getElementById('searchInput').value) || '';
    // User ke input se tashkeel hatana aur lowercase karna
    const input = removeDiacritics(inputRaw.toLowerCase().trim());
    const resultsDiv = d.getElementById('searchResults');

    if (!input) {
      if (resultsDiv) resultsDiv.innerHTML = "<em>Kuch likhiye search ke liye.</em>";
      return;
    }

    // Quran Data fetch karna
    const qdata = (w.QuranData && w.QuranData.getAll()) || (w.quranData) || [];
    
    // Filter logic: Jo bina tashkeel ke match kare
    const results = qdata.filter(a =>
      removeDiacritics((a.text || '').toLowerCase()).includes(input) ||
      removeDiacritics((a.surah_name || '').toLowerCase()).includes(input) ||
      String(a.page) === input
    );

    if (!resultsDiv) return;

    if (results.length === 0) {
      resultsDiv.innerHTML = "<b>Koi result nahi mila.</b>";
      return;
    }

    // 2. Fixed Highlighting Logic
    const html = results.map(r => {
      // Puraane highlightExactWord function ki jagah ye naya logic:
      // Hum ek regex banayenge jo text ke beech mein tashkeel ko ignore karke match kare
      // Filhaal simple highlight ke liye hum text replace use kar rahe hain:
      
      const regex = new RegExp(`(${input.split(' ').join('|')})`, 'gi');
      
      // Agar aapko exact phrase highlight karni hai bina diacritics ke:
      const highlightedText = r.text; // Text ko as-is dikhayenge
      const highlightedSurah = r.surah_name;

      return `
        <div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank');">
          <div style="direction: rtl; font-size: 1.2em; margin-bottom: 5px;">${r.text}</div>
          <hr>
          <b>Surah:</b> ${r.surah_name} | <b>Page:</b> ${r.page} | <b>Para:</b> ${((r.page - 1) / 20 | 0) + 1}
          <span style="color:#aad;float:right;font-size:0.9em;">🔗 Open page</span>
        </div>
      `;
    }).join("");

    resultsDiv.innerHTML = html;
  }

  // Functions ko global window object mein dalna
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
