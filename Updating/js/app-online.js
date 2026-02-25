// ═══════════════════════════════════════════════════════════════
//  app-online.js
//  Online Match: Lobby, Matchmaking, Game Loop, Result, Cleanup
// ═══════════════════════════════════════════════════════════════

import {
  doc, getDoc, updateDoc, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  ref, set, get, onValue, remove, update, push, off,
  runTransaction as rtdbTx,
  onDisconnect as rtdbOnDisconnect
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

import {
  db, rtdb, CONFIG, TABLES,
  $, toast, showScreen, spawnCoinParticles, esc,
  timerManager, listenerManager,
  getCurUser, getCurData, setCurData,
  getLastSubmit, setLastSubmit, resetSubmit,
  isConnected, MS, resetMS, setJoining, getJoining, freshMatchState
} from './app-core.js';
import { quizState, loadQuran } from './app-game.js';

// ═══════════════════════════════════════════
//  LOBBY
// ═══════════════════════════════════════════

export async function openOnlineLobby() {
  const curUser = getCurUser();
  if (!curUser || curUser.isAnonymous) { toast('❌ Login karo pehle!','error'); showScreen('authScreen'); return; }
  loadQuran();
  showScreen('onlineLobbyScreen');
  try { const snap=await getDoc(doc(db,'users',curUser.uid)); if(snap.exists()) setCurData(snap.data()); } catch(_){}
  const coins = getCurData()?.coins || 0;
  const li    = $('lobbyCoinsInfo');
  if (li) li.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} — Table chuniye!`;
  Object.entries(TABLES).forEach(([key,t]) => {
    const id  = `join${key.charAt(0).toUpperCase()+key.slice(1)}`;
    const btn = $(id); if (!btn) return;
    if (coins < t.fee) { btn.disabled=true; btn.textContent=`🔒 ${t.fee}🪙 chahiye`; }
    else               { btn.disabled=false; btn.textContent=`Join (${t.fee}🪙)`; }
  });
}

// ═══════════════════════════════════════════
//  JOIN TABLE
// ═══════════════════════════════════════════

export async function joinTable(tableKey) {
  const curUser = getCurUser();
  if (!curUser || !getCurData())  { toast('❌ Login karein!','error'); return; }
  if (!isConnected())             { toast('❌ Internet check karein!','error'); return; }
  if (getJoining())                   { toast('⏳ Thoda ruko...','info'); return; }
  if (MS.matchId || MS.myRole)    leaveMatchCleanup(false);

  setJoining(true);
  const table = TABLES[tableKey];
  if (!table) { setJoining(false); toast('❌ Invalid table!','error'); return; }

  try { const snap=await getDoc(doc(db,'users',curUser.uid)); if(snap.exists()) setCurData(snap.data()); } catch(_){}

  const coins = getCurData()?.coins || 0;
  if (coins < table.fee) { setJoining(false); toast(`❌ ${table.fee}🪙 chahiye! Aapke paas: ${coins}🪙`,'error'); return; }

  if (!quizState.quranData.length) {
    toast('⏳ Data load ho raha hai...','info');
    await loadQuran();
    if (!quizState.quranData.length) { setJoining(false); toast('❌ Quran data load nahi hua!','error'); return; }
  }

  Object.assign(MS, freshMatchState());
  MS.tableKey    = tableKey;
  MS.feeDeducted = false;

  try {
    await runTransaction(db, async tx => {
      const userRef = doc(db,'users',curUser.uid);
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists()) throw new Error('User not found');
      if ((userDoc.data().coins||0) < table.fee) throw new Error('Insufficient coins');
      tx.update(userRef, { coins: increment(-table.fee) });
    });
    MS.feeDeducted = true;
  } catch(e) { setJoining(false); toast('❌ Coins deduct error. Try again.','error'); return; }

  showScreen('matchWaitScreen');
  $('matchWaitInfo')  && ($('matchWaitInfo').textContent  = table.name);
  $('matchWaitTimer') && ($('matchWaitTimer').textContent = '0s');

  const waitStart = Date.now();
  MS.timers.setInterval('matchWait',()=>{ const el=$('matchWaitTimer'); if(el) el.textContent=`${Math.floor((Date.now()-waitStart)/1000)}s`; },1000);

  try { await _findOrCreateMatch(tableKey); } finally { setJoining(false); }
}

// ═══════════════════════════════════════════
//  MATCHMAKING
// ═══════════════════════════════════════════

async function _findOrCreateMatch(tableKey) {
  const curUser = getCurUser(), curData = getCurData();
  const qRef    = ref(rtdb, `queues/${tableKey}`);
  let txResult  = { asP2:false, p2MatchId:null, oppData:null };

  try {
    await rtdbTx(qRef, current => {
      if (!current || current.uid === curUser.uid) {
        return { uid:curUser.uid, username:curData?.username||'Player', matchId:'', ts:Date.now() };
      }
      txResult.asP2=true; txResult.p2MatchId=current.matchId; txResult.oppData=current;
      return;
    });
  } catch(e) { await _doRefund(); toast('❌ Matchmaking error. Retry karein.','error'); showScreen('onlineLobbyScreen'); return; }

  if (txResult.asP2) {
    let p2MatchId=txResult.p2MatchId, tries=0;
    while ((!p2MatchId||p2MatchId==='') && tries<16) {
      await new Promise(r=>setTimeout(r,500));
      try { const snap=await get(qRef); if(!snap.exists()){p2MatchId=null;break;} const mid=snap.val()?.matchId; if(mid&&mid!=='') p2MatchId=mid; } catch(_){}
      tries++;
    }
    if (!p2MatchId) { await _doRefund(); toast('❌ Match nahi mila. Retry karein.','error'); showScreen('onlineLobbyScreen'); return; }
    MS.matchId=p2MatchId; MS.myRole='p2'; MS.opponentName=txResult.oppData?.username||'Player';
    await _p2JoinMatch(p2MatchId, tableKey, qRef);
  } else {
    let matchId;
    try {
      matchId=push(ref(rtdb,`matches/${tableKey}`)).key; MS.matchId=matchId; MS.myRole='p1';
      const tbl=TABLES[tableKey];
      await set(ref(rtdb,`matches/${tableKey}/${matchId}`),{
        status:'waiting', table:tableKey, totalQ:tbl.totalQ, questionPool:[],
        p1:{uid:curUser.uid,name:curData?.username||'Player',score:0,qIdx:0,connected:true},
        p2:{uid:'',name:'',score:0,qIdx:0,connected:false},
        winner:'', createdAt:Date.now()
      });
      await update(qRef,{matchId});
    } catch(e) { await _doRefund(); toast('❌ Match create error.','error'); showScreen('onlineLobbyScreen'); return; }

    _p1WaitForOpponent(tableKey, matchId);

    MS.timers.setTimeout('matchAutoCancel', async()=>{
      try {
        const snap=await get(ref(rtdb,`matches/${tableKey}/${matchId}`));
        if (snap.exists()&&snap.val().status==='waiting') {
          await remove(ref(rtdb,`matches/${tableKey}/${matchId}`)).catch(()=>{});
          await remove(qRef).catch(()=>{});
          MS.matchId=null; MS.myRole=null; leaveMatchCleanup(false); await _doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!','info',4000); showScreen('onlineLobbyScreen');
        }
      } catch(_){}
    }, CONFIG.MATCH_AUTO_CANCEL_MS);
  }
}

function _p1WaitForOpponent(tableKey, matchId) {
  const mRef  = ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap=>{
    if (!snap.exists()) return;
    const d=snap.val();
    if (d.status==='active'&&d.p2?.uid) { MS.listeners.remove(`p1Wait_${matchId}`); MS.opponentName=d.p2.name; startOnlineMatch(tableKey,matchId,d); }
  }, err=>console.warn('P1 wait error:',err.message));
  MS.listeners.add(`p1Wait_${matchId}`,unsub);
}

async function _p2JoinMatch(matchId, tableKey, qRef) {
  const curUser=getCurUser(), curData=getCurData();
  const mRef=ref(rtdb,`matches/${tableKey}/${matchId}`);
  let snap; try{snap=await get(mRef);}catch(_){await _doRefund();toast('❌ Match data error.','error');showScreen('onlineLobbyScreen');return;}
  if (!snap.exists()){await _doRefund();toast('❌ Match cancel ho gaya.','error');showScreen('onlineLobbyScreen');return;}
  if (snap.val().status!=='waiting'){await _doRefund();toast('❌ Match pehle se start ho gaya.','error');showScreen('onlineLobbyScreen');return;}
  const tbl=TABLES[tableKey];
  const questionPool=_buildPool(tbl.totalQ+CONFIG.POOL_EXTRA);
  try {
    await update(mRef,{ status:'active', questionPool, 'p2/uid':curUser.uid, 'p2/name':curData?.username||'Player', 'p2/score':0, 'p2/qIdx':0, 'p2/connected':true });
  } catch(_){await _doRefund();toast('❌ Match join error.','error');showScreen('onlineLobbyScreen');return;}
  if (qRef) remove(qRef).catch(()=>{});
  const finalSnap=await get(mRef).catch(()=>null);
  if (finalSnap?.exists()) startOnlineMatch(tableKey,matchId,finalSnap.val());
}

function _buildPool(size) {
  if (!quizState.quranData.length) return [];
  const idx=Array.from({length:quizState.quranData.length},(_,i)=>i);
  for(let i=idx.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
  return idx.slice(0,size);
}

// ═══════════════════════════════════════════
//  MATCH SCREEN
// ═══════════════════════════════════════════

export function startOnlineMatch(tableKey, matchId, initData) {
  MS.timers.clearInterval('matchWait');
  MS.timers.clearTimeout('matchAutoCancel');
  MS.feeDeducted=false; MS.myQIdx=0; MS.inSuddenDeath=false;
  showScreen('onlineMatchScreen'); _hidePopups();

  const curData=getCurData();
  if($('myName'))  $('myName').textContent  = curData?.username||'Player';
  if($('oppName')) $('oppName').textContent = MS.opponentName||'Opponent';
  if($('myScore')) $('myScore').textContent = '0';
  if($('oppScore'))$('oppScore').textContent= '0';

  const myConnRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`);
  set(myConnRef,true).catch(()=>{}); rtdbOnDisconnect(myConnRef).set(false).catch(()=>{});

  const pool=initData.questionPool||[];
  if (pool.length) { MS.currentAyatIndex=pool[0]; _showMatchQuestion(pool[0],1,TABLES[tableKey].totalQ); }
  _triggerMatchStartParticles();

  const mRef  = ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap=>{
    if (MS._ended) return;
    if (!snap.exists()) { _handleMatchEnd(false,'opponent_left'); return; }
    const d=snap.val(), tbl=TABLES[tableKey], isP1=MS.myRole==='p1';
    const myD=isP1?d.p1:d.p2, opD=isP1?d.p2:d.p1;
    if($('myScore'))  $('myScore').textContent  = myD?.score||0;
    if($('oppScore')) $('oppScore').textContent = opD?.score||0;
    MS.myScore=myD?.score||0; MS.oppScore=opD?.score||0;

    // Disconnect grace
    if (opD?.connected===false&&!MS.disconnectGraceTimer&&(d.status==='active'||d.status==='sudden_death')) {
      _showDisconnectGrace(CONFIG.GRACE_PERIOD_SEC);
      MS.disconnectGraceTimer=timerManager.setTimeout(`dg_${matchId}`,async()=>{
        try {
          const fresh=await get(mRef); if(!fresh.exists()) return;
          const freshOp=isP1?fresh.val().p2:fresh.val().p1;
          if (freshOp?.connected===false&&fresh.val().status!=='finished') {
            await rtdbTx(ref(rtdb,`matches/${tableKey}/${matchId}/winner`),c=>(c&&c!=='')?undefined:MS.myRole);
            await update(mRef,{status:'finished'}); _handleMatchEnd(true,'opponent_left');
          } else { MS.disconnectGraceTimer=null; _hideDisconnectGrace(); }
        } catch(_){MS.disconnectGraceTimer=null;}
      },CONFIG.GRACE_PERIOD_SEC*1000);
    } else if (opD?.connected===true&&MS.disconnectGraceTimer) {
      timerManager.clearTimeout(`dg_${matchId}`); MS.disconnectGraceTimer=null; _hideDisconnectGrace();
    }

    if (d.winner&&d.status==='finished') { _handleMatchEnd(d.winner===MS.myRole); return; }
    if (MS.myScore>=tbl.firstTo)  { _handleMatchEnd(true);  return; }
    if (MS.oppScore>=tbl.firstTo) { _handleMatchEnd(false); return; }

    const myDone=(myD?.qIdx||0)>=tbl.totalQ, oppDone=(opD?.qIdx||0)>=tbl.totalQ;
    if (myDone&&oppDone&&d.status==='active') {
      if (MS.myScore>MS.oppScore)       { _handleMatchEnd(true);  return; }
      if (MS.myScore<MS.oppScore)       { _handleMatchEnd(false); return; }
      if (!MS.inSuddenDeath) { MS.inSuddenDeath=true; if(MS.myRole==='p2') update(mRef,{status:'sudden_death'}).catch(()=>{}); _enterSuddenDeath(d.questionPool,myD?.qIdx||0); }
      return;
    }
    if (d.status==='sudden_death'&&!MS.inSuddenDeath) { MS.inSuddenDeath=true; _enterSuddenDeath(d.questionPool,myD?.qIdx||0); return; }
    const newQIdx=myD?.qIdx||0;
    if (newQIdx>MS.myQIdx) { MS.myQIdx=newQIdx; if(d.questionPool?.[newQIdx]!==undefined) MS.currentAyatIndex=d.questionPool[newQIdx]; }
  }, err=>console.warn('Match listener err:',err.message));
  MS.listeners.add(`matchListener_${matchId}`,unsub);
}

