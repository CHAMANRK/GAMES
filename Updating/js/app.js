'use strict';

// ═══════════════════════════════════════════
//  FIREBASE IMPORTS
// ═══════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, signInAnonymously, GoogleAuthProvider,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  increment, serverTimestamp, onSnapshot,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getDatabase, ref, set, get, onValue, remove, update, push, off,
  runTransaction, onDisconnect as rtdbOnDisconnect
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js";

// ═══════════════════════════════════════════
//  FIREBASE CONFIG
// ═══════════════════════════════════════════
const firebaseApp = initializeApp({
  apiKey:            "AIzaSyDnAGW2eDe3ao1ezTf7fykUSfhyReQDgJM",
  authDomain:        "quran-quiz-3ee30.firebaseapp.com",
  databaseURL:       "https://quran-quiz-3ee30-default-rtdb.firebaseio.com",
  projectId:         "quran-quiz-3ee30",
  storageBucket:     "quran-quiz-3ee30.firebasestorage.app",
  messagingSenderId: "362662301719",
  appId:             "1:362662301719:web:e5fa7bd4adf633758e8c52",
  measurementId:     "G-CVQTH5SS0X"
});
const auth = getAuth(firebaseApp);
const db   = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);
const GP   = new GoogleAuthProvider();

// ═══════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════
let quranData = [], quranLoading = false;
let curUser = null, curData = null, guestN = 0;
let selAyats = [], curAyat = null;
let qIdx = 0, score = 0, totalQ = 10, mode = 'practice';
let usedI = [], surahC = {}, startT = 0, qTmr = null;
let timeArr = [], survOn = true, hints = 0;
let sessionCorrect = 0, sessionTotal = 0;
let _autoNextTmr = null, _userUnsub = null, _isConnected = false;
let _authResolved = false; // Boot-loader gate
const MAX_H = 2;

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const $  = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const sc = $(id); if (sc) sc.classList.add('active');
  if (id !== 'welcomeScreen') {
    const c = $('searchContainer'); if (c) c.style.display = 'none';
    const b = $('toggleSearchBtn'); if (b) b.textContent = '🔎 Search';
  }
}

function toast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) { t = document.createElement('div'); t.id = '_toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = `toast toast-${type} toast-show`;
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => t.classList.remove('toast-show'), dur);
}

function setMsg(id, msg, type = 'error') {
  const el = $(id); if (!el) return;
  el.textContent = msg;
  el.className = `auth-msg ${type} show`;
}

function clearMsgs() {
  document.querySelectorAll('.auth-msg').forEach(m => { m.className = 'auth-msg'; m.textContent = ''; });
}

function btnLoad(id, loading, orig) {
  const b = $(id); if (!b) return;
  b.disabled = loading;
  if (loading) { b._orig = b.textContent; b.textContent = '⏳'; }
  else b.textContent = orig || b._orig || b.textContent;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════
//  BOOT LOADER
// ═══════════════════════════════════════════
function hideBootLoader() {
  if (_authResolved) return;
  _authResolved = true;
  const bl = $('bootLoader');
  if (!bl) return;
  bl.style.transition = 'opacity 0.45s ease';
  bl.style.opacity = '0';
  setTimeout(() => { bl.style.display = 'none'; }, 480);
}

// ═══════════════════════════════════════════
//  LANGUAGE
// ═══════════════════════════════════════════
let currentLang = localStorage.getItem('nqg_lang') || 'hinglish';
function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem('nqg_lang', lang);
  const bH = $('btnHinglish'), bE = $('btnEnglish');
  if (bH) bH.classList.toggle('active', lang === 'hinglish');
  if (bE) bE.classList.toggle('active', lang === 'english');
}

// ═══════════════════════════════════════════
//  COINS
// ═══════════════════════════════════════════
function calcCoins(timeSpent, optCorrect, hintsUsed, isSurvival) {
  let c = timeSpent<=5?15:timeSpent<=10?12:timeSpent<=15?10:timeSpent<=20?8:timeSpent<=30?6:5;
  c += optCorrect*5; c -= hintsUsed*5; if (isSurvival) c += 20;
  return Math.max(0, c);
}

async function addCoinsToFirestore(amount, correct, total) {
  if (!curUser || curUser.isAnonymous) return;
  if (!amount && !correct && !total) return;
  try {
    const r2 = doc(db,'users',curUser.uid);
    const upd = { lastPlayed: serverTimestamp() };
    if (amount>0)  upd.coins        = increment(amount);
    if (correct>0) upd.totalCorrect = increment(correct);
    if (total>0)   upd.totalGames   = increment(total);
    await updateDoc(r2, upd);
    if ((correct>0||total>0) && curData) {
      const nc = (curData.totalCorrect||0)+correct, nt = (curData.totalGames||0)+total;
      if (nt>0) updateDoc(r2,{accuracy:Math.round((nc/nt)*100)}).catch(()=>{});
    }
  } catch(e) { console.warn('Coins save error:',e.message); }
}

// ═══════════════════════════════════════════
//  PROFILE PANEL
// ═══════════════════════════════════════════
function openProfilePanel() {
  $('profilePanel')?.classList.add('open');
  $('profileOverlay')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeProfilePanel() {
  $('profilePanel')?.classList.remove('open');
  $('profileOverlay')?.classList.add('hidden');
  document.body.style.overflow = '';
}
function refreshProfilePanel() {
  if (!curUser || curUser.isAnonymous || !curData) return;
  const isHafiz = curData.isHafiz||false;
  const s = (id,v) => { const el=$(id); if(el) el.textContent=v; };
  s('ppUsername', curData.username||curUser.displayName||'Player');
  s('ppRole', isHafiz?'👑 Hafiz':curData.role==='admin'?'🛡️ Admin':'🎮 Player');
  s('ppCoins', (curData.coins||0).toLocaleString());
  s('ppAccuracy', (curData.accuracy||0)+'%');
  s('ppGames', curData.totalGames||0);
  const uidEl=$('ppUidVal'); if(uidEl) uidEl.textContent=curUser.uid;
  const av=$('ppAvatarCircle'); if(av) av.textContent=isHafiz?'👑':'👤';
  const pb=$('profileBtnIcon'); if(pb) pb.textContent=isHafiz?'👑':'👤';
}
function setupUidCopy() {
  on('ppUidCopy','click',()=>{
    const uid=curUser?.uid; if(!uid) return;
    const done=()=>{ const el=$('ppUidCopied'); if(el){el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),2000);} };
    navigator.clipboard.writeText(uid).then(done).catch(()=>{
      const ta=document.createElement('textarea'); ta.value=uid; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
    });
  });
}

// ═══════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════
function updateHeader() {
  const pb=$('profileBtn'), hc=$('hdrCoins'), hv=$('hdrCoinsVal'), gl=$('guestLogoutPill');
  if (curUser && !curUser.isAnonymous) {
    pb?.classList.remove('hidden'); hc?.classList.remove('hidden');
    if(hv) hv.textContent=(curData?.coins||0).toLocaleString();
    if(gl) gl.style.display='none';
    refreshProfilePanel();
  } else if (curUser?.isAnonymous) {
    pb?.classList.add('hidden'); hc?.classList.add('hidden');
    if(gl) gl.style.display='flex';
  } else {
    pb?.classList.add('hidden'); hc?.classList.add('hidden');
    if(gl) gl.style.display='none';
  }
}

function showWelcomePopup(name, coins, isNew=false) {
  const p=$('welcomePopup'); if(!p) return;
  const wn=$('wpName'), wc=$('wpCoins');
  if(wn) wn.textContent=isNew?`Ahlan, ${name}! 🌙`:`Marhaba, ${name}! 🌙`;
  if(wc) wc.textContent=isNew?`🪙 ${coins} welcome coins!`:`🪙 ${coins} coins`;
  p.classList.add('show'); setTimeout(()=>p.classList.remove('show'),4000);
}

// ═══════════════════════════════════════════
//  FIRESTORE USER SYNC
// ═══════════════════════════════════════════
async function syncUser(uid, data) {
  try {
    const r2=doc(db,'users',uid), snap=await getDoc(r2);
    if (!snap.exists()) {
      const nd={
        uid, username:data.username||'Player', email:data.email||'',
        coins:500, xp:0, level:1, accuracy:0, totalGames:0, totalWins:0,
        totalCorrect:0, streak:0, bestStreak:0, avgSpeed:0, fastestAnswer:0,
        lastLogin:serverTimestamp(), createdAt:serverTimestamp(),
        isHafiz:false, role:'user', avatar:'default', onlineMode:true,
        badges:[], friends:[], friendRequests:[], bookmarks:[]
      };
      await setDoc(r2,nd); curData=nd;
    } else {
      curData=snap.data();
      const upd={lastLogin:serverTimestamp()};
      if (!curData.onlineMode) { upd.onlineMode=true; curData.onlineMode=true; }
      if (!curData.friendRequests) { upd.friendRequests=[]; }
      if (!curData.friends) { upd.friends=[]; }
      updateDoc(r2,upd).catch(()=>{});
    }
    startUserListener(uid);
  } catch(e) { console.warn('syncUser:',e.code||e.message); }
}

function startUserListener(uid) {
  if (_userUnsub) { _userUnsub(); _userUnsub=null; }
  _userUnsub=onSnapshot(doc(db,'users',uid), snap=>{
    if(snap.exists()){ curData=snap.data(); updateHeader(); }
  }, err=>console.warn('UserListener:',err.message));
}
function stopUserListener() { if(_userUnsub){_userUnsub();_userUnsub=null;} }

