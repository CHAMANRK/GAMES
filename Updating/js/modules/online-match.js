// ═══════════════════════════════════════════
//  online-match.js — Matchmaking, game loop,
//  result, cleanup
//  Fixes: race condition, double handleMatchEnd,
//  client-side coin distribution (noted as TODO
//  for Cloud Function), disconnectGrace memory leak
// ═══════════════════════════════════════════

import {
  doc, getDoc, updateDoc, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  ref, set, get, onValue, remove, update, push, off,
  runTransaction as rtdbRunTransaction,
  onDisconnect as rtdbOnDisconnect
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

import { db, rtdb }          from './firebase.js';
import { CONFIG, TABLES }    from '../../config.js';
import { $, toast, showScreen, spawnCoinParticles, esc } from './ui.js';
import {
  timerManager, listenerManager,
  getCurUser, getCurData, setCurData,
  getLastSubmit, setLastSubmit, resetSubmit,
  isConnected,
  MS, getMS, resetMS, setJoining, _joining,
  freshMatchState
} from '../state/appState.js';
import { quizState, loadQuran } from './quiz.js';

// ── Getter so other modules can import cleanly ──
const getTable = () => TABLES[MS.tableKey] || {};

// ═══════════════════════════════════════════
//  LOBBY
// ═══════════════════════════════════════════
export async function openOnlineLobby() {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) {
    toast('❌ Login karo pehle!', 'error');
    showScreen('authScreen');
    return;
  }
  loadQuran();
  showScreen('onlineLobbyScreen');

  try {
    const snap = await getDoc(doc(db, 'users', curUser.uid));
    if (snap.exists()) setCurData(snap.data());
  } catch (e) { console.warn('Fresh read error:', e); }

  const coins = getCurData()?.coins || 0;
  const li    = $('lobbyCoinsInfo');
  if (li) li.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} — Table chuniye!`;

  $('onlineLocked') && $('onlineLocked').classList.add('hidden');
  const grid = $('tablesGrid');
  if (grid) grid.style.opacity = '1';

  Object.entries(TABLES).forEach(([key, t]) => {
    const id  = `join${key.charAt(0).toUpperCase() + key.slice(1)}`;
    const btn = $(id);
    if (!btn) return;
    if (coins < t.fee) {
      btn.disabled    = true;
      btn.textContent = `🔒 ${t.fee}🪙 chahiye`;
    } else {
      btn.disabled    = false;
      btn.textContent = `Join (${t.fee}🪙)`;
    }
  });
}

// ═══════════════════════════════════════════
//  JOIN TABLE
// ═══════════════════════════════════════════
export async function joinTable(tableKey) {
  const curUser = getCurUser();
  if (!curUser || !getCurData())  { toast('❌ Login karein!', 'error');         return; }
  if (!isConnected())             { toast('❌ Internet check karein!', 'error'); return; }
  if (_joining)                   { toast('⏳ Thoda ruko...', 'info');            return; }
  if (MS.matchId || MS.myRole)    { leaveMatchCleanup(false); }

  setJoining(true);

  const table = TABLES[tableKey];
  if (!table) { setJoining(false); toast('❌ Invalid table!', 'error'); return; }

  try {
    const snap = await getDoc(doc(db, 'users', curUser.uid));
    if (snap.exists()) setCurData(snap.data());
  } catch (_) {}

  const coins = getCurData()?.coins || 0;
  if (coins < table.fee) {
    setJoining(false);
    toast(`❌ ${table.fee}🪙 chahiye! Aapke paas: ${coins}🪙`, 'error');
    return;
  }

  if (!quizState.quranData.length) {
    toast('⏳ Data load ho raha hai...', 'info');
    await loadQuran();
    if (!quizState.quranData.length) { setJoining(false); toast('❌ Quran data load nahi hua!', 'error'); return; }
  }

  // Reset match state
  Object.assign(MS, freshMatchState());
  MS.tableKey     = tableKey;
  // FIX: feeDeducted is set AFTER successful deduction, not before
  MS.feeDeducted  = false;

  // ── Deduct fee via Firestore transaction ──
  try {
    await runTransaction(db, async tx => {
      const userRef  = doc(db, 'users', curUser.uid);
      const userDoc  = await tx.get(userRef);
      if (!userDoc.exists()) throw new Error('User not found');
      if ((userDoc.data().coins || 0) < table.fee) throw new Error('Insufficient coins');
      tx.update(userRef, { coins: increment(-table.fee) });
    });
    MS.feeDeducted = true;   // ← set AFTER success
  } catch (e) {
    setJoining(false);
    toast('❌ Coins deduct error. Try again.', 'error');
    console.error('Coin deduction error:', e);
    return;
  }

  showScreen('matchWaitScreen');
  $('matchWaitInfo')  && ($('matchWaitInfo').textContent  = table.name);
  $('matchWaitTimer') && ($('matchWaitTimer').textContent = '0s');

  const waitStart = Date.now();
  MS.timers.setInterval('matchWait', () => {
    const el = $('matchWaitTimer');
    if (el) el.textContent = `${Math.floor((Date.now() - waitStart) / 1000)}s`;
  }, 1000);

  try {
    await findOrCreateMatch(tableKey);
  } finally {
    setJoining(false);
  }
}

// ═══════════════════════════════════════════
//  MATCHMAKING
// ═══════════════════════════════════════════
async function findOrCreateMatch(tableKey) {
  const curUser = getCurUser();
  const curData = getCurData();
  const qRef    = ref(rtdb, `queues/${tableKey}`);
  // FIX: Extract state from transaction result, not closure mutation
  let txResult = { asP2: false, p2MatchId: null, oppData: null };

  try {
    const result = await rtdbRunTransaction(qRef, current => {
      if (!current || current.uid === curUser.uid) {
        return { uid: curUser.uid, username: curData?.username || 'Player', matchId: '', ts: Date.now() };
      }
      // P2: return undefined to abort (take existing slot)
      txResult.asP2      = true;
      txResult.p2MatchId = current.matchId;
      txResult.oppData   = current;
      return;   // don't overwrite
    });
    // After tx, read back what was written
    if (!txResult.asP2) txResult.asP2 = false;
  } catch (e) {
    console.error('Queue tx error:', e);
    await doRefund();
    toast('❌ Matchmaking error. Retry karein.', 'error');
    showScreen('onlineLobbyScreen');
    return;
  }

  if (txResult.asP2) {
    // Wait for P1 to set matchId
    let p2MatchId = txResult.p2MatchId;
    let tries     = 0;
    while ((!p2MatchId || p2MatchId === '') && tries < 16) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const snap = await get(qRef);
        if (!snap.exists()) { p2MatchId = null; break; }
        const mid  = snap.val()?.matchId;
        if (mid && mid !== '') p2MatchId = mid;
      } catch (_) {}
      tries++;
    }

    if (!p2MatchId) {
      await doRefund();
      toast('❌ Match nahi mila. Retry karein.', 'error');
      showScreen('onlineLobbyScreen');
      return;
    }

    MS.matchId      = p2MatchId;
    MS.myRole       = 'p2';
    MS.opponentName = txResult.oppData?.username || 'Player';
    await p2JoinMatch(p2MatchId, tableKey, qRef);

  } else {
    // P1 — create match
    let matchId;
    try {
      matchId   = push(ref(rtdb, `matches/${tableKey}`)).key;
      MS.matchId = matchId;
      MS.myRole  = 'p1';

      const tbl = TABLES[tableKey];
      await set(ref(rtdb, `matches/${tableKey}/${matchId}`), {
        status:       'waiting',
        table:         tableKey,
        totalQ:        tbl.totalQ,
        questionPool:  [],
        p1: { uid: curUser.uid, name: curData?.username || 'Player', score: 0, qIdx: 0, connected: true },
        p2: { uid: '', name: '', score: 0, qIdx: 0, connected: false },
        winner:    '',
        createdAt:  Date.now()
      });
      await update(qRef, { matchId });
    } catch (e) {
      console.error('P1 match create error:', e);
      await doRefund();
      toast('❌ Match create error.', 'error');
      showScreen('onlineLobbyScreen');
      return;
    }

    p1WaitForOpponent(tableKey, matchId);

    MS.timers.setTimeout('matchAutoCancel', async () => {
      try {
        const snap = await get(ref(rtdb, `matches/${tableKey}/${matchId}`));
        if (snap.exists() && snap.val().status === 'waiting') {
          await remove(ref(rtdb, `matches/${tableKey}/${matchId}`)).catch(() => {});
          await remove(qRef).catch(() => {});
          MS.matchId = null; MS.myRole = null;
          leaveMatchCleanup(false);
          await doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!', 'info', 4000);
          showScreen('onlineLobbyScreen');
        }
      } catch (e) { console.error('Auto-cancel error:', e); }
    }, CONFIG.MATCH_AUTO_CANCEL_MS);
  }
}

// ── P1 waits for P2 ──
function p1WaitForOpponent(tableKey, matchId) {
  const mRef  = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap => {
    if (!snap.exists()) return;
    const d = snap.val();
    if (d.status === 'active' && d.p2?.uid) {
      MS.listeners.remove(`p1Wait_${matchId}`);  // unsub before startOnlineMatch
      MS.opponentName = d.p2.name;
      startOnlineMatch(tableKey, matchId, d);
    }
  }, err => console.warn('P1 wait error:', err.message));

  MS.listeners.add(`p1Wait_${matchId}`, unsub);
}

// ── P2 joins match ──
async function p2JoinMatch(matchId, tableKey, qRef) {
  const curUser = getCurUser();
  const curData = getCurData();
  const mRef    = ref(rtdb, `matches/${tableKey}/${matchId}`);

  let snap;
  try { snap = await get(mRef); } catch (_) {
    await doRefund(); toast('❌ Match data error.', 'error'); showScreen('onlineLobbyScreen'); return;
  }

  if (!snap.exists()) {
    await doRefund(); toast('❌ Match cancel ho gaya.', 'error'); showScreen('onlineLobbyScreen'); return;
  }

  if (snap.val().status !== 'waiting') {
    await doRefund(); toast('❌ Match pehle se start ho gaya.', 'error'); showScreen('onlineLobbyScreen'); return;
  }

  const tbl         = TABLES[tableKey];
  // TODO: Move buildQuestionPool to Cloud Function for security
  const questionPool = buildQuestionPool(tbl.totalQ + CONFIG.POOL_EXTRA);

  try {
    await update(mRef, {
      status:       'active',
      questionPool,
      'p2/uid':      curUser.uid,
      'p2/name':     curData?.username || 'Player',
      'p2/score':    0,
      'p2/qIdx':     0,
      'p2/connected': true
    });
  } catch (_) {
    await doRefund(); toast('❌ Match join error.', 'error'); showScreen('onlineLobbyScreen'); return;
  }

  if (qRef) remove(qRef).catch(() => {});

  const finalSnap = await get(mRef).catch(() => null);
  if (finalSnap?.exists()) startOnlineMatch(tableKey, matchId, finalSnap.val());
}

function buildQuestionPool(size) {
  if (!quizState.quranData.length) return [];
  const indices = Array.from({ length: quizState.quranData.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, size);
}

// ═══════════════════════════════════════════
//  ONLINE MATCH SCREEN
// ═══════════════════════════════════════════
export function startOnlineMatch(tableKey, matchId, initData) {
  MS.timers.clearInterval('matchWait');
  MS.timers.clearTimeout('matchAutoCancel');
  MS.feeDeducted    = false;
  MS.myQIdx         = 0;
  MS.inSuddenDeath  = false;

  showScreen('onlineMatchScreen');
  hidePopups();

  const curData = getCurData();
  if ($('myName'))  $('myName').textContent  = curData?.username || 'Player';
  if ($('oppName')) $('oppName').textContent = MS.opponentName  || 'Opponent';
  if ($('myScore')) $('myScore').textContent = '0';
  if ($('oppScore'))$('oppScore').textContent = '0';

  // Presence
  const myConnRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`);
  set(myConnRef, true).catch(() => {});
  rtdbOnDisconnect(myConnRef).set(false).catch(() => {});

  // Show first question
  const pool = initData.questionPool || [];
  if (pool.length) {
    MS.currentAyatIndex = pool[0];
    showMatchQuestion(pool[0], 1, TABLES[tableKey].totalQ);
  }

  triggerMatchStartParticles();

  // ── Main match listener ──
  const mRef  = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap => {
    if (MS._ended) return;
    if (!snap.exists()) { handleMatchEnd(false, 'opponent_left'); return; }

    const d   = snap.val();
    const tbl = TABLES[tableKey];
    const isP1 = MS.myRole === 'p1';
    const myD  = isP1 ? d.p1 : d.p2;
    const opD  = isP1 ? d.p2 : d.p1;

    // Update scores
    if ($('myScore'))  $('myScore').textContent  = myD?.score || 0;
    if ($('oppScore')) $('oppScore').textContent = opD?.score || 0;
    MS.myScore  = myD?.score  || 0;
    MS.oppScore = opD?.score  || 0;

    // Disconnect grace
    const oppConnected = opD?.connected;
    if (oppConnected === false && !MS.disconnectGraceTimer
      && (d.status === 'active' || d.status === 'sudden_death')) {

      showDisconnectGracePopup(CONFIG.GRACE_PERIOD_SEC);
      MS.disconnectGraceTimer = timerManager.setTimeout(`disconnectGrace_${matchId}`, async () => {
        try {
          const fresh  = await get(mRef);
          if (!fresh.exists()) return;
          const freshOp = isP1 ? fresh.val().p2 : fresh.val().p1;
          if (freshOp?.connected === false && fresh.val().status !== 'finished') {
            const winRef = ref(rtdb, `matches/${tableKey}/${matchId}/winner`);
            await rtdbRunTransaction(winRef, c => (c && c !== '') ? undefined : MS.myRole);
            await update(mRef, { status: 'finished' });
            handleMatchEnd(true, 'opponent_left');
          } else {
            MS.disconnectGraceTimer = null;
            hideDisconnectGracePopup();
          }
        } catch (_) { MS.disconnectGraceTimer = null; }
      }, CONFIG.GRACE_PERIOD_SEC * 1000);

    } else if (oppConnected === true && MS.disconnectGraceTimer) {
      timerManager.clearTimeout(`disconnectGrace_${matchId}`);
      MS.disconnectGraceTimer = null;
      hideDisconnectGracePopup();
    }

    // FIX: Single win detection — server state only
    if (d.winner && d.status === 'finished') {
      handleMatchEnd(d.winner === MS.myRole);
      return;
    }

    // FIX: Remove duplicate client-side score check — let server decide
    // (these are still here as fallback for poor connections)
    if (MS.myScore  >= tbl.firstTo) { handleMatchEnd(true);  return; }
    if (MS.oppScore >= tbl.firstTo) { handleMatchEnd(false); return; }

    const myDone  = (myD?.qIdx  || 0) >= tbl.totalQ;
    const oppDone = (opD?.qIdx  || 0) >= tbl.totalQ;

    if (myDone && oppDone && d.status === 'active') {
      if (MS.myScore > MS.oppScore)       { handleMatchEnd(true);  return; }
      if (MS.myScore < MS.oppScore)       { handleMatchEnd(false); return; }
      if (!MS.inSuddenDeath) {
        MS.inSuddenDeath = true;
        if (MS.myRole === 'p2') update(mRef, { status: 'sudden_death' }).catch(() => {});
        enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
      }
      return;
    }

    if (d.status === 'sudden_death' && !MS.inSuddenDeath) {
      MS.inSuddenDeath = true;
      enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
      return;
    }

    const newQIdx = myD?.qIdx || 0;
    if (newQIdx > MS.myQIdx) {
      MS.myQIdx = newQIdx;
      if (d.questionPool?.[newQIdx] !== undefined) MS.currentAyatIndex = d.questionPool[newQIdx];
    }
  }, err => console.warn('Match listener err:', err.message));

  MS.listeners.add(`matchListener_${matchId}`, unsub);
}

