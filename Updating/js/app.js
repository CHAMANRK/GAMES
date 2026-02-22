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
  getDatabase, ref, set, get, onValue, remove, update, push, off, runTransaction
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
const MAX_H = 2;

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const $  = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
//  COINS — ATOMIC TRANSACTIONS
// ═══════════════════════════════════════════
function calcCoins(timeSpent, optCorrect, hintsUsed, isSurvival) {
  let c = timeSpent<=5?15:timeSpent<=10?12:timeSpent<=15?10:timeSpent<=20?8:timeSpent<=30?6:5;
  c += optCorrect*5; c -= hintsUsed*5; if (isSurvival) c += 20;
  return Math.max(0, c);
}

// Atomic coin update using Firestore increment (safe against concurrent writes)
async function addCoinsAtomic(amount, correct=0, total=0) {
  if (!curUser || curUser.isAnonymous) return;
  try {
    const ref2 = doc(db,'users',curUser.uid);
    const upd = { lastPlayed: serverTimestamp() };
    if (amount > 0)  upd.coins        = increment(amount);
    if (correct > 0) upd.totalCorrect = increment(correct);
    if (total > 0)   upd.totalGames   = increment(total);
    await updateDoc(ref2, upd);
    // Update accuracy separately (not blocking)
    if ((correct>0||total>0) && curData) {
      const nc=(curData.totalCorrect||0)+correct, nt=(curData.totalGames||0)+total;
      if (nt>0) updateDoc(ref2,{accuracy:Math.round((nc/nt)*100)}).catch(()=>{});
    }
  } catch(e) { console.warn('addCoinsAtomic error:', e.message); }
}

// ═══════════════════════════════════════════
//  ANIMATIONS — CARROM POOL STYLE
// ═══════════════════════════════════════════

// Coin particle burst from center to player boxes on match start
function animateMatchStart() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Target positions: player box left, opponent box right
  const myBox   = $('myPlayerBox');
  const oppBox  = $('oppPlayerBox');
  const myRect  = myBox  ? myBox.getBoundingClientRect()  : {left:80,  top:200, width:100, height:60};
  const oppRect = oppBox ? oppBox.getBoundingClientRect() : {left:window.innerWidth-180, top:200, width:100, height:60};

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  const particles = [];
  const count = 32;
  for (let i = 0; i < count; i++) {
    const goLeft = i < count / 2;
    const targetX = goLeft
      ? myRect.left  + myRect.width/2
      : oppRect.left + oppRect.width/2;
    const targetY = goLeft
      ? myRect.top   + myRect.height/2
      : oppRect.top  + oppRect.height/2;
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 4;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle)*speed + (targetX-cx)*0.015,
      vy: Math.sin(angle)*speed + (targetY-cy)*0.015,
      tx: targetX, ty: targetY,
      size: 6 + Math.random()*6,
      alpha: 1,
      color: i % 2 === 0 ? '#d4a843' : '#00c472',
      life: 1
    });
  }

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      if (p.alpha <= 0) return;
      alive = true;
      // Move toward target with attraction
      p.vx += (p.tx - p.x) * 0.04;
      p.vy += (p.ty - p.y) * 0.04;
      p.vx *= 0.92; p.vy *= 0.92;
      p.x += p.vx; p.y += p.vy;

      const dist = Math.hypot(p.x - p.tx, p.y - p.ty);
      if (dist < 20) p.alpha -= 0.06;
      if (frame > 60) p.alpha -= 0.03;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size/2, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.fill();
      // Coin symbol
      ctx.globalAlpha = Math.max(0, p.alpha * 0.9);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${p.size*0.8}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪙', p.x, p.y);
      ctx.restore();
    });
    frame++;
    if (alive && frame < 120) requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
}

