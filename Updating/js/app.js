// ═══════════════════════════════════════════
//  app.js — Entry point
//  Sirf event bindings aur module imports
//  Koi business logic yahan nahi
// ═══════════════════════════════════════════

import { $ , on, showScreen, isMobile }   from './modules/ui.js';
import { switchTab, doLogin, doSignup,
         doGoogle, doGuest, doLogout,
         doForgot, initAuthListener }     from './modules/auth.js';
import { openProfilePanel, closeProfilePanel,
         setupUidCopy }                   from './modules/user.js';
import { startGame, nextQ, checkAnswer,
         showHint, endQuiz, resetGame,
         loadQuran }                      from './modules/quiz.js';
import { doSearch }                       from './modules/search.js';
import { openOnlineLobby, joinTable,
         submitMatchAnswer, showExitConfirm,
         hideExitConfirm, leaveMatchCleanup } from './modules/online-match.js';
import { searchFriend, startFriendsListener,
         stopFriendsListener }            from './modules/friends.js';
import { currentLang, setLang }           from './state/appState.js';

// ── Stars background (mobile-respects prefers-reduced-motion) ──
(function initStars() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('starsCanvas');
  if (!c) return;
  const x = c.getContext('2d');
  let s    = [];
  const rs = () => { c.width = innerWidth; c.height = innerHeight; };
  const is = () => {
    s = [];
    const n = Math.floor(c.width * c.height / 8000);
    for (let i = 0; i < n; i++) {
      s.push({ x: Math.random() * c.width, y: Math.random() * c.height,
               r: Math.random() * 1.2 + .2, a: Math.random(),
               sp: Math.random() * .005 + .001,
               col: Math.random() > .7 ? '#d4a843' : '#00c472' });
    }
  };
  const dr = () => {
    x.clearRect(0, 0, c.width, c.height);
    s.forEach(p => {
      p.a += p.sp;
      if (p.a > 1 || p.a < 0) p.sp = -p.sp;
      x.save();
      x.globalAlpha = Math.abs(Math.sin(p.a));
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      x.fillStyle = p.col; x.shadowBlur = 6; x.shadowColor = p.col; x.fill();
      x.restore();
    });
    requestAnimationFrame(dr);
  };
  rs(); is(); dr();
  addEventListener('resize', () => { rs(); is(); });
})();

// ── Init auth listener (boot + onAuthStateChanged) ──
initAuthListener();

// ── DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {

  // ── Auth ──
  on('tabLogin',       'click', e => { e.preventDefault(); switchTab('login');   });
  on('tabSignup',      'click', e => { e.preventDefault(); switchTab('signup');  });
  on('loginBtn',       'click', e => { e.preventDefault(); doLogin();            });
  on('signupBtn',      'click', e => { e.preventDefault(); doSignup();           });
  on('googleLoginBtn', 'click', e => { e.preventDefault(); doGoogle();           });
  on('googleSignupBtn','click', e => { e.preventDefault(); doGoogle();           });
  on('guestBtn',       'click', e => { e.preventDefault(); doGuest();            });
  on('forgotBtn',      'click', e => { e.preventDefault(); doForgot();           });
  // Fix [HTML-1]: guestLogoutPill — replaced inline onclick with proper listener
  on('guestLogoutPill','click', () => doLogout());

  // Keyboard shortcuts
  on('loginEmail',     'keypress', e => { if (e.key === 'Enter') doLogin();   });
  on('loginPassword',  'keypress', e => { if (e.key === 'Enter') doLogin();   });
  on('signupConfirmPw','keypress', e => { if (e.key === 'Enter') doSignup();  });

  // Password toggles
  on('toggleLoginPw',  'click', e => {
    const i = $('loginPassword');
    if (i) { i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? '👁️' : '🙈'; }
  });
  on('toggleSignupPw', 'click', e => {
    const i = $('signupPassword');
    if (i) { i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? '👁️' : '🙈'; }
  });

  // ── Quiz ──
  on('paraForm',    'submit', e => { e.preventDefault(); startGame(); });
  on('answerForm',  'submit', e => { e.preventDefault(); checkAnswer(); });
  on('checkBtn',    'click',  e => { e.preventDefault(); checkAnswer(); });
  on('nextBtn',     'click',  e => { e.preventDefault(); nextQ(); });
  on('hintBtn',     'click',  e => { e.preventDefault(); showHint(); });
  on('goParaSelect','click',  () => { loadQuran(); showScreen('paraSelectScreen'); });
  on('backFromPara','click',  () => showScreen('welcomeScreen'));   // Fix [HTML-8]
  on('backFromQuiz','click',  () => showScreen('welcomeScreen'));
  on('goHomeBtn',   'click',  () => resetGame(true));
  on('playAgainBtn','click',  () => resetGame(false));

  // ── Profile ──
  on('profileBtn',      'click', openProfilePanel);
  on('ppCloseBtn',      'click', closeProfilePanel);
  on('profileOverlay',  'click', closeProfilePanel);
  on('ppLogoutBtn',     'click', () => { closeProfilePanel(); doLogout(); });
  on('ppContactBtn',    'click', () => { closeProfilePanel(); showScreen('contactScreen'); });  // Fix [HTML-8]
  setupUidCopy();

  // ── Language ──
  const applyLang = lang => {
    if (!['hinglish', 'english'].includes(lang)) return;
    setLang(lang);
    $('btnHinglish')?.classList.toggle('active', lang === 'hinglish');
    $('btnEnglish')?.classList.toggle('active',  lang === 'english');
  };
  on('btnHinglish', 'click', () => applyLang('hinglish'));
  on('btnEnglish',  'click', () => applyLang('english'));
  applyLang(currentLang);

  // ── Search ──
  on('searchForm',      'submit', doSearch);
  on('toggleSearchBtn', 'click',  () => {
    const sc  = $('searchContainer'), btn = $('toggleSearchBtn');
    if (sc && btn) {
      const vis = sc.style.display === 'block';
      sc.style.display = vis ? 'none' : 'block';
      btn.textContent  = vis ? '🔎 Search' : '❌ Band Karein';
      if (!vis) setTimeout(() => $('searchInput')?.focus(), 100);
    }
  });

  // ── Online match ──
  on('goOnlineMatch',  'click', openOnlineLobby);
  on('backFromLobby',  'click', () => showScreen('welcomeScreen'));
  on('joinStarter',    'click', () => joinTable('starter'));
  on('joinBronze',     'click', () => joinTable('bronze'));
  on('joinSilver',     'click', () => joinTable('silver'));
  on('joinGold',       'click', () => joinTable('gold'));
  on('joinDiamond',    'click', () => joinTable('diamond'));

  on('cancelMatchBtn', 'click', async () => {
    const { MS, getCurUser } = await import('./state/appState.js');
    const { ref, get, remove } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js");
    const { rtdb } = await import('./modules/firebase.js');
    if (MS.matchId && MS.tableKey && MS.myRole === 'p1') {
      const mRef = ref(rtdb, `matches/${MS.tableKey}/${MS.matchId}`);
      const snap = await get(mRef).catch(() => null);
      if (snap?.exists() && snap.val().status === 'waiting') {
        await remove(mRef).catch(() => {});
        await remove(ref(rtdb, `queues/${MS.tableKey}`)).catch(() => {});
        MS.matchId = null; MS.myRole = null;
      }
    }
    leaveMatchCleanup(true);
    showScreen('onlineLobbyScreen');
  });

  // Match answer
  on('matchAnswerForm', 'submit', e => { e.preventDefault(); submitMatchAnswer(false); });
  on('exitMatchBtn',    'click',  showExitConfirm);
  on('exitMatchCancel', 'click',  hideExitConfirm);
  on('exitMatchConfirm','click',  async () => {
    hideExitConfirm();
    leaveMatchCleanup(false);
    showScreen('welcomeScreen');
  });
  on('matchPlayAgainBtn','click', () => openOnlineLobby());
  on('matchGoHomeBtn',   'click', () => showScreen('welcomeScreen'));

  // ── Friends ──
  on('goFriends',       'click', () => { showScreen('friendsScreen'); startFriendsListener(); });  // Fix [HTML-8]
  on('backFromFriends', 'click', () => { showScreen('welcomeScreen'); stopFriendsListener(); });   // Fix [HTML-8]
  on('searchFriendBtn', 'click', searchFriend);
  on('friendUidInput',  'keypress', e => { if (e.key === 'Enter') searchFriend(); });

  // ── Contact ──
  on('backFromContact', 'click', () => showScreen('welcomeScreen'));  // Fix [HTML-8]

  // ── Hidden Tasbeeh (7-click on logo) ──
  let clickCount = 0;
  const trigger  = $('hiddenTasbeehTrigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      clickCount++;
      if (clickCount >= 7) {
        clickCount = 0;
        const overlay = $('tasbeehOverlay');
        if (overlay) overlay.style.display = 'flex';  // Fix [HTML-6]: use flex not block
      }
    });
  }
  $('tasbeehClose') && $('tasbeehClose').addEventListener('click', () => {
    const overlay = $('tasbeehOverlay');
    if (overlay) overlay.style.display = 'none';
  });
  $('tasbeehReset') && $('tasbeehReset').addEventListener('click', () => {
    $('tasbeehCount').textContent = '0';
  });
  $('tasbeehTap') && $('tasbeehTap').addEventListener('click', () => {
    const cnt = $('tasbeehCount');
    if (cnt) {
      const n = (parseInt(cnt.textContent) || 0) + 1;
      cnt.textContent = n;
      cnt.classList.add('tasbeeh-pulse');
      cnt.addEventListener('animationend', () => cnt.classList.remove('tasbeeh-pulse'), { once: true });
    }
  });
  document.querySelectorAll('.tasbeeh-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tasbeeh-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const txt = $('tasbeehArabic');
      if (txt) txt.textContent = btn.dataset.text || '';
      $('tasbeehCount') && ($('tasbeehCount').textContent = '0');
    });
    if (btn.dataset.type === 'subhan') {
      const txt = $('tasbeehArabic');
      if (txt) txt.textContent = btn.dataset.text || '';
    }
  });

  // ── Dynamic copyright year ──
  const yr = document.getElementById('copyrightYear');
  if (yr) yr.textContent = new Date().getFullYear();

  // ── Mobile optimizations ──
  if (isMobile()) {
    document.addEventListener('touchstart', () => {}, false);
    let lastTouchEnd = 0;
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, false);
  }

  document.addEventListener('wheel', e => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
});