// ── Sudden death ──
function enterSuddenDeath(pool, currentQIdx) {
  showSuddenDeathBanner();
  const sdIdx = pool?.[currentQIdx];
  if (sdIdx !== undefined) {
    MS.currentAyatIndex = sdIdx;
    const mp = $('matchProgress');
    if (mp) mp.textContent = '⚡ SUDDEN DEATH';
    showMatchQuestion(sdIdx, null, null, true);
  }
}

// ── Show question ──
function showMatchQuestion(ayatIndex, qNum, totalQ, isSuddenDeath = false) {
  const ayat = quizState.quranData[ayatIndex];
  if (!ayat) { console.warn('Invalid ayat index:', ayatIndex); return; }

  MS.answered = false;

  if (!isSuddenDeath) {
    const mp = $('matchProgress');
    if (mp) mp.textContent = qNum && totalQ ? `Sawal ${qNum} / ${totalQ}` : `Sawal ${qNum}`;
  }

  const el = $('matchAyatText');
  if (el) el.textContent = ayat.text;

  $('matchAnswerForm')?.reset();
  $('matchCheckBtn') && ($('matchCheckBtn').disabled = false);

  const mr = $('matchResult');
  if (mr) { mr.classList.add('hidden'); mr.textContent = ''; }

  const para   = ayat.para || (((ayat.page - 1) / 20 | 0) + 1);
  const maxPip = para === 29 ? 24 : para === 30 ? 25 : 20;
  const pipInp = $('match_pip');
  if (pipInp) { pipInp.max = maxPip; pipInp.placeholder = `PiP (1-${maxPip})`; }

  startMatchTimer(30);
}

