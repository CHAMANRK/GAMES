// data.js - Quran data management
(function() {
  // Global data storage
  window.quranData = [];

  // Quran data load
  async function loadQuranData() {
    try {
      window.quranData = await (await fetch('quran_full.json')).json();
    } catch (e) {
      alert('❌ Quran data load error: ' + e.message);
    }
  }

  // Expose to window
  window.DataManager = {
    loadQuranData: loadQuranData
  };

  // Load on page load
  window.addEventListener('DOMContentLoaded', async () => {
    await loadQuranData();
  });
})();