// ═══════════════════════════════════════════
//  FIREBASE ERRORS
// ═══════════════════════════════════════════
function fbErr(code) {
  const m={
    'auth/email-already-in-use':'❌ Email pehle se registered hai.',
    'auth/invalid-email':'❌ Sahi email likhein.',
    'auth/user-not-found':'❌ Email registered nahi.',
    'auth/wrong-password':'❌ Password galat hai.',
    'auth/invalid-credential':'❌ Email ya password galat hai.',
    'auth/weak-password':'❌ Password min 6 chars chahiye.',
    'auth/too-many-requests':'❌ Zyada try — baad mein koshish karein.',
    'auth/network-request-failed':'❌ Internet check karein.',
    'auth/popup-blocked':'❌ Popup block — allow karein.',
  };
  return m[code]||`❌ Error: ${code}`;
}

// ═══════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p=>p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
}

async function doLogin() {
  clearMsgs();
  const email=$('loginEmail')?.value.trim(), pw=$('loginPassword')?.value;
  if(!email||!pw){setMsg('loginMsg','❌ Email aur password likhein!');return;}
  btnLoad('loginBtn',true);
  try {
    const cred=await signInWithEmailAndPassword(auth,email,pw);
    await syncUser(cred.user.uid,{username:cred.user.displayName||email.split('@')[0],email:cred.user.email});
    showScreen('welcomeScreen'); toast('✅ Login ho gaye!','success');
    if(curData) showWelcomePopup(curData.username||'Player',curData.coins||0);
  } catch(e) { setMsg('loginMsg',fbErr(e.code)); btnLoad('loginBtn',false,'🔐 Login'); }
}

async function doSignup() {
  clearMsgs();
  const un=$('signupUsername')?.value.trim(), em=$('signupEmail')?.value.trim();
  const pw=$('signupPassword')?.value, cpw=$('signupConfirmPw')?.value;
  if(!un||!em||!pw||!cpw){setMsg('signupMsg','❌ Sab fields bharen!');return;}
  if(un.length<3||un.length>20||!/^[a-zA-Z0-9_]+$/.test(un)){setMsg('signupMsg','❌ Username: 3-20 chars, letters/numbers/_ sirf.');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){setMsg('signupMsg','❌ Sahi email likhein.');return;}
  if(pw.length<6){setMsg('signupMsg','❌ Password min 6 chars.');return;}
  if(pw!==cpw){setMsg('signupMsg','❌ Passwords match nahi!');return;}
  btnLoad('signupBtn',true);
  try {
    const cred=await createUserWithEmailAndPassword(auth,em,pw);
    await updateProfile(cred.user,{displayName:un});
    await syncUser(cred.user.uid,{username:un,email:em});
    showScreen('welcomeScreen'); showWelcomePopup(un,500,true);
    toast('✅ Account ban gaya! 500🪙 mile!','success');
  } catch(e) { setMsg('signupMsg',fbErr(e.code)); btnLoad('signupBtn',false,'📝 Account Banayein'); }
}

