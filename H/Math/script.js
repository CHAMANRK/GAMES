'use strict';

/* ═══════════════════════════════════════════════
   ALL-IN-ONE AI QUIZ — script.js  v2.0
═══════════════════════════════════════════════ */

/* ── Constants ── */
const TIMER_SEC = 30;
const BASE_PTS  = { Easy: 10, Medium: 20, Hard: 30 };
const HINT_COST = [0, 5, 10, 15]; // index = level
const DON_MULTIPLIER = 10;        // Double or Nothing: 10x points

/* ── Math topics per class ── */
const MATH_TOPICS = {
  1:  ['Counting','Addition','Subtraction','Shapes','Patterns'],
  2:  ['Addition','Subtraction','Multiplication','Measurement','Time'],
  3:  ['Multiplication','Division','Fractions','Geometry','Money'],
  4:  ['Large Numbers','Fractions','Decimals','Angles','Area & Perimeter'],
  5:  ['Fractions','Decimals','Percentage','Area','Volume','Factors & Multiples'],
  6:  ['Integers','Fractions','Ratio & Proportion','Algebra','Geometry','Data'],
  7:  ['Integers','Linear Equations','Lines & Angles','Triangles','Area','Data'],
  8:  ['Rational Numbers','Linear Equations','Quadrilaterals','Mensuration','Exponents','Factorisation'],
  9:  ['Number Systems','Polynomials','Linear Equations','Coordinate Geometry','Triangles','Statistics'],
  10: ['Real Numbers','Polynomials','Quadratic Equations','AP/GP','Trigonometry','Circles','Probability']
};

const MATH_GROUPS = {
  primary:  { classes: [1,2,3,4], active: 'active-p' },
  middle:   { classes: [5,6,7,8], active: 'active-m' },
  advanced: { classes: [9,10],    active: 'active-a' }
};

/* ── Category definitions ── */
const CATEGORIES = {
  math: {
    theme:    'theme-math',
    badge:    '🧮 MATH MODE',
    title:    'Math Challenge',
    sub:      'Groq AI · Hinglish · 3-Level Hints',
    loaderSub:'Groq AI math question bana raha hai... ⚡',
    isMath:   true
  },
  jasoos: {
    theme:    'theme-jasoos',
    badge:    '🕵️ JASOOS MODE',
    title:    'Jasoos Corner',
    sub:      'Crime · Mystery · Logic Puzzles',
    loaderSub:'Jasoos case file dhundh raha hai... 🔍',
    isMath:   false
  },
  paheliyan: {
    theme:    'theme-paheliyan',
    badge:    '🧩 PAHELIYAN MODE',
    title:    'Paheliyon Ki Duniya',
    sub:      'Brain Teasers · Lateral Thinking',
    loaderSub:'Dimaag ghuma dene wali paheli aa rahi hai... 🧠',
    isMath:   false
  },
  rishte: {
    theme:    'theme-rishte',
    badge:    '👥 RISHTE MODE',
    title:    'Rishton Ka Jaal',
    sub:      'Blood Relations · Family Trees',
    loaderSub:'Rishtedaari ka chakkar samajh raha hoon... 👨‍👩‍👧',
    isMath:   false
  },
  gk: {
    theme:    'theme-gk',
    badge:    '🌍 MAHAGYANI MODE',
    title:    'Mahagyani GK',
    sub:      'Mind-Blowing Facts · Science · Logic',
    loaderSub:'Brahmand ke raaz dhundh raha hoon... 🌌',
    isMath:   false
  }
};

/* ── Troll messages for wrong answers ── */
const TROLL_MSGS = [
  'Bhai, itna galat kaise ho sakte ho? Thoda badam khao! 🥜',
  'Yeh jawab dekh ke meri aankhon mein aansu aa gaye 😭',
  'School mein sote the kya? 😴',
  'Arre, meri dadi bhi yeh jaanti hain! 👵',
  'Google kar lo yaar, please 🙏',
  'Confidence toh full tha, answer bilkul nahi tha 😂',
  'Yeh jawab likh ke exam doge toh teacher bhi pagal ho jaayenge 🤪',
  'Itni mehnat ke baad yeh jawab? Wah! 👏',
  'Aankh band karke answer diya kya? 👀',
  'Bhai kuch bhi likhna chahiye tha, yeh kuch bhi nahi tha 💀'
];