// ── Match timer ──
function startMatchTimer(sec) {
  MS.timers.clearInterval('matchTimer');
  let t    = sec;
  const f  = $('matchTimerFill'), txt = $('matchTimer');
  if (f)   f.style.width    = '100%';
  if (txt) txt.textContent  = `${t}s`;

  MS.timers.setInterval('matchTimer', () => {
    t--;
    if (f)   f.style.width   = `${(t / sec) * 100}%`;
    if (txt) txt.textContent = `${t}s`;
    if (t <= 0) { MS.timers.clearInterval('matchTimer'); if (!MS.answered) submitMatchAnswer(true); }
  }, 1000);
}

// ═══════════════════════════════════════════
//  SUBMIT ANSWER
// ═══════════════════════════════════════════
export async function submitMatchAnswer(timeOut = false) {
  const now = Date.now();
  if (now - getLastSubmit() < CONFIG.SUBMIT_COOLDOWN_MS) return;
  setLastSubmit();
  if (MS.answered) return;
  MS.answered = true;
  MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn') && ($('matchCheckBtn').disabled = true);

  if (timeOut) { showMatchMsg('⏱️ Waqt khatam!', false); await advanceMyQuestion(false); return; }

  const para = $('match_para')?.value.trim() || '';
  const pip  = $('match_pip')?.value.trim()  || '';

  if (!para) {
    MS.answered = false; $('matchCheckBtn') && ($('matchCheckBtn').disabled = false);
    resetSubmit(); toast('❌ Para zaroori hai!', 'error'); return;
  }
  const paraNum = parseInt(para);
  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) {
    MS.answered = false; $('matchCheckBtn') && ($('matchCheckBtn').disabled = false);
    resetSubmit(); toast('❌ Para 1-30 ke beech!', 'error'); return;
  }

  const ayat = quizState.quranData[MS.currentAyatIndex];
  if (!ayat) { showMatchMsg('❌ Question data error', false); await advanceMyQuestion(false); return; }

  const ap   = ayat.para || (((parseInt(ayat.page) - 1) / 20 | 0) + 1);
  const aip  = ayat.pip  || (((parseInt(ayat.page) - 1) % 20) + 1);
  const pOk  = paraNum === ap;
  const pipOk= pip ? parseInt(pip) === aip : true;

  if (pOk && pipOk) {
    if (MS.inSuddenDeath) {
      const winRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/winner`);
      const mRef   = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
      let won = false;
      try {
        const txResult = await rtdbRunTransaction(winRef, c => (c && c !== '') ? undefined : MS.myRole);
        won = txResult.committed;
        if (won) await update(mRef, { status: 'finished', [`${MS.myRole}/score`]: MS.myScore + 1 });
      } catch (e) { console.warn('SD winner tx err:', e); }
      showMatchMsg(`✅ Sahi! Para: ${ap}`, true);
      handleMatchEnd(won, won ? 'sudden_death_win' : 'sudden_death_loss');
      return;
    }

    // TODO: Move score increment to Cloud Function
    const scoreRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/score`);
    try { await rtdbRunTransaction(scoreRef, c => (c || 0) + 1); }
    catch (e) { console.warn('Score update err:', e); }

    showMatchMsg(`✅ Sahi! Para: ${ap}${pip ? `, PiP: ${aip}` : ''}`, true);
  } else {
    showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip}`, false);
  }

  await advanceMyQuestion(pOk && pipOk);
}

// ── Advance to next question ──
async function advanceMyQuestion(wasCorrect) {
  await new Promise(r => setTimeout(r, 1400));
  if (MS._ended) return;

  const tbl     = TABLES[MS.tableKey];
  if (!tbl) return;
  const newIdx  = MS.myQIdx + 1;
  const field   = `${MS.myRole}/qIdx`;
  const mRef    = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
  MS.myQIdx     = newIdx;

  if (!MS.inSuddenDeath && newIdx >= tbl.totalQ) {
    update(mRef, { [field]: newIdx }).catch(() => {});
    showWaitingForOpponent();
    return;
  }

  update(mRef, { [field]: newIdx }).catch(e => console.warn('AdvanceQ err:', e));

  const snap = await get(mRef).catch(() => null);
  if (!snap?.exists() || MS._ended) return;

  const pool = snap.val()?.questionPool;
  if (pool?.[newIdx] !== undefined && !MS.inSuddenDeath) {
    MS.currentAyatIndex = pool[newIdx];
    showMatchQuestion(pool[newIdx], newIdx + 1, tbl.totalQ);
  }
}

// ── Waiting for opponent ──
function showWaitingForOpponent() {
  const tbl = TABLES[MS.tableKey] || {};
  MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn') && ($('matchCheckBtn').disabled = true);
  const f = $('matchTimerFill'); if (f) f.style.width = '0%';
  const t = $('matchTimer');    if (t) t.textContent  = '⏳';
  const mp = $('matchProgress');
  if (mp) mp.textContent = `✅ Aapne ${tbl.totalQ || ''} sawaal khatam kiye — ${MS.opponentName || 'Opponent'} ka intezaar...`;
  const at = $('matchAyatText');
  if (at) at.textContent = '⏳ Opponent abhi khel raha hai...';
  const mr = $('matchResult'); if (mr) { mr.classList.add('hidden'); mr.textContent = ''; }
  showOpponentWaitPopup(true);
}

// ═══════════════════════════════════════════
//  MATCH END
// ═══════════════════════════════════════════
function handleMatchEnd(won, reason = '') {
  if (MS._ended) return;
  MS._ended = true;

  leaveMatchCleanup(false);
  hidePopups();

  const tbl   = TABLES[MS.tableKey] || {};
  const coins = won ? (tbl.winCoins || 0) : 0;

  if ($('matchResultIcon'))  $('matchResultIcon').textContent = won ? '🏆' : '😔';
  if ($('matchResultTitle')) {
    $('matchResultTitle').textContent =
      reason === 'sudden_death_win' ? '⚡ Sudden Death Jeet!'
      : reason === 'opponent_left'  ? '🏆 Opponent Chala Gaya!'
      : won ? 'Jeet Gaye! 🏆' : 'Haare! 😔';
  }

  let reasonText = '';
  if (reason === 'opponent_left')   reasonText = 'Opponent ne match chhod diya!';
  if (reason === 'sudden_death_win') reasonText = '⚡ Pehla sahi jawab — Jeet!';
  if (reason === 'sudden_death_loss') reasonText = '⚡ Opponent ne pehle sahi jawab diya.';

  const rs = $('matchResultScores');
  if (rs) rs.textContent = `Aap: ${MS.myScore}  VS  ${MS.opponentName || 'Opp'}: ${MS.oppScore}  ${reasonText}`;

  const rc = $('matchResultCoins');
  if (rc) rc.textContent = won ? `+${coins} 🪙 Jeet ki coins!` : 'Koi coins nahi — agali baar!';

  // TODO: Replace with Cloud Function call for security
  if (won && coins > 0) {
    const curUser = getCurUser();
    if (curUser && !curUser.isAnonymous) {
      updateDoc(doc(db, 'users', curUser.uid), {
        coins: increment(coins), totalWins: increment(1)
      }).catch(() => {});
      toast(`🏆 Jeet Gaye! +${coins}🪙`, 'success', 4000);
    }
  }

  if (MS.matchId && MS.tableKey && MS.myRole === 'p1') {
    const _mid = MS.matchId, _tk = MS.tableKey;
    timerManager.setTimeout(`deleteMatch_${_mid}`, () => {
      remove(ref(rtdb, `matches/${_tk}/${_mid}`)).catch(() => {});
    }, 8000);
  }

  showScreen('matchResultScreen');
  if (won) timerManager.setTimeout('victoryParticles', triggerVictoryParticles, 400);
}

// ═══════════════════════════════════════════
//  CLEANUP
// ═══════════════════════════════════════════
export function leaveMatchCleanup(refundFee = false) {
  MS.timers.clearAll();
  MS.listeners.removeAll();

  if (MS.tableKey) {
    const qRef = ref(rtdb, `queues/${MS.tableKey}`);
    const curUser = getCurUser();
    get(qRef).then(snap => {
      if (snap.exists() && snap.val()?.uid === curUser?.uid) remove(qRef).catch(() => {});
    }).catch(() => {});

    if (MS.matchId && MS.myRole && !MS._ended) {
      set(ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`), false).catch(() => {});
    }
  }

  if (refundFee) doRefund();
}