async function doGoogle() {
  clearMsgs();
  ['googleLoginBtn','googleSignupBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=true;});
  try {
    const result=await signInWithPopup(auth,GP), user=result.user;
    const name=user.displayName||user.email.split('@')[0];
    const isNew=result._tokenResponse?.isNewUser||false;
    await syncUser(user.uid,{username:name,email:user.email});
    showScreen('welcomeScreen');
    showWelcomePopup(name,isNew?500:(curData?.coins||0),isNew);
    toast('✅ Google se login!','success');
  } catch(e) { if(e.code!=='auth/popup-closed-by-user') setMsg('loginMsg',fbErr(e.code)); }
  ['googleLoginBtn','googleSignupBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=false;});
}

async function doGuest() {
  btnLoad('guestBtn',true);
  try {
    await signInAnonymously(auth); guestN=0;
    showScreen('welcomeScreen'); toast('👤 Guest mode — 3 sawaal free!','info',4000);
  } catch(e) { setMsg('loginMsg',fbErr(e.code)); btnLoad('guestBtn',false,'👤 Guest (3 sawaal free)'); }
}

async function doLogout() {
  leaveMatchCleanup(false); stopUserListener();
  await signOut(auth); curUser=null; curData=null;
  updateHeader(); showScreen('authScreen'); toast('👋 Phir aana!','info');
}

async function doForgot() {
  const em=$('loginEmail')?.value.trim();
  if(!em){setMsg('loginMsg','❌ Pehle email likhein!');return;}
  try { await sendPasswordResetEmail(auth,em); setMsg('loginMsg','📧 Reset email bhej diya!','success'); }
  catch(e){setMsg('loginMsg',fbErr(e.code));}
}

// ─── Zero-Flicker Auth ────────────────────
onAuthStateChanged(auth, async user => {
  curUser = user;
  if (user) {
    if (!user.isAnonymous) {
      try {
        const snap = await getDoc(doc(db,'users',user.uid));
        if (snap.exists()) { curData = snap.data(); updateHeader(); }
      } catch(e) {}
      startUserListener(user.uid);
    }
    updateHeader();
    showScreen('welcomeScreen');
    // Only show welcome popup on first auth resolve (not on every token refresh)
    if (curData && !_authResolved) {
      showWelcomePopup(curData.username||'Player', curData.coins||0);
    }
  } else {
    stopUserListener(); curUser = null; curData = null;
    updateHeader();
    showScreen('authScreen');
  }
  // Always hide the boot loader after first auth resolution
  hideBootLoader();
});

onValue(ref(rtdb,'.info/connected'), snap=>{ _isConnected=snap.val()===true; });

// ═══════════════════════════════════════════
//  QURAN DATA
// ═══════════════════════════════════════════
async function loadQuran() {
  if(quranData.length||quranLoading) return;
  quranLoading=true;
  try { quranData=await(await fetch('quran_full.json')).json(); console.log('✅ Quran:',quranData.length); }
  catch(e){ console.error('❌ Quran load fail:',e); }
  finally { quranLoading=false; }
}

// ═══════════════════════════════════════════
//  QUIZ
// ═══════════════════════════════════════════
async function startGame() {
  const er=$('selectError'); if(er) er.classList.add('hidden');
  if(!quranData.length){
    if(er){er.textContent='⏳ Data load ho raha hai...';er.classList.remove('hidden');}
    await loadQuran();
    if(!quranData.length){if(er){er.textContent='❌ Quran data load nahi hua.';er.classList.remove('hidden');}return;}
    if(er) er.classList.add('hidden');
  }
  const fp=parseInt($('fromPara').value), tp=parseInt($('toPara').value);
  if(isNaN(fp)||isNaN(tp)||fp<1||tp>30||fp>tp){if(er){er.textContent='❌ Galat range!';er.classList.remove('hidden');}return;}
  selAyats=quranData.filter(a=>{const p=((a.page-1)/20|0)+1;return p>=fp&&p<=tp;});
  if(!selAyats.length){if(er){er.textContent='❌ Is range mein ayat nahi mile.';er.classList.remove('hidden');}return;}
  qIdx=0;score=0;usedI=[];surahC={};timeArr=[];hints=0;survOn=true;sessionCorrect=0;sessionTotal=0;
  mode=document.querySelector('input[name="quizMode"]:checked')?.value||'practice';
  totalQ=mode==='timed'?10:9999;
  const hb=$('hintBtn');if(hb)hb.disabled=false;
  const hi=$('hintInfo');if(hi)hi.textContent=`Hint: 0/${MAX_H}`;
  $('survivalAnswer')?.classList.add('hidden');
  nextQ(); showScreen('quizScreen');
}

function nextQ() {
  if(_autoNextTmr){clearInterval(_autoNextTmr);_autoNextTmr=null;}
  const nb=$('nextBtn');if(nb){nb.textContent='➡️ Agla Sawal';nb.classList.add('hidden');}
  ['quizError','quizResult','survivalAnswer'].forEach(id=>$(id)?.classList.add('hidden'));
  $('answerForm')?.reset();
  const cb=$('checkBtn');if(cb)cb.disabled=false;
  hints=0;
  const hb=$('hintBtn');if(hb)hb.disabled=false;
  const hi=$('hintInfo');if(hi)hi.textContent=`Hint: 0/${MAX_H}`;
  if(qIdx>=totalQ||usedI.length>=selAyats.length){endQuiz();return;}
  let i,t=0; do{i=Math.floor(Math.random()*selAyats.length);t++;}while(usedI.includes(i)&&t<1000);
  usedI.push(i); curAyat=selAyats[i]; typeText(curAyat.text,'ayatText');
  qIdx++; updateQuizStats(); startT=Date.now();
  if(mode==='timed') startTimer(30); else{const tm=$('timer');if(tm)tm.textContent='';}
}

function updateQuizStats() {
  const acc=sessionTotal>0?Math.round((sessionCorrect/sessionTotal)*100):0;
  const sb=$('scoreBoard');
  if(sb)sb.innerHTML=`<span>Score: <b>${score}/${qIdx}</b></span><span style="margin:0 8px;color:var(--text-muted)">|</span><span>🎯 ${acc}%</span>`;
  const qp=$('quizProgress');
  if(qp)qp.textContent=mode==='practice'?`🎯 Practice — Sawal: ${qIdx}`:mode==='survival'?`💥 Survival — Sawal: ${qIdx}`:`⏱️ ${qIdx} / ${totalQ}`;
}

function typeText(text, elId, instant=false) {
  const el=$(elId); if(!el) return;
  el.textContent='';
  if(instant){el.textContent=text;return;}
  let i=0;
  const go=()=>{ if(i<text.length){el.textContent+=text[i++];setTimeout(go,20);} };
  go();
}

function startTimer(sec) {
  const el=$('timer');if(!el)return;
  let t=sec; el.textContent=`⏱️ ${t}s`; el.classList.remove('urgent');
  if(qTmr)clearInterval(qTmr);
  qTmr=setInterval(()=>{
    t--;el.textContent=`⏱️ ${t}s`;
    if(t<=10)el.classList.add('urgent');
    if(t<=0){
      clearInterval(qTmr);el.textContent="⏱️ Time's up!";el.classList.remove('urgent');
      timeArr.push(sec);sessionTotal++;
      const cb=$('checkBtn');if(cb)cb.disabled=true;
      showRes('⏱️ Waqt khatam!',false);
      $('nextBtn')?.classList.remove('hidden');
      startAutoNext();
    }
  },1000);
}

function checkAnswer() {
  const cb=$('checkBtn');
  if(cb&&cb.disabled)return; if(cb)cb.disabled=true;
  if(_autoNextTmr){clearInterval(_autoNextTmr);_autoNextTmr=null;}
  if(mode==='timed'&&qTmr)clearInterval(qTmr);
  const ts=Math.round((Date.now()-startT)/1000);
  const para=$('user_para')?.value.trim()||'';
  const pip=$('user_page_in_para')?.value.trim()||'';
  const pg=$('user_page')?.value.trim()||'';
  const sur=$('user_surah')?.value.trim().toLowerCase()||'';
  const rk=$('user_ruku')?.value.trim()||'';
  const ay=$('user_ayat')?.value.trim()||'';
  ['quizError','quizResult'].forEach(id=>$(id)?.classList.add('hidden'));
  $('nextBtn')?.classList.add('hidden'); $('survivalAnswer')?.classList.add('hidden');
  if(!para){showErr('❌ Para Number zaroori hai!');if(cb)cb.disabled=false;return;}
  const pn=parseInt(curAyat.page), ap=((pn-1)/20|0)+1, aip=((pn-1)%20)+1;
  let parts=[],opt=0;
  const pOk=parseInt(para)===ap; if(!pOk)parts.push(`❌ Para Galat! Sahi: ${ap}`);
  let pipOk=true;
  if(pip){pipOk=parseInt(pip)===aip-1;if(!pipOk)parts.push(`❌ PiP Galat! Sahi: ${aip-1}`);}
  if(pg){if(parseInt(pg)===pn)opt++;else parts.push(`❌ Page Galat! Sahi: ${pn}`);}
  if(sur){if(curAyat.surah_name.toLowerCase().includes(sur))opt++;else parts.push(`❌ Surah Galat! Sahi: ${curAyat.surah_name}`);}
  if(rk&&curAyat.ruku_no!==undefined){if(parseInt(rk)===curAyat.ruku_no)opt++;else parts.push(`❌ Ruku Galat! Sahi: ${curAyat.ruku_no}`);}
  if(ay&&curAyat.ayat_no!==undefined){if(parseInt(ay)===curAyat.ayat_no)opt++;else parts.push(`❌ Ayat Galat! Sahi: ${curAyat.ayat_no}`);}
  const ok=pOk&&(pip?pipOk:true); sessionTotal++;
  if(ok){
    score++;sessionCorrect++;surahC[curAyat.surah_name]=(surahC[curAyat.surah_name]||0)+1;
    timeArr.push(ts);
    const earned=calcCoins(ts,opt,hints,mode==='survival');
    const spd=ts<=5?'⚡ Super Fast!':ts<=10?'🏃 Fast!':ts<=20?'👍 Good':'🐢 Slow';
    addCoinsToFirestore(earned,1,1);
    let msg=`✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span><br><small style="color:var(--text-muted)">${spd} (${ts}s)`;
    if(opt>0)msg+=` | +${opt*5}🪙 optional`;if(hints>0)msg+=` | -${hints*5}🪙 hint`;
    msg+=`</small>`;
    showRes(msg,true);
    if(sessionCorrect%10===0){toast(`🔥 ${sessionCorrect} sahi! +50🪙 streak!`,'success',3000);addCoinsToFirestore(50,0,0);}
  } else {
    if(sessionTotal>0)addCoinsToFirestore(0,0,1);
    showRes(parts.join('<br>')||'❌ Galat!',false);
    if(mode==='survival'){
      survOn=false;
      const sa=$('survivalAnswer');
      if(sa){sa.innerHTML=`<b>Sahi Jawab:</b><br>Surah: <b>${curAyat.surah_name}</b> | Para: <b>${ap}</b> | Page: <b>${pn}</b> | PiP: <b>${aip-1}</b>`;sa.classList.remove('hidden');}
      setTimeout(endQuiz,2200);return;
    }
  }
  $('nextBtn')?.classList.remove('hidden'); updateQuizStats(); hints=0; startAutoNext();
}

function startAutoNext() {
  if(_autoNextTmr)clearInterval(_autoNextTmr);
  let cd=5; const nb=$('nextBtn');
  if(nb)nb.textContent=`➡️ Agla Sawal (${cd}s)`;
  _autoNextTmr=setInterval(()=>{ cd--;if(nb)nb.textContent=cd>0?`➡️ Agla Sawal (${cd}s)`:'➡️ Agla Sawal';if(cd<=0){clearInterval(_autoNextTmr);_autoNextTmr=null;nextQ();} },1000);
}
function showRes(msg,ok){const d=$('quizResult');if(!d)return;d.innerHTML=msg;d.className=ok?'result':'error';d.classList.remove('hidden');if(ok)setTimeout(()=>d.classList.add('hidden'),5000);}
function showErr(msg){const e=$('quizError');if(!e)return;e.textContent=msg;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2500);}
function showHint(){if(hints>=MAX_H)return;hints++;const hi=$('hintInfo');if(hi)hi.textContent=`Hint: ${hints}/${MAX_H}`;const hb=$('hintBtn');if(hb&&hints>=MAX_H)hb.disabled=true;const ap=((parseInt(curAyat.page)-1)/20|0)+1;const s2=curAyat.surah_name.split(' ').slice(0,2).join(' ');const e=$('quizError');if(!e)return;e.innerHTML=`💡 <b>Hint (-5🪙):</b> Surah: <b>${s2}...</b>, Para: <b>${ap}</b>`;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),3500);}
function endQuiz(){
  if(qTmr)clearInterval(qTmr);if(_autoNextTmr){clearInterval(_autoNextTmr);_autoNextTmr=null;}
  const avg=timeArr.length?Math.round(timeArr.reduce((a,b)=>a+b,0)/timeArr.length):0;
  const fast=timeArr.length?Math.min(...timeArr):0;
  const acc=sessionTotal>0?Math.round((sessionCorrect/sessionTotal)*100):0;
  let best='',mx=0;Object.entries(surahC).forEach(([s,c])=>{if(c>mx){mx=c;best=s;}});
  const spd=avg<=8?'⚡ Speed Master':avg<=15?'🏃 Quick Player':'📚 Careful Reader';
  const fr=$('finalResult');
  if(fr)fr.innerHTML=`<div class="result-grid"><div class="result-item"><span class="ri-icon">🧠</span><span class="ri-val">${score}/${qIdx}</span><span class="ri-lbl">Score</span></div><div class="result-item"><span class="ri-icon">🎯</span><span class="ri-val">${acc}%</span><span class="ri-lbl">Accuracy</span></div><div class="result-item"><span class="ri-icon">⏱️</span><span class="ri-val">${avg}s</span><span class="ri-lbl">Avg Speed</span></div><div class="result-item"><span class="ri-icon">⚡</span><span class="ri-val">${fast}s</span><span class="ri-lbl">Fastest</span></div><div class="result-item result-item-wide"><span class="ri-icon">🪙</span><span class="ri-val">${(curData?.coins||0).toLocaleString()}</span><span class="ri-lbl">Total Coins</span></div><div class="result-item result-item-wide"><span class="ri-icon">📖</span><span class="ri-val" style="font-size:.95rem">${best||'—'}</span><span class="ri-lbl">Best Surah</span></div></div><div class="speed-badge">${spd}</div><div style="margin-top:8px;color:var(--text-muted);font-size:.85rem">${mode==='survival'&&!survOn?'💥 Survival Khatam!':'🎉 Mubarak!'}</div>`;
  showScreen('resultScreen');
}
function resetGame(home){
  qIdx=0;score=0;usedI=[];surahC={};timeArr=[];hints=0;survOn=true;sessionCorrect=0;sessionTotal=0;
  if(qTmr)clearInterval(qTmr);if(_autoNextTmr){clearInterval(_autoNextTmr);_autoNextTmr=null;}
  $('hintBtn')&&($('hintBtn').disabled=false);
  $('hintInfo')&&($('hintInfo').textContent=`Hint: 0/${MAX_H}`);
  showScreen(home?'welcomeScreen':'paraSelectScreen');
}