/* ── AI Hint style labels per category ── */
const HINT_LABELS = {
  math:      ['', '💡 CLUE', '🔍 STEP', '📐 METHOD'],
  jasoos:    ['', '🔎 CLUE', '🕵️ SUSPECT', '📁 EVIDENCE'],
  paheliyan: ['', '✨ ISHAARA', '🧩 ANGLE', '🔮 RAAZ'],
  rishte:    ['', '👨‍👩‍👧 PEHLU', '🌳 TREE HINT', '📝 FORMULA'],
  gk:        ['', '💡 FACT', '🌍 CONTEXT', '🔬 SCIENCE']
};

/* ── App config (persists between rounds) ── */
let cfg = {
  category: 'math',
  group: 'middle', cls: 5, topic: 'Fractions',
  diff: 'Medium', rounds: 10, lang: 'hinglish'
};

/* ── Game state (reset each round) ── */
function freshGame() {
  return {
    qNum: 0, score: 0, streak: 0, maxStreak: 0,
    answered: false, timerId: null, timeLeft: 0,
    hintsUsed: 0, hintPenalty: 0,
    history: [], currentQ: null,
    donActive: false, donBet: 0
  };
}
let G = freshGame();

/* ═══════════════════════════════════════════════
   THEME / CATEGORY SWITCHING
═══════════════════════════════════════════════ */
function applyTheme(catKey) {
  const cat = CATEGORIES[catKey];
  // Remove all theme classes
  document.body.className = cat.theme;

  // Update logo
  document.getElementById('logoBadge').textContent = cat.badge;
  document.getElementById('logoTitle').textContent = cat.title;
  document.getElementById('logoSub').textContent   = cat.sub;

  // Show/hide math config
  const mathCfg = document.getElementById('mathConfig');
  mathCfg.classList.toggle('visible', cat.isMath);
}

