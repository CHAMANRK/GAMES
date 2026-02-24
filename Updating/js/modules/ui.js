// ═══════════════════════════════════════════
//  ui.js — DOM helpers, toast, screen nav,
//          button loader, input sanitizer
// ═══════════════════════════════════════════

import { TimerManager } from './managers.js';

const uiTimers = new TimerManager();

// ── DOM shortcuts ──
export const $ = id => document.getElementById(id);
export const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

// ── Detect mobile (cached) ──
export const isMobile = (() => {
  const result = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  return () => result;
})();

// ── XSS escape ──
export function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
    .replace(/\//g, '&#x2F;');
}

// ── Sleep ──
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Screen transitions ──
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id);
  if (sc) {
    sc.classList.add('active');
    window.scrollTo(0, 0);
    if (isMobile()) setTimeout(() => document.activeElement?.blur?.(), 100);
  }
  // Search band kar do agar welcome screen nahi hai
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer');
    if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn');
    if (b) b.textContent = '🔎 Search';
  }
}

// ── Toast (fixed: single timer per toast, no duplicate IDs) ──
let _toastEl = null;
export function toast(msg, type = 'info', dur = 3000) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.id = '_toast';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.className   = `toast toast-${type} toast-show`;
  uiTimers.setTimeout('toast', () => _toastEl.classList.remove('toast-show'), dur);
}

// ── Auth messages ──
export function setMsg(id, msg, type = 'error') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `auth-msg ${type} show`;
  if (isMobile()) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

export function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => {
    m.className  = 'auth-msg';
    m.textContent = '';
  });
}

// ── Button loading state (no DOM property leak) ──
const _origTexts = new WeakMap();

export function btnLoad(id, loading, fallback) {
  const b = $(id);
  if (!b) return;
  if (loading) {
    _origTexts.set(b, b.textContent);
    b.disabled            = true;
    b.textContent         = '⏳';
    b.style.pointerEvents = 'none';
    b.style.opacity       = '0.6';
  } else {
    b.disabled            = false;
    b.textContent         = fallback || _origTexts.get(b) || b.textContent;
    b.style.pointerEvents = 'auto';
    b.style.opacity       = '1';
  }
}

// ── Boot loader ──
let _bootDone = false;
export function hideBootLoader(force = false) {
  if (_bootDone && !force) return;
  _bootDone = true;
  const bl = $('bootLoader');
  if (!bl) return;
  bl.style.transition = 'opacity 0.45s ease';
  bl.style.opacity    = '0';
  uiTimers.setTimeout('bootHide', () => { bl.style.display = 'none'; }, 480);
}
export const isBootDone = () => _bootDone;

// ── typeText animation (fixed: single timer ID, no memory leak) ──
export function typeText(text, elId, instant = false) {
  const el = $(elId);
  if (!el || !text) return;
  el.textContent = '';
  if (instant) { el.textContent = text; return; }

  uiTimers.clearTimeout('typeText');   // ← cancel any previous animation
  let i = 0;
  const tick = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      uiTimers.setTimeout('typeText', tick, 20);
    }
  };
  tick();
}

// ── Coin particles ──
export function spawnCoinParticles(fromEl, toEl, count = 18) {
  if (!fromEl || !toEl) return;
  const fR    = fromEl.getBoundingClientRect();
  const tR    = toEl.getBoundingClientRect();
  const startX = fR.left + fR.width  / 2;
  const startY = fR.top  + fR.height / 2;
  const endX   = tR.left + tR.width  / 2;
  const endY   = tR.top  + tR.height / 2;

  for (let i = 0; i < count; i++) {
    const p  = document.createElement('span');
    p.className = 'coin-particle';
    p.textContent = '🪙';
    const sz = 12 + Math.random() * 12;
    p.style.cssText = `position:fixed;left:${startX}px;top:${startY}px;font-size:${sz}px;`
                    + `transform:translate(-50%,-50%);pointer-events:none;z-index:99997;opacity:1;will-change:transform,opacity;`;
    document.body.appendChild(p);

    const delay  = Math.random() * 250;
    const spread = (Math.random() - 0.5) * 120;
    const arc    = -(Math.random() * 80 + 40);
    const dur    = 500 + Math.random() * 400;
    const dx     = endX - startX + spread;
    const dy     = endY - startY;

    uiTimers.setTimeout(`cp_${i}`, () => {
      const anim = p.animate([
        { transform: 'translate(-50%,-50%) scale(1)',                                              opacity: 1, offset: 0   },
        { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% + ${arc}px)) scale(1.2)`,  opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`,          opacity: 0, offset: 1   },
      ], { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
      anim.onfinish = () => p.remove();
    }, delay);
  }
}

// ── Welcome popup ──
export function showWelcomePopup(name, coins, isNew = false) {
  const p  = $('welcomePopup');
  if (!p) return;
  const wn = $('wpName'), wc = $('wpCoins');
  if (wn) wn.textContent = isNew ? `Ahlan, ${esc(name)}! 🌙` : `Marhaba, ${esc(name)}! 🌙`;
  if (wc) wc.textContent = isNew ? `🪙 ${coins} welcome coins!` : `🪙 ${coins} coins`;
  p.classList.add('show');
  uiTimers.setTimeout('welcomeHide', () => p.classList.remove('show'), 4000);
}
