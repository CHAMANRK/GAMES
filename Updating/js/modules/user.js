// ═══════════════════════════════════════════
//  user.js — Firestore sync, user listener,
//            header update, profile panel
// ═══════════════════════════════════════════

import {
  doc, setDoc, getDoc, updateDoc, increment,
  serverTimestamp, onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { db }                      from './firebase.js';
import { $, esc, toast, on }       from './ui.js';
import { TimerManager }            from './managers.js';

const ppTimers  = new TimerManager();
let   _userUnsub = null;

// ── Create/load user in Firestore ──
export async function syncUser(uid, data) {
  try {
    const userRef = doc(db, 'users', uid);
    const snap    = await getDoc(userRef);

    if (!snap.exists()) {
      await runTransaction(db, async tx => {
        const existing = await tx.get(userRef);
        if (existing.exists()) return;
        const newData = {
          uid,
          username:       data.username || 'Player',
          email:          data.email    || '',
          coins:          500,
          xp: 0, level: 1, accuracy: 0, totalGames: 0, totalWins: 0,
          totalCorrect: 0, streak: 0, bestStreak: 0, avgSpeed: 0, fastestAnswer: 0,
          lastLogin: serverTimestamp(), createdAt: serverTimestamp(),
          isHafiz: false, role: 'user', avatar: 'default', onlineMode: true,
          badges: [], friends: [], friendRequests: [], bookmarks: []
        };
        tx.set(userRef, newData);
        // Note: curData set here is from transaction — safe because we check snap first
        const state = await import('../state/appState.js');
        state.setCurData(newData);
      });
    } else {
      const state = await import('../state/appState.js');
      state.setCurData(snap.data());
      const upd = { lastLogin: serverTimestamp() };
      const d   = snap.data();
      if (!d.onlineMode)     { upd.onlineMode     = true; }
      if (!d.friendRequests) { upd.friendRequests = [];   }
      if (!d.friends)        { upd.friends        = [];   }
      updateDoc(userRef, upd).catch(() => {});
    }
    startUserListener(uid);
  } catch (e) {
    console.error('syncUser error:', e.code || e.message);
  }
}

// ── Real-time listener ──
export function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
  _userUnsub = onSnapshot(
    doc(db, 'users', uid),
    async snap => {
      if (snap.exists()) {
        const state = await import('../state/appState.js');
        state.setCurData(snap.data());
        updateHeader();
      }
    },
    err => console.warn('UserListener error:', err.message)
  );
}

export function stopUserListener() {
  if (_userUnsub) { _userUnsub(); _userUnsub = null; }
}

// ── Header display ──
export async function updateHeader() {
  const state   = await import('../state/appState.js');
  const curUser = state.getCurUser();
  const curData = state.getCurData();
  const pb = $('profileBtn'), hc = $('hdrCoins'), hv = $('hdrCoinsVal'), gl = $('guestLogoutPill');

  if (curUser && !curUser.isAnonymous) {
    pb?.classList.remove('hidden');
    hc?.classList.remove('hidden');
    if (hv) hv.textContent = (curData?.coins || 0).toLocaleString();
    if (gl) gl.style.display = 'none';
    refreshProfilePanel();
  } else if (curUser?.isAnonymous) {
    pb?.classList.add('hidden');
    hc?.classList.add('hidden');
    if (gl) gl.style.display = 'flex';
  } else {
    pb?.classList.add('hidden');
    hc?.classList.add('hidden');
    if (gl) gl.style.display = 'none';
  }
}

// ── Profile panel ──
export async function refreshProfilePanel() {
  const state   = await import('../state/appState.js');
  const curUser = state.getCurUser();
  const curData = state.getCurData();
  if (!curUser || curUser.isAnonymous || !curData) return;

  const isHafiz = curData.isHafiz || false;
  const s       = (id, v) => { const el = $(id); if (el) el.textContent = v; };

  s('ppUsername', esc(curData.username || curUser.displayName || 'Player'));
  s('ppRole',     isHafiz ? '👑 Hafiz' : curData.role === 'admin' ? '🛡️ Admin' : '🎮 Player');
  s('ppCoins',    (curData.coins    || 0).toLocaleString());
  s('ppAccuracy', (curData.accuracy || 0) + '%');
  s('ppGames',     curData.totalGames  || 0);

  const uidEl = $('ppUidVal'); if (uidEl) uidEl.textContent = curUser.uid;
  const av    = $('ppAvatarCircle'); if (av) av.textContent = isHafiz ? '👑' : '👤';
  const pb    = $('profileBtnIcon'); if (pb) pb.textContent = isHafiz ? '👑' : '👤';
}

export function openProfilePanel() {
  refreshProfilePanel();
  $('profilePanel')?.classList.add('open');
  $('profileOverlay')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

export function closeProfilePanel() {
  $('profilePanel')?.classList.remove('open');
  $('profileOverlay')?.classList.add('hidden');
  document.body.style.overflow = '';
}

export function setupUidCopy() {
  on('ppUidCopy', 'click', async () => {
    const state = await import('../state/appState.js');
    const uid   = state.getCurUser()?.uid;
    if (!uid) return;
    const done = () => {
      const el = $('ppUidCopied');
      if (el) {
        el.classList.remove('hidden');
        ppTimers.setTimeout('uidCopyHide', () => el.classList.add('hidden'), 2000);
      }
    };
    navigator.clipboard.writeText(uid).then(done).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = uid;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    });
  });
}
