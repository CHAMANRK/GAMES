// ui.js - UI management and screen transitions (patched)
(function() {
  function showSection(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');

    // Hide search overlay on screens other than welcome
    if(id !== "welcomeScreen") {
      const sc = document.getElementById("searchContainer");
      if (sc) sc.style.display = "none";
      const toggleBtn = document.getElementById("toggleSearchBtn");
      if (toggleBtn) toggleBtn.innerText = "🔎 Search";
    }

    // Highlight bottom nav item whose onclick contains this id
    document.querySelectorAll('.nav-item').forEach(a => {
      const on = a.getAttribute('onclick') || '';
      if (on.includes(`'${id}'`) || on.includes(`"${id}"`)) a.classList.add('active');
      else a.classList.remove('active');
    });

    // Persist last screen
    if (window.StorageManager && typeof window.StorageManager.setLastScreen === 'function') {
      window.StorageManager.setLastScreen(id);
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

  // On load: restore last screen & profile name
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const last = window.StorageManager?.getLastScreen?.();
      if (last) showSection(last);
    } catch(e){ /* ignore */ }

    // Load profile name into profile screen
    try {
      const profile = window.StorageManager?.getUserProfile?.();
      if (profile && profile.name) {
        const profileNameEl = document.getElementById('profileName');
        if (profileNameEl) profileNameEl.textContent = profile.name;
      }
      // Load coins if used
      const coinsEl = document.getElementById('displayCoins');
      if (coinsEl && profile && typeof profile.coins !== 'undefined') coinsEl.textContent = profile.coins;
    } catch(e) { console.warn('ui load error', e); }
  });

  // Expose
  window.showSection = showSection;
  window.toggleSearch = toggleSearch;
  window.ayatTypingEffect = ayatTypingEffect;

  window.UI = { showSection, toggleSearch, ayatTypingEffect };
})();