// ═══════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════
function rmD(t){return t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,'');}
function doSearch(e){
  if(e)e.preventDefault();
  const inp=$('searchInput');if(!inp)return;
  const q=rmD(inp.value.trim().toLowerCase()), rd=$('searchResults');if(!rd)return;
  if(!q){rd.innerHTML='<em>Kuch likhein...</em>';return;}
  if(!quranData.length){rd.innerHTML='<em>Data load ho raha hai...</em>';return;}
  const found=quranData.filter(a=>rmD(a.text.toLowerCase()).includes(q)||rmD(a.surah_name.toLowerCase()).includes(q)||String(a.page)===q||String(((a.page-1)/20|0)+1)===q).slice(0,30);
  if(!found.length){rd.innerHTML='<b>Koi result nahi mila.</b>';return;}
  const hl=t=>t.split(/(\s+)/).map(w=>rmD(w.toLowerCase())===q?`<mark>${w}</mark>`:w).join('');
  rd.innerHTML=found.map(r=>{const ap=((r.page-1)/20|0)+1;return`<div class="search-result" onclick="window.open('https://quran.com/page/${r.page}','_blank')"><b>Ayat:</b> ${hl(r.text)}<br><b>Surah:</b> ${hl(r.surah_name)} | <b>Page:</b> ${r.page} | <b>Para:</b> ${ap}<span style="float:right;color:#aad">🔗</span></div>`;}).join('');
}

// ═══════════════════════════════════════════
//  COIN PARTICLE SYSTEM (Carrom Pool Style)
// ═══════════════════════════════════════════

/**
 * spawnCoinParticles(fromRect, toRect, count)
 * Animates 🪙 coins flying from one element to another.
 */