// Coin shower toward header balance on win
function animateCoinShower(wonAmount) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Target: header coins display
  const hdrCoins = $('hdrCoins');
  const rect = hdrCoins ? hdrCoins.getBoundingClientRect() : {left: window.innerWidth - 120, top: 20, width: 80, height: 30};
  const tx = rect.left + rect.width/2;
  const ty = rect.top  + rect.height/2;

  const particles = [];
  const count = 60;
  for (let i = 0; i < count; i++) {
    // Start from random positions near result area
    const sx = window.innerWidth/2 + (Math.random()-0.5)*200;
    const sy = window.innerHeight/2 + (Math.random()-0.5)*100;
    particles.push({
      x: sx, y: sy,
      vx: (tx-sx)*0.02 + (Math.random()-0.5)*8,
      vy: (ty-sy)*0.02 + (Math.random()-0.5)*8,
      size: 8 + Math.random()*8,
      alpha: 1,
      color: '#d4a843',
      delay: i * 3 // stagger
    });
  }

  let frame = 0;
  // Pulse header on complete
  let pulsed = false;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      if (frame < p.delay || p.alpha <= 0) { if(p.alpha > 0) alive = true; return; }
      alive = true;

      p.vx += (tx - p.x) * 0.05;
      p.vy += (ty - p.y) * 0.05;
      p.vx *= 0.90; p.vy *= 0.90;
      p.x += p.vx; p.y += p.vy;

      const dist = Math.hypot(p.x-tx, p.y-ty);
      if (dist < 15) { p.alpha = 0; return; }
      if (frame > 80) p.alpha -= 0.04;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.font = `${p.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪙', p.x, p.y);
      ctx.restore();
    });

    // Pulse header coins element
    if (!pulsed && frame > 40 && hdrCoins) {
      pulsed = true;
      hdrCoins.classList.add('coins-pulse');
      setTimeout(() => hdrCoins.classList.remove('coins-pulse'), 600);
    }

    frame++;
    if (alive && frame < 150) requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
}

// Sudden death glow on question card
function glowSuddenDeath(on) {
  const ayatEl = $('matchAyatText');
  const progEl = $('matchProgress');
  if (ayatEl) ayatEl.classList.toggle('sudden-death-glow', on);
  if (progEl) progEl.classList.toggle('sudden-death-label', on);
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
  const isHafiz = curData.isHafiz || false;
  const s = (id,v) => { const el=$(id); if(el) el.textContent=v; };
  s('ppUsername', curData.username || curUser.displayName || 'Player');
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
    const done=()=>{const el=$('ppUidCopied');if(el){el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),2000);}};
    navigator.clipboard.writeText(uid).then(done).catch(()=>{
      const ta=document.createElement('textarea');ta.value=uid;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done();
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
      if(!curData.onlineMode){ upd.onlineMode=true; }
      if(!curData.friendRequests){ upd.friendRequests=[]; }
      if(!curData.friends){ upd.friends=[]; }
      updateDoc(r2,upd).catch(()=>{});
    }
    startUserListener(uid);
  } catch(e) { console.warn('syncUser:',e.code||e.message); }
}

function startUserListener(uid) {
  if (_userUnsub){_userUnsub();_userUnsub=null;}
  _userUnsub=onSnapshot(doc(db,'users',uid), snap=>{
    if(snap.exists()){curData=snap.data();updateHeader();}
  }, err=>console.warn('UserListener:',err.message));
}
function stopUserListener(){if(_userUnsub){_userUnsub();_userUnsub=null;}}

// ═══════════════════════════════════════════
//  FIREBASE ERRORS
// ═══════════════════════════════════════════
function fbErr(code){
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
function switchTab(tab){
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.auth-form-panel').forEach(p=>p.classList.remove('active'));
  $(`${tab}Panel`)?.classList.add('active');
  clearMsgs();
}

async function doLogin(){
  clearMsgs();
  const email=$('loginEmail')?.value.trim(), pw=$('loginPassword')?.value;
  if(!email||!pw){setMsg('loginMsg','❌ Email aur password likhein!');return;}
  btnLoad('loginBtn',true);
  try{
    const cred=await signInWithEmailAndPassword(auth,email,pw);
    await syncUser(cred.user.uid,{username:cred.user.displayName||email.split('@')[0],email:cred.user.email});
    showScreen('welcomeScreen'); toast('✅ Login ho gaye!','success');
    if(curData) showWelcomePopup(curData.username||'Player',curData.coins||0);
  }catch(e){setMsg('loginMsg',fbErr(e.code));btnLoad('loginBtn',false,'🔐 Login');}
}

async function doSignup(){
  clearMsgs();
  const un=$('signupUsername')?.value.trim(), em=$('signupEmail')?.value.trim();
  const pw=$('signupPassword')?.value, cpw=$('signupConfirmPw')?.value;
  if(!un||!em||!pw||!cpw){setMsg('signupMsg','❌ Sab fields bharen!');return;}
  if(un.length<3||un.length>20||!/^[a-zA-Z0-9_]+$/.test(un)){setMsg('signupMsg','❌ Username: 3-20 chars, letters/numbers/_ sirf.');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){setMsg('signupMsg','❌ Sahi email likhein.');return;}
  if(pw.length<6){setMsg('signupMsg','❌ Password min 6 chars.');return;}
  if(pw!==cpw){setMsg('signupMsg','❌ Passwords match nahi!');return;}
  btnLoad('signupBtn',true);
  try{
    const cred=await createUserWithEmailAndPassword(auth,em,pw);
    await updateProfile(cred.user,{displayName:un});
    await syncUser(cred.user.uid,{username:un,email:em});
    showScreen('welcomeScreen'); showWelcomePopup(un,500,true);
    toast('✅ Account ban gaya! 500🪙 mile!','success');
  }catch(e){setMsg('signupMsg',fbErr(e.code));btnLoad('signupBtn',false,'📝 Account Banayein');}
}

async function doGoogle(){
  clearMsgs();
  ['googleLoginBtn','googleSignupBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=true;});
  try{
    const result=await signInWithPopup(auth,GP), user=result.user;
    const name=user.displayName||user.email.split('@')[0];
    const isNew=result._tokenResponse?.isNewUser||false;
    await syncUser(user.uid,{username:name,email:user.email});
    showScreen('welcomeScreen');
    showWelcomePopup(name,isNew?500:(curData?.coins||0),isNew);
    toast('✅ Google se login!','success');
  }catch(e){if(e.code!=='auth/popup-closed-by-user')setMsg('loginMsg',fbErr(e.code));}
  ['googleLoginBtn','googleSignupBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=false;});
}

async function doGuest(){
  btnLoad('guestBtn',true);
  try{
    await signInAnonymously(auth); guestN=0;
    showScreen('welcomeScreen'); toast('👤 Guest mode — 3 sawaal free!','info',4000);
  }catch(e){setMsg('loginMsg',fbErr(e.code));btnLoad('guestBtn',false,'👤 Guest (3 sawaal free)');}
}

async function doLogout(){
  leaveMatchCleanup(false); stopUserListener();
  await signOut(auth); curUser=null; curData=null;
  updateHeader(); showScreen('authScreen'); toast('👋 Phir aana!','info');
}

async function doForgot(){
  const em=$('loginEmail')?.value.trim();
  if(!em){setMsg('loginMsg','❌ Pehle email likhein!');return;}
  try{await sendPasswordResetEmail(auth,em);setMsg('loginMsg','📧 Reset email bhej diya!','success');}
  catch(e){setMsg('loginMsg',fbErr(e.code));}
}

onAuthStateChanged(auth, async user=>{
  curUser=user;
  if(user){
    if(!user.isAnonymous){
      try{const snap=await getDoc(doc(db,'users',user.uid));if(snap.exists()){curData=snap.data();updateHeader();}}catch(e){}
      startUserListener(user.uid);
    }
    if($('authScreen')?.classList.contains('active')){
      showScreen('welcomeScreen');
      if(curData) showWelcomePopup(curData.username||'Player',curData.coins||0);
    }
  } else {stopUserListener();curUser=null;curData=null;updateHeader();showScreen('authScreen');}
});

onValue(ref(rtdb,'.info/connected'), snap=>{ _isConnected=snap.val()===true; });

// ═══════════════════════════════════════════
//  QURAN DATA
// ═══════════════════════════════════════════
async function loadQuran(){
  if(quranData.length||quranLoading)return;
  quranLoading=true;
  try{quranData=await(await fetch('quran_full.json')).json();console.log('✅ Quran:',quranData.length);}
  catch(e){console.error('❌ Quran load fail:',e);}
  finally{quranLoading=false;}
}

// ═══════════════════════════════════════════
//  QUIZ — OFFLINE
// ═══════════════════════════════════════════
async function startGame(){
  const er=$('selectError');if(er)er.classList.add('hidden');
  if(!quranData.length){
    if(er){er.textContent='⏳ Data load ho raha hai...';er.classList.remove('hidden');}
    await loadQuran();
    if(!quranData.length){if(er){er.textContent='❌ Quran data load nahi hua.';er.classList.remove('hidden');}return;}
    if(er)er.classList.add('hidden');
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

function nextQ(){
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
  usedI.push(i); curAyat=selAyats[i];
  typeText(curAyat.text,'ayatText',false); // Typewriter for offline
  qIdx++; updateQuizStats(); startT=Date.now();
  if(mode==='timed') startTimer(30); else {const tm=$('timer');if(tm)tm.textContent='';}
}

function updateQuizStats(){
  const acc=sessionTotal>0?Math.round((sessionCorrect/sessionTotal)*100):0;
  const sb=$('scoreBoard');
  if(sb)sb.innerHTML=`<span>Score: <b>${score}/${qIdx}</b></span><span style="margin:0 8px;color:var(--text-muted)">|</span><span>🎯 ${acc}%</span>`;
  const qp=$('quizProgress');
  if(qp)qp.textContent=mode==='practice'?`🎯 Practice — Sawal: ${qIdx}`:mode==='survival'?`💥 Survival — Sawal: ${qIdx}`:`⏱️ ${qIdx} / ${totalQ}`;
}

// Typewriter for offline, instant for online match
function typeText(text, elId, instant=false){
  const el=$(elId);if(!el)return;
  el.textContent='';
  if(instant){el.textContent=text;return;}
  let i=0;
  const go=()=>{if(i<text.length){el.textContent+=text[i++];setTimeout(go,20);}};
  go();
}

function startTimer(sec){
  const el=$('timer');if(!el)return;
  let t=sec; el.textContent=`⏱️ ${t}s`; el.classList.remove('urgent');
  if(qTmr)clearInterval(qTmr);
  qTmr=setInterval(()=>{
    t--; el.textContent=`⏱️ ${t}s`;
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

function checkAnswer(){
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
    addCoinsAtomic(earned,1,1);
    let msg=`✅ Sahi! <span style="color:var(--gold)">+${earned}🪙</span><br><small style="color:var(--text-muted)">${spd} (${ts}s)`;
    if(opt>0)msg+=` | +${opt*5}🪙 optional`;if(hints>0)msg+=` | -${hints*5}🪙 hint`;
    msg+=`</small>`;
    showRes(msg,true);
    if(sessionCorrect%10===0){toast(`🔥 ${sessionCorrect} sahi! +50🪙 streak!`,'success',3000);addCoinsAtomic(50,0,0);}
  } else {
    if(sessionTotal>0)addCoinsAtomic(0,0,1);
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

function startAutoNext(){
  if(_autoNextTmr)clearInterval(_autoNextTmr);
  let cd=5; const nb=$('nextBtn');
  if(nb)nb.textContent=`➡️ Agla Sawal (${cd}s)`;
  _autoNextTmr=setInterval(()=>{ cd--;if(nb)nb.textContent=cd>0?`➡️ Agla Sawal (${cd}s)`:'➡️ Agla Sawal';if(cd<=0){clearInterval(_autoNextTmr);_autoNextTmr=null;nextQ();}},1000);
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
//  ONLINE MATCHMAKING — DECOUPLED PROGRESSION
// ═══════════════════════════════════════════

/*
  RTDB Structure:
  matches/{tableKey}/{matchId}: {
    status: 'waiting' | 'active' | 'sudden_death' | 'done',
    table: tableKey,
    p1: { uid, name, score, qIdx, done },   // each player tracks own state
    p2: { uid, name, score, qIdx, done },
    questions: {                             // shared question pool (P1 generates)
      "1": { ayatIndex },
      "2": { ayatIndex },
      ...
    },
    p1Seen: false,   // has P1 seen result screen?
    p2Seen: false,   // has P2 seen result screen?
    winner: null | 'p1' | 'p2' | 'draw',
    suddenDeathQ: 0, // current sudden death question number
    createdAt
  }

  KEY DESIGN:
  - Each player has their own qIdx — no waiting for each other!
  - Questions pre-generated by P1 when match starts (enough for max questions)
  - Both players read from same question pool via their qIdx
  - Win condition checked by each player independently in their listener
  - Match node only deleted after BOTH p1Seen AND p2Seen = true
*/

const TABLES = {
  starter: { name:'🪵 Starter', fee:200,  totalQ:7,  firstTo:4, winCoins:400   },
  bronze:  { name:'🥉 Bronze',  fee:500,  totalQ:9,  firstTo:5, winCoins:1000  },
  silver:  { name:'🥈 Silver',  fee:1000, totalQ:11, firstTo:6, winCoins:2000  },
  gold:    { name:'🥇 Gold',    fee:2500, totalQ:13, firstTo:7, winCoins:5000  },
  diamond: { name:'💎 Diamond', fee:5000, totalQ:15, firstTo:8, winCoins:10000 },
};

function freshMS() {
  return {
    tableKey: null, matchId: null, myRole: null,
    opponentName: null,
    myScore: 0, oppScore: 0,
    myQIdx: 0,          // my personal question index
    totalQDone: 0,      // how many of totalQ I've done
    isSuddenDeath: false,
    suddenDeathQIdx: 0,
    answered: false,
    feeDeducted: false,
    endHandled: false,  // prevent double handleMatchEnd
    waitTimer: null, matchTimerInterval: null, autoCancel: null,
    listeners: []
  };
}
let MS = freshMS();

// ── Lobby ──
function openOnlineLobby(){
  if(!curUser||curUser.isAnonymous){toast('❌ Login karo pehle!','error');showScreen('authScreen');return;}
  loadQuran();
  const coins=curData?.coins||0;
  const li=$('lobbyCoinsInfo');
  if(li) li.textContent=`Aapke paas: 🪙 ${coins.toLocaleString()} — Table chuniye!`;
  const locked=$('onlineLocked'), grid=$('tablesGrid');
  if(locked)locked.classList.add('hidden');
  if(grid)grid.style.opacity='1';
  Object.entries(TABLES).forEach(([key,t])=>{
    const id=`join${key.charAt(0).toUpperCase()+key.slice(1)}`;
    const btn=$(id);if(!btn)return;
    if(coins<t.fee){btn.disabled=true;btn.textContent=`🔒 ${t.fee}🪙`;}
    else{btn.disabled=false;btn.textContent='Join';}
  });
  showScreen('onlineLobbyScreen');
}

// ── Join table ──
async function joinTable(tableKey){
  if(!curUser||!curData){toast('❌ Login karein!','error');return;}
  if(!_isConnected){toast('❌ Internet check karein!','error');return;}
  const table=TABLES[tableKey];
  const coins=curData.coins||0;
  if(coins<table.fee){toast(`❌ ${table.fee}🪙 chahiye!`,'error');return;}
  if(!quranData.length){
    toast('⏳ Data load ho raha hai...','info');
    await loadQuran();
    if(!quranData.length){toast('❌ Quran data load nahi hua!','error');return;}
  }
  MS=freshMS();
  MS.tableKey=tableKey;
  MS.feeDeducted=true;
  // Atomic deduction
  try{await updateDoc(doc(db,'users',curUser.uid),{coins:increment(-table.fee)});}
  catch(e){toast('❌ Coins deduct error. Try again.','error');return;}
  showScreen('matchWaitScreen');
  const wi=$('matchWaitInfo');if(wi)wi.textContent=table.name;
  const wt=$('matchWaitTimer');if(wt)wt.textContent='0s';
  const waitStart=Date.now();
  MS.waitTimer=setInterval(()=>{const el=$('matchWaitTimer');if(el)el.textContent=`${Math.floor((Date.now()-waitStart)/1000)}s`;},500);
  await findOrCreateMatch(tableKey);
}

// ── Core matchmaking ──
async function findOrCreateMatch(tableKey){
  const qRef=ref(rtdb,`queues/${tableKey}`);
  let asP2=false, p2MatchId=null, oppData=null;
  try{
    await runTransaction(qRef, current=>{
      if(!current){
        return{uid:curUser.uid,username:curData.username||'Player',matchId:'',ts:Date.now()};
      }
      if(current.uid===curUser.uid){
        // Same user double-tab — refresh as P1
        return{uid:curUser.uid,username:curData.username||'Player',matchId:'',ts:Date.now()};
      }
      asP2=true; p2MatchId=current.matchId; oppData=current;
      return; // P2: don't modify queue
    });
  }catch(e){
    console.error('Queue tx error:',e);
    await doRefund(); toast('❌ Matchmaking error. Dobara try karein.','error');
    showScreen('onlineLobbyScreen'); return;
  }

  if(asP2){
    // Wait for P1 to write matchId
    let tries=0;
    while((!p2MatchId||p2MatchId==='')&&tries<16){
      await sleep(500);
      try{
        const snap=await get(qRef);
        if(!snap.exists()){p2MatchId=null;break;}
        const mid=snap.val()?.matchId;
        if(mid&&mid!=='')p2MatchId=mid;
      }catch(e){}
      tries++;
    }
    if(!p2MatchId){
      await doRefund(); toast('❌ Match nahi mila. Dobara try karein.','error');
      showScreen('onlineLobbyScreen'); return;
    }
    try{await remove(qRef);}catch(e){}
    MS.matchId=p2MatchId; MS.myRole='p2';
    MS.opponentName=oppData?.username||'Player';
    await p2JoinMatch(p2MatchId,tableKey);
  } else {
    let matchId;
    try{
      matchId=push(ref(rtdb,`matches/${tableKey}`)).key;
      MS.matchId=matchId; MS.myRole='p1';
      const table=TABLES[tableKey];
      // Pre-generate all questions for the match + 5 extra for sudden death
      const questions={};
      const usedIdx=new Set();
      for(let i=1;i<=table.totalQ+10;i++){
        let idx; let tries2=0;
        do{idx=Math.floor(Math.random()*quranData.length);tries2++;}while(usedIdx.has(idx)&&tries2<500);
        usedIdx.add(idx);
        questions[String(i)]={ayatIndex:idx};
      }
      await set(ref(rtdb,`matches/${tableKey}/${matchId}`),{
        status:'waiting', table:tableKey,
        p1:{uid:curUser.uid,name:curData.username||'Player',score:0,qIdx:0,done:false},
        p2:{uid:'',name:'',score:0,qIdx:0,done:false},
        questions,
        p1Seen:false, p2Seen:false,
        winner:null, suddenDeathQ:0,
        createdAt:Date.now()
      });
      await update(qRef,{matchId});
    }catch(e){
      console.error('P1 create error:',e);
      await doRefund(); toast('❌ Match create error.','error');
      showScreen('onlineLobbyScreen'); return;
    }
    p1WaitForOpponent(tableKey,matchId);
    MS.autoCancel=setTimeout(async()=>{
      try{
        const snap=await get(ref(rtdb,`matches/${tableKey}/${matchId}`));
        if(snap.exists()&&snap.val().status==='waiting'){
          leaveMatchCleanup(false); await doRefund();
          toast('⏰ Koi opponent nahi mila. Coins wapas!','info',4000);
          showScreen('onlineLobbyScreen');
        }
      }catch(e){}
    },60000);
  }
}

// P1 waits
function p1WaitForOpponent(tableKey,matchId){
  const mRef=ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub=onValue(mRef,snap=>{
    if(!snap.exists())return;
    const d=snap.val();
    if(d.status==='active'&&d.p2?.uid){
      off(mRef);
      MS.opponentName=d.p2.name;
      startOnlineMatch(tableKey,matchId,d);
    }
  },err=>console.warn('P1 wait:',err.message));
  MS.listeners.push({ref:mRef});
}

// P2 joins
async function p2JoinMatch(matchId,tableKey){
  const mRef=ref(rtdb,`matches/${tableKey}/${matchId}`);
  let snap;
  try{snap=await get(mRef);}catch(e){await doRefund();toast('❌ Match data error.','error');showScreen('onlineLobbyScreen');return;}
  if(!snap.exists()){await doRefund();toast('❌ Match cancel ho gaya.','error');showScreen('onlineLobbyScreen');return;}
  if(snap.val().status!=='waiting'){await doRefund();toast('❌ Match pehle se shuru.','error');showScreen('onlineLobbyScreen');return;}
  try{
    await update(mRef,{
      status:'active',
      'p2/uid':curUser.uid,'p2/name':curData.username||'Player',
      'p2/score':0,'p2/qIdx':0,'p2/done':false
    });
  }catch(e){await doRefund();toast('❌ Match join error.','error');showScreen('onlineLobbyScreen');return;}
  const finalSnap=await get(mRef);
  if(finalSnap.exists()) startOnlineMatch(tableKey,matchId,finalSnap.val());
}

// ── Main match ──
function startOnlineMatch(tableKey,matchId,initData){
  clearInterval(MS.waitTimer); clearTimeout(MS.autoCancel);
  MS.autoCancel=null; MS.feeDeducted=false;
  MS.myQIdx=1; MS.totalQDone=0; MS.endHandled=false;

  showScreen('onlineMatchScreen');
  hideOverlayPopup('oppWaitPopup');
  glowSuddenDeath(false);

  // Names & scores
  const n1=$('myName'),n2=$('oppName'),s1=$('myScore'),s2=$('oppScore');
  if(n1)n1.textContent=curData?.username||'Player';
  if(n2)n2.textContent=MS.opponentName||'Opponent';
  if(s1)s1.textContent='0';
  if(s2)s2.textContent='0';

  // Coin animation — carrom pool style
  setTimeout(()=>animateMatchStart(),300);

  // Load my Q1
  const q1=initData.questions?.['1'];
  if(q1){showMatchQuestion(q1.ayatIndex,1,TABLES[tableKey].totalQ,false);}

  // Listen to match for opponent score updates & sudden death
  const mRef=ref(rtdb,`matches/${tableKey}/${matchId}`);
  const unsub=onValue(mRef,snap=>{
    if(!snap.exists()){
      if(!MS.endHandled) handleMatchEnd('opponent_left');
      return;
    }
    const d=snap.val();
    const isP1=MS.myRole==='p1';
    const myD=isP1?d.p1:d.p2;
    const opD=isP1?d.p2:d.p1;

    // Update opponent score display
    const ms1=$('myScore'),ms2=$('oppScore');
    if(ms1)ms1.textContent=myD?.score||0;
    if(ms2)ms2.textContent=opD?.score||0;
    MS.myScore=myD?.score||0;
    MS.oppScore=opD?.score||0;

    const tbl=TABLES[tableKey];

    // Win via firstTo
    if(!MS.endHandled&&MS.myScore>=tbl.firstTo){handleMatchEnd('won');return;}
    if(!MS.endHandled&&MS.oppScore>=tbl.firstTo){handleMatchEnd('lost');return;}

    // Sudden death: both done, scores equal
    if(!MS.endHandled&&d.status==='sudden_death'&&!MS.isSuddenDeath){
      MS.isSuddenDeath=true;
      glowSuddenDeath(true);
      toast('⚡ SUDDEN DEATH! Score barabar — ek aur sawaal!','info',4000);
      // Load sudden death question
      if(d.suddenDeathQ>0){
        const sdKey=String(tbl.totalQ+d.suddenDeathQ);
        const sdQ=d.questions?.[sdKey];
        if(sdQ) showMatchQuestion(sdQ.ayatIndex, d.suddenDeathQ, 1, true);
      }
    }

    // Sudden death new question
    if(!MS.endHandled&&d.status==='sudden_death'&&MS.isSuddenDeath){
      const newSD=d.suddenDeathQ||1;
      if(newSD!==MS.suddenDeathQIdx){
        MS.suddenDeathQIdx=newSD;
        MS.answered=false; // reset for new SD question
        const sdKey=String(tbl.totalQ+newSD);
        const sdQ=d.questions?.[sdKey];
        if(sdQ) showMatchQuestion(sdQ.ayatIndex,newSD,1,true);
      }
    }

    // Done state — both players done, check winner
    if(!MS.endHandled&&d.status==='done'&&d.winner){
      const myRole=MS.myRole;
      if(d.winner==='draw'){handleMatchEnd('draw');}
      else if(d.winner===myRole){handleMatchEnd('won');}
      else{handleMatchEnd('lost');}
    }
  },err=>console.warn('Match listener:',err.message));
  MS.listeners.push({ref:mRef});
}

// ── Show question ──
function showMatchQuestion(ayatIndex,qNum,total,isSuddenDeath=false){
  if(!quranData[ayatIndex]){console.warn('Invalid ayatIndex:',ayatIndex);return;}
  MS.answered=false;

  const ayat=quranData[ayatIndex];
  const mp=$('matchProgress');
  if(mp){
    if(isSuddenDeath){
      mp.innerHTML='<span class="sd-badge">⚡ SUDDEN DEATH</span>';
    } else {
      mp.textContent=`Sawal ${qNum} / ${total}`;
    }
  }

  // INSTANT text for online match
  const el=$('matchAyatText');if(el)el.textContent=ayat.text;

  $('matchAnswerForm')?.reset();
  const cb=$('matchCheckBtn');if(cb)cb.disabled=false;
  const mr=$('matchResult');if(mr){mr.classList.add('hidden');mr.textContent='';}

  startMatchTimer(30);
}

// ── Match timer ──
function startMatchTimer(sec){
  if(MS.matchTimerInterval)clearInterval(MS.matchTimerInterval);
  let t=sec;
  const fill=$('matchTimerFill'),txt=$('matchTimer');
  if(fill)fill.style.width='100%';
  if(txt)txt.textContent=`${t}s`;
  MS.matchTimerInterval=setInterval(()=>{
    t--;
    if(fill)fill.style.width=`${(t/sec)*100}%`;
    if(txt)txt.textContent=`${t}s`;
    if(t<=0){clearInterval(MS.matchTimerInterval);if(!MS.answered)submitMatchAnswer(true);}
  },1000);
}

// ── Submit answer — DECOUPLED (each player independent) ──
async function submitMatchAnswer(timeOut=false){
  if(MS.answered)return;
  MS.answered=true;
  clearInterval(MS.matchTimerInterval);
  const cb=$('matchCheckBtn');if(cb)cb.disabled=true;

  if(timeOut){
    showMatchMsg('⏱️ Waqt khatam!',false);
    await afterAnswer(false);
    return;
  }

  const para=$('match_para')?.value.trim()||'';
  const pip=$('match_pip')?.value.trim()||'';
  if(!para){MS.answered=false;if(cb)cb.disabled=false;toast('❌ Para zaroori hai!','error');return;}

  // Get current ayat based on my question index
  const tbl=TABLES[MS.tableKey];
  let questionKey;
  if(MS.isSuddenDeath){
    questionKey=String(tbl.totalQ+MS.suddenDeathQIdx);
  } else {
    questionKey=String(MS.myQIdx);
  }

  const mRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);
  let snap;
  try{snap=await get(mRef);}catch(e){showMatchMsg('❌ Data error',false);await afterAnswer(false);return;}
  if(!snap.exists()){return;}
  const matchData=snap.val();
  const q=matchData.questions?.[questionKey];
  if(!q||!quranData[q.ayatIndex]){showMatchMsg('❌ Sawaal data missing',false);await afterAnswer(false);return;}

  const ayat=quranData[q.ayatIndex];
  const pn=parseInt(ayat.page);
  const ap=((pn-1)/20|0)+1;
  const aip=((pn-1)%20)+1;
  const pOk=parseInt(para)===ap;
  const pipOk=pip?parseInt(pip)===aip-1:true;
  const correct=pOk&&pipOk;

  if(correct){
    // Atomic score increment
    const scoreField=`${MS.myRole}/score`;
    try{await update(mRef,{[scoreField]:MS.myScore+1});}
    catch(e){console.warn('Score update:',e);}
    showMatchMsg(`✅ Sahi! Para: ${ap}${pip?`, PiP: ${aip-1}`:''}`,true);
  } else {
    showMatchMsg(`❌ Galat! Sahi: Para ${ap}, PiP ${aip-1}`,false);
  }

  await afterAnswer(correct);
}

// After each answer — advance MY question independently
async function afterAnswer(correct){
  await sleep(1500);

  const tbl=TABLES[MS.tableKey];
  const mRef=ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`);

  if(MS.isSuddenDeath){
    // In sudden death: update my score, then check if I won
    // Both players will trigger this; winner determined by who scores first
    const snap=await get(mRef).catch(()=>null);
    if(!snap?.exists())return;
    const d=snap.val();
    const myD=MS.myRole==='p1'?d.p1:d.p2;
    const opD=MS.myRole==='p1'?d.p2:d.p1;

    if(correct){
      // I scored in sudden death — I win
      if(!MS.endHandled){
        await update(mRef,{status:'done',winner:MS.myRole}).catch(()=>{});
      }
    } else {
      // I didn't score — if opponent already scored, I lose (handled via listener)
      // If no one scored yet, P1 generates next SD question
      if(MS.myRole==='p1'&&!opD?.sdScored){
        const nextSD=(d.suddenDeathQ||1)+1;
        const nextKey=String(tbl.totalQ+nextSD);
        let newIdx; let t=0;
        do{newIdx=Math.floor(Math.random()*quranData.length);t++;}while(t<100);
        await update(mRef,{
          suddenDeathQ:nextSD,
          [`questions/${nextKey}`]:{ayatIndex:newIdx}
        }).catch(()=>{});
      }
    }
    return;
  }

  // Normal flow — advance my personal qIdx
  MS.myQIdx++;
  MS.totalQDone++;

  // Update my qIdx in RTDB
  const myQField=`${MS.myRole}/qIdx`;
  try{await update(mRef,{[myQField]:MS.myQIdx});}catch(e){}

  // Check if I've done all questions
  if(MS.totalQDone>=tbl.totalQ){
    // Mark me as done
    const doneField=`${MS.myRole}/done`;
    try{await update(mRef,{[doneField]:true});}catch(e){}

    // Check if both done
    const snap=await get(mRef).catch(()=>null);
    if(snap?.exists()){
      const d=snap.val();
      const bothDone=d.p1?.done&&d.p2?.done;
      if(bothDone){
        // Determine outcome
        const p1s=d.p1?.score||0, p2s=d.p2?.score||0;
        if(p1s===p2s){
          // Sudden death!
          const firstSD=tbl.totalQ+1;
          let sdIdx; let t=0;
          do{sdIdx=Math.floor(Math.random()*quranData.length);t++;}while(t<100);
          await update(mRef,{
            status:'sudden_death',
            suddenDeathQ:1,
            [`questions/${String(firstSD)}`]:{ayatIndex:sdIdx}
          }).catch(()=>{});
        } else {
          const winner=p1s>p2s?'p1':'p2';
          await update(mRef,{status:'done',winner}).catch(()=>{});
        }
      } else {
        // Waiting for opponent
        showOpponentWaitingIndicator();
      }
    }
    return;
  }

  // Show next question immediately (no waiting!)
  const nextKey=String(MS.myQIdx);
  const snap=await get(mRef).catch(()=>null);
  if(!snap?.exists())return;
  const nextQ2=snap.val().questions?.[nextKey];
  if(nextQ2){
    showMatchQuestion(nextQ2.ayatIndex,MS.myQIdx,tbl.totalQ,false);
  }
}