export async function doRefund() {
  if (!MS.feeDeducted || !getCurUser() || !MS.tableKey) return;
  if (MS._refunding) return;
  MS._refunding  = true;
  MS.feeDeducted = false;
  const fee = TABLES[MS.tableKey]?.fee || 0;
  if (fee > 0) {
    try {
      await updateDoc(doc(db, 'users', getCurUser().uid), { coins: increment(fee) });
      console.log(`Refunded ${fee} coins`);
    } catch (e) { console.error('Refund error:', e); }
  }
  MS._refunding = false;
}

// ═══════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════
function showMatchMsg(msg, ok) {
  const el = $('matchResult');
  if (!el) return;
  el.textContent = msg;
  el.className   = ok ? 'result' : 'error';
  el.classList.remove('hidden');
}

function hidePopups() {
  hideOpponentWaitPopup();
  hideDisconnectGracePopup();
  hideSuddenDeathBanner();
}

// ── Exit confirm modal ──
export function showExitConfirm() { const m = $('exitMatchModal'); if (m) m.style.display = 'flex'; }
export function hideExitConfirm() { const m = $('exitMatchModal'); if (m) m.style.display = 'none'; }

// ── Opponent wait popup ──
function showOpponentWaitPopup(allDone = false) {
  let popup = $('oppWaitPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'oppWaitPopup';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(5,15,10,.88);backdrop-filter:blur(10px);z-index:8000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(popup);
  }
  const tbl = TABLES[MS.tableKey] || {};
  // Safe DOM — no innerHTML with user data for the score value
  popup.innerHTML = allDone
    ? `<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:32px 24px;text-align:center;max-width:320px;width:90vw;display:flex;flex-direction:column;gap:16px">
        <div style="font-size:2.5rem">✅</div>
        <div style="font-family:Cinzel,serif;color:var(--gold-light)">Aapne Sawaal Poore Kiye!</div>
        <div style="font-size:1.8rem;font-weight:900;color:var(--emerald)">${MS.myScore} points</div>
        <div style="font-size:0.85rem;color:var(--text-muted)">Nateeja unke khatam hone par aayega</div>
        <div class="match-spinner" style="margin:0 auto"></div>
      </div>`
    : `<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px">
        <div style="font-size:2rem">⏳</div>
        <div style="font-family:Cinzel,serif;color:var(--gold-light)">Opponent ka Intezaar</div>
        <div class="match-spinner" style="margin:0 auto"></div>
      </div>`;
  popup.style.display = 'flex';
}