function spawnCoinParticles(fromEl, toEl, count = 18) {
  if (!fromEl || !toEl) return;
  const fR = fromEl.getBoundingClientRect();
  const tR = toEl.getBoundingClientRect();
  const startX = fR.left + fR.width  / 2;
  const startY = fR.top  + fR.height / 2;
  const endX   = tR.left + tR.width  / 2;
  const endY   = tR.top  + tR.height / 2;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'coin-particle';
    p.textContent = '🪙';
    const sz = 12 + Math.random() * 12;
    p.style.cssText = `
      position:fixed;
      left:${startX}px;top:${startY}px;
      font-size:${sz}px;
      transform:translate(-50%,-50%);
      pointer-events:none;
      z-index:99997;
      opacity:1;
      will-change:transform,opacity;
    `;
    document.body.appendChild(p);

    const delay = Math.random() * 250;
    const spread = (Math.random() - 0.5) * 120;
    const arc    = -(Math.random() * 80 + 40); // upward arc
    const dur    = 500 + Math.random() * 400;

    setTimeout(() => {
      const dx = endX - startX + spread;
      const dy = endY - startY;
      // Two-step animation: arc up then land
      p.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(calc(-50% + ${dx*0.4}px), calc(-50% + ${arc}px)) scale(1.2)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4)`, opacity: 0, offset: 1 }
      ], {
        duration: dur,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      }).onfinish = () => p.remove();
    }, delay);
  }
}

// Match start: coins from both player boxes toward VS center
function triggerMatchStartParticles() {
  const myBox  = $('myPlayerBox');
  const oppBox = $('oppPlayerBox');
  const vsEl   = $('matchVsEl');
  if (!vsEl) return;
  setTimeout(() => {
    spawnCoinParticles(myBox,  vsEl, 14);
    setTimeout(() => spawnCoinParticles(oppBox, vsEl, 14), 120);
  }, 400);
}

// Victory: coins from result icon to header coin balance
function triggerVictoryParticles() {
  const fromEl = $('matchResultIcon');
  const toEl   = $('hdrCoins');
  if (!fromEl || !toEl) return;
  // Staggered bursts
  spawnCoinParticles(fromEl, toEl, 20);
  setTimeout(() => spawnCoinParticles(fromEl, toEl, 15), 300);
  setTimeout(() => spawnCoinParticles(fromEl, toEl, 10), 600);
}

// ═══════════════════════════════════════════
//  ONLINE MATCHMAKING — UPGRADED
//
//  RTDB Match Node Structure:
//  matches/{tableKey}/{matchId}/
//    status: 'waiting' | 'active' | 'sudden_death' | 'finished'
//    table:   String
//    totalQ:  Number
//    questionPool: Number[]   ← shared array of ayat indices
//    p1: { uid, name, score, qIdx, connected }
//    p2: { uid, name, score, qIdx, connected }
//    winner: '' | 'p1' | 'p2'
//    createdAt: timestamp
// ═══════════════════════════════════════════
const TABLES = {
  starter: { name:'🪵 Starter', fee:200,  totalQ:7,  firstTo:4, winCoins:400   },
  bronze:  { name:'🥉 Bronze',  fee:500,  totalQ:9,  firstTo:5, winCoins:1000  },
  silver:  { name:'🥈 Silver',  fee:1000, totalQ:11, firstTo:6, winCoins:2000  },
  gold:    { name:'🥇 Gold',    fee:2500, totalQ:13, firstTo:7, winCoins:5000  },
  diamond: { name:'💎 Diamond', fee:5000, totalQ:15, firstTo:8, winCoins:10000 },
};

// Pool extras beyond totalQ for sudden-death questions
const POOL_EXTRA = 20;

function freshMatchState() {
  return {
    tableKey: null, matchId: null, myRole: null,
    opponentName: null,
    myScore: 0, oppScore: 0,
    myQIdx: 0,             // my current position in questionPool
    currentAyatIndex: -1,
    answered: false,
    feeDeducted: false,
    inSuddenDeath: false,
    waitTimer: null, matchTimerInterval: null, autoCancel: null,
    disconnectGraceTimer: null,
    listeners: []
  };
}
let MS = freshMatchState();

// ── Build a unique random question pool ──
function buildQuestionPool(size) {
  if (!quranData.length) return [];
  const used = new Set(), pool = [];
  let attempts = 0;
  while (pool.length < size && attempts < size * 10) {
    const idx = Math.floor(Math.random() * quranData.length);
    if (!used.has(idx)) { used.add(idx); pool.push(idx); }
    attempts++;
  }
  return pool;
}

// ── Lobby ──
function openOnlineLobby() {
  if (!curUser || curUser.isAnonymous) {
    toast('❌ Login karo pehle!','error'); showScreen('authScreen'); return;
  }
  loadQuran();
  const coins = curData?.coins || 0;
  const li = $('lobbyCoinsInfo');
  if (li) li.textContent = `Aapke paas: 🪙 ${coins.toLocaleString()} — Table chuniye!`;

  const locked=$('onlineLocked'), grid=$('tablesGrid');
  if (locked) locked.classList.add('hidden');
  if (grid)   grid.style.opacity = '1';

  Object.entries(TABLES).forEach(([key, t]) => {
    const id = `join${key.charAt(0).toUpperCase()+key.slice(1)}`;
    const btn = $(id);
    if (!btn) return;
    if (coins < t.fee) {
      btn.disabled = true;
      btn.textContent = `🔒 ${t.fee}🪙`;
    } else {
      btn.disabled = false;
      btn.textContent = 'Join';
    }
  });
  showScreen('onlineLobbyScreen');
}

// ── Join table ──
async function joinTable(tableKey) {
  if (!curUser || !curData) { toast('❌ Login karein!','error'); return; }
  if (!_isConnected)        { toast('❌ Internet check karein!','error'); return; }

  const table = TABLES[tableKey];
  const coins = curData.coins || 0;
  if (coins < table.fee) { toast(`❌ ${table.fee}🪙 chahiye!`,'error'); return; }

  if (!quranData.length) {
    toast('⏳ Data load ho raha hai...','info');
    await loadQuran();
    if (!quranData.length) { toast('❌ Quran data load nahi hua!','error'); return; }
  }

  MS = freshMatchState();
  MS.tableKey = tableKey;
  MS.feeDeducted = true;

  try {
    await updateDoc(doc(db,'users',curUser.uid), { coins: increment(-table.fee) });
  } catch(e) {
    toast('❌ Coins deduct error. Try again.','error'); return;
  }

  showScreen('matchWaitScreen');
  const wi=$('matchWaitInfo'); if(wi) wi.textContent = table.name;
  const wt=$('matchWaitTimer'); if(wt) wt.textContent = '0s';

  const waitStart = Date.now();
  MS.waitTimer = setInterval(() => {
    const el=$('matchWaitTimer');
    if(el) el.textContent = `${Math.floor((Date.now()-waitStart)/1000)}s`;
  }, 500);

  await findOrCreateMatch(tableKey);
}

// ── Core matchmaking (transaction-safe, no self-match) ──
async function findOrCreateMatch(tableKey) {
  const qRef = ref(rtdb, `queues/${tableKey}`);
  let asP2 = false, p2MatchId = null, oppData = null;

  try {
    await runTransaction(qRef, current => {
      if (!current) {
        return { uid: curUser.uid, username: curData.username||'Player', matchId: '', ts: Date.now() };
      }
      if (current.uid === curUser.uid) {
        return { uid: curUser.uid, username: curData.username||'Player', matchId: '', ts: Date.now() };
      }
      asP2 = true; p2MatchId = current.matchId; oppData = current;
      return; // don't modify queue — P2 removes it after joining
    });
  } catch(e) {
    console.error('Queue tx error:', e);
    await doRefund();
    toast('❌ Matchmaking error. Dobara try karein.','error');
    showScreen('onlineLobbyScreen'); return;
  }

  if (asP2) {
    // ── P2 Path ──
    let tries = 0;
    while ((!p2MatchId || p2MatchId==='') && tries < 16) {
      await sleep(500);
      try {
        const snap = await get(qRef);
        if (!snap.exists()) { p2MatchId = null; break; }
        const mid = snap.val()?.matchId;
        if (mid && mid !== '') p2MatchId = mid;
      } catch(e) {}
      tries++;
    }

    if (!p2MatchId) {
      await doRefund();
      toast('❌ Match nahi mila. Dobara try karein.','error');
      showScreen('onlineLobbyScreen'); return;
    }

    try { await remove(qRef); } catch(e) {}

    MS.matchId = p2MatchId;
    MS.myRole  = 'p2';
    MS.opponentName = oppData?.username || 'Player';
    await p2JoinMatch(p2MatchId, tableKey);

  } else {
    // ── P1 Path ──
    let matchId;
    try {
      matchId = push(ref(rtdb, `matches/${tableKey}`)).key;
      MS.matchId = matchId;
      MS.myRole  = 'p1';

      const tbl = TABLES[tableKey];

      await set(ref(rtdb, `matches/${tableKey}/${matchId}`), {
        status: 'waiting', table: tableKey,
        totalQ: tbl.totalQ,
        questionPool: [], // P2 will populate this
        p1: { uid: curUser.uid, name: curData.username||'Player', score: 0, qIdx: 0, connected: true },
        p2: { uid: '', name: '', score: 0, qIdx: 0, connected: false },
        winner: '',
        createdAt: Date.now()
      });
      await update(qRef, { matchId });
    } catch(e) {
      console.error('P1 match create error:', e);
      await doRefund();
      toast('❌ Match create error.','error');
      showScreen('onlineLobbyScreen'); return;
    }

    p1WaitForOpponent(tableKey, matchId);

    MS.autoCancel = setTimeout(async () => {
      try {
        const snap = await get(ref(rtdb, `matches/${tableKey}/${matchId}`));
        if (snap.exists() && snap.val().status === 'waiting') {
          leaveMatchCleanup(false);
          await doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!','info',4000);
          showScreen('onlineLobbyScreen');
        }
      } catch(e) {}
    }, 60000);
  }
}

// P1 listens for P2 to join
function p1WaitForOpponent(tableKey, matchId) {
  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap => {
    if (!snap.exists()) return;
    const d = snap.val();
    if (d.status === 'active' && d.p2?.uid) {
      off(mRef);
      MS.opponentName = d.p2.name;
      startOnlineMatch(tableKey, matchId, d);
    }
  }, err => console.warn('P1 wait error:', err.message));
  MS.listeners.push({ ref: mRef });
}

// P2 joins match AND generates the shared question pool
async function p2JoinMatch(matchId, tableKey) {
  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);

  let snap;
  try { snap = await get(mRef); } catch(e) {
    await doRefund(); toast('❌ Match data error.','error'); showScreen('onlineLobbyScreen'); return;
  }
  if (!snap.exists()) {
    await doRefund(); toast('❌ Match cancel ho gaya.','error'); showScreen('onlineLobbyScreen'); return;
  }
  if (snap.val().status !== 'waiting') {
    await doRefund(); toast('❌ Match pehle se shuru.','error'); showScreen('onlineLobbyScreen'); return;
  }

  // Generate shared question pool (totalQ + POOL_EXTRA for sudden death)
  const tbl = TABLES[tableKey];
  const poolSize = tbl.totalQ + POOL_EXTRA;
  const questionPool = buildQuestionPool(poolSize);

  try {
    await update(mRef, {
      status: 'active',
      questionPool,
      'p2/uid':       curUser.uid,
      'p2/name':      curData.username||'Player',
      'p2/score':     0,
      'p2/qIdx':      0,
      'p2/connected': true
    });
  } catch(e) {
    await doRefund(); toast('❌ Match join error.','error'); showScreen('onlineLobbyScreen'); return;
  }

  const finalSnap = await get(mRef);
  if (finalSnap.exists()) startOnlineMatch(tableKey, matchId, finalSnap.val());
}

// ── Main match screen — INDEPENDENT FLOW ──
function startOnlineMatch(tableKey, matchId, initData) {
  clearInterval(MS.waitTimer);
  clearTimeout(MS.autoCancel);
  MS.autoCancel  = null;
  MS.feeDeducted = false;
  MS.myQIdx      = 0;
  MS.inSuddenDeath = false;

  showScreen('onlineMatchScreen');
  hideOpponentWaitPopup();
  hideDisconnectGracePopup();
  hideSuddenDeathBanner();

  const n1=$('myName'), n2=$('oppName'), s1=$('myScore'), s2=$('oppScore');
  if(n1) n1.textContent = curData?.username||'Player';
  if(n2) n2.textContent = MS.opponentName||'Opponent';
  if(s1) s1.textContent = '0';
  if(s2) s2.textContent = '0';

  // Set up RTDB presence & disconnect signal
  if (MS.matchId && MS.tableKey && MS.myRole) {
    const myConnRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/${MS.myRole}/connected`);
    set(myConnRef, true).catch(()=>{});
    rtdbOnDisconnect(myConnRef).set(false).catch(()=>{});
  }

  // Load first question immediately from the shared pool
  const pool = initData.questionPool || [];
  if (pool.length > 0) {
    MS.currentAyatIndex = pool[0];
    showMatchQuestion(pool[0], 1, TABLES[tableKey].totalQ);
  }

  // Trigger match-start coin explosion animation
  triggerMatchStartParticles();

  // ── Main RTDB listener ──
  const mRef = ref(rtdb, `matches/${tableKey}/${matchId}`);
  const unsub = onValue(mRef, snap => {
    if (!snap.exists()) {
      // Node deleted externally — opponent left or admin cleared
      handleMatchEnd(false, 'opponent_left');
      return;
    }
    const d   = snap.val();
    const tbl = TABLES[tableKey];
    const isP1 = MS.myRole === 'p1';
    const myD  = isP1 ? d.p1 : d.p2;
    const opD  = isP1 ? d.p2 : d.p1;

    // ── Real-time scoreboard update ──
    const ms1=$('myScore'), ms2=$('oppScore');
    if(ms1) ms1.textContent = myD?.score || 0;
    if(ms2) ms2.textContent = opD?.score || 0;
    MS.myScore  = myD?.score  || 0;
    MS.oppScore = opD?.score  || 0;

    // ── Opponent disconnect detection ──
    const oppConnected = opD?.connected;
    if (oppConnected === false && !MS.disconnectGraceTimer) {
      showDisconnectGracePopup(5);
      MS.disconnectGraceTimer = setTimeout(async () => {
        try {
          const freshSnap = await get(mRef);
          if (!freshSnap.exists()) return;
          const currD = freshSnap.val();
          const freshOpD = isP1 ? currD.p2 : currD.p1;
          if (freshOpD?.connected === false) {
            // Still disconnected after grace period → auto-win
            handleMatchEnd(true, 'opponent_left');
          } else {
            // Reconnected
            MS.disconnectGraceTimer = null;
            hideDisconnectGracePopup();
          }
        } catch(e) { MS.disconnectGraceTimer = null; }
      }, 5000);
    } else if (oppConnected === true && MS.disconnectGraceTimer) {
      // Opponent reconnected
      clearTimeout(MS.disconnectGraceTimer);
      MS.disconnectGraceTimer = null;
      hideDisconnectGracePopup();
    }

    // ── Match already finished (winner set) ──
    if (d.winner && d.status === 'finished') {
      handleMatchEnd(d.winner === MS.myRole);
      return;
    }

    // ── Win condition: first to firstTo ──
    if (MS.myScore  >= tbl.firstTo) { handleMatchEnd(true);  return; }
    if (MS.oppScore >= tbl.firstTo) { handleMatchEnd(false); return; }

    // ── Check sudden death trigger ──
    const myDone  = (myD?.qIdx  || 0) >= tbl.totalQ;
    const oppDone = (opD?.qIdx  || 0) >= tbl.totalQ;

    if (myDone && oppDone && d.status === 'active') {
      if (MS.myScore > MS.oppScore) { handleMatchEnd(true);  return; }
      if (MS.myScore < MS.oppScore) { handleMatchEnd(false); return; }
      // Equal scores → Sudden Death
      if (!MS.inSuddenDeath) {
        MS.inSuddenDeath = true;
        // Only P2 writes the status change to avoid race
        if (MS.myRole === 'p2') {
          update(mRef, { status: 'sudden_death' }).catch(()=>{});
        }
        enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
      }
      return;
    }

    if (d.status === 'sudden_death' && !MS.inSuddenDeath) {
      MS.inSuddenDeath = true;
      enterSuddenDeath(d.questionPool, myD?.qIdx || 0);
      return;
    }

    // ── Independent question advancement ──
    const newMyQIdx = myD?.qIdx || 0;
    if (newMyQIdx !== MS.myQIdx && d.questionPool && d.questionPool[newMyQIdx] !== undefined) {
      MS.myQIdx = newMyQIdx;
      MS.currentAyatIndex = d.questionPool[newMyQIdx];
      if (!MS.inSuddenDeath) {
        showMatchQuestion(d.questionPool[newMyQIdx], newMyQIdx + 1, tbl.totalQ);
      }
    }
  }, err => console.warn('Match listener err:', err.message));

  MS.listeners.push({ ref: mRef });
}

// ── Sudden Death ──
function enterSuddenDeath(pool, currentQIdx) {
  showSuddenDeathBanner();
  const sdAyatIdx = pool ? pool[currentQIdx] : undefined;
  if (sdAyatIdx !== undefined) {
    MS.currentAyatIndex = sdAyatIdx;
    const mp=$('matchProgress');
    if(mp) mp.innerHTML=`<span class="sd-label">⚡ SUDDEN DEATH</span>`;
    showMatchQuestion(sdAyatIdx, null, null, true);
  }
}