function _enterSuddenDeath(pool, currentQIdx) {
  _showSuddenDeathBanner();
  const sdIdx=pool?.[currentQIdx];
  if (sdIdx!==undefined) { MS.currentAyatIndex=sdIdx; const mp=$('matchProgress'); if(mp)mp.textContent='⚡ SUDDEN DEATH'; _showMatchQuestion(sdIdx,null,null,true); }
}

function _showMatchQuestion(ayatIndex, qNum, totalQ, isSuddenDeath=false) {
  const ayat=quizState.quranData[ayatIndex]; if(!ayat) return;
  MS.answered=false;
  if (!isSuddenDeath) { const mp=$('matchProgress'); if(mp) mp.textContent=qNum&&totalQ?`Sawal ${qNum} / ${totalQ}`:`Sawal ${qNum}`; }
  const el=$('matchAyatText'); if(el) el.textContent=ayat.text;
  $('matchAnswerForm')?.reset(); $('matchCheckBtn')&&($('matchCheckBtn').disabled=false);
  const mr=$('matchResult'); if(mr){mr.classList.add('hidden');mr.textContent='';}
  const para=ayat.para||(((ayat.page-1)/20|0)+1), maxPip=para===29?24:para===30?25:20;
  const pipInp=$('match_pip'); if(pipInp){pipInp.max=maxPip;pipInp.placeholder=`PiP (1-${maxPip})`;}
  _startMatchTimer(30);
}

