// ui.js - UI management and screen transitions
(function() {
  function showSection(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if(id !== "welcomeScreen") {
      document.getElementById("searchContainer").style.display = "none";
      document.getElementById("toggleSearchBtn").innerText = "🔎 Search";
    }
    setTimeout(() => {
      const heading = document.querySelector(`#${id} .main-heading`);
      if(heading) heading.focus();
    }, 200);
  }

  function toggleSearch() {
    const sc = document.getElementById("searchContainer");
    const btn = document.getElementById("toggleSearchBtn");
    if (sc.style.display === "none") {
      sc.style.display = "block";
      btn.innerText = "❌ Band Karein";
      document.getElementById("searchInput").focus();
    } else {
      sc.style.display = "none";
      btn.innerText = "🔎 Search";
    }
  }

  function ayatTypingEffect(text) {
    const ayatDiv = document.getElementById('ayatText');
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