// ── Display question ──
function showMatchQuestion(ayatIndex, qNum, totalQuestions, isSuddenDeath = false) {
  if (!quranData[ayatIndex]) { console.warn('ayatIndex invalid:', ayatIndex); return; }

  MS.answered = false;
  const ayat = quranData[ayatIndex];

  if (!isSuddenDeath) {
    const mp=$('matchProgress');
    if(mp) mp.textContent = qNum && totalQuestions ? `Sawal ${qNum} / ${totalQuestions}` : `Sawal ${qNum}`;
  }

  const el=$('matchAyatText'); if(el) el.textContent = ayat.text;
  $('matchAnswerForm')?.reset();
  const cb=$('matchCheckBtn'); if(cb) cb.disabled=false;
  const mr=$('matchResult'); if(mr){ mr.classList.add('hidden'); mr.textContent=''; }

  startMatchTimer(30);
}

// ── Match timer ──
function startMatchTimer(sec) {
  if (MS.matchTimerInterval) clearInterval(MS.matchTimerInterval);
  let t = sec;
  const fill=$('matchTimerFill'), txt=$('matchTimer');
  if(fill) fill.style.width='100%';
  if(txt)  txt.textContent=`${t}s`;
  MS.matchTimerInterval = setInterval(() => {
    t--;
    if(fill) fill.style.width=`${(t/sec)*100}%`;
    if(txt)  txt.textContent=`${t}s`;
    if(t<=0){
      clearInterval(MS.matchTimerInterval);
      if(!MS.answered) submitMatchAnswer(true);
    }
  },1000);
}

// ── Submit answer — INDEPENDENT FLOW ──
async function submitMatchAnswer(timeOut=false) {
  if (MS.answered) return;
  MS.answered = true;
  clearInterval(MS.matchTimerInterval);
  const cb=$('matchCheckBtn'); if(cb) cb.disabled=true;

  if (timeOut) {
    showMatchMsg('⏱️ Waqt khatam!', false);
    await advanceMyQuestion(false);
    return;
  }

  const para = $('match_para')?.value.trim() || '';
  const pip  = $('match_pip')?.value.trim()  || '';

  if (!para) {
    MS.answered = false;
    if(cb) cb.disabled=false;
    toast('❌ Para zaroori hai!','error'); return;
  }

  if (!quranData[MS.currentAyatIndex]) {
    showMatchMsg('❌ Question data error', false);
    await advanceMyQuestion(false); return;
  }

  const ayat = quranData[MS.currentAyatIndex];
  const pn   = parseInt(ayat.page);
  const ap   = ((pn-1)/20|0)+1;
  const aip  = ((pn-1)%20)+1;
  const pOk  = parseInt(para) === ap;
  const pipOk= pip ? parseInt(pip) === aip-1 : true;

  if (pOk && pipOk) {
    // ── Correct ──
    if (MS.inSuddenDeath) {
      // Sudden death: race to be first correct — use transaction
      const winRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}/winner`);
      const mRef   = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
      let won = false;
      try {
        const txResult = await runTransaction(winRef, current => {
          if (current && current !== '') return; // already has winner
          return MS.myRole;
        });
        won = txResult.committed;
        if (won) {
          await update(mRef, {
            status: 'finished',
            [`${MS.myRole}/score`]: MS.myScore + 1
          });
        }
      } catch(e) { console.warn('SD winner tx err:', e); }
      showMatchMsg(`✅ Sahi! Para: ${ap}`, true);
      if (won) {
        handleMatchEnd(true, 'sudden_death_win');
      } else {
        // Lost the race — opponent was faster
        handleMatchEnd(false, 'sudden_death_loss');
      }
      return;
    }

    // Normal: update own score and advance
    const scoreField = MS.myRole==='p1' ? 'p1/score' : 'p2/score';
    const mRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
    try {
      await update(mRef, { [scoreField]: MS.myScore + 1 });
    } catch(e) { console.warn('Score update err:', e); }
    showMatchMsg(`✅ Sahi! Para: ${ap}${pip?`, PiP: ${aip-1}`:''}`, true);
  } else {
    showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip-1}`, false);
  }

  await advanceMyQuestion(pOk && pipOk);
}

// Advance only THIS player's question index in RTDB
async function advanceMyQuestion(wasCorrect) {
  await sleep(1400);
  const tbl    = TABLES[MS.tableKey];
  const newIdx = MS.myQIdx + 1;
  const qIdxField = MS.myRole==='p1' ? 'p1/qIdx' : 'p2/qIdx';
  const mRef      = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);

  if (!MS.inSuddenDeath && newIdx >= tbl.totalQ) {
    // Mark self as done — listener handles end-of-game logic
    try { await update(mRef, { [qIdxField]: newIdx }); } catch(e) {}
    return;
  }

  try { await update(mRef, { [qIdxField]: newIdx }); } catch(e) { console.warn('AdvanceMyQ err:', e); }
}

function showMatchMsg(msg, ok) {
  const el=$('matchResult'); if(!el) return;
  el.textContent = msg;
  el.className   = ok ? 'result' : 'error';
  el.classList.remove('hidden');
}

// ── Match end ──
function handleMatchEnd(won, reason='') {
  if (MS._ended) return; // prevent double-fire
  MS._ended = true;

  leaveMatchCleanup(false);
  hideOpponentWaitPopup();
  hideDisconnectGracePopup();
  hideSuddenDeathBanner();

  const tbl   = TABLES[MS.tableKey] || {};
  const coins = won ? (tbl.winCoins||0) : 0;

  const ri=$('matchResultIcon');   if(ri) ri.textContent = won?'🏆':'😔';
  const rt=$('matchResultTitle');  if(rt) {
    if (reason==='sudden_death_win')  rt.textContent = '⚡ Sudden Death Jeet!';
    else if (reason==='opponent_left') rt.textContent = '🏆 Opponent Chala Gaya!';
    else rt.textContent = won ? 'Jeet Gaye! 🏆' : 'Haare! 😔';
  }

  let reasonText = '';
  if (reason==='opponent_left')     reasonText = '<div style="color:var(--gold);font-size:0.85rem;margin-top:4px">Opponent ne match chhod diya!</div>';
  if (reason==='sudden_death_win')  reasonText = '<div style="color:#f0c96a;font-size:0.85rem;margin-top:4px">⚡ Pehla sahi jawab — Jeet!</div>';
  if (reason==='sudden_death_loss') reasonText = '<div style="color:var(--text-muted);font-size:0.85rem;margin-top:4px">⚡ Opponent ne pehle sahi jawab diya.</div>';

  const rs=$('matchResultScores');
  if(rs) rs.innerHTML=`<div style="display:flex;justify-content:center;gap:30px;font-size:1.1rem;font-weight:700">
    <span style="color:var(--emerald)">Aap: ${MS.myScore}</span>
    <span style="color:var(--text-muted)">VS</span>
    <span style="color:#ff9090">${MS.opponentName||'Opp'}: ${MS.oppScore}</span>
  </div>${reasonText}`;

  const rc=$('matchResultCoins');
  if(rc) rc.innerHTML = won
    ? `<div style="color:var(--gold);font-size:1.2rem;font-weight:700">+${coins} 🪙 Jeet ki coins!</div>`
    : `<div style="color:var(--text-muted)">Koi coins nahi — agali baar!</div>`;

  if (won && coins>0 && curUser && !curUser.isAnonymous) {
    updateDoc(doc(db,'users',curUser.uid),{coins:increment(coins),totalWins:increment(1)}).catch(()=>{});
    toast(`🏆 Jeet Gaye! +${coins}🪙`,'success',4000);
  }

  // Clean up match node
  if (MS.matchId && MS.tableKey) {
    remove(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`)).catch(()=>{});
  }

  showScreen('matchResultScreen');

  // Trigger victory coin animation for winner
  if (won) {
    setTimeout(triggerVictoryParticles, 400);
  }
}

function leaveMatchCleanup(refund=false) {
  clearInterval(MS.waitTimer);
  clearInterval(MS.matchTimerInterval);
  clearTimeout(MS.autoCancel);
  clearTimeout(MS.disconnectGraceTimer);
  MS.autoCancel = null;
  MS.disconnectGraceTimer = null;
  MS.listeners.forEach(l=>{ try{ if(l&&l.ref) off(l.ref); }catch(e){} });
  MS.listeners = [];
  if (MS.tableKey) {
    remove(ref(rtdb,`queues/${MS.tableKey}`)).catch(()=>{});
    if (MS.matchId && MS.myRole==='p1') {
      remove(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`)).catch(()=>{});
    }
  }
  if (refund) doRefund();
}

async function doRefund() {
  if (!MS.feeDeducted || !curUser || !MS.tableKey) return;
  MS.feeDeducted = false;
  const fee = TABLES[MS.tableKey]?.fee||0;
  if (fee>0) await updateDoc(doc(db,'users',curUser.uid),{coins:increment(fee)}).catch(()=>{});
}