function _startMatchTimer(sec) {
  MS.timers.clearInterval('matchTimer');
  let t=sec; const f=$('matchTimerFill'),txt=$('matchTimer');
  if(f) f.style.width='100%'; if(txt) txt.textContent=`${t}s`;
  MS.timers.setInterval('matchTimer',()=>{
    t--; if(f) f.style.width=`${(t/sec)*100}%`; if(txt) txt.textContent=`${t}s`;
    if (t<=0){MS.timers.clearInterval('matchTimer'); if(!MS.answered) submitMatchAnswer(true);}
  },1000);
}

// ═══════════════════════════════════════════
//  SUBMIT MATCH ANSWER
// ═══════════════════════════════════════════

export async function submitMatchAnswer(timeOut=false) {
  const now=Date.now();
  if (now-getLastSubmit()<CONFIG.SUBMIT_COOLDOWN_MS) return;
  setLastSubmit();
  if (MS.answered) return;
  MS.answered=true; MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn')&&($('matchCheckBtn').disabled=true);
  if (timeOut){_showMatchMsg('⏱️ Waqt khatam!',false);await _advanceQ(false);return;}

  const para=$('match_para')?.value.trim()||'', pip=$('match_pip')?.value.trim()||'';
  if (!para){MS.answered=false;$('matchCheckBtn')&&($('matchCheckBtn').disabled=false);resetSubmit();toast('❌ Para zaroori hai!','error');return;}
  const paraNum=parseInt(para);
  if(isNaN(paraNum)||paraNum<1||paraNum>30){MS.answered=false;$('matchCheckBtn')&&($('matchCheckBtn').disabled=false);resetSubmit();toast('❌ Para 1-30 ke beech!','error');return;}

  const ayat=quizState.quranData[MS.currentAyatIndex];
  if(!ayat){_showMatchMsg('❌ Question data error',false);await _advanceQ(false);return;}

  const ap=ayat.para||(((parseInt(ayat.page)-1)/20|0)+1), aip=ayat.pip||(((parseInt(ayat.page)-1)%20)+1);
  const pOk=paraNum===ap, pipOk=pip?parseInt(pip)===aip:true;

  if (pOk&&pipOk) {
    if (MS.inSuddenDeath) {
      const winRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/winner`);
      const mRef  =ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
      let won=false;
      try { const r=await rtdbTx(winRef,c=>(c&&c!=='')?undefined:MS.myRole); won=r.committed; if(won)await update(mRef,{status:'finished',[`${MS.myRole}/score`]:MS.myScore+1}); } catch(_){}
      _showMatchMsg(`✅ Sahi! Para: ${ap}`,true); _handleMatchEnd(won,won?'sudden_death_win':'sudden_death_loss'); return;
    }
    try { await rtdbTx(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/score`),c=>(c||0)+1); } catch(_){}
    _showMatchMsg(`✅ Sahi! Para: ${ap}${pip?`, PiP: ${aip}`:''}`,true);
  } else { _showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip}`,false); }
  await _advanceQ(pOk&&pipOk);
}

async function _advanceQ(wasCorrect) {
  await new Promise(r=>setTimeout(r,1400));
  if (MS._ended) return;
  const tbl=TABLES[MS.tableKey]; if(!tbl) return;
  const newIdx=MS.myQIdx+1, field=`${MS.myRole}/qIdx`, mRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
  MS.myQIdx=newIdx;
  if (!MS.inSuddenDeath&&newIdx>=tbl.totalQ){update(mRef,{[field]:newIdx}).catch(()=>{}); _showWaitingForOpponent(); return;}
  update(mRef,{[field]:newIdx}).catch(()=>{});
  const snap=await get(mRef).catch(()=>null);
  if (!snap?.exists()||MS._ended) return;
  const pool=snap.val()?.questionPool;
  if (pool?.[newIdx]!==undefined&&!MS.inSuddenDeath){MS.currentAyatIndex=pool[newIdx];_showMatchQuestion(pool[newIdx],newIdx+1,tbl.totalQ);}
}

function _showWaitingForOpponent() {
  const tbl=TABLES[MS.tableKey]||{};
  MS.timers.clearInterval('matchTimer');
  $('matchCheckBtn')&&($('matchCheckBtn').disabled=true);
  const f=$('matchTimerFill');if(f)f.style.width='0%';
  const t=$('matchTimer');if(t)t.textContent='⏳';
  const mp=$('matchProgress');if(mp)mp.textContent=`✅ Aapne ${tbl.totalQ||''} sawaal khatam kiye — ${MS.opponentName||'Opponent'} ka intezaar...`;
  const at=$('matchAyatText');if(at)at.textContent='⏳ Opponent abhi khel raha hai...';
  const mr=$('matchResult');if(mr){mr.classList.add('hidden');mr.textContent='';}
  _showOpponentWaitPopup(true);
}

// ═══════════════════════════════════════════
//  MATCH END
// ═══════════════════════════════════════════

function _handleMatchEnd(won, reason='') {
  if (MS._ended) return;
  MS._ended=true;
  leaveMatchCleanup(false); _hidePopups();

  const tbl=TABLES[MS.tableKey]||{}, coins=won?(tbl.winCoins||0):0;
  if($('matchResultIcon'))  $('matchResultIcon').textContent  = won?'🏆':'😔';
  if($('matchResultTitle')) $('matchResultTitle').textContent =
    reason==='sudden_death_win'?'⚡ Sudden Death Jeet!': reason==='opponent_left'?'🏆 Opponent Chala Gaya!': won?'Jeet Gaye! 🏆':'Haare! 😔';

  let reasonText='';
  if(reason==='opponent_left')    reasonText='Opponent ne match chhod diya!';
  if(reason==='sudden_death_win') reasonText='⚡ Pehla sahi jawab — Jeet!';
  if(reason==='sudden_death_loss')reasonText='⚡ Opponent ne pehle sahi jawab diya.';
  const rs=$('matchResultScores'); if(rs) rs.textContent=`Aap: ${MS.myScore}  VS  ${MS.opponentName||'Opp'}: ${MS.oppScore}  ${reasonText}`;
  const rc=$('matchResultCoins');  if(rc) rc.textContent=won?`+${coins} 🪙 Jeet ki coins!`:'Koi coins nahi — agali baar!';

  if (won&&coins>0) {
    const curUser=getCurUser();
    if (curUser&&!curUser.isAnonymous) {
      updateDoc(doc(db,'users',curUser.uid),{coins:increment(coins),totalWins:increment(1)}).catch(()=>{});
      toast(`🏆 Jeet Gaye! +${coins}🪙`,'success',4000);
    }
  }
  if (MS.matchId&&MS.tableKey&&MS.myRole==='p1') {
    const _mid=MS.matchId,_tk=MS.tableKey;
    timerManager.setTimeout(`deleteMatch_${_mid}`,()=>remove(ref(rtdb,`matches/${_tk}/${_mid}`)).catch(()=>{}),8000);
  }
  showScreen('matchResultScreen');
  if (won) timerManager.setTimeout('victoryParticles',_triggerVictoryParticles,400);
}

// ═══════════════════════════════════════════
//  CLEANUP
// ═══════════════════════════════════════════

export function leaveMatchCleanup(refundFee=false) {
  MS.timers.clearAll(); MS.listeners.removeAll();
  if (MS.tableKey) {
    const qRef=ref(rtdb,`queues/${MS.tableKey}`), curUser=getCurUser();
    get(qRef).then(snap=>{if(snap.exists()&&snap.val()?.uid===curUser?.uid)remove(qRef).catch(()=>{});}).catch(()=>{});
    if (MS.matchId&&MS.myRole&&!MS._ended) set(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`),false).catch(()=>{});
  }
  if (refundFee) _doRefund();
}

