// ui.js - UI management and screen transitions (patched with defensive DOM access)
(function() {
  function showSection(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');

    // Hide search overlay on screens other than welcome
    if (id !== "welcomeScreen") {
      const sc = document.getElementById("searchContainer");
      if (sc) sc.style.display = "none";
      const toggleBtn = document.getElementById("toggleSearchBtn");
      if (toggleBtn) toggleBtn.innerText = "🔎 Search";
    }

    setTimeout(() => {
      const heading = document.querySelector(`#${id} .main-heading`);
      if (heading) heading.focus();
    }, 200);
  }

  function toggleSearch() {
    const sc = document.getElementById("searchContainer");
    const btn = document.getElementById("toggleSearchBtn");
    if (!sc) return;

    // Use computed style to determine visibility reliably
    const computed = getComputedStyle(sc);
    const isHidden = (sc.style.display === "none" || computed.display === "none");

    if (isHidden) {
      sc.style.display = "block";
      if (btn) btn.innerText = "❌ Band Karein";
      const input = document.getElementById("searchInput");
      if (input) input.focus();
    } else {
      sc.style.display = "none";
      if (btn) btn.innerText = "🔎 Search";
    }
  }

  function ayatTypingEffect(text) {
    const ayatDiv = document.getElementById('ayatText');
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

  // Expose to window
  window.showSection = showSection;
  window.toggleSearch = toggleSearch;
  window.ayatTypingEffect = ayatTypingEffect;

  window.UI = {
    showSection: showSection,
    toggleSearch: toggleSearch,
    ayatTypingEffect: ayatTypingEffect
  };
})();