function showOpponentWaitingIndicator(){
  const mp=$('matchProgress');
  if(mp) mp.innerHTML='<span style="color:var(--gold);font-size:0.9rem;font-family:Tajawal,sans-serif">⏳ Opponent ka intezaar hai...</span>';
  const el=$('matchAyatText');
  if(el) el.textContent='';
  const cb=$('matchCheckBtn');if(cb)cb.disabled=true;
}

function showMatchMsg(msg,ok){
  const el=$('matchResult');if(!el)return;
  el.textContent=msg;
  el.className=ok?'result':'error';
  el.classList.remove('hidden');
}

// ── Match end — safe against race conditions ──
function handleMatchEnd(outcome){
  if(MS.endHandled)return;
  MS.endHandled=true;

  leaveMatchCleanup(false);
  hideOverlayPopup('oppWaitPopup');
  glowSuddenDeath(false);

  const tbl=TABLES[MS.tableKey];
  const won=outcome==='won';
  const draw=outcome==='draw';
  const oppLeft=outcome==='opponent_left';

  // Coins
  const coins=won?tbl.winCoins:0;

  const ri=$('matchResultIcon');if(ri)ri.textContent=won?'🏆':draw?'🤝':'😔';
  const rt=$('matchResultTitle');if(rt)rt.textContent=won?'Jeet Gaye!':draw?'Barabar!':'Haare!';

  let reasonHtml='';
  if(oppLeft) reasonHtml='<div style="color:var(--gold);font-size:0.85rem;margin-top:4px">Opponent ne match chhod diya — aap jeet gaye!</div>';
  if(draw)    reasonHtml='<div style="color:var(--gold);font-size:0.85rem;margin-top:4px">Sudden Death mein bhi barabar!</div>';

  const rs=$('matchResultScores');
  if(rs)rs.innerHTML=`<div style="display:flex;justify-content:center;gap:30px;font-size:1.1rem;font-weight:700"><span style="color:var(--emerald)">Aap: ${MS.myScore}</span><span style="color:var(--text-muted)">VS</span><span style="color:#ff9090">${MS.opponentName||'Opp'}: ${MS.oppScore}</span></div>${reasonHtml}`;

  const rc=$('matchResultCoins');
  if(rc)rc.innerHTML=won||oppLeft
    ?`<div style="color:var(--gold);font-size:1.2rem;font-weight:700">+${tbl.winCoins} 🪙 Jeet ki coins!</div>`
    :draw?`<div style="color:var(--gold)">+${Math.round(tbl.fee*0.5)} 🪙 Draw bonus!</div>`
    :`<div style="color:var(--text-muted)">Koi coins nahi — agali baar!</div>`;

  if(curUser&&!curUser.isAnonymous){
    if(won||oppLeft){
      addCoinsAtomic(tbl.winCoins,0,0);
      toast(`🏆 Jeet Gaye! +${tbl.winCoins}🪙`,'success',4000);
      updateDoc(doc(db,'users',curUser.uid),{totalWins:increment(1)}).catch(()=>{});
      // WIN ANIMATION
      setTimeout(()=>animateCoinShower(tbl.winCoins),400);
    } else if(draw){
      const drawBonus=Math.round(tbl.fee*0.5);
      addCoinsAtomic(drawBonus,0,0);
      toast(`🤝 Barabar! +${drawBonus}🪙 draw bonus!`,'info',3000);
    }
  }

  // Mark this player as having seen result — safe cleanup
  if(MS.matchId&&MS.tableKey){
    const seenField=`${MS.myRole}Seen`;
    update(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`),{[seenField]:true}).then(async()=>{
      // Check if both seen — if yes, delete match node
      try{
        const snap=await get(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`));
        if(snap.exists()){
          const d=snap.val();
          if(d.p1Seen&&d.p2Seen){
            remove(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`)).catch(()=>{});
          }
        }
      }catch(e){}
    }).catch(()=>{});
  }

  showScreen('matchResultScreen');
}

function leaveMatchCleanup(refund=false){
  clearInterval(MS.waitTimer); clearInterval(MS.matchTimerInterval); clearTimeout(MS.autoCancel);
  MS.autoCancel=null;
  MS.listeners.forEach(l=>{try{if(l&&l.ref)off(l.ref);}catch(e){}});
  MS.listeners=[];
  if(MS.tableKey){
    remove(ref(rtdb,`queues/${MS.tableKey}`)).catch(()=>{});
    if(MS.matchId&&MS.myRole==='p1'&&!MS.endHandled){
      remove(ref(rtdb,`matches/${MS.tableKey}/${MS.matchId}`)).catch(()=>{});
    }
  }
  if(refund)doRefund();
}

async function doRefund(){
  if(!MS.feeDeducted||!curUser||!MS.tableKey)return;
  MS.feeDeducted=false;
  const fee=TABLES[MS.tableKey]?.fee||0;
  if(fee>0)await updateDoc(doc(db,'users',curUser.uid),{coins:increment(fee)}).catch(()=>{});
}

// ── Overlay popups ──
function showOverlayPopup(id,html){
  let p=$(id);
  if(!p){
    p=document.createElement('div');p.id=id;
    p.style.cssText='position:fixed;inset:0;background:rgba(5,15,10,.85);backdrop-filter:blur(8px);z-index:8000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(p);
  }
  p.innerHTML=html; p.style.display='flex';
}
function hideOverlayPopup(id){const p=$(id);if(p)p.style.display='none';}

function showOpponentWaitPopup(){
  showOverlayPopup('oppWaitPopup',`
    <div style="background:var(--bg-card);border:1px solid #00c47228;border-radius:20px;padding:30px 24px;text-align:center;max-width:300px;width:90vw;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:2rem">⏳</div>
      <div style="font-family:Cinzel,serif;font-size:1.1rem;color:var(--gold-light)">Opponent ka Intezaar</div>
      <div style="font-size:0.88rem;color:var(--text-muted);font-family:Tajawal,sans-serif">Opponent abhi sawaal submit kar raha hai...</div>
      <div class="match-spinner" style="margin:0 auto"></div>
    </div>`);
}

// ── Exit confirm ──
function showExitConfirm(){const m=$('exitMatchModal');if(m)m.style.display='flex';}
function hideExitConfirm(){const m=$('exitMatchModal');if(m)m.style.display='none';}

// ═══════════════════════════════════════════
//  FRIENDS SYSTEM
// ═══════════════════════════════════════════
async function openFriendsScreen(){
  if(!curUser||curUser.isAnonymous){toast('❌ Login karo!','error');showScreen('authScreen');return;}
  showScreen('friendsScreen');
  await loadFriendsList();
}

async function loadFriendsList(){
  const listEl=$('friendsList'),pendEl=$('pendingList'),pendLabel=$('pendingLabel');
  if(!listEl)return;
  listEl.innerHTML='<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Loading...</div>';
  try{
    const snap=await getDoc(doc(db,'users',curUser.uid));
    if(!snap.exists()){listEl.innerHTML='<div style="color:#ff9090;text-align:center;padding:16px">Data nahi mila.</div>';return;}
    const data=snap.data();
    const friends=data.friends||[],pending=data.friendRequests||[];
    if(!friends.length){
      listEl.innerHTML='<div style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:16px;font-family:Tajawal,sans-serif">Abhi koi dost nahi — UID se add karein!</div>';
    } else {
      const fDocs=await Promise.all(friends.map(uid=>getDoc(doc(db,'users',uid)).catch(()=>null)));
      listEl.innerHTML=fDocs.map((fd,i)=>{
        if(!fd||!fd.exists())return'';
        const d=fd.data();
        return`<div class="friend-card"><div class="friend-avatar">👤</div><div class="friend-info"><div class="friend-name">${esc(d.username||'Player')}</div><div class="friend-uid">🆔 ${(d.uid||'').substring(0,16)}...</div></div><button class="friend-action-btn unfriend-btn" onclick="unfriendUser('${friends[i]}','${esc(d.username||'Player')}')">🗑️</button></div>`;
      }).filter(Boolean).join('')||'<div style="color:var(--text-muted);text-align:center;padding:12px">Koi data nahi</div>';
    }
    if(!pending.length){
      if(pendEl)pendEl.innerHTML=''; if(pendLabel)pendLabel.style.display='none';
    } else {
      if(pendLabel)pendLabel.style.display='block';
      const pDocs=await Promise.all(pending.map(uid=>getDoc(doc(db,'users',uid)).catch(()=>null)));
      if(pendEl)pendEl.innerHTML=pDocs.map((pd,i)=>{
        if(!pd||!pd.exists())return'';
        const d=pd.data();
        return`<div class="friend-card"><div class="friend-avatar">👤</div><div class="friend-info"><div class="friend-name">${esc(d.username||'Player')}</div><div class="friend-uid" style="color:var(--gold)">📩 Request bheja</div></div><div style="display:flex;gap:6px"><button class="friend-action-btn accept-btn" onclick="acceptFriend('${pending[i]}','${esc(d.username||'Player')}')">✅ Accept</button><button class="friend-action-btn reject-btn" onclick="rejectFriend('${pending[i]}')">❌</button></div></div>`;
      }).filter(Boolean).join('');
    }
  }catch(e){listEl.innerHTML=`<div style="color:#ff9090;text-align:center;padding:16px;font-size:0.85rem">Error: ${e.message}</div>`;}
}

// UID search — show preview FIRST, then add button
async function searchUserByUID(){
  if(!curUser||curUser.isAnonymous)return;
  const input=$('friendUidInput'),msgEl=$('addFriendMsg'),preview=$('friendSearchPreview');
  if(!input||!msgEl)return;
  const uid=input.value.trim();
  if(!uid){setMsg('addFriendMsg','❌ UID likhein!');if(preview)preview.innerHTML='';return;}
  if(uid===curUser.uid){setMsg('addFriendMsg','❌ Apni khud ki UID nahi!');if(preview)preview.innerHTML='';return;}
  setMsg('addFriendMsg','⏳ Dhoondh raha hoon...','success');
  if(preview)preview.innerHTML='';
  try{
    const targetSnap=await getDoc(doc(db,'users',uid));
    if(!targetSnap.exists()){setMsg('addFriendMsg','❌ Koi user nahi mila is UID se.');if(preview)preview.innerHTML='';return;}
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
          <div class="friend-preview-stats">🎯 ${td.accuracy||0}% &nbsp;|&nbsp; 🎮 ${td.totalGames||0} games &nbsp;|&nbsp; 🏆 ${td.totalWins||0} wins</div>
          <div class="friend-preview-uid">🆔 ${uid.substring(0,22)}...</div>
        </div>
        ${alreadyFriends
          ?`<div style="color:var(--emerald);font-size:0.82rem;font-weight:700">✅ Dost hain</div>`
          :alreadySent
          ?`<div style="color:var(--gold);font-size:0.82rem">⏳ Request bhej di</div>`
          :`<button class="btn btn-primary" onclick="sendFriendRequest('${uid}','${esc(td.username||'Player')}')" style="padding:8px 16px;font-size:0.88rem;width:auto">➕ Add</button>`}
      </div>`;
    }
  }catch(e){setMsg('addFriendMsg',`❌ Error: ${e.message}`);}
}

window.sendFriendRequest=async function(uid,name){
  try{
    await updateDoc(doc(db,'users',uid),{friendRequests:arrayUnion(curUser.uid)});
    toast(`✅ Request bhej di: ${name}!`,'success');
    const preview=$('friendSearchPreview');
    if(preview){const btn=preview.querySelector('button');if(btn)btn.outerHTML=`<div style="color:var(--gold);font-size:0.82rem">⏳ Request bhej di</div>`;}
    setMsg('addFriendMsg','✅ Friend request bhej di!','success');
  }catch(e){toast('❌ Error: '+e.message,'error');}
};

window.unfriendUser=async function(fUid,name){
  if(!curUser)return;
  if(!confirm(`${name} ko unfriend karein?`))return;
  try{
    await updateDoc(doc(db,'users',curUser.uid),{friends:arrayRemove(fUid)});
    await updateDoc(doc(db,'users',fUid),{friends:arrayRemove(curUser.uid)});
    toast(`🗑️ ${name} unfriend ho gaya.`,'info');
    await loadFriendsList();
  }catch(e){toast('❌ Unfriend error: '+e.message,'error');}
};

window.acceptFriend=async function(fromUid,name){
  if(!curUser)return;
  try{
    await updateDoc(doc(db,'users',curUser.uid),{friends:arrayUnion(fromUid),friendRequests:arrayRemove(fromUid)});
    await updateDoc(doc(db,'users',fromUid),{friends:arrayUnion(curUser.uid)});
    toast(`✅ ${name} ab aapka dost hai!`,'success');
    await loadFriendsList();
  }catch(e){toast('❌ Accept error: '+e.message,'error');}
};

window.rejectFriend=async function(fromUid){
  if(!curUser)return;
  try{
    await updateDoc(doc(db,'users',curUser.uid),{friendRequests:arrayRemove(fromUid)});
    toast('Request reject kar di.','info');
    await loadFriendsList();
  }catch(e){toast('❌ Reject error.','error');}
};

// ═══════════════════════════════════════════
//  HIDDEN TASBEEH — 2x COINS ON CLOSE
// ═══════════════════════════════════════════
let _tClicks=0,_tTimer=null,_tCount=0,_tText='سُبْحَانَ اللَّهِ',_tCoinsEarned=0;

function setupTasbeeh(){
  const trigger=$('hiddenTasbeehTrigger');
  if(!trigger)return;
  trigger.addEventListener('click',()=>{
    _tClicks++;
    clearTimeout(_tTimer);
    _tTimer=setTimeout(()=>{_tClicks=0;},2000);
    if(_tClicks>=7){_tClicks=0;clearTimeout(_tTimer);openTasbeeh();}
  });
  document.querySelectorAll('.tasbeeh-type-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tasbeeh-type-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _tText=btn.dataset.text;
      const ta=$('tasbeehArabic');if(ta)ta.textContent=_tText;
    });
  });
  on('tasbeehTap','click',()=>{
    _tCount++;
    _tCoinsEarned+=2; // 2x coins per tap
    const tc=$('tasbeehCount');
    if(tc){tc.textContent=_tCount;tc.classList.remove('tasbeeh-pulse');void tc.offsetWidth;tc.classList.add('tasbeeh-pulse');}
    if(navigator.vibrate)navigator.vibrate(30);
    // Show running coin tally
    const ce=$('tasbeehCoins');if(ce)ce.textContent=`+${_tCoinsEarned}🪙`;
    if(_tCount===33)toast('✨ 33 — SubhanAllah! +66🪙','success',2000);
    if(_tCount===99)toast('🌟 99 — Alhamdulillah! +198🪙','success',2000);
    if(_tCount===100)toast('💯 100 — MashaAllah!','success',2500);
  });
  on('tasbeehReset','click',()=>{
    _tCount=0;_tCoinsEarned=0;
    const tc=$('tasbeehCount');if(tc)tc.textContent='0';
    const ce=$('tasbeehCoins');if(ce)ce.textContent='';
  });
  on('tasbeehClose','click',closeTasbeehAndSave);
}