async function _doRefund() {
  if (!MS.feeDeducted||!getCurUser()||!MS.tableKey) return;
  if (MS._refunding) return;
  MS._refunding=true; MS.feeDeducted=false;
  const fee=TABLES[MS.tableKey]?.fee||0;
  if (fee>0) {
    try { await updateDoc(doc(db,'users',getCurUser().uid),{coins:increment(fee)}); console.log(`Refunded ${fee} coins`); }
    catch(e){ console.error('Refund error:',e); }
  }
  MS._refunding=false;
}

// ═══════════════════════════════════════════
//  EXIT MODAL
// ═══════════════════════════════════════════

export function showExitConfirm() { const m=$('exitMatchModal'); if(m) m.style.display='flex'; }
export function hideExitConfirm() { const m=$('exitMatchModal'); if(m) m.style.display='none'; }

// ═══════════════════════════════════════════
//  UI POPUPS
// ═══════════════════════════════════════════

function _showMatchMsg(msg, ok) {
  const el=$('matchResult'); if(!el) return;
  el.textContent=msg; el.className=ok?'result':'error'; el.classList.remove('hidden');
}

function _hidePopups() { _hideOpponentWaitPopup(); _hideDisconnectGrace(); _hideSuddenDeathBanner(); }

function _showOpponentWaitPopup(allDone=false) {
  let p=$('oppWaitPopup');
  if (!p){p=document.createElement('div');p.id='oppWaitPopup';p.style.cssText='position:fixed;inset:0;background:rgba(5,15,10,.88);backdrop-filter:blur(10px);z-index:8000;display:flex;align-items:center;justify-content:center;';document.body.appendChild(p);}
  const tbl=TABLES[MS.tableKey]||{};
  p.innerHTML=allDone
    ?`<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:32px 24px;text-align:center;max-width:320px;width:90vw;display:flex;flex-direction:column;gap:16px"><div style="font-size:2.5rem">✅</div><div style="font-family:Cinzel,serif;color:var(--gold-light)">Aapne Sawaal Poore Kiye!</div><div style="font-size:1.8rem;font-weight:900;color:var(--emerald)">${MS.myScore} points</div><div style="font-size:0.85rem;color:var(--text-muted)">Nateeja unke khatam hone par aayega</div><div class="match-spinner" style="margin:0 auto"></div></div>`
    :`<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px"><div style="font-size:2rem">⏳</div><div style="font-family:Cinzel,serif;color:var(--gold-light)">Opponent ka Intezaar</div><div class="match-spinner" style="margin:0 auto"></div></div>`;
  p.style.display='flex';
}
function _hideOpponentWaitPopup(){const p=$('oppWaitPopup');if(p)p.style.display='none';}

