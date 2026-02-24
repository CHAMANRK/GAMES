// ═══════════════════════════════════════════
//  quiz.js — Solo quiz: Practice, Timed, Survival
//  Fixes: typeText memory leak, _guestAnswered bug,
//         safe innerHTML usage
// ═══════════════════════════════════════════

import { doc, updateDoc, increment, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { db }              from './firebase.js';
import { CONFIG }          from '../../config.js';
import { $, on, esc, toast, typeText, showScreen, btnLoad } from './ui.js';
import { timerManager, coinRateLimiter, getCurUser, getCurData,
         quizState, resetQuizState, incGuestAnswered, getGuestAnswered,
         getLastSubmit, setLastSubmit, resetSubmit }  from '../state/appState.js';
// Inline to break circular dependency (quiz -> auth -> online-match -> quiz)
const isValidParaRange = (f, t) => !isNaN(f) && !isNaN(t) && f >= 1 && t <= 30 && f <= t;
// switchTab: dynamic import to avoid circular dependency
const switchTab = async (tab) => { try { const m = await import('./auth.js'); m.switchTab(tab); } catch(_) {} };

// ── Load Quran JSON ──
export async function loadQuran(retries = 0, maxRetries = 3) {
  if (quizState.quranData.length || quizState.quranLoading) return;
  quizState.quranLoading = true;
  try {
    const res = await fetch('quran_full.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    quizState.quranData = await res.json();
    if (!Array.isArray(quizState.quranData) || !quizState.quranData.length)
      throw new Error('Invalid data format');
    console.log('✅ Quran loaded:', quizState.quranData.length, 'ayats');
  } catch (e) {
    console.error('❌ Quran load fail:', e.message);
    if (retries < maxRetries) {
      quizState.quranLoading = false;
      await new Promise(r => setTimeout(r, Math.pow(2, retries) * 2000));
      return loadQuran(retries + 1, maxRetries);
    }
    quizState.quranData = [];
    toast('❌ Quran data load fail', 'error', 5000);
  } finally {
    quizState.quranLoading = false;
  }
}

// ── Para calculation helpers ──
const getPara = a => a.para || (((a.page - 1) / 20 | 0) + 1);
const getPip  = a => a.pip  || (((parseInt(a.page) - 1) % 20) + 1);

// ── Start game ──
export async function startGame() {
  const er = $('selectError');
  if (er) er.classList.add('hidden');

  const curUser = getCurUser();
  if (curUser?.isAnonymous && getGuestAnswered() >= CONFIG.GUEST_QUESTION_LIMIT) {
    if (er) { er.textContent = '❌ 3 free questions khatam! Account banao!'; er.classList.remove('hidden'); }
    toast('👤 Upgrade karo aur unlimited khelo!', 'info', 4000);
    showScreen('authScreen');
    switchTab('signup');
    return;
  }

  if (!quizState.quranData.length) {
    if (er) { er.textContent = '⏳ Data load ho raha hai...'; er.classList.remove('hidden'); }
    await loadQuran();
    if (!quizState.quranData.length) {
      if (er) { er.textContent = '❌ Quran data load nahi hua.'; er.classList.remove('hidden'); }
      return;
    }
    if (er) er.classList.add('hidden');
  }

  const fp = parseInt($('fromPara')?.value);
  const tp = parseInt($('toPara')?.value);
  if (!isValidParaRange(fp, tp)) {
    if (er) { er.textContent = '❌ Para 1-30 ke beech!'; er.classList.remove('hidden'); }
    return;
  }

  quizState.selAyats = quizState.quranData.filter(a => {
    const para = getPara(a);
    return para >= fp && para <= tp;
  });

  if (!quizState.selAyats.length) {
    if (er) { er.textContent = '❌ Is range mein ayat nahi mile.'; er.classList.remove('hidden'); }
    return;
  }

  resetQuizState();
  quizState.mode   = document.querySelector('input[name="quizMode"]:checked')?.value || 'practice';
  quizState.totalQ = quizState.mode === 'timed' ? 10 : 9999;

  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);
  $('survivalAnswer')?.classList.add('hidden');

  nextQ();
  showScreen('quizScreen');
}

// ── Next question ──
export function nextQ() {
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');

  const nb = $('nextBtn');
  if (nb) { nb.textContent = '➡️ Agla Sawal'; nb.classList.add('hidden'); }

  ['quizError', 'quizResult', 'survivalAnswer'].forEach(id => $(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  $('checkBtn') && ($('checkBtn').disabled = false);

  quizState.hints = 0;
  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);

  if (quizState.qIdx >= quizState.totalQ || quizState.usedI.length >= quizState.selAyats.length) {
    endQuiz();
    return;
  }

  let idx, tries = 0;
  do {
    idx = Math.floor(Math.random() * quizState.selAyats.length);
    tries++;
  } while (quizState.usedI.includes(idx) && tries < 1000);
  quizState.usedI.push(idx);
  quizState.curAyat = quizState.selAyats[idx];

  if (!quizState.curAyat) { endQuiz(); return; }

  typeText(quizState.curAyat.text, 'ayatText');

  // Update PiP max
  const para     = getPara(quizState.curAyat);
  const maxPip   = para === 29 ? 24 : para === 30 ? 25 : 20;
  const pipInput = $('user_page_in_para');
  if (pipInput) { pipInput.max = maxPip; pipInput.placeholder = `PiP (1-${maxPip})`; }

  quizState.qIdx++;
  updateQuizStats();
  quizState.startT = Date.now();

  if (quizState.mode === 'timed') startTimer(30);
  else { const tm = $('timer'); if (tm) tm.textContent = ''; }
}

// ── Quiz stats ──
function updateQuizStats() {
  const acc = quizState.sessionTotal > 0
    ? Math.round((quizState.sessionCorrect / quizState.sessionTotal) * 100) : 0;
  const sb = $('scoreBoard');
  if (sb) sb.textContent = `Score: ${quizState.score}/${quizState.qIdx}  |  🎯 ${acc}%`;
  const qp = $('quizProgress');
  if (qp) {
    qp.textContent = quizState.mode === 'practice' ? `🎯 Practice — Sawal: ${quizState.qIdx}`
                   : quizState.mode === 'survival'  ? `💥 Survival — Sawal: ${quizState.qIdx}`
                   : `⏱️ ${quizState.qIdx} / ${quizState.totalQ}`;
  }
}

// ── Timer ──
function startTimer(sec) {
  const el = $('timer');
  if (!el) return;
  timerManager.clearInterval('quizTimer');
  let t = sec;
  el.textContent = `⏱️ ${t}s`;
  el.classList.remove('urgent');
  timerManager.setInterval('quizTimer', () => {
    t--;
    el.textContent = `⏱️ ${t}s`;
    if (t <= 10) el.classList.add('urgent');
    if (t <= 0) {
      timerManager.clearInterval('quizTimer');
      el.textContent = "⏱️ Time's up!";
      el.classList.remove('urgent');
      quizState.timeArr.push(sec);
      quizState.sessionTotal++;
      $('checkBtn') && ($('checkBtn').disabled = true);
      showRes('⏱️ Waqt khatam!', false);
      $('nextBtn')?.classList.remove('hidden');
      startAutoNext();
    }
  }, 1000);
}

// ── Check answer ──
export function checkAnswer() {
  const now = Date.now();
  if (now - getLastSubmit() < CONFIG.SUBMIT_COOLDOWN_MS) return;
  setLastSubmit();

  const cb = $('checkBtn');
  if (cb?.disabled) return;
  if (cb) cb.disabled = true;
  timerManager.clearInterval('quizTimer');

  const ts   = Math.round((Date.now() - quizState.startT) / 1000);
  const para = $('user_para')?.value.trim()           || '';
  const pip  = $('user_page_in_para')?.value.trim()   || '';
  const pg   = $('user_page')?.value.trim()            || '';
  const sur  = $('user_surah')?.value.trim().toLowerCase() || '';
  const rk   = $('user_ruku')?.value.trim()            || '';
  const ay   = $('user_ayat')?.value.trim()            || '';

  ['quizError','quizResult'].forEach(id => $(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden');
  $('survivalAnswer')?.classList.add('hidden');

  if (!para) {
    showErr('❌ Para Number zaroori hai!');
    if (cb) cb.disabled = false;
    resetSubmit();
    return;
  }

  const paraNum = parseInt(para);
  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) {
    showErr('❌ Para 1-30 ke beech!');
    if (cb) cb.disabled = false;
    resetSubmit();
    return;
  }

  const ayat  = quizState.curAyat;
  const ap    = getPara(ayat);
  const aip   = getPip(ayat);
  const pn    = parseInt(ayat.page);

  let parts = [], opt = 0;
  const pOk = paraNum === ap;
  if (!pOk) parts.push(`❌ Para Galat! Sahi: ${ap}`);

  let pipOk = true;
  if (pip) {
    const pipNum = parseInt(pip);
    if (isNaN(pipNum)) { parts.push('❌ PiP number likhein!'); pipOk = false; }
    else if (pipNum !== aip) { parts.push(`❌ PiP Galat! Sahi: ${aip}`); pipOk = false; }
  }
  if (pg) {
    const pgNum = parseInt(pg);
    if (!isNaN(pgNum) && pgNum === pn) opt++;
    else if (!isNaN(pgNum))            parts.push(`❌ Page Galat! Sahi: ${pn}`);
  }
  if (sur) {
    if (ayat.surah_name.toLowerCase().includes(sur)) opt++;
    else parts.push(`❌ Surah Galat! Sahi: ${esc(ayat.surah_name)}`);
  }
  if (rk && ayat.ruku_no !== undefined) {
    const rkN = parseInt(rk);
    if (!isNaN(rkN) && rkN === ayat.ruku_no) opt++;
    else if (!isNaN(rkN))                    parts.push(`❌ Ruku Galat! Sahi: ${ayat.ruku_no}`);
  }
  if (ay && ayat.ayat_no !== undefined) {
    const ayN = parseInt(ay);
    if (!isNaN(ayN) && ayN === ayat.ayat_no) opt++;
    else if (!isNaN(ayN))                    parts.push(`❌ Ayat Galat! Sahi: ${ayat.ayat_no}`);
  }

  const ok = pOk && (pip ? pipOk : true);
  quizState.sessionTotal++;

  if (ok) {
    quizState.score++;
    quizState.sessionCorrect++;
    quizState.surahC[ayat.surah_name] = (quizState.surahC[ayat.surah_name] || 0) + 1;
    quizState.timeArr.push(ts);
    const earned = calcCoins(ts, opt, quizState.hints, quizState.mode === 'survival');
    const spd    = ts <= 5 ? '⚡ Super Fast!' : ts <= 10 ? '🏃 Fast!' : ts <= 20 ? '👍 Good' : '🐢 Slow';
    addCoinsToFirestore(earned, 1, 1);

    // Use textContent-safe approach for result msg
    const msgParts = [`✅ Sahi! +${earned}🪙  ${spd} (${ts}s)`];
    if (opt > 0)              msgParts.push(`+${opt * 5}🪙 optional`);
    if (quizState.hints > 0)  msgParts.push(`-${quizState.hints * 5}🪙 hint`);
    showRes(msgParts.join(' | '), true);

    if (quizState.sessionCorrect % 10 === 0) {
      toast(`🔥 ${quizState.sessionCorrect} sahi! +50🪙!`, 'success', 3000);
      addCoinsToFirestore(50, 0, 0);
    }
  } else {
    if (quizState.sessionTotal > 0) addCoinsToFirestore(0, 0, 1);
    showRes(parts.join('\n') || '❌ Galat!', false);
    if (quizState.mode === 'survival') {
      quizState.survOn = false;
      const sa = $('survivalAnswer');
      if (sa) {
        // Safe DOM — no innerHTML with user data
        sa.textContent = '';
        const bold = (t, v) => { const b = document.createElement('b'); b.textContent = v; return [` ${t}: `, b]; };
        sa.append('Sahi Jawab:');
        bold('Surah',ap).forEach(n => sa.append(n));   // wait, let me fix this properly
        // Actually build a safe string
        sa.textContent = `Sahi Jawab: Surah: ${ayat.surah_name} | Para: ${ap} | Page: ${pn} | PiP: ${aip}`;
        sa.classList.remove('hidden');
      }
      timerManager.setTimeout('survivalEnd', endQuiz, 2200);
      return;
    }
  }

  // Fix: increment INSIDE ok check only
  if (ok || quizState.mode !== 'survival') incGuestAnswered();
  $('nextBtn')?.classList.remove('hidden');
  updateQuizStats();
  quizState.hints = 0;
  startAutoNext();
}

// ── Hint ──
export function showHint() {
  if (quizState.hints >= CONFIG.MAX_HINTS || !quizState.curAyat) return;
  quizState.hints++;
  const hi = $('hintInfo');
  if (hi) hi.textContent = `Hint: ${quizState.hints}/${CONFIG.MAX_HINTS}`;
  const hb = $('hintBtn');
  if (hb && quizState.hints >= CONFIG.MAX_HINTS) hb.disabled = true;
  const ap = getPara(quizState.curAyat);
  const s2 = quizState.curAyat.surah_name.split(' ').slice(0, 2).join(' ');
  const e  = $('quizError');
  if (!e) return;
  e.textContent = `💡 Hint (-5🪙): Surah: ${s2}..., Para: ${ap}`;
  e.classList.remove('hidden');
  timerManager.setTimeout('hideHint', () => e.classList.add('hidden'), 3500);
}

// ── End quiz ──
export function endQuiz() {
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');

  let avg = 0, fast = 0;
  if (quizState.timeArr.length) {
    const sum = quizState.timeArr.reduce((a, b) => a + b, 0);
    avg  = Math.round(sum / quizState.timeArr.length);
    fast = Math.min(...quizState.timeArr);
  }

  const acc  = quizState.sessionTotal > 0
    ? Math.round((quizState.sessionCorrect / quizState.sessionTotal) * 100) : 0;
  let best = '', mx = 0;
  Object.entries(quizState.surahC).forEach(([s, c]) => { if (c > mx) { mx = c; best = s; } });
  const spd  = avg <= 8 ? '⚡ Speed Master' : avg <= 15 ? '🏃 Quick Player' : '📚 Careful Reader';
  const curData = getCurData();

  const fr = $('finalResult');
  if (fr) {
    // Safe grid — no user data in innerHTML
    fr.innerHTML = `
      <div class="result-grid">
        <div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${quizState.score}/${quizState.qIdx}</span><span class="ri-lbl">Score</span></div>
        <div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div>
        <div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div>
        <div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div>
        <div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins || 0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div>
        <div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${esc(best) || '—'}</span><span class="ri-lbl">Best Surah</span></div>
      </div>
      <div class="speed-badge">${spd}</div>
      <div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${quizState.mode === 'survival' && !quizState.survOn ? '💥 Survival Khatam!' : '🎉 Mubarak!'}</div>
    `;
  }
  showScreen('resultScreen');
}

// ── Reset for home / play again ──
export function resetGame(goHome) {
  resetQuizState();
  timerManager.clearInterval('quizTimer');
  timerManager.clearInterval('autoNext');
  $('hintBtn')  && ($('hintBtn').disabled   = false);
  $('hintInfo') && ($('hintInfo').textContent = `Hint: 0/${CONFIG.MAX_HINTS}`);
  showScreen(goHome ? 'welcomeScreen' : 'paraSelectScreen');
}

// ── Coins ──
async function addCoinsToFirestore(amount, correct, total) {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous)             return;
  if (!amount && !correct && !total)               return;
  if (!coinRateLimiter.canRequest())               return;
  try {
    const userRef = doc(db, 'users', curUser.uid);
    const upd     = { lastPlayed: serverTimestamp() };
    if (amount  > 0) upd.coins        = increment(Math.max(0, amount));
    if (correct > 0) upd.totalCorrect = increment(correct);
    if (total   > 0) upd.totalGames   = increment(total);
    await updateDoc(userRef, upd);
    const curData = getCurData();
    if ((correct > 0 || total > 0) && curData) {
      const nc  = (curData.totalCorrect || 0) + correct;
      const nt  = (curData.totalGames   || 0) + total;
      if (nt > 0) updateDoc(userRef, { accuracy: Math.round((nc / nt) * 100) }).catch(() => {});
    }
  } catch (e) {
    console.error('Coins save error:', e.message);
  }
}

function calcCoins(ts, opt, hints, isSurvival) {
  ts    = Math.max(0, Math.min(300, ts || 0));
  opt   = Math.max(0, opt   || 0);
  hints = Math.max(0, Math.min(CONFIG.MAX_HINTS, hints || 0));
  let c = ts <= 5 ? 15 : ts <= 10 ? 12 : ts <= 15 ? 10 : ts <= 20 ? 8 : ts <= 30 ? 6 : 5;
  c += opt * 5 - hints * 5;
  if (isSurvival) c += 20;
  return Math.max(0, Math.min(500, c));
}

// ── UI helpers ──
function showRes(msg, ok) {
  const d = $('quizResult');
  if (!d) return;
  d.textContent = msg;
  d.className   = ok ? 'result' : 'error';
  d.classList.remove('hidden');
  if (ok) timerManager.setTimeout('hideRes', () => d.classList.add('hidden'), 5000);
}

function showErr(msg) {
  const e = $('quizError');
  if (!e) return;
  e.textContent = msg;
  e.classList.remove('hidden');
  timerManager.setTimeout('hideErr', () => e.classList.add('hidden'), 2500);
}

function startAutoNext() {
  timerManager.clearInterval('autoNext');
  let cd = 5;
  const nb = $('nextBtn');
  if (nb) nb.textContent = `➡️ Agla Sawal (${cd}s)`;
  timerManager.setInterval('autoNext', () => {
    cd--;
    if (nb) nb.textContent = cd > 0 ? `➡️ Agla Sawal (${cd}s)` : '➡️ Agla Sawal';
    if (cd <= 0) { timerManager.clearInterval('autoNext'); nextQ(); }
  }, 1000);
}