function selectCategory(el, catKey) {
  cfg.category = catKey;
  document.querySelectorAll('.master-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  applyTheme(catKey);
}

/* ═══════════════════════════════════════════════
   MATH SUB-CONFIG
═══════════════════════════════════════════════ */
function selectGroup(g) {
  cfg.group = g;
  cfg.cls   = MATH_GROUPS[g].classes[0];
  document.querySelectorAll('.gtab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.gtab[data-g="${g}"]`).classList.add('active');
  renderClassChips();
  renderTopicChips();
}

function renderClassChips() {
  const wrap = document.getElementById('classChips');
  wrap.innerHTML = '';
  const { classes, active } = MATH_GROUPS[cfg.group];
  classes.forEach(c => {
    const sfx = c===1?'st':c===2?'nd':c===3?'rd':'th';
    const el  = document.createElement('div');
    el.className  = 'cls-chip' + (c === cfg.cls ? ' '+active : '');
    el.textContent = c + sfx;
    el.onclick = () => { cfg.cls = c; renderClassChips(); renderTopicChips(); };
    wrap.appendChild(el);
  });
}

function renderTopicChips() {
  const wrap   = document.getElementById('topicChips');
  wrap.innerHTML = '';
  const topics = MATH_TOPICS[cfg.cls] || [];
  if (!topics.includes(cfg.topic)) cfg.topic = topics[0] || '';
  topics.forEach(t => {
    const el = document.createElement('div');
    el.className  = 'topic-chip' + (t === cfg.topic ? ' active' : '');
    el.textContent = t;
    el.onclick = () => {
      document.querySelectorAll('.topic-chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      cfg.topic = t;
    };
    wrap.appendChild(el);
  });
}

/* ═══════════════════════════════════════════════
   SETUP UI CONTROLS
═══════════════════════════════════════════════ */
function selectDiff(el) {
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  cfg.diff = el.dataset.d;
}

function selectRounds(el) {
  document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  cfg.rounds = +el.dataset.r;
}

function toggleLang() {
  cfg.lang = cfg.lang === 'hinglish' ? 'english' : 'hinglish';
  const isH = cfg.lang === 'hinglish';
  document.getElementById('togglePill').className   = 'toggle-pill' + (isH ? ' on' : '');
  document.getElementById('langBadge').textContent  = isH ? 'HINGLISH' : 'ENGLISH';
  document.getElementById('langBadge').className    = 'lang-badge ' + (isH ? 'hinglish' : 'english');
  document.getElementById('langSub').textContent    = isH ? 'AI Hinglish mein poochega' : 'AI will ask in English';
}

/* ═══════════════════════════════════════════════
   SCREEN HELPER
═══════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const sc = document.getElementById(id);
  sc.style.removeProperty('display');
  requestAnimationFrame(() => sc.classList.add('active'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════════
   API — GROQ VIA VERCEL PROXY
═══════════════════════════════════════════════ */
async function callProxy(messages, options = {}) {
  const res = await fetch('/api/game-proxy', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messages, ...options })
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Server error: ' + res.status);
  }
  return res.json();
}

/* ── Build prompt per category ── */
function buildQuestionPrompt() {
  const cat    = cfg.category;
  const isH    = cfg.lang === 'hinglish';
  const lang   = isH
    ? `LANGUAGE: Write in Hinglish (Hindi+English mix like Indians speak naturally).`
    : `LANGUAGE: Write in clear simple English.`;
  const diff   = cfg.diff;
  const diffNote = `Easy = straightforward  |  Medium = some thinking  |  Hard = tricky/multi-step`;

  const categoryPrompts = {
    math: `Generate a math quiz question for Indian school students.
Class: ${cfg.cls}, Topic: ${cfg.topic}, Difficulty: ${diff}
${lang}
STRICT RULES:
- Answer must be a SINGLE number or simple fraction (e.g. "12" or "3/4")
- Question must be SHORT — 1-2 lines only
- No multiple choice | ${diffNote}
Respond with ONLY valid JSON: {"question":"...","answer":"...","explanation":"brief 1-line solution"}`,

    jasoos: `Generate a detective logic / crime-scene quiz question in the style of an Indian brain-teaser game.
Difficulty: ${diff}
${lang}
TYPES: Find the lie, spot the suspect, logical deduction, "who did it" — creative Indian settings.
Example vibe: "Ek crime scene mein teen logon ke footprints mile — Amit, Rahul aur Priya. Lekin baarish teen baje se pehle ruk gayi thi. Toh gunahgar kaun hai?"
STRICT RULES:
- Answer = a SHORT word or phrase (person's name / yes / no / a number etc.)
- No multiple choice | ${diffNote}
- Give a clear logical explanation
Respond with ONLY valid JSON: {"question":"...","answer":"...","explanation":"why this is the answer"}`,

    paheliyan: `Generate a brain-teaser / lateral thinking paheli (riddle) for an Indian quiz game.
Difficulty: ${diff}
${lang}
TYPES: Classic riddles ("main kaun hoon"), lateral thinking, wordplay, "dimaag ki dahi" style.
Example: "Subah char paon, dopahar do paon, shaam teen paon — main kaun hoon?"
Include BOTH classic Indian paheliyan AND new creative ones.
STRICT RULES:
- Answer = 1-3 words max
- No multiple choice | ${diffNote}
Respond with ONLY valid JSON: {"question":"...","answer":"...","explanation":"brief explanation of the riddle"}`,

    rishte: `Generate a blood relation / family tree puzzle question for an Indian quiz game.
Difficulty: ${diff}
${lang}
TYPES: Tricky family trees, "kaun hain" type — Indian family names (Ramu, Seema, Dadi, Mama etc.)
Example: "Aapke mama ki behen ki saas ke pote ki biwi ka bhai aapka kaun hai?"
STRICT RULES:
- Answer = a relation word (e.g. "Bhai", "Chacha", "Nana", "Cousin" etc.)
- No multiple choice | ${diffNote}
- Explanation must clearly trace the relationship step by step
Respond with ONLY valid JSON: {"question":"...","answer":"...","explanation":"step-by-step chain"}`,

    gk: `Generate a mind-blowing General Knowledge / science logic question for an Indian quiz game.
Difficulty: ${diff}
${lang}
TYPES: Out-of-the-box facts, common misconceptions, science logic, weight/time/measurement tricks.
Example: "1 kilo loha aur 1 kilo rui mein se zyada bhari kaunsi hai?" (Dono barabar)
OR: "Insaan ke jism ka kaun sa ang andhere mein bada hota hai?" (Aankh ki putli)
STRICT RULES:
- Answer = 1 short phrase or word
- No multiple choice | ${diffNote}
- Explanation must be satisfying & informative
Respond with ONLY valid JSON: {"question":"...","answer":"...","explanation":"brief wow-factor explanation"}`
  };

  return categoryPrompts[cat];
}

async function fetchQuestion() {
  const prompt = buildQuestionPrompt();
  const isH    = cfg.lang === 'hinglish';

  const data = await callProxy(
    [
      { role: 'system', content: 'You are a quiz question generator. Respond ONLY in pure valid JSON, no markdown, no extra text.' },
      { role: 'user',   content: prompt }
    ],
    { temperature: 0.88, max_tokens: 400, responseFormat: 'json' }
  );

  const raw = data.choices[0].message.content;
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function fetchHint(level) {
  const q   = G.currentQ.question;
  const cat = cfg.category;
  const isH = cfg.lang === 'hinglish';

  const hintPrompts = {
    math: {
      hi: [`Is math question ke liye ek chhoti si clue do (max 12 words), answer mat batao: "${q}"`,
           `Is question ka sirf pehla calculation step batao, final answer nahi: "${q}"`,
           `Is question ko solve karne ka formula ya method batao, answer nahi: "${q}"`],
      en: [`Give ONE short clue (max 12 words) for: "${q}". Do NOT give the answer.`,
           `Show ONLY the first calculation step for: "${q}". No final answer.`,
           `State the formula/method to solve: "${q}". No final answer.`]
    },
    jasoos: {
      hi: [`Is detective puzzle mein ek chhoti si clue do jo sochne par majboor kare, solution mat batao: "${q}"`,
           `Suspect ke bahaane ya alibi mein galti dhoondhne ka tarika batao, jawab nahi: "${q}"`,
           `Is case ki sabse important logic clue batao lekin criminal reveal mat karo: "${q}"`],
      en: [`Give one small clue to think about, don't reveal the answer: "${q}"`,
           `Point out what to look for in the suspect's alibi, no solution: "${q}"`,
           `Give the key logical deduction step, no final answer: "${q}"`]
    },
    paheliyan: {
      hi: [`Is paheli ka ek chhota sa ishaara do, seedha answer mat batao: "${q}"`,
           `Is paheli ko ek alag angle se dekhne ka tarika batao: "${q}"`,
           `Is paheli ke jawab se related ek cheez batao, par jawab nahi: "${q}"`],
      en: [`Give one small hint for this riddle, no direct answer: "${q}"`,
           `Suggest a different way to think about this riddle: "${q}"`,
           `Give a clue related to the answer without revealing it: "${q}"`]
    },
    rishte: {
      hi: [`Pehle is rishte ki chain ka sirf pehla step batao, poori chain nahi: "${q}"`,
           `Mummy ya papa ki side se sochna shuru karo — ek step hint: "${q}"`,
           `Is rishtedaari ko solve karne ka tarika ya shortcut batao: "${q}"`],
      en: [`Give only the first step in tracing this relationship: "${q}"`,
           `Hint at which side of the family to start with: "${q}"`,
           `Explain the method to trace blood relations for: "${q}"`]
    },
    gk: {
      hi: [`Is GK question ke baare mein ek dilchasp clue do, jawab mat batao: "${q}"`,
           `Is topic se related ek scientific fact ya context do: "${q}"`,
           `Is jawab ko logically deduce karne ka tarika batao: "${q}"`],
      en: [`Give one interesting clue about this GK question, no answer: "${q}"`,
           `Give related scientific context or a fun fact: "${q}"`,
           `Explain how to logically deduce the answer: "${q}"`]
    }
  };

  const prompts = isH ? hintPrompts[cat].hi : hintPrompts[cat].en;
  const prompt  = prompts[level - 1];

  const sysMsg = isH
    ? 'Tum ek helpful Indian quiz tutor ho. Hints Hinglish mein do. Final answer KABHI reveal mat karo.'
    : 'You are a helpful quiz tutor. Give concise hints. NEVER reveal the final answer.';

  const data = await callProxy(
    [
      { role: 'system', content: sysMsg },
      { role: 'user',   content: prompt }
    ],
    { temperature: 0.5, max_tokens: 120 }
  );

  return data.choices[0].message.content.trim();
}

/* ═══════════════════════════════════════════════
   GAME FLOW
═══════════════════════════════════════════════ */
async function startGame() {
  const at = document.querySelector('.topic-chip.active');
  if (at) cfg.topic = at.textContent;

  const errEl = document.getElementById('setupErr');
  errEl.textContent = '';
  errEl.classList.remove('show');

  G = freshGame();
  await loadNextQuestion();
}

async function loadNextQuestion() {
  const cat = CATEGORIES[cfg.category];
  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent =
    G.qNum === 0 ? 'Pehla question taiyaar ho raha hai...' : `Question ${G.qNum + 1} aa raha hai...`;
  document.getElementById('loadingSub').textContent = cat.loaderSub;

  try {
    const q = await fetchQuestion();
    G.currentQ = q;
    renderQuestion(q);
  } catch (err) {
    showScreen('setupScreen');
    const errEl = document.getElementById('setupErr');
    errEl.innerHTML = '⚠️ API error. Check Vercel proxy / GROQ_API_KEY.<br><small>' + err.message + '</small>';
    errEl.classList.add('show');
  }
}

function renderQuestion(q) {
  G.qNum++;
  G.answered    = false;
  G.hintsUsed   = 0;
  G.hintPenalty = 0;
  G.donActive   = false;
  G.donBet      = 0;

  // Hide DON banner
  document.getElementById('donBanner').classList.remove('visible');

  showScreen('gameScreen');

  // Progress
  document.getElementById('progressFill').style.width = (G.qNum / cfg.rounds * 100) + '%';
  document.getElementById('qLabel').textContent = 'Question ' + G.qNum;
  document.getElementById('qFrac').textContent  = G.qNum + ' / ' + cfg.rounds;
  document.getElementById('scoreDisplay').textContent = G.score;

  // Tags
  const diffEmoji = cfg.diff === 'Easy' ? '😊' : cfg.diff === 'Medium' ? '🔥' : '💀';
  const catDef    = CATEGORIES[cfg.category];
  const topicLabel = catDef.isMath ? cfg.topic : cfg.category.charAt(0).toUpperCase() + cfg.category.slice(1);
  document.getElementById('qMeta').innerHTML =
    `<span class="q-tag tag-num">Q${G.qNum}</span>` +
    `<span class="q-tag tag-topic">🎯 ${topicLabel}</span>` +
    `<span class="q-tag tag-${cfg.diff}">${diffEmoji} ${cfg.diff}</span>`;

  document.getElementById('qText').textContent = q.question;

  // Reset hints
  document.getElementById('hintPanel').innerHTML   = '';
  document.getElementById('hintsInfo').textContent = '';
  ['hBtn1','hBtn2','hBtn3'].forEach((id, i) => {
    const b = document.getElementById(id);
    b.disabled  = (i !== 0);
    b.className = 'hint-btn';
  });

  // Reset input
  const inp = document.getElementById('ansInput');
  inp.value     = '';
  inp.className = 'ans-input';
  inp.disabled  = false;
  inp.placeholder = cfg.category === 'math' ? 'Jawab yahan likho...' : 'Apna jawab yahan likho...';

  document.getElementById('submitBtn').disabled    = false;
  document.getElementById('feedbackBox').className = 'feedback-box';
  document.getElementById('nextBtn').className     = 'next-btn';

  renderStreak();
  startTimer();
  setTimeout(() => inp.focus(), 150);
}

/* ── Timer ── */
function startTimer() {
  clearInterval(G.timerId);
  G.timeLeft = TIMER_SEC;
  updateTimerUI(TIMER_SEC);
  G.timerId = setInterval(() => {
    G.timeLeft--;
    updateTimerUI(G.timeLeft);
    if (G.timeLeft <= 0) { clearInterval(G.timerId); if (!G.answered) timeUp(); }
  }, 1000);
}

function updateTimerUI(t) {
  document.getElementById('timerNum').textContent = t;
  const arc = document.getElementById('timerArc');
  arc.style.strokeDashoffset = ((TIMER_SEC - t) / TIMER_SEC) * 283;
  arc.style.stroke = t > 10 ? 'var(--t-primary)' : t > 5 ? 'var(--yellow)' : 'var(--red)';
}

function timeUp() {
  if (G.answered) return;
  G.answered = true; G.streak = 0;
  lockInputs();
  document.getElementById('ansInput').className = 'ans-input wrong';
  G.history.push({ q: G.currentQ.question, correct: false, userAns: '⏰ Time Up', rightAns: G.currentQ.answer, hintsUsed: G.hintsUsed });
  showFeedback(false, '⏰', 'Time Up!',
    `Sahi jawab tha: <span class="fb-ans">${G.currentQ.answer}</span><br><small>${G.currentQ.explanation || ''}</small>`);
  revealNextBtn();
}

/* ── Hints ── */
async function useHint(level) {
  if (G.answered) return;
  if (level !== G.hintsUsed + 1) return;

  const btn = document.getElementById('hBtn' + level);
  btn.disabled  = true;
  btn.className = 'hint-btn used';

  G.hintPenalty += HINT_COST[level];
  G.hintsUsed    = level;
  document.getElementById('hintsInfo').textContent = '−' + G.hintPenalty + 'pts';

  const panel  = document.getElementById('hintPanel');
  const loadEl = document.createElement('div');
  loadEl.className = 'hint-loading';
  loadEl.innerHTML = '<div class="hint-spin"></div> Hint soch raha hoon...';
  panel.appendChild(loadEl);

  try {
    const text   = await fetchHint(level);
    const labels = HINT_LABELS[cfg.category] || HINT_LABELS.math;
    const colors = ['','h1','h2','h3'];
    const card   = document.createElement('div');
    card.className = 'hint-card ' + colors[level];
    card.innerHTML = `<div class="hint-num">${labels[level]}</div><div class="hint-text">${text}</div>`;
    loadEl.replaceWith(card);
    if (level < 3) document.getElementById('hBtn' + (level+1)).disabled = false;
  } catch {
    loadEl.innerHTML = '⚠️ Hint load nahi hua. Try again.';
    btn.disabled  = false;
    btn.className = 'hint-btn';
    G.hintPenalty -= HINT_COST[level];
    G.hintsUsed    = level - 1;
    document.getElementById('hintsInfo').textContent = G.hintPenalty > 0 ? '−' + G.hintPenalty + 'pts' : '';
  }
  document.getElementById('ansInput').focus();
}

/* ── Normalize / validate ── */
function normalize(s) {
  return String(s).trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')   // keep spaces for word answers
    .replace(/[।,.]/g, '')
    .replace(/rs\.?/gi, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');
}

function parseMath(str) {
  const s = str.replace(/\s/g, '');
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 2) return parseFloat(parts[0]) / parseFloat(parts[1]);
  }
  return parseFloat(s);
}

function checkAnswer(userRaw, rightRaw) {
  const u = normalize(userRaw);
  const r = normalize(rightRaw);

  // Exact match (case-insensitive)
  if (u === r) return true;

  // Partial match — user's answer is a substring of correct (for long answers like "Aankh ki putli")
  if (r.includes(u) && u.length >= 3) return true;

  // Numeric match (for math)
  if (cfg.category === 'math') {
    const un = parseMath(u);
    const rn = parseMath(r);
    if (!isNaN(un) && !isNaN(rn)) return Math.abs(un - rn) < 0.01;
  }

  return false;
}

/* ── Submit Answer ── */
function handleKey(e) { if (e.key === 'Enter') submitAnswer(); }

function submitAnswer() {
  if (G.answered) return;
  const inp    = document.getElementById('ansInput');
  const rawAns = inp.value.trim();
  if (!rawAns) { inp.focus(); return; }

  clearInterval(G.timerId);
  G.answered = true;
  lockInputs();

  const correct = checkAnswer(rawAns, G.currentQ.answer);
  inp.className = 'ans-input ' + (correct ? 'correct' : 'wrong');

  if (correct) {
    const timeBonus = Math.max(0, Math.floor(G.timeLeft / 3));
    const base      = BASE_PTS[cfg.diff] || 20;
    const pts       = Math.max(1, base + timeBonus - G.hintPenalty);
    G.score  += pts;
    G.streak++;
    if (G.streak > G.maxStreak) G.maxStreak = G.streak;

    G.history.push({ q: G.currentQ.question, correct: true, userAns: rawAns, rightAns: G.currentQ.answer, pts, hintsUsed: G.hintsUsed });

    const sv = document.getElementById('scoreDisplay');
    sv.textContent = G.score;
    sv.classList.remove('bump'); void sv.offsetWidth; sv.classList.add('bump');
    renderStreak();

    const penaltyNote = G.hintPenalty > 0 ? `<br><span class="fb-penalty">🔍 Hint penalty: −${G.hintPenalty}pts</span>` : '';
    showFeedback(true, '✅', 'Bilkul Sahi! +' + pts + 'pts', (G.currentQ.explanation || 'Excellent!') + penaltyNote);

    // Offer Double or Nothing if last question & score > 0
    if (G.qNum >= cfg.rounds && G.score > 0) {
      showDoubleOrNothing(pts);
      return; // Don't show next btn yet
    }

  } else {
    G.streak = 0;
    G.history.push({ q: G.currentQ.question, correct: false, userAns: rawAns, rightAns: G.currentQ.answer, hintsUsed: G.hintsUsed });
    renderStreak();

    const troll = TROLL_MSGS[Math.floor(Math.random() * TROLL_MSGS.length)];
    showFeedback(false, '❌', 'Galat Jawab!',
      `Tumhara: <span class="fb-ans">${rawAns}</span> &nbsp;Sahi: <span class="fb-ans">${G.currentQ.answer}</span><br>` +
      `<small>${G.currentQ.explanation || ''}</small><span class="troll-msg">${troll}</span>`);
  }

  revealNextBtn();
}

function lockInputs() {
  document.getElementById('ansInput').disabled  = true;
  document.getElementById('submitBtn').disabled = true;
  ['hBtn1','hBtn2','hBtn3'].forEach(id => { document.getElementById(id).disabled = true; });
}

function showFeedback(correct, icon, title, body) {
  const fb = document.getElementById('feedbackBox');
  fb.className = 'feedback-box show ' + (correct ? 'correct-fb' : 'wrong-fb');
  document.getElementById('fbIcon').textContent  = icon;
  const t = document.getElementById('fbTitle');
  t.className   = 'fb-title ' + (correct ? 'c' : 'w');
  t.textContent = title;
  document.getElementById('fbBody').innerHTML = body;
}

function revealNextBtn() {
  const btn = document.getElementById('nextBtn');
  btn.textContent = G.qNum >= cfg.rounds ? '🏁 Results Dekho →' : 'Next Question →';
  btn.className   = 'next-btn show';
}

function renderStreak() {
  const el = document.getElementById('streakBar');
  el.innerHTML = G.streak >= 2 ? `<span class="streak-fire">🔥</span> ${G.streak} ka streak!` : '';
}

async function nextQuestion() {
  if (G.qNum >= cfg.rounds) showResults();
  else await loadNextQuestion();
}

/* ═══════════════════════════════════════════════
   DOUBLE OR NOTHING
═══════════════════════════════════════════════ */
function showDoubleOrNothing(lastPts) {
  G.donActive = true;
  G.donBet    = G.score; // Bet entire score

  const banner = document.getElementById('donBanner');
  document.getElementById('donSub').textContent =
    `Tumhara score hai: ${G.score} pts. Ek extreme hard sawal sahi kiya toh ${DON_MULTIPLIER}x = ${G.score * DON_MULTIPLIER} pts! Galat kiya toh ZERO. 😱`;
  banner.classList.add('visible');
}

async function donAccept() {
  document.getElementById('donBanner').classList.remove('visible');
  // Override for DON round
  const savedDiff = cfg.diff;
  cfg.diff = 'Hard';
  G.score = 0; // Reset — they'll either win big or get zero
  G.history.push({ q: '💀 DOUBLE OR NOTHING', correct: null, userAns: 'Accepted!', rightAns: '' });

  await loadNextQuestionDON(savedDiff);
}

async function loadNextQuestionDON(savedDiff) {
  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent = '💀 DOUBLE OR NOTHING sawal aa raha hai...';
  document.getElementById('loadingSub').textContent  = 'Ek extreme hard question taiyaar ho raha hai... 🎲';
  try {
    const q = await fetchQuestion();
    cfg.diff = savedDiff;
    G.currentQ   = q;
    G.donActive  = true;
    G.answered   = false;
    G.hintsUsed  = 0;
    G.hintPenalty = 0;
    renderDONQuestion(q);
  } catch {
    cfg.diff = savedDiff;
    showResults();
  }
}

function renderDONQuestion(q) {
  showScreen('gameScreen');
  document.getElementById('progressFill').style.width = '100%';
  document.getElementById('qLabel').textContent = '💀 DOUBLE OR NOTHING';
  document.getElementById('qFrac').textContent  = 'Final!';
  document.getElementById('scoreDisplay').textContent = G.score;
  document.getElementById('qMeta').innerHTML =
    `<span class="q-tag tag-num">DON</span>` +
    `<span class="q-tag tag-Hard">💀 EXTREME HARD</span>`;
  document.getElementById('qText').textContent = q.question;
  document.getElementById('hintPanel').innerHTML   = '';
  document.getElementById('hintsInfo').textContent = '';
  ['hBtn1','hBtn2','hBtn3'].forEach((id, i) => { document.getElementById(id).disabled = (i !== 0); document.getElementById(id).className = 'hint-btn'; });
  const inp = document.getElementById('ansInput');
  inp.value = ''; inp.className = 'ans-input'; inp.disabled = false;
  document.getElementById('submitBtn').disabled    = false;
  document.getElementById('feedbackBox').className = 'feedback-box';
  document.getElementById('nextBtn').className     = 'next-btn';
  renderStreak();
  startTimer();
  setTimeout(() => inp.focus(), 150);
}

function submitDON() {
  // After DON question is answered, always go to results
  G.donActive = false;
  revealNextBtn();
  document.getElementById('nextBtn').textContent = '🏁 Results Dekho →';
  document.getElementById('nextBtn').onclick = showResults;
}

function donDecline() {
  document.getElementById('donBanner').classList.remove('visible');
  showResults();
}

/* ═══════════════════════════════════════════════
   RESULTS
═══════════════════════════════════════════════ */
function showResults() {
  clearInterval(G.timerId);
  const total    = G.history.filter(h => h.correct !== null).length;
  const correct  = G.history.filter(h => h.correct === true).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  let emoji = '💪', title = 'Keep Practicing!', sub = 'Haar mat mano, agle baar better karoge!';
  if      (accuracy >= 90) { emoji = '🌟'; title = 'Zabardast! Expert!';   sub = 'Tum is category ke king ho! 👑'; }
  else if (accuracy >= 70) { emoji = '🏆'; title = 'Bahut Accha!';          sub = 'Solid performance! Keep it up!'; }
  else if (accuracy >= 50) { emoji = '👍'; title = 'Theek Hai!';             sub = 'Aur practice karo, behtar hoge!'; }

  document.getElementById('resultEmoji').textContent = emoji;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSub').textContent   = sub;
  document.getElementById('rScore').textContent      = G.score;
  document.getElementById('rCorrect').textContent    = correct + '/' + total;
  document.getElementById('rAccuracy').textContent   = accuracy + '%';
  document.getElementById('rStreak').textContent     = G.maxStreak;

  document.getElementById('histList').innerHTML = G.history.map(h => {
    if (h.correct === null) return `<div class="hist-item"><div class="hist-dot" style="background:var(--yellow)"></div><div class="hist-q">${h.q}</div><div class="hist-a" style="color:var(--yellow)">🎲</div></div>`;
    const hintNote = h.hintsUsed > 0 ? ` <span class="hist-hint">(${h.hintsUsed}💡)</span>` : '';
    return `<div class="hist-item">
      <div class="hist-dot ${h.correct?'c':'w'}"></div>
      <div class="hist-q">${h.q}${hintNote}</div>
      <div class="hist-a ${h.correct?'c':'w'}">${h.correct ? '+'+h.pts+'pts' : h.rightAns}</div>
    </div>`;
  }).join('');

  showScreen('resultScreen');
}

function playAgain() {
  clearInterval(G.timerId);
  G = freshGame();
  showScreen('setupScreen');
  document.getElementById('setupErr').classList.remove('show');
  // Restore next btn onclick
  document.getElementById('nextBtn').onclick = nextQuestion;
}

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
(function init() {
  applyTheme('math');
  selectGroup('middle');

  // Set default selections
  document.querySelector('.diff-btn[data-d="Medium"]').classList.add('active');
  document.querySelector('.round-btn[data-r="10"]').classList.add('active');

  // Default category card selected
  const defaultCard = document.querySelector('.master-card.cat-math');
  if (defaultCard) defaultCard.classList.add('selected');
})();
