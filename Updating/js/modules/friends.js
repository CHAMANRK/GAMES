// ═══════════════════════════════════════════
//  friends.js — Friends list, search by UID,
//               add/unfriend, pending requests
// ═══════════════════════════════════════════

import {
  doc, getDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { db }                   from './firebase.js';
import { $, esc, toast, on }    from './ui.js';
import { timerManager, listenerManager, getCurUser, getCurData } from '../state/appState.js';

// ── Search friend by UID ──
export async function searchFriend() {
  const uid     = $('friendUidInput')?.value.trim();
  const preview = $('friendSearchPreview');
  const msg     = $('addFriendMsg');
  if (msg)     { msg.className = 'auth-msg'; msg.textContent = ''; }
  if (preview) { preview.innerHTML = ''; }

  if (!uid) { showFriendMsg('❌ UID likhein!', 'error'); return; }

  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) { showFriendMsg('❌ Login karein!', 'error'); return; }
  if (uid === curUser.uid)             { showFriendMsg('❌ Khud ko friend nahi kar sakte!', 'error'); return; }

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) { showFriendMsg('❌ User nahi mila.', 'error'); return; }

    const data    = snap.data();
    const curData = getCurData();
    const friends = curData?.friends || [];
    const already = friends.includes(uid);
    const pending = (curData?.friendRequests || []).includes(uid);

    // Safe DOM rendering
    if (preview) {
      preview.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'friend-preview-card';
      card.innerHTML = `
        <div class="friend-preview-avatar">👤</div>
        <div class="friend-preview-info">
          <div class="friend-preview-name">${esc(data.username || 'Player')}</div>
          <div class="friend-preview-stats">🪙 ${(data.coins || 0).toLocaleString()} | 🎯 ${data.accuracy || 0}%</div>
          <div class="friend-preview-uid">${esc(uid.slice(0, 20))}...</div>
        </div>
      `;

      if (!already) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary friend-action-btn';
        btn.style.cssText = 'margin-top:10px;width:100%;padding:10px';
        btn.textContent = pending ? '✅ Request Bheja' : '➕ Friend Request Bhejo';
        btn.disabled    = pending;
        if (!pending) {
          btn.addEventListener('click', () => sendFriendRequest(uid, data.username));
        }
        card.appendChild(btn);
      } else {
        const tag = document.createElement('div');
        tag.style.cssText = 'color:var(--emerald);font-size:0.82rem;margin-top:8px;font-family:Tajawal,sans-serif';
        tag.textContent = '✅ Pehle se dost hai';
        card.appendChild(tag);
      }
      preview.appendChild(card);
    }
  } catch (e) {
    showFriendMsg('❌ Error. Dobara try karein.', 'error');
    console.error('Search friend error:', e);
  }
}

// ── Send friend request ──
async function sendFriendRequest(targetUid, targetName) {
  const curUser = getCurUser();
  if (!curUser) return;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      friendRequests: arrayUnion(curUser.uid)
    });
    showFriendMsg(`✅ ${esc(targetName)} ko request bheja!`, 'success');
  } catch (e) {
    showFriendMsg('❌ Request bhejne mein error.', 'error');
    console.error('Friend request error:', e);
  }
}

// ── Accept request ──
async function acceptRequest(senderUid) {
  const curUser = getCurUser();
  if (!curUser) return;
  try {
    await updateDoc(doc(db, 'users', curUser.uid), {
      friends:        arrayUnion(senderUid),
      friendRequests: arrayRemove(senderUid)
    });
    await updateDoc(doc(db, 'users', senderUid), {
      friends: arrayUnion(curUser.uid)
    });
    toast('✅ Friend request accept!', 'success');
  } catch (e) {
    toast('❌ Error accepting request.', 'error');
  }
}

// ── Reject request ──
async function rejectRequest(senderUid) {
  const curUser = getCurUser();
  if (!curUser) return;
  try {
    await updateDoc(doc(db, 'users', curUser.uid), {
      friendRequests: arrayRemove(senderUid)
    });
    toast('Request reject ho gayi.', 'info');
  } catch (e) { toast('❌ Error.', 'error'); }
}

// ── Unfriend ──
async function unfriend(targetUid) {
  const curUser = getCurUser();
  if (!curUser) return;
  try {
    await updateDoc(doc(db, 'users', curUser.uid), { friends: arrayRemove(targetUid) });
    await updateDoc(doc(db, 'users', targetUid),   { friends: arrayRemove(curUser.uid) });
    toast('Dost list se hata diya.', 'info');
  } catch (e) { toast('❌ Error.', 'error'); }
}

// ── Load friends list (real-time) ──
export function startFriendsListener() {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) return;

  const unsub = onSnapshot(doc(db, 'users', curUser.uid), async snap => {
    if (!snap.exists()) return;
    const data   = snap.data();
    const friends = data.friends || [];
    const pending = data.friendRequests || [];

    // Pending requests
    const pl = $('pendingList'), pLabel = $('pendingLabel');
    if (pl) {
      pl.innerHTML = '';
      if (pending.length) {
        if (pLabel) pLabel.style.display = 'block';
        for (const uid of pending.slice(0, 10)) {
          try {
            const ps = await getDoc(doc(db, 'users', uid));
            if (!ps.exists()) continue;
            const pd  = ps.data();
            const row = document.createElement('div');
            row.className = 'friend-card';
            row.innerHTML = `<div class="friend-avatar">👤</div>
              <div class="friend-info">
                <div class="friend-name">${esc(pd.username || 'Player')}</div>
              </div>`;
            const acc = document.createElement('button');
            acc.className   = 'friend-action-btn accept-btn';
            acc.textContent = '✅ Accept';
            acc.addEventListener('click', () => acceptRequest(uid));
            const rej = document.createElement('button');
            rej.className   = 'friend-action-btn reject-btn';
            rej.textContent = '❌';
            rej.addEventListener('click', () => rejectRequest(uid));
            row.appendChild(acc);
            row.appendChild(rej);
            pl.appendChild(row);
          } catch (_) {}
        }
      } else {
        if (pLabel) pLabel.style.display = 'none';
      }
    }

    // Friends list
    const fl = $('friendsList');
    if (!fl) return;
    fl.innerHTML = '';

    if (!friends.length) {
      fl.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Koi dost nahi — UID se dhundein!</div>';
      return;
    }

    for (const uid of friends.slice(0, 20)) {
      try {
        const fs = await getDoc(doc(db, 'users', uid));
        if (!fs.exists()) continue;
        const fd  = fs.data();
        const row = document.createElement('div');
        row.className = 'friend-card';
        const unBtn = document.createElement('button');
        unBtn.className   = 'friend-action-btn unfriend-btn';
        unBtn.textContent = '🚫 Hata';
        unBtn.addEventListener('click', () => unfriend(uid));
        row.innerHTML = `<div class="friend-avatar">👤</div>
          <div class="friend-info">
            <div class="friend-name">${esc(fd.username || 'Player')}</div>
            <div class="friend-uid">${esc(uid.slice(0, 16))}...</div>
          </div>`;
        row.appendChild(unBtn);
        fl.appendChild(row);
      } catch (_) {}
    }
  }, err => console.warn('Friends listener error:', err.message));

  listenerManager.add('friendsListener', unsub);
}

export function stopFriendsListener() {
  listenerManager.remove('friendsListener');
}

function showFriendMsg(msg, type) {
  const el = $('addFriendMsg');
  if (!el) return;
  el.textContent = msg;
  el.className   = `auth-msg ${type} show`;
}