function openTasbeeh(){
  _tCount=0; _tCoinsEarned=0;
  const o=$('tasbeehOverlay');if(o)o.style.display='flex';
  const ta=$('tasbeehArabic');if(ta)ta.textContent=_tText;
  const tc=$('tasbeehCount');if(tc)tc.textContent='0';
  const ce=$('tasbeehCoins');if(ce)ce.textContent='';
}

async function closeTasbeehAndSave(){
  const o=$('tasbeehOverlay');if(o)o.style.display='none';
  if(_tCoinsEarned>0&&curUser&&!curUser.isAnonymous){
    try{
      await updateDoc(doc(db,'users',curUser.uid),{coins:increment(_tCoinsEarned)});
      toast(`✅ Tasbeeh complete! +${_tCoinsEarned}🪙 (2x reward)!`,'success',3000);
    }catch(e){console.warn('Tasbeeh coins error:',e);}
    _tCoinsEarned=0;
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
on('modeForm','change',()=>{mode=document.querySelector('input[name="quizMode"]:checked')?.value||'practice';});

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
on('cancelMatchBtn','click',()=>{leaveMatchCleanup(true);showScreen('onlineLobbyScreen');});
on('exitMatchBtn','click',showExitConfirm);
on('exitMatchCancel','click',hideExitConfirm);
on('exitMatchConfirm','click',()=>{hideExitConfirm();leaveMatchCleanup(false);showScreen('welcomeScreen');});
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

// Init
setupUidCopy();
setupTasbeeh();
applyLang(currentLang);
