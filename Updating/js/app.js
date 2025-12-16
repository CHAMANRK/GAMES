// app.js
// Entry point: initialize modules when DOM is ready.
// Calls data loader and initializes quiz module.

(function (w, d) {
  async function onLoad() {
    // Load Quran data first
    if (w.QuranData && typeof w.QuranData.loadQuranData === 'function') {
      await w.QuranData.loadQuranData();
    }
    // Initialize quiz module (wires radio listener etc)
    if (w.Quiz && typeof w.Quiz.init === 'function') {
      w.Quiz.init();
    }

    // ensure hint info initial state
    const hintInfo = d.getElementById('hintInfo');
    if (hintInfo) hintInfo.textContent = `Hint: 0/2`;
  }

  // Run on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onLoad);
  } else {
    onLoad();
  }
})(window, document);