// ── Sudden Death Banner ──
function showSuddenDeathBanner() {
  let el = $('suddenDeathBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'suddenDeathBanner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:8500;display:flex;align-items:center;justify-content:center;padding:12px 16px;background:linear-gradient(135deg,#1a0800,#2a1000);border-bottom:2px solid #d4a84380;animation:sdSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both';
    el.innerHTML = `<style>@keyframes sdSlideIn{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
      <span style="font-size:1.3rem;margin-right:10px">⚡</span>
      <span style="font-family:Cinzel,serif;font-weight:900;font-size:1rem;background:linear-gradient(135deg,#f0c96a,#d4a843);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">SUDDEN DEATH</span>
      <span style="font-size:1.3rem;margin-left:10px">⚡</span>
      <span style="font-size:0.78rem;color:var(--text-muted);margin-left:12px;font-family:Tajawal,sans-serif">Pehla sahi jawab jeetega!</span>`;
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}
function hideSuddenDeathBanner() {
  const el=$('suddenDeathBanner'); if(el) el.style.display='none';
}

// ── Opponent Wait Popup (legacy) ──
function showOpponentWaitPopup() {
  let popup = $('oppWaitPopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'oppWaitPopup';
    popup.style.cssText = 'position:fixed;inset:0;background:rgba(5,15,10,.85);backdrop-filter:blur(8px);z-index:8000;display:flex;align-items:center;justify-content:center;';
    popup.innerHTML = `<div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:2rem">⏳</div>
      <div style="font-family:Cinzel,serif;font-size:1.1rem;color:var(--gold-light)">Opponent ka Intezaar</div>
      <div style="font-size:0.88rem;color:var(--text-muted);font-family:Tajawal,sans-serif">Opponent abhi sawaal submit kar raha hai...</div>
      <div class="match-spinner" style="margin:0 auto"></div>
    </div>`;
    document.body.appendChild(popup);
  }
  popup.style.display = 'flex';
}
function hideOpponentWaitPopup() {
  const p=$('oppWaitPopup'); if(p) p.style.display='none';
}

// ── Disconnect Grace Period Popup ──
function showDisconnectGracePopup(seconds = 5) {
  let popup = $('disconnectGracePopup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'disconnectGracePopup';
    popup.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,#1a0808,#100404);
      border:1px solid #c4293b60;border-radius:16px;
      padding:16px 24px;text-align:center;
      max-width:320px;width:90vw;z-index:9500;
      box-shadow:0 0 30px #c4293b30;
      animation:graceSlide 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
    `;
    document.head.insertAdjacentHTML('beforeend',`<style>@keyframes graceSlide{from{opacity:0;transform:translateX(-50%) translateY(60px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>`);
    document.body.appendChild(popup);
  }
  let countdown = seconds;
  popup.innerHTML = `
    <div style="font-size:1.8rem;margin-bottom:6px">📡</div>
    <div style="font-family:Cinzel,serif;color:var(--gold-light);font-size:0.95rem;margin-bottom:4px">Opponent Disconnect!</div>
    <div id="graceCountdownTxt" style="font-size:0.85rem;color:var(--text-muted);font-family:Tajawal,sans-serif">
      ${countdown}s intezaar karo...
    </div>
  `;
  popup.style.display = 'flex';
  popup.style.flexDirection = 'column';
  const interval = setInterval(() => {
    countdown--;
    const txt = $('graceCountdownTxt');
    if (txt) {
      if (countdown > 0) txt.textContent = `${countdown}s intezaar karo...`;
      else txt.textContent = 'Match khatam kar raha hai...';
    }
    if (countdown <= 0) clearInterval(interval);
  }, 1000);
  popup._interval = interval;
}
function hideDisconnectGracePopup() {
  const p=$('disconnectGracePopup');
  if(p){
    clearInterval(p._interval);
    p.style.display='none';
  }
}

// ── Exit match confirm ──
function showExitConfirm() {
  const m=$('exitMatchModal'); if(m) m.style.display='flex';
}
function hideExitConfirm() {
  const m=$('exitMatchModal'); if(m) m.style.display='none';
}

// ═══════════════════════════════════════════
//  FRIENDS SYSTEM
// ═══════════════════════════════════════════
async function openFriendsScreen() {
  if (!curUser||curUser.isAnonymous){toast('❌ Login karo!','error');showScreen('authScreen');return;}
  showScreen('friendsScreen');
  await loadFriendsList();
}

async function loadFriendsList() {
  const listEl=$('friendsList'), pendEl=$('pendingList'), pendLabel=$('pendingLabel');
  if(!listEl)return;
  listEl.innerHTML='<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Loading...</div>';
  try {
    const snap=await getDoc(doc(db,'users',curUser.uid));
    if(!snap.exists()){listEl.innerHTML='<div style="color:#ff9090;text-align:center;padding:16px">Data nahi mila.</div>';return;}
    const data=snap.data();
    const friends=data.friends||[], pending=data.friendRequests||[];

    if(!friends.length){
      listEl.innerHTML='<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Abhi koi dost nahi — UID se add karein!</div>';
    } else {
      const fDocs=await Promise.all(friends.map(uid=>getDoc(doc(db,'users',uid)).catch(()=>null)));
      listEl.innerHTML=fDocs.map((fd,i)=>{
        if(!fd||!fd.exists())return'';
        const d=fd.data();
        return`<div class="friend-card">
          <div class="friend-avatar">👤</div>
          <div class="friend-info">
            <div class="friend-name">${esc(d.username||'Player')}</div>
            <div class="friend-uid">🆔 ${(d.uid||'').substring(0,16)}...</div>
          </div>
          <button class="friend-action-btn unfriend-btn" onclick="unfriendUser('${friends[i]}','${esc(d.username||'Player')}')">🗑️</button>
        </div>`;
      }).filter(Boolean).join('')||'<div style="color:var(--text-muted);text-align:center;padding:12px">Koi data nahi</div>';
    }

    if(!pending.length){
      if(pendEl)pendEl.innerHTML='';
      if(pendLabel)pendLabel.style.display='none';
    } else {
      if(pendLabel)pendLabel.style.display='block';
      const pDocs=await Promise.all(pending.map(uid=>getDoc(doc(db,'users',uid)).catch(()=>null)));
      if(pendEl)pendEl.innerHTML=pDocs.map((pd,i)=>{
        if(!pd||!pd.exists())return'';
        const d=pd.data();
        return`<div class="friend-card">
          <div class="friend-avatar">👤</div>
          <div class="friend-info">
            <div class="friend-name">${esc(d.username||'Player')}</div>
            <div class="friend-uid" style="color:var(--gold)">📩 Friend request bheja</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="friend-action-btn accept-btn" onclick="acceptFriend('${pending[i]}','${esc(d.username||'Player')}')">✅ Accept</button>
            <button class="friend-action-btn reject-btn" onclick="rejectFriend('${pending[i]}')">❌</button>
          </div>
        </div>`;
      }).filter(Boolean).join('');
    }
  } catch(e){
    console.error('loadFriendsList:',e);
    listEl.innerHTML=`<div style="color:#ff9090;text-align:center;padding:16px;font-size:0.85rem">Error: ${e.message}</div>`;
  }
}

async function searchUserByUID() {
  if(!curUser||curUser.isAnonymous)return;
  const input=$('friendUidInput'), msgEl=$('addFriendMsg'), preview=$('friendSearchPreview');
  if(!input||!msgEl)return;

  const uid=input.value.trim();
  if(!uid){setMsg('addFriendMsg','❌ UID likhein!');if(preview)preview.innerHTML='';return;}
  if(uid===curUser.uid){setMsg('addFriendMsg','❌ Apni khud ki UID nahi add kar sakte!');if(preview)preview.innerHTML='';return;}

  setMsg('addFriendMsg','⏳ Dhoondh raha hoon...','success');
  if(preview)preview.innerHTML='';

  try {
    const targetSnap=await getDoc(doc(db,'users',uid));
    if(!targetSnap.exists()){
      setMsg('addFriendMsg','❌ Koi user nahi mila is UID se.');
      if(preview)preview.innerHTML='';
      return;
    }
    const td=targetSnap.data();

    const mySnap=await getDoc(doc(db,'users',curUser.uid));
    const myFriends=mySnap.exists()?(mySnap.data().friends||[]):[];
    const alreadyFriends=myFriends.includes(uid);

    const theirRequests=td.friendRequests||[];
    const alreadySent=theirRequests.includes(curUser.uid);

    setMsg('addFriendMsg','✅ User mila!','success');

    if(preview){
      preview.innerHTML=`<div class="friend-preview-card">
        <div class="friend-preview-avatar">👤</div>
        <div class="friend-preview-info">
          <div class="friend-preview-name">${esc(td.username||'Player')}</div>
          <div class="friend-preview-stats">
            🎯 ${td.accuracy||0}% accuracy &nbsp;|&nbsp; 🎮 ${td.totalGames||0} games
          </div>
          <div class="friend-preview-uid">🆔 ${uid.substring(0,20)}...</div>
        </div>
        ${alreadyFriends
          ? `<div style="color:var(--emerald);font-size:0.82rem;font-family:Tajawal,sans-serif;font-weight:700">✅ Dost hain</div>`
          : alreadySent
          ? `<div style="color:var(--gold);font-size:0.82rem;font-family:Tajawal,sans-serif">⏳ Request bhej di</div>`
          : `<button class="btn btn-primary" onclick="sendFriendRequest('${uid}','${esc(td.username||'Player')}')" style="padding:8px 16px;font-size:0.88rem;width:auto">➕ Add Karo</button>`
        }
      </div>`;
    }
  } catch(e){
    console.error('searchUser:',e);
    setMsg('addFriendMsg',`❌ Error: ${e.message}`);
  }
}

window.sendFriendRequest = async function(uid, name) {
  try {
    await updateDoc(doc(db,'users',uid),{friendRequests:arrayUnion(curUser.uid)});
    toast(`✅ Request bhej di: ${name}!`,'success');
    const preview=$('friendSearchPreview');
    if(preview){
      const btn=preview.querySelector('button');
      if(btn) btn.outerHTML=`<div style="color:var(--gold);font-size:0.82rem;font-family:Tajawal,sans-serif">⏳ Request bhej di</div>`;
    }
    setMsg('addFriendMsg','✅ Friend request bhej di!','success');
  } catch(e){
    toast('❌ Request bhejne mein error: '+e.message,'error');
  }
};

window.unfriendUser = async function(fUid, name) {
  if(!curUser)return;
  if(!confirm(`${name} ko unfriend karein?`))return;
  try {
    await updateDoc(doc(db,'users',curUser.uid),{friends:arrayRemove(fUid)});
    await updateDoc(doc(db,'users',fUid),{friends:arrayRemove(curUser.uid)});
    toast(`🗑️ ${name} unfriend ho gaya.`,'info');
    await loadFriendsList();
  } catch(e){toast('❌ Unfriend error: '+e.message,'error');}
};

window.acceptFriend = async function(fromUid, name) {
  if(!curUser)return;
  try {
    await updateDoc(doc(db,'users',curUser.uid),{friends:arrayUnion(fromUid),friendRequests:arrayRemove(fromUid)});
    await updateDoc(doc(db,'users',fromUid),{friends:arrayUnion(curUser.uid)});
    toast(`✅ ${name} ab aapka dost hai!`,'success');
    await loadFriendsList();
  } catch(e){toast('❌ Accept error: '+e.message,'error');}
};

window.rejectFriend = async function(fromUid) {
  if(!curUser)return;
  try {
    await updateDoc(doc(db,'users',curUser.uid),{friendRequests:arrayRemove(fromUid)});
    toast('Request reject kar di.','info');
    await loadFriendsList();
  } catch(e){toast('❌ Reject error.','error');}
};

// ═══════════════════════════════════════════
//  HIDDEN TASBEEH — DOUBLE REWARDS ON CLOSE
// ═══════════════════════════════════════════
let _tasbeehClicks=0, _tasbeehTimer=null, _tasbeehCount=0, _tasbeehText='سُبْحَانَ اللَّهِ';
let _tasbeehSavedAt=0; // last count already saved to Firestore

function setupTasbeeh(){
  const trigger=$('hiddenTasbeehTrigger');
  if(!trigger)return;
  trigger.addEventListener('click',()=>{
    _tasbeehClicks++;
    clearTimeout(_tasbeehTimer);
    _tasbeehTimer=setTimeout(()=>{_tasbeehClicks=0;},2000);
    if(_tasbeehClicks>=7){_tasbeehClicks=0;clearTimeout(_tasbeehTimer);openTasbeeh();}
  });
  document.querySelectorAll('.tasbeeh-type-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tasbeeh-type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _tasbeehText=btn.dataset.text;
      const ta=$('tasbeehArabic');if(ta)ta.textContent=_tasbeehText;
    });
  });
  on('tasbeehTap','click',()=>{
    _tasbeehCount++;
    const tc=$('tasbeehCount');
    if(tc){tc.textContent=_tasbeehCount;tc.classList.remove('tasbeeh-pulse');void tc.offsetWidth;tc.classList.add('tasbeeh-pulse');}
    if(navigator.vibrate)navigator.vibrate(30);
    if(_tasbeehCount===33)toast('✨ 33 — SubhanAllah!','success',2000);
    if(_tasbeehCount===99)toast('🌟 99 — Alhamdulillah!','success',2000);
    if(_tasbeehCount===100)toast('💯 100 — MashaAllah!','success',2500);
  });
  on('tasbeehReset','click',()=>{
    _tasbeehCount=0;
    _tasbeehSavedAt=0;
    const tc=$('tasbeehCount');if(tc)tc.textContent='0';
  });
  on('tasbeehClose','click',closeTasbeeh);
}

function openTasbeeh(){
  _tasbeehSavedAt = 0; // reset the saved baseline when opening fresh
  const o=$('tasbeehOverlay');if(o)o.style.display='flex';
  const ta=$('tasbeehArabic');if(ta)ta.textContent=_tasbeehText;
}

async function closeTasbeeh(){
  const o=$('tasbeehOverlay');if(o)o.style.display='none';

  // ── Double Reward: save (_tasbeehCount - _tasbeehSavedAt) × 2 coins ──
  const newTaps = _tasbeehCount - _tasbeehSavedAt;
  if (newTaps > 0 && curUser && !curUser.isAnonymous) {
    const reward = newTaps * 2;
    _tasbeehSavedAt = _tasbeehCount;
    try {
      await updateDoc(doc(db,'users',curUser.uid), { coins: increment(reward) });
      toast(`📿 +${reward}🪙 Tasbeeh reward (×2)!`, 'success', 3000);
    } catch(e) { console.warn('Tasbeeh coins error:', e.message); }
  }
}

// ═══════════════════════════════════════════
//  EVENT BINDINGS
// ═══════════════════════════════════════════

// Auth
on('tabLogin','click',()=>switchTab('login'));
on('tabSignup','click',()=>switchTab('signup'));
on('loginBtn','click',doLogin);
on('signupBtn','click',doSignup);
on('googleLoginBtn','click',doGoogle);
on('googleSignupBtn','click',doGoogle);
on('guestBtn','click',doGuest);
on('forgotBtn','click',doForgot);
on('loginPassword','keydown',e=>{if(e.key==='Enter')doLogin();});
on('signupConfirmPw','keydown',e=>{if(e.key==='Enter')doSignup();});
on('toggleLoginPw','click',function(){const i=$('loginPassword');if(!i)return;i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁️':'🙈';});
on('toggleSignupPw','click',function(){const i=$('signupPassword');if(!i)return;i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁️':'🙈';});

// Nav
on('goParaSelect','click',()=>{loadQuran();showScreen('paraSelectScreen');});
on('backFromPara','click',()=>showScreen('welcomeScreen'));
on('backFromQuiz','click',()=>showScreen('welcomeScreen'));
on('backFromContact','click',()=>showScreen(curUser&&!curUser.isAnonymous?'welcomeScreen':'authScreen'));
on('goHomeBtn','click',()=>resetGame(true));
on('playAgainBtn','click',()=>resetGame(false));
on('nextBtn','click',nextQ);
on('hintBtn','click',showHint);

// Forms
on('paraForm','submit',e=>{e.preventDefault();startGame();});
on('answerForm','submit',e=>{e.preventDefault();checkAnswer();});
on('searchForm','submit',doSearch);
on('searchInput','keydown',e=>{if(e.key==='Enter')doSearch(e);});
on('modeForm','change',()=>{ mode=document.querySelector('input[name="quizMode"]:checked')?.value||'practice'; });

// Search toggle
on('toggleSearchBtn','click',()=>{
  const sc=$('searchContainer'),btn=$('toggleSearchBtn');if(!sc||!btn)return;
  const vis=sc.style.display==='block';
  sc.style.display=vis?'none':'block';
  btn.textContent=vis?'🔎 Search':'❌ Band Karein';
  if(!vis)$('searchInput')?.focus();
});

// Guest modal
on('guestToSignup','click',()=>{const gm=$('guestModal');if(gm)gm.style.display='none';showScreen('authScreen');switchTab('signup');});
on('guestContinue','click',()=>{const gm=$('guestModal');if(gm)gm.style.display='none';});

// Profile
on('profileBtn','click',openProfilePanel);
on('ppCloseBtn','click',closeProfilePanel);
on('profileOverlay','click',closeProfilePanel);
on('ppLogoutBtn','click',()=>{closeProfilePanel();doLogout();});
on('ppContactBtn','click',()=>{closeProfilePanel();showScreen('contactScreen');});

// Language
on('btnHinglish','click',()=>applyLang('hinglish'));
on('btnEnglish','click',()=>applyLang('english'));

// Online match
on('goOnlineMatch','click',openOnlineLobby);
on('backFromLobby','click',()=>showScreen('welcomeScreen'));
on('joinStarter','click',()=>joinTable('starter'));
on('joinBronze','click',()=>joinTable('bronze'));
on('joinSilver','click',()=>joinTable('silver'));
on('joinGold','click',()=>joinTable('gold'));
on('joinDiamond','click',()=>joinTable('diamond'));
on('cancelMatchBtn','click',()=>{ leaveMatchCleanup(true); showScreen('onlineLobbyScreen'); });

// Exit match with confirm
on('exitMatchBtn','click',showExitConfirm);
on('exitMatchCancel','click',hideExitConfirm);
on('exitMatchConfirm','click',()=>{ hideExitConfirm(); leaveMatchCleanup(false); showScreen('welcomeScreen'); });

// Match result
on('matchPlayAgainBtn','click',()=>openOnlineLobby());
on('matchGoHomeBtn','click',()=>showScreen('welcomeScreen'));
on('matchAnswerForm','submit',e=>{e.preventDefault();submitMatchAnswer(false);});

// Friends
on('goFriends','click',openFriendsScreen);
on('backFromFriends','click',()=>showScreen('welcomeScreen'));
on('searchFriendBtn','click',searchUserByUID);
on('friendUidInput','keydown',e=>{if(e.key==='Enter')searchUserByUID();});

// Guest logout
document.addEventListener('guestLogout',()=>doLogout());

// UID Copy
setupUidCopy();
// Tasbeeh
setupTasbeeh();
// Language
applyLang(currentLang);