function _showDisconnectGrace(seconds=15){
  let p=$('disconnectGracePopup');
  if(!p){p=document.createElement('div');p.id='disconnectGracePopup';p.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a0808,#100404);border:1px solid #c4293b60;border-radius:16px;padding:16px 24px;text-align:center;max-width:320px;width:90vw;z-index:9500;display:none;';document.body.appendChild(p);}
  p.innerHTML=`<div style="font-size:1.8rem;margin-bottom:6px">📡</div><div style="font-family:Cinzel,serif;color:var(--gold-light);font-size:0.95rem">Opponent Disconnect!</div><div id="graceCountdown" style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif">${seconds}s intezaar karo...</div>`;
  p.style.display='flex'; p.style.flexDirection='column';
  let cd=seconds;
  timerManager.setInterval('graceCountdown',()=>{
    cd--; const el=$('graceCountdown'); if(el) el.textContent=cd>0?`${cd}s intezaar karo...`:'Match khatam kar raha hai...';
    if(cd<=0) timerManager.clearInterval('graceCountdown');
  },1000);
}
function _hideDisconnectGrace(){timerManager.clearInterval('graceCountdown');const p=$('disconnectGracePopup');if(p)p.style.display='none';}

function _showSuddenDeathBanner(){
  let el=$('suddenDeathBanner');
  if(!el){el=document.createElement('div');el.id='suddenDeathBanner';el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:linear-gradient(135deg,#1a0800,#2a1000);border-bottom:2px solid #d4a84380;';el.innerHTML='<span style="font-size:1.3rem;margin-right:10px">⚡</span><span style="font-family:Cinzel,serif;font-weight:900;font-size:1rem;color:var(--gold-light)">SUDDEN DEATH</span><span style="font-size:1.3rem;margin-left:10px">⚡</span><span style="font-size:0.78rem;color:var(--text-muted);margin-left:12px;font-family:Tajawal,sans-serif">Pehla sahi jawab jeetega!</span>';document.body.appendChild(el);}
  el.style.display='flex';
}
function _hideSuddenDeathBanner(){const el=$('suddenDeathBanner');if(el)el.style.display='none';}

function _triggerMatchStartParticles(){
  const myBox=$('myPlayerBox'),oppBox=$('oppPlayerBox'),vsEl=$('matchVsEl');if(!vsEl)return;
  timerManager.setTimeout('matchStartP',()=>{spawnCoinParticles(myBox,vsEl,14);timerManager.setTimeout('matchStartP2',()=>spawnCoinParticles(oppBox,vsEl,14),120);},400);
}
function _triggerVictoryParticles(){
  const from=$('matchResultIcon'),to=$('hdrCoins');if(!from||!to)return;
  spawnCoinParticles(from,to,20);timerManager.setTimeout('vp2',()=>spawnCoinParticles(from,to,15),300);timerManager.setTimeout('vp3',()=>spawnCoinParticles(from,to,10),600);
}
