// ============================================
// ui.js
// UI helpers: typing effect, toast, loading
// ============================================

// Ayat typing effect
export function ayatTypingEffect(text) {
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

// Toast notification (success/error/info)
export function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toast
  const existing = document.getElementById('toastMsg');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toastMsg';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('toast-show'), 10);

  // Remove after duration
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// Show loading spinner
export function showLoading(message = 'Loading...') {
  const existing = document.getElementById('loadingOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `
    <div class="loading-box">
      <div class="loading-spinner"></div>
      <p>${message}</p>
    </div>
  `;
  document.body.appendChild(overlay);
}

// Hide loading spinner
export function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.remove();
}

// Hide element helper
export function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// Show element helper
export function show(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

// Format number with commas
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
