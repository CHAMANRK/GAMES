// data.js
// Responsible for loading quran_full.json and exposing accessors.
// Attaches QuranData to window with methods: loadQuranData() and getAll()

(function (w) {
  const state = {
    data: []
  };

  async function loadQuranData() {
    try {
      const resp = await fetch('quran_full.json');
      if (!resp.ok) throw new Error('Network response was not ok: ' + resp.status);
      const json = await resp.json();
      state.data = json;
    } catch (e) {
      // Keep behavior similar to original: alert user on load error.
      alert('❌ Quran data load error: ' + (e && e.message ? e.message : e));
      state.data = [];
    }
  }

  function getAll() {
    return state.data;
  }

  // Expose on window
  w.QuranData = {
    loadQuranData,
    getAll
  };
})(window);