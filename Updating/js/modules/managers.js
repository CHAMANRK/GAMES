// ═══════════════════════════════════════════
//  managers.js — ListenerManager, TimerManager,
//                RateLimiter, BruteForceProtection
//  Fix: timer ID duplication bug patched
// ═══════════════════════════════════════════

import { CONFIG } from '../../config.js';

// ── Firestore / RTDB listener cleanup ──
export class ListenerManager {
  constructor() { this._map = new Map(); }

  add(id, unsub) {
    if (this._map.has(id)) {
      try { this._map.get(id)?.(); } catch (_) {}
    }
    this._map.set(id, unsub);
  }

  remove(id) {
    const fn = this._map.get(id);
    if (fn) { try { fn(); } catch (_) {} this._map.delete(id); }
  }

  removeAll() {
    this._map.forEach(fn => { try { fn(); } catch (_) {} });
    this._map.clear();
  }
}

// ── Named timers (no duplicate IDs!) ──
export class TimerManager {
  constructor() {
    this._timeouts  = new Map();
    this._intervals = new Map();
  }

  setTimeout(id, callback, delay) {
    this.clearTimeout(id);                         // purana hatao pehle
    const t = setTimeout(() => {
      try { callback(); } catch (e) { console.error(`Timer[${id}] error:`, e); }
      this._timeouts.delete(id);
    }, delay);
    this._timeouts.set(id, t);
    return t;
  }

  setInterval(id, callback, interval) {
    this.clearInterval(id);
    const t = setInterval(() => {
      try { callback(); } catch (e) { console.error(`Interval[${id}] error:`, e); }
    }, interval);
    this._intervals.set(id, t);
    return t;
  }

  clearTimeout(id) {
    const t = this._timeouts.get(id);
    if (t !== undefined) { clearTimeout(t); this._timeouts.delete(id); }
  }

  clearInterval(id) {
    const t = this._intervals.get(id);
    if (t !== undefined) { clearInterval(t); this._intervals.delete(id); }
  }

  clearAll() {
    this._timeouts.forEach(t  => clearTimeout(t));
    this._intervals.forEach(t => clearInterval(t));
    this._timeouts.clear();
    this._intervals.clear();
  }
}

// ── Coin API rate limiter ──
export class RateLimiter {
  constructor(max = CONFIG.COIN_RATE_LIMIT_MAX, windowMs = CONFIG.COIN_RATE_LIMIT_WINDOW_MS) {
    this._max      = max;
    this._window   = windowMs;
    this._requests = [];
  }

  canRequest() {
    const now = Date.now();
    this._requests = this._requests.filter(t => now - t < this._window);
    if (this._requests.length < this._max) {
      this._requests.push(now);
      return true;
    }
    return false;
  }
}

// ── Login brute-force protection (client-side only, supplements Firebase) ──
export class BruteForceProtection {
  constructor() { this._map = new Map(); }

  _clean(key) {
    const cutoff = Date.now() - CONFIG.BRUTE_FORCE_TIMEOUT_MS;
    const list   = this._map.get(key) || [];
    const fresh  = list.filter(t => t > cutoff);
    this._map.set(key, fresh);
    return fresh;
  }

  record(email) {
    const key  = email.toLowerCase();
    const list = this._clean(key);
    list.push(Date.now());
    this._map.set(key, list);
  }

  isBlocked(email) {
    const list = this._clean(email.toLowerCase());
    return list.length >= CONFIG.BRUTE_FORCE_MAX_ATTEMPTS;
  }

  remainingMs(email) {
    const list = this._clean(email.toLowerCase());
    if (!list.length) return 0;
    return Math.max(0, CONFIG.BRUTE_FORCE_TIMEOUT_MS - (Date.now() - list[0]));
  }

  reset(email) { this._map.delete(email.toLowerCase()); }
}
