// ui.js
// UI helpers: showSection, toggleSearch, ayatTypingEffect
// Functions are attached to window so existing inline handlers keep working.

(function (w, d) {
  // Show a given screen by id; manage .active class for CSS-driven display.
  function showSection(id) {
    const screens = d.querySelectorAll('.screen');
    screens.forEach(s => s.classList.remove('active'));
    const target = d.getElementById(id);
    if (target) target.classList.add('active');

    // When entering non-welcome screens, hide search container and update button label.
    const searchContainer = d.getElementById('searchContainer');
    const toggleBtn = d.getElementById('toggleSearchBtn');
    if (id !== 'welcomeScreen') {
      if (searchContainer) searchContainer.style.display = 'none';
      if (toggleBtn) toggleBtn.innerText = '🔎 Search';
    }

    // move focus to heading for accessibility
    setTimeout(() => {
      const heading = d.querySelector(`#${id} .main-heading`);
      if (heading) heading.focus();
    }, 200);
  }

  // Toggle the search panel on welcome screen
  function toggleSearch() {
    const sc = d.getElementById('searchContainer');
    const btn = d.getElementById('toggleSearchBtn');
    if (!sc || !btn) return;
    if (sc.style.display === 'none' || sc.style.display === '') {
      sc.style.display = 'block';
      btn.innerText = '❌ Band Karein';
      const input = d.getElementById('searchInput');
      if (input) input.focus();
    } else {
      sc.style.display = 'none';
      btn.innerText = '🔎 Search';
    }
  }

  // Typing effect for ayat text. Exposed as window.ayatTypingEffect (keeps behavior).
  function ayatTypingEffect(text) {
    const ayatDiv = d.getElementById('ayatText');
    if (!ayatDiv) return;
    ayatDiv.innerHTML = "";
    let i = 0;
    function type() {
      if (i < text.length) {
        ayatDiv.innerHTML += text.charAt(i);
        i++;
        setTimeout(type, 22);
      }
    }
    type();
  }

  // Expose to global scope
  w.showSection = showSection;
  w.toggleSearch = toggleSearch;
  w.ayatTypingEffect = ayatTypingEffect;

})(window, document);