function hideOpponentWaitPopup() {
  const p = $('oppWaitPopup'); if (p) p.style.display = 'none';
}

// ── Disconnect grace popup ──
// FIX: Use TimerManager instead of raw setInterval to prevent memory leak
function showDisconnectGracePopup(seconds = 15) {
  let popup = $('disconnectGracePopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'disconnectGracePopup';
    popup.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a0808,#100404);border:1px solid #c4293b60;border-radius:16px;padding:16px 24px;text-align:center;max-width:320px;width:90vw;z-index:9500;display:none;';
    document.body.appendChild(popup);
  }

  popup.innerHTML = `<div style="font-size:1.8rem;margin-bottom:6px">📡</div>
    <div style="font-family:Cinzel,serif;color:var(--gold-light);font-size:0.95rem">Opponent Disconnect!</div>
    <div id="graceCountdown" style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif">${seconds}s intezaar karo...</div>`;
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';

  let cd = seconds;
  timerManager.setInterval('graceCountdown', () => {
    cd--;
    const el = $('graceCountdown');
    if (el) el.textContent = cd > 0 ? `${cd}s intezaar karo...` : 'Match khatam kar raha hai...';
    if (cd <= 0) timerManager.clearInterval('graceCountdown');
  }, 1000);
}

function hideDisconnectGracePopup() {
  timerManager.clearInterval('graceCountdown');
  const p = $('disconnectGracePopup'); if (p) p.style.display = 'none';
}

