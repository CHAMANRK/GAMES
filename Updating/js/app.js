// ============================================
// app.js — Screen navigation utility
// No imports from other files (avoids circular deps)
// ============================================

export function showSection(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  if (id !== 'welcomeScreen') {
    const sc  = document.getElementById('searchContainer');
    const btn = document.getElementById('toggleSearchBtn');
    if (sc)  sc.style.display = 'none';
    if (btn) btn.innerText = '🔎 Search';
  }

  setTimeout(() => {
    const heading = document.querySelector(`#${id} .main-heading`);
    if (heading) heading.focus();
  }, 200);
}

export function toggleSearch() {
  const sc  = document.getElementById('searchContainer');
  const btn = document.getElementById('toggleSearchBtn');
  if (!sc || !btn) return;
  if (sc.style.display === 'none' || sc.style.display === '') {
    sc.style.display = 'block';
    btn.innerText = '❌ Band Karein';
    document.getElementById('searchInput')?.focus();
  } else {
    sc.style.display = 'none';
    btn.innerText = '🔎 Search';
  }
}