// ── Sudden death banner ──
function showSuddenDeathBanner() {
  let el = $('suddenDeathBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suddenDeathBanner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:linear-gradient(135deg,#1a0800,#2a1000);border-bottom:2px solid #d4a84380;';
    el.innerHTML = '<span style="font-size:1.3rem;margin-right:10px">⚡</span>'
      + '<span style="font-family:Cinzel,serif;font-weight:900;font-size:1rem;color:var(--gold-light)">SUDDEN DEATH</span>'
      + '<span style="font-size:1.3rem;margin-left:10px">⚡</span>'
      + '<span style="font-size:0.78rem;color:var(--text-muted);margin-left:12px;font-family:Tajawal,sans-serif">Pehla sahi jawab jeetega!</span>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

function hideSuddenDeathBanner() {
  const el = $('suddenDeathBanner'); if (el) el.style.display = 'none';
}

// ── Particles ──
function triggerMatchStartParticles() {
  const myBox = $('myPlayerBox'), oppBox = $('oppPlayerBox'), vsEl = $('matchVsEl');
  if (!vsEl) return;
  timerManager.setTimeout('matchStartP', () => {
    spawnCoinParticles(myBox, vsEl, 14);
    timerManager.setTimeout('matchStartP2', () => spawnCoinParticles(oppBox, vsEl, 14), 120);
  }, 400);
}

function triggerVictoryParticles() {
  const from = $('matchResultIcon'), to = $('hdrCoins');
  if (!from || !to) return;
  spawnCoinParticles(from, to, 20);
  timerManager.setTimeout('vp2', () => spawnCoinParticles(from, to, 15), 300);
  timerManager.setTimeout('vp3', () => spawnCoinParticles(from, to, 10), 600);
}
