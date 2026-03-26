'use strict';
/* ═══════════════════════════════════════════════
   ALL-IN-ONE AI QUIZ — script.js  v4.0
   Major Fixes:
   1. AI now returns acceptedAnswers[] array — no more
      wrong rejections due to spelling/synonym mismatch
   2. Timer is now OPTIONAL (toggle in config)
      + per-category default times + custom time picker
   3. All 5 category prompts fully hardened
   4. checkAnswer() completely rewritten — checks
      acceptedAnswers first, then fuzzy + numeric
   5. Timer bonus only applies when timer is ON
═══════════════════════════════════════════════ */

/* ── Per-category default timer seconds ── */
const TIMER_DEFAULTS = {
  math:      45,
  jasoos:    60,
  paheliyan: 45,
  rishte:    50,
  gk:        30
};

const BASE_PTS       = { Easy: 10, Medium: 20, Hard: 30 };
const HINT_COST      = [0, 5, 10, 15];
const DON_MULTIPLIER = 10;

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

const CATEGORIES = {
  math:      { theme:'theme-math',      badge:'🧮 MATH',      loaderSub:'Groq AI math question bana raha hai... ⚡', isMath:true  },
  jasoos:    { theme:'theme-jasoos',    badge:'🕵️ JASOOS',    loaderSub:'Jasoos case file dhundh raha hai... 🔍',   isMath:false },
  paheliyan: { theme:'theme-paheliyan', badge:'🧩 PAHELIYAN', loaderSub:'Dimaag ghuma dene wali paheli... 🧠',      isMath:false },
  rishte:    { theme:'theme-rishte',    badge:'👥 RISHTE',    loaderSub:'Rishtedaari ka chakkar... 👨‍👩‍👧',            isMath:false },
  gk:        { theme:'theme-gk',        badge:'🌍 GK',        loaderSub:'Brahmand ke raaz dhundh raha hoon... 🌌',  isMath:false }
};

const TROLL_MSGS = [
  'Bhai, itna galat kaise ho sakte ho? Thoda badam khao! 🥜',
  'Yeh jawab dekh ke meri aankhon mein aansu aa gaye 😭',
  'School mein sote the kya? 😴',
  'Arre, meri dadi bhi yeh jaanti hain! 👵',
  'Google kar lo yaar, please 🙏',
  'Confidence toh full tha, answer bilkul nahi tha 😂',
  'Yeh jawab likh ke exam doge toh teacher bhi pagal ho jaayenge 🤪',
  'Aankh band karke answer diya kya? 👀',
  'Bhai kuch bhi likhna chahiye tha, yeh kuch bhi nahi tha 💀',
  'Itni mehnat ke baad yeh jawab? Wah wah! 👏'
];

const HINT_LABELS = {
  math:      ['','💡 CLUE','🔍 STEP','📐 METHOD'],
  jasoos:    ['','🔎 CLUE','🕵️ SUSPECT','📁 EVIDENCE'],
  paheliyan: ['','✨ ISHAARA','🧩 ANGLE','🔮 RAAZ'],
  rishte:    ['','👨‍👩‍👧 PEHLU','🌳 HINT','📝 FORMULA'],
  gk:        ['','💡 FACT','🌍 CONTEXT','🔬 SCIENCE']
};

/* ── State ── */
let cfg = {
  name:'', category:'math',
  group:'middle', cls:5, topic:'Fractions',
  diff:'Medium', rounds:10, lang:'hinglish',
  timerOn:true, timerSec:45
};

function freshGame() {
  return {
    qNum:0, score:0, streak:0, maxStreak:0,
    answered:false, timerId:null, timeLeft:0,
    hintsUsed:0, hintPenalty:0,
    history:[], currentQ:null,
    donActive:false, donBet:0
  };
}
let G = freshGame();

/* ═══════════════════════════════════════════════
   SCREEN NAVIGATION
═══════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const sc = document.getElementById(id);
  sc.style.removeProperty('display');
  requestAnimationFrame(() => sc.classList.add('active'));
  window.scrollTo({ top:0, behavior:'smooth' });
}

function goToCategory() {
  const val = document.getElementById('nameInput').value.trim();
  const err = document.getElementById('nameErr');
  if (!val) { err.classList.add('show'); document.getElementById('nameInput').focus(); return; }
  err.classList.remove('show');
  cfg.name = val;
  document.getElementById('catGreeting').textContent = val + ', kya khelna hai?';
  showScreen('categoryScreen');
}

function goToConfig() {
  const cat = CATEGORIES[cfg.category];
  const titles = { math:'Math Settings', jasoos:'Jasoos Settings', paheliyan:'Paheli Settings', rishte:'Rishte Settings', gk:'GK Settings' };
  document.getElementById('configTitle').textContent = titles[cfg.category] || 'Game Settings';
  document.getElementById('mathConfig').classList.toggle('visible', cat.isMath);
  cfg.timerSec = TIMER_DEFAULTS[cfg.category];
  updateTimerConfigUI();
  showScreen('configScreen');
}

/* ═══════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════ */
function applyTheme(catKey) {
  document.body.className = CATEGORIES[catKey].theme;
}

/* ═══════════════════════════════════════════════
   CATEGORY SELECT
═══════════════════════════════════════════════ */
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
    el.className  = 'cls-chip' + (c===cfg.cls ? ' '+active : '');
    el.textContent = c + sfx;
    el.onclick = () => { cfg.cls=c; renderClassChips(); renderTopicChips(); };
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
    el.className  = 'topic-chip' + (t===cfg.topic ? ' active' : '');
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
   CONFIG CONTROLS
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
  cfg.lang = cfg.lang==='hinglish' ? 'english' : 'hinglish';
  const isH = cfg.lang==='hinglish';
  document.getElementById('togglePill').className  = 'toggle-pill'+(isH?' on':'');
  document.getElementById('langBadge').textContent = isH ? 'HINGLISH' : 'ENGLISH';
  document.getElementById('langBadge').className   = 'lang-badge '+(isH?'hinglish':'english');
  document.getElementById('langSub').textContent   = isH ? 'AI Hinglish mein poochega' : 'AI will ask in English';
}

/* ── Timer toggle & time picker ── */
function toggleTimer() {
  cfg.timerOn = !cfg.timerOn;
  updateTimerConfigUI();
}

function selectTimerSec(el) {
  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  cfg.timerSec = +el.dataset.t;
}

function updateTimerConfigUI() {
  const isOn = cfg.timerOn;
  const pill = document.getElementById('timerTogglePill');
  const sub  = document.getElementById('timerToggleSub');
  const opts = document.getElementById('timerOptions');
  if (pill) pill.className = 'toggle-pill' + (isOn ? ' on' : '');
  if (sub)  sub.textContent = isOn ? 'Timer on — speed bonus milega score mein' : 'Timer off — aaram se sochna, koi pressure nahi';
  if (opts) opts.style.display = isOn ? 'flex' : 'none';
  document.querySelectorAll('.time-btn').forEach(b => {
    b.classList.toggle('active', +b.dataset.t === cfg.timerSec);
  });
}

/* ═══════════════════════════════════════════════
   API — GROQ VIA VERCEL PROXY
═══════════════════════════════════════════════ */
async function callProxy(messages, options={}) {
  const res = await fetch('/api/game-proxy', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ messages, ...options })
  });
  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e.error || 'Server error: '+res.status);
  }
  return res.json();
}

/* ═══════════════════════════════════════════════
   PROMPTS — v4.0
   KEY CHANGE: AI now returns acceptedAnswers[] array
   with all valid spellings/forms of the answer.
   This completely solves the wrong-rejection issue.
═══════════════════════════════════════════════ */
function buildQuestionPrompt() {
  const cat  = cfg.category;
  const diff = cfg.diff;
  const lang = cfg.lang==='hinglish'
    ? 'LANGUAGE: Write the question in Hinglish (Hindi+English mix like Indians speak).'
    : 'LANGUAGE: Write the question in clear simple English.';

  const prompts = {

    math:
`Generate ONE math quiz question for Indian school students.
Class: ${cfg.cls}, Topic: ${cfg.topic}, Difficulty: ${diff}
${lang}

RULES:
- Question = 1-2 lines, no multiple choice options
- Easy = 1 step | Medium = 2-3 steps | Hard = multi-step
- Answer = clean number or simple fraction (e.g. "12" or "3/4")
- In acceptedAnswers, include ALL valid forms:
  e.g. for 0.5 → ["0.5","1/2","half","0.50"]
  e.g. for 100 → ["100","100.0","sao"]

Return ONLY valid JSON, no markdown:
{"question":"...","answer":"primary answer","acceptedAnswers":["form1","form2",...],"explanation":"step-by-step solution in 1 line"}`,

    jasoos:
`Generate ONE original detective/logic puzzle for an Indian quiz game.
Difficulty: ${diff}
${lang}

PUZZLE TYPES: Spot the liar, find the culprit, logical deduction.

STRONG EXAMPLE:
Q: "Ek kamre mein 4 log the. Chori ke baad:\nAmit bola: 'Maine nahi kiya'\nRahul bola: 'Amit sach bol raha hai'\nPriya bola: 'Rahul jhooth bol raha hai'\nNeha bola: 'Maine nahi kiya'\nAgar sirf 1 vyakti jhooth bol raha hai, toh chori kisne ki?"
A: "Priya" — Priya ka jhooth pakda jata hai kyunki agar Rahul sach bol raha hai, toh Priya galat hai

RULES:
- Puzzle MUST have exactly ONE logically correct answer
- Verify your own logic step by step before writing
- Answer = ONE person's name or one word
- acceptedAnswers = name variations (e.g. ["Priya","priya ji"])

Return ONLY valid JSON:
{"question":"...","answer":"primary answer","acceptedAnswers":["form1","form2",...],"explanation":"step-by-step logical proof"}`,

    paheliyan:
`Generate ONE classic Indian paheli (riddle).
Difficulty: ${diff}
${lang}

VERIFIED WORKING EXAMPLES (match this quality and style):
Q: "Subah char paon, dopahar do paon, shaam teen paon — main kaun?" A: "Insaan" — Explanation: baccha=4, adult=2, budhapa=3 (stick)
Q: "Mujhe todte hain toh kaam aata hoon, nahi toda toh bekaar hoon" A: "Anda" — Explanation: toda toh khana bana, nahi toda toh kuch nahi
Q: "Jitna kheencho utna lambi, chod do toh chhoti ho jaati" A: "Rubber band"
Q: "Andar se geeli, bahar se sukhi, andar jaaye toh pyas bujhe" A: "Coconut/Nariyal"
Q: "Har ghar mein hoon, par kharidta koi nahi" A: "Hawa/Air"

RULES:
- Answer MUST be a common, real, everyday object/thing
- VERIFY each clue: does it truly describe the answer? Cross-check ALL clues
- Answer = 1-2 words (simple Hindi or English)
- acceptedAnswers = MUST include both Hindi and English names + common variants
  e.g. for Rubber band: ["Rubber band","rubber band","rassi","elastic"]
  e.g. for Anda: ["Anda","anda","egg","Egg"]

Return ONLY valid JSON:
{"question":"...","answer":"primary answer","acceptedAnswers":["form1","form2","form3",...],"explanation":"clue-by-clue: clue1=why, clue2=why, etc."}`,

    rishte:
`You are an Indian blood relations expert. Generate ONE verified family relation puzzle.
Difficulty: ${diff}
${lang}

━━ CORRECT VERIFIED EXAMPLES ━━
Easy (1 hop only):
  Q:"Aapke papa ki maa aapki kaun hoti hain?" A:"Dadi" — papa ki maa = Dadi ✓
  Q:"Aapki maa ke bhai aapke kaun hote hain?" A:"Mama" — maa ke bhai = Mama ✓
  Q:"Aapke bhai ki beti aapki kaun hoti hai?" A:"Bhanji" — bhai ki beti = Bhanji ✓
  Q:"Aapki behen ke bete aapke kaun hote hain?" A:"Bhaanja" ✓

Medium (exactly 2 hops):
  Q:"Aapke mama ki ikloti behen aapki kaun hoti hain?" A:"Maa"
    Trace: Mama ki behen = Maa ✓ (2 hops)
  Q:"Aapki maa ki maa aapki kaun hoti hain?" A:"Nani"
    Trace: Maa ki maa = Nani ✓ (2 hops)
  Q:"Aapke nana ke damaad aapke kaun hote hain?" A:"Papa"
    Trace: Nana ki beti = Maa → Maa ka pati = Papa ✓

Hard (exactly 3 hops):
  Q:"Aapki maa ke bhai ki beti aapki kaun hoti hai?" A:"Cousin"
    Trace: Maa ke bhai = Mama → Mama ki beti = Cousin ✓
  Q:"Aapke papa ki behen ka beta aapka kaun hota hai?" A:"Cousin"
    Trace: Papa ki behen = Bua → Bua ka beta = Cousin ✓

━━ STRICTLY FORBIDDEN ━━
❌ Papa ke chacha ki beti = Mausi (WRONG — do NOT generate)
❌ Papa ke chacha ka beta = Mama (WRONG — do NOT generate)
❌ Chains longer than 3 hops
❌ Confusing cross-relations that have no clear single answer

━━ MANDATORY RULES ━━
- Trace EVERY hop step by step before writing
- If uncertain at ANY step → generate an easier question instead
- answer = ONE standard Indian relation word
- acceptedAnswers = include gender-neutral variants + common spellings
  e.g. "Cousin" → ["Cousin","cousin","cousin bhai","cousin behen","chachera bhai","mamere bhai"]
  e.g. "Mama" → ["Mama","mama","mama ji","maamaa","maternal uncle"]

Return ONLY valid JSON:
{"question":"...","answer":"primary answer","acceptedAnswers":["form1","form2",...],"explanation":"Hop 1: ... → Hop 2: ... → Answer: ..."}`,

    gk:
`Generate ONE factually verified GK/science/general knowledge question for Indian quiz.
Difficulty: ${diff}
${lang}

VERIFIED EXAMPLES (copy this accuracy and format):
Q:"Pani ka chemical formula?" A:"H2O" acceptedAnswers:["H2O","h2o","H 2 O"]
Q:"Prithvi ka sabse bada mahasagar?" A:"Pacific Mahasagar" acceptedAnswers:["Pacific Mahasagar","Pacific Ocean","Prashant Mahasagar","pacific","prashant"]
Q:"Insaan ki sabse badi haddi?" A:"Femur" acceptedAnswers:["Femur","femur","jaangh ki haddi","thigh bone","femur bone"]
Q:"Prakash ki gati vaccum mein?" A:"3 lakh km/s" acceptedAnswers:["3 lakh km/s","3×10⁸ m/s","300000 km/s","3 lakh","3,00,000","c"]
Q:"Sabse halka element?" A:"Hydrogen" acceptedAnswers:["Hydrogen","hydrogen","H","hydro"]
Q:"Insaan ke kitne dant hote hain?" A:"32" acceptedAnswers:["32","battees","32 dant","batis"]

RULES:
- Fact must be 100% verified school textbook correct
- acceptedAnswers MUST cover:
  * Hindi + English names of the thing
  * Common short forms and abbreviations
  * Number variants (lakh format AND digit format AND written form)
  * Plural/singular variants if relevant
- No trick questions, no ambiguous facts
- Explanation = 1-2 interesting factual lines

Return ONLY valid JSON:
{"question":"...","answer":"primary answer","acceptedAnswers":["form1","form2","form3",...],"explanation":"factual explanation"}`
  };

  return prompts[cat];
}

async function fetchQuestion() {
  const data = await callProxy(
    [
      {
        role:'system',
        content:'You are a quiz question generator. Respond ONLY in pure valid JSON. No markdown. No text outside JSON. The acceptedAnswers array is critical — always include all valid answer forms. All facts must be verified correct.'
      },
      { role:'user', content: buildQuestionPrompt() }
    ],
    { temperature:0.7, max_tokens:600, responseFormat:'json' }
  );
  const raw = data.choices[0].message.content;
  const q = JSON.parse(raw.replace(/```json|```/g,'').trim());

  // Ensure acceptedAnswers exists and always contains the primary answer
  if (!Array.isArray(q.acceptedAnswers) || q.acceptedAnswers.length === 0) {
    q.acceptedAnswers = [q.answer];
  }
  const ansLower = q.answer.toLowerCase().trim();
  if (!q.acceptedAnswers.some(a => a.toLowerCase().trim() === ansLower)) {
    q.acceptedAnswers.unshift(q.answer);
  }
  return q;
}

async function fetchHint(level) {
  const q   = G.currentQ.question;
  const cat = cfg.category;
  const isH = cfg.lang==='hinglish';

  const allPrompts = {
    math: {
      hi:[`Is math question ke liye sirf ek chhota sa clue do (max 15 words). Answer bilkul mat batao: "${q}"`,
          `Is question ka sirf PEHLA calculation step batao, final answer nahi: "${q}"`,
          `Is question ko solve karne ka formula ya method batao, answer nahi: "${q}"`],
      en:[`Give one short clue (max 15 words) for this. DO NOT give the answer: "${q}"`,
          `Show only the first calculation step. No final answer: "${q}"`,
          `Give the formula or method to solve this. No answer: "${q}"`]
    },
    jasoos: {
      hi:[`Is detective puzzle mein ek chhoti si clue do, solution bilkul mat batao: "${q}"`,
          `Puzzle mein kaunsa logic point sabse important hai woh batao: "${q}"`,
          `Kaun jhooth bol sakta hai ya nahi bol sakta — sirf ek ishaara do: "${q}"`],
      en:[`Give one small clue only, no solution: "${q}"`,
          `What is the most important logical point to focus on: "${q}"`,
          `Give one directional hint about who could or couldn't be the answer: "${q}"`]
    },
    paheliyan: {
      hi:[`Is paheli ka sirf ek chhota sa ishaara do, seedha jawab mat batao: "${q}"`,
          `Is cheez ki ek aisi khaasiyat batao jo isse unique banati hai: "${q}"`,
          `Jawab ek common cheez hai — uski category batao (jaise daak, pauda, kapda...) par naam mat batao: "${q}"`],
      en:[`Give one small hint, do NOT reveal the answer: "${q}"`,
          `Describe one unique property of the answer object: "${q}"`,
          `Tell what broad category the answer belongs to (e.g. food, tool, animal) but not the name: "${q}"`]
    },
    rishte: {
      hi:[`Rishte ki chain ka sirf PEHLA step batao, aage mat batao: "${q}"`,
          `Papa ki side se dekhna chahiye ya Maa ki side se — sirf yeh batao: "${q}"`,
          `Poori chain trace karo step by step lekin last answer mat batao: "${q}"`],
      en:[`Tell only the FIRST hop in the relationship chain: "${q}"`,
          `Should we trace from father's side or mother's side — hint only: "${q}"`,
          `Trace the full chain step by step but do not reveal the final answer: "${q}"`]
    },
    gk: {
      hi:[`Is GK fact ke baare mein ek dilchasp clue do, jawab mat batao: "${q}"`,
          `Is topic se related ek scientific ya geographic context do: "${q}"`,
          `Answer kis category mein aata hai (planet/element/country/animal/formula) — sirf category batao: "${q}"`],
      en:[`Give one interesting clue about this fact, no answer: "${q}"`,
          `Give related scientific or geographic context: "${q}"`,
          `Tell what category the answer belongs to (planet/element/country/animal/formula) but not the answer: "${q}"`]
    }
  };

  const prompts = isH ? allPrompts[cat].hi : allPrompts[cat].en;
  const sysMsg  = isH
    ? 'Tum ek helpful Indian quiz tutor ho. Hints Hinglish mein do (2-3 lines max). KABHI BHI final answer reveal mat karo.'
    : 'You are a helpful quiz tutor. Give concise hints in 2-3 lines max. NEVER reveal the final answer.';

  const data = await callProxy(
    [{ role:'system', content:sysMsg }, { role:'user', content:prompts[level-1] }],
    { temperature:0.5, max_tokens:100 }
  );
  return data.choices[0].message.content.trim();
}

/* ═══════════════════════════════════════════════
   GAME FLOW
═══════════════════════════════════════════════ */
async function startGame() {
  const at = document.querySelector('.topic-chip.active');
  if (at) cfg.topic = at.textContent;
  document.getElementById('setupErr').textContent='';
  document.getElementById('setupErr').classList.remove('show');
  G = freshGame();
  await loadNextQuestion();
}

async function loadNextQuestion() {
  const cat = CATEGORIES[cfg.category];
  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent =
    G.qNum===0 ? 'Pehla question taiyaar ho raha hai...' : `Question ${G.qNum+1} aa raha hai...`;
  document.getElementById('loadingSub').textContent = cat.loaderSub;

  try {
    const q = await fetchQuestion();
    G.currentQ = q;
    renderQuestion(q);
  } catch(err) {
    showScreen('configScreen');
    const errEl = document.getElementById('setupErr');
    errEl.innerHTML = '⚠️ API error. Check Vercel proxy / GROQ_API_KEY.<br><small>'+err.message+'</small>';
    errEl.classList.add('show');
  }
}

function renderQuestion(q) {
  G.qNum++;
  G.answered=false; G.hintsUsed=0; G.hintPenalty=0;
  G.donActive=false; G.donBet=0;
  document.getElementById('donBanner').classList.remove('visible');

  showScreen('gameScreen');

  document.getElementById('progressFill').style.width = (G.qNum/cfg.rounds*100)+'%';
  document.getElementById('qLabel').textContent = 'Question '+G.qNum;
  document.getElementById('qFrac').textContent  = G.qNum+' / '+cfg.rounds;
  document.getElementById('scoreDisplay').textContent = G.score;

  const diffEmoji = {Easy:'😊',Medium:'🔥',Hard:'💀'}[cfg.diff]||'🔥';
  const topicLabel = CATEGORIES[cfg.category].isMath ? cfg.topic : CATEGORIES[cfg.category].badge;
  document.getElementById('qMeta').innerHTML =
    `<span class="q-tag tag-num">Q${G.qNum}</span>`+
    `<span class="q-tag tag-topic">🎯 ${topicLabel}</span>`+
    `<span class="q-tag tag-${cfg.diff}">${diffEmoji} ${cfg.diff}</span>`;

  document.getElementById('qText').textContent = q.question;

  document.getElementById('hintPanel').innerHTML='';
  document.getElementById('hintsInfo').textContent='';
  ['hBtn1','hBtn2','hBtn3'].forEach((id,i) => {
    const b=document.getElementById(id);
    b.disabled=(i!==0); b.className='hint-btn';
  });

  const inp = document.getElementById('ansInput');
  inp.value=''; inp.className='ans-input'; inp.disabled=false;
  inp.placeholder = cfg.category==='math' ? 'Number mein jawab likho...' : 'Apna jawab yahan likho...';

  document.getElementById('submitBtn').disabled=false;
  document.getElementById('submitBtn').onclick=submitAnswer;
  inp.onkeydown=handleKey;

  document.getElementById('feedbackBox').className='feedback-box';
  document.getElementById('nextBtn').className='next-btn';
  document.getElementById('nextBtn').onclick=nextQuestion;

  // Show/hide timer based on cfg
  const timerWrap = document.getElementById('timerWrap');
  if (timerWrap) timerWrap.style.visibility = cfg.timerOn ? 'visible' : 'hidden';

  renderStreak();
  if (cfg.timerOn) startTimer();
  else { clearInterval(G.timerId); G.timeLeft=0; }
  setTimeout(()=>inp.focus(),150);
}

/* ── Timer ── */
function startTimer() {
  clearInterval(G.timerId);
  G.timeLeft = cfg.timerSec;
  const arc = document.getElementById('timerArc');
  arc.style.strokeDasharray  = '283';
  arc.style.strokeDashoffset = '0';
  updateTimerUI(cfg.timerSec);
  G.timerId = setInterval(()=>{
    G.timeLeft--;
    updateTimerUI(G.timeLeft);
    if(G.timeLeft<=0){ clearInterval(G.timerId); if(!G.answered) timeUp(); }
  },1000);
}

function updateTimerUI(t) {
  document.getElementById('timerNum').textContent = t;
  const arc   = document.getElementById('timerArc');
  const total = cfg.timerSec || 30;
  arc.style.strokeDashoffset = ((total-t)/total)*283;
  arc.style.stroke = t > total*0.4 ? 'var(--t-primary)' : t > total*0.2 ? 'var(--yellow)' : 'var(--red)';
}

function timeUp() {
  if(G.answered) return;
  G.answered=true; G.streak=0;
  lockInputs();
  document.getElementById('ansInput').className='ans-input wrong';
  G.history.push({q:G.currentQ.question, correct:false, userAns:'⏰ Time Up', rightAns:G.currentQ.answer, hintsUsed:G.hintsUsed});
  showFeedback(false,'⏰','Time Up!',
    `Sahi jawab tha: <span class="fb-ans">${G.currentQ.answer}</span><br><small>${G.currentQ.explanation||''}</small>`);
  revealNextBtn();
}

/* ── Hints ── */
async function useHint(level) {
  if(G.answered||level!==G.hintsUsed+1) return;
  const btn=document.getElementById('hBtn'+level);
  btn.disabled=true; btn.className='hint-btn used';
  G.hintPenalty+=HINT_COST[level]; G.hintsUsed=level;
  document.getElementById('hintsInfo').textContent='−'+G.hintPenalty+'pts';

  const panel=document.getElementById('hintPanel');
  const loadEl=document.createElement('div');
  loadEl.className='hint-loading';
  loadEl.innerHTML='<div class="hint-spin"></div> Hint soch raha hoon...';
  panel.appendChild(loadEl);

  try {
    const text  = await fetchHint(level);
    const labels= HINT_LABELS[cfg.category]||HINT_LABELS.math;
    const card  = document.createElement('div');
    card.className='hint-card '+['','h1','h2','h3'][level];
    card.innerHTML=`<div class="hint-num">${labels[level]}</div><div class="hint-text">${text}</div>`;
    loadEl.replaceWith(card);
    if(level<3) document.getElementById('hBtn'+(level+1)).disabled=false;
  } catch {
    loadEl.innerHTML='⚠️ Hint load nahi hua.';
    btn.disabled=false; btn.className='hint-btn';
    G.hintPenalty-=HINT_COST[level]; G.hintsUsed=level-1;
    document.getElementById('hintsInfo').textContent=G.hintPenalty>0?'−'+G.hintPenalty+'pts':'';
  }
  document.getElementById('ansInput').focus();
}

/* ═══════════════════════════════════════════════
   ANSWER VALIDATION — v4.0
   Step 1: Check against acceptedAnswers[] (AI-provided)
   Step 2: Normalized string match
   Step 3: Word-level match (multi-word answers)
   Step 4: Numeric comparison (fractions, decimals)
═══════════════════════════════════════════════ */
function norm(s) {
  return String(s).trim().toLowerCase()
    .replace(/[।,.'"\-_]/g,' ')
    .replace(/\s+/g,' ').trim();
}
function normC(s) { return norm(s).replace(/\s/g,''); }

function parseFrac(s) {
  const c = s.replace(/\s/g,'');
  if (/^\d+\/\d+$/.test(c)) {
    const [n,d] = c.split('/').map(Number);
    return d!==0 ? n/d : NaN;
  }
  return parseFloat(c);
}

function checkAnswer(userRaw, rightRaw) {
  const accepted = (G.currentQ && G.currentQ.acceptedAnswers) ? G.currentQ.acceptedAnswers : [rightRaw];
  const uC = normC(userRaw);
  const uN = norm(userRaw);

  /* Step 1 — acceptedAnswers exact & substring match */
  for (const a of accepted) {
    const aC = normC(a);
    const aN = norm(a);
    if (uC === aC) return true;
    if (aC.length >= 3 && uC.includes(aC)) return true;
    if (uC.length >= 3 && aC.includes(uC)) return true;
    // Word level for multi-word accepted answers
    const aWords = aN.split(' ').filter(w=>w.length>=3);
    const uWords = uN.split(' ').filter(w=>w.length>=3);
    if (aWords.length >= 2 && aWords.every(w=>uN.includes(w))) return true;
    if (uWords.length >= 2 && uWords.every(w=>aN.includes(w))) return true;
  }

  /* Step 2 — fallback normalize match on primary answer */
  const rC = normC(rightRaw);
  const rN = norm(rightRaw);
  if (uC === rC) return true;
  if (rC.length >= 3 && uC.includes(rC)) return true;
  if (uC.length >= 3 && rC.includes(uC)) return true;

  const rWords = rN.split(' ').filter(w=>w.length>=3);
  const uWords2= uN.split(' ').filter(w=>w.length>=3);
  if (rWords.length>=2 && rWords.every(w=>uN.includes(w))) return true;
  if (uWords2.length>=2 && uWords2.every(w=>rN.includes(w))) return true;

  /* Step 3 — numeric match */
  const uNum = parseFrac(uC);
  const rNum = parseFrac(rC);
  if (!isNaN(uNum)&&!isNaN(rNum)&&isFinite(uNum)&&isFinite(rNum)) {
    if (Math.abs(uNum-rNum)<0.01) return true;
  }

  /* Step 4 — numeric match against all accepted answers */
  if (!isNaN(uNum) && isFinite(uNum)) {
    for (const a of accepted) {
      const aNum = parseFrac(normC(a));
      if (!isNaN(aNum) && isFinite(aNum) && Math.abs(uNum-aNum)<0.01) return true;
    }
  }

  return false;
}

/* ── Submit ── */
function handleKey(e){ if(e.key==='Enter') submitAnswer(); }

function submitAnswer() {
  if(G.answered) return;
  const inp=document.getElementById('ansInput');
  const rawAns=inp.value.trim();
  if(!rawAns){ inp.focus(); return; }

  clearInterval(G.timerId);
  G.answered=true; lockInputs();

  const correct=checkAnswer(rawAns, G.currentQ.answer);
  inp.className='ans-input '+(correct?'correct':'wrong');

  if(correct) {
    const timeBonus = cfg.timerOn ? Math.max(0,Math.floor(G.timeLeft/3)) : 0;
    const base = BASE_PTS[cfg.diff]||20;
    const pts  = Math.max(1, base+timeBonus-G.hintPenalty);
    G.score+=pts; G.streak++;
    if(G.streak>G.maxStreak) G.maxStreak=G.streak;
    G.history.push({q:G.currentQ.question, correct:true, userAns:rawAns, rightAns:G.currentQ.answer, pts, hintsUsed:G.hintsUsed});

    const sv=document.getElementById('scoreDisplay');
    sv.textContent=G.score; sv.classList.remove('bump'); void sv.offsetWidth; sv.classList.add('bump');
    renderStreak();

    const pen=G.hintPenalty>0?`<br><span class="fb-penalty">🔍 Hint penalty: −${G.hintPenalty}pts</span>`:'';
    showFeedback(true,'✅','Bilkul Sahi! +'+pts+'pts',(G.currentQ.explanation||'Excellent!')+pen);

    if(G.qNum>=cfg.rounds && G.score>0){ showDoubleOrNothing(); return; }
  } else {
    G.streak=0;
    G.history.push({q:G.currentQ.question, correct:false, userAns:rawAns, rightAns:G.currentQ.answer, hintsUsed:G.hintsUsed});
    renderStreak();
    const troll=TROLL_MSGS[Math.floor(Math.random()*TROLL_MSGS.length)];
    showFeedback(false,'❌','Galat Jawab!',
      `Tumhara: <span class="fb-ans">${rawAns}</span> &nbsp;Sahi: <span class="fb-ans">${G.currentQ.answer}</span><br>`+
      `<small>${G.currentQ.explanation||''}</small><span class="troll-msg">${troll}</span>`);
  }
  revealNextBtn();
}

function lockInputs() {
  document.getElementById('ansInput').disabled=true;
  document.getElementById('submitBtn').disabled=true;
  ['hBtn1','hBtn2','hBtn3'].forEach(id=>document.getElementById(id).disabled=true);
}

function showFeedback(correct,icon,title,body) {
  const fb=document.getElementById('feedbackBox');
  fb.className='feedback-box show '+(correct?'correct-fb':'wrong-fb');
  document.getElementById('fbIcon').textContent=icon;
  const t=document.getElementById('fbTitle');
  t.className='fb-title '+(correct?'c':'w'); t.textContent=title;
  document.getElementById('fbBody').innerHTML=body;
}

function revealNextBtn() {
  const btn=document.getElementById('nextBtn');
  btn.textContent = G.qNum>=cfg.rounds ? '🏁 Results Dekho →' : 'Next Question →';
  btn.className='next-btn show';
}

function renderStreak() {
  const el=document.getElementById('streakBar');
  el.innerHTML=G.streak>=2?`<span class="streak-fire">🔥</span> ${G.streak} ka streak!`:'';
}

async function nextQuestion() {
  if(G.qNum>=cfg.rounds) showResults();
  else await loadNextQuestion();
}

/* ═══════════════════════════════════════════════
   DOUBLE OR NOTHING
═══════════════════════════════════════════════ */
function showDoubleOrNothing() {
  G.donActive=true;
  document.getElementById('donSub').textContent =
    `Tumhara score: ${G.score} pts. Sahi jawab → ${G.score*DON_MULTIPLIER} pts! Galat → ZERO. 😱`;
  document.getElementById('donBanner').classList.add('visible');
}

async function donAccept() {
  document.getElementById('donBanner').classList.remove('visible');
  const savedDiff=cfg.diff; cfg.diff='Hard';
  const savedScore=G.score; G.score=0;
  G.history.push({q:'💀 DOUBLE OR NOTHING accepted', correct:null, userAns:'', rightAns:''});

  showScreen('loadingScreen');
  document.getElementById('loadingText').textContent='💀 Double or Nothing sawal...';
  document.getElementById('loadingSub').textContent='Ek extreme hard question taiyaar ho raha hai... 🎲';

  try {
    const q=await fetchQuestion();
    cfg.diff=savedDiff;
    G.currentQ=q; G.donActive=true; G.donBet=savedScore;
    G.answered=false; G.hintsUsed=0; G.hintPenalty=0;

    showScreen('gameScreen');
    document.getElementById('progressFill').style.width='100%';
    document.getElementById('qLabel').textContent='💀 DOUBLE OR NOTHING';
    document.getElementById('qFrac').textContent='Final!';
    document.getElementById('scoreDisplay').textContent=G.score;
    document.getElementById('qMeta').innerHTML=
      `<span class="q-tag tag-num">DON</span><span class="q-tag tag-Hard">💀 EXTREME</span>`;
    document.getElementById('qText').textContent=q.question;
    document.getElementById('hintPanel').innerHTML='';
    document.getElementById('hintsInfo').textContent='';
    ['hBtn1','hBtn2','hBtn3'].forEach((id,i)=>{
      document.getElementById(id).disabled=(i!==0);
      document.getElementById(id).className='hint-btn';
    });
    const inp=document.getElementById('ansInput');
    inp.value=''; inp.className='ans-input'; inp.disabled=false;
    document.getElementById('submitBtn').disabled=false;
    document.getElementById('feedbackBox').className='feedback-box';
    const nb=document.getElementById('nextBtn');
    nb.className='next-btn'; nb.onclick=showResults;

    const timerWrap=document.getElementById('timerWrap');
    if(timerWrap) timerWrap.style.visibility = cfg.timerOn ? 'visible' : 'hidden';

    document.getElementById('submitBtn').onclick=submitDON;
    inp.onkeydown=e=>{ if(e.key==='Enter') submitDON(); };

    renderStreak();
    if(cfg.timerOn) startTimer();
    setTimeout(()=>inp.focus(),150);
  } catch {
    cfg.diff=savedDiff; G.score=savedScore;
    showResults();
  }
}

function submitDON() {
  if(G.answered) return;
  const inp=document.getElementById('ansInput');
  const rawAns=inp.value.trim();
  if(!rawAns){ inp.focus(); return; }

  clearInterval(G.timerId);
  G.answered=true; lockInputs();

  const correct=checkAnswer(rawAns, G.currentQ.answer);
  inp.className='ans-input '+(correct?'correct':'wrong');

  if(correct) {
    G.score=G.donBet*DON_MULTIPLIER;
    G.history.push({q:G.currentQ.question, correct:true, userAns:rawAns, rightAns:G.currentQ.answer, pts:G.score, hintsUsed:G.hintsUsed});
    document.getElementById('scoreDisplay').textContent=G.score;
    showFeedback(true,'🎉','DOUBLE OR NOTHING JEETA!',`${G.donBet} × ${DON_MULTIPLIER} = <strong>${G.score} pts!</strong> 🏆`);
  } else {
    G.history.push({q:G.currentQ.question, correct:false, userAns:rawAns, rightAns:G.currentQ.answer, hintsUsed:G.hintsUsed});
    showFeedback(false,'💀','HAARE! Score ZERO!',
      `Sahi tha: <span class="fb-ans">${G.currentQ.answer}</span><br><small>${G.currentQ.explanation||''}</small>`);
  }

  const nb=document.getElementById('nextBtn');
  nb.textContent='🏁 Results Dekho →'; nb.className='next-btn show'; nb.onclick=showResults;
  document.getElementById('submitBtn').onclick=submitAnswer;
  document.getElementById('ansInput').onkeydown=handleKey;
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
  const total   = G.history.filter(h=>h.correct!==null).length;
  const correct = G.history.filter(h=>h.correct===true).length;
  const accuracy= total>0?Math.round(correct/total*100):0;

  let emoji='💪', title='Keep Practicing!', sub='Haar mat mano, agle baar better karoge!';
  if     (accuracy>=90){emoji='🌟';title='Zabardast! Expert!'; sub=cfg.name+' tum is category ke king ho! 👑';}
  else if(accuracy>=70){emoji='🏆';title='Bahut Accha!';       sub='Solid performance '+cfg.name+'! Keep it up!';}
  else if(accuracy>=50){emoji='👍';title='Theek Hai!';          sub='Aur practice karo '+cfg.name+', behtar hoge!';}
  else                  {emoji='💪';title='Keep Practicing!';   sub=cfg.name+', haar mat mano! Dobara koshish karo 💪';}

  document.getElementById('resultEmoji').textContent =emoji;
  document.getElementById('resultPlayer').textContent=cfg.name ? '👤 '+cfg.name : '';
  document.getElementById('resultTitle').textContent =title;
  document.getElementById('resultSub').textContent   =sub;
  document.getElementById('rScore').textContent      =G.score;
  document.getElementById('rCorrect').textContent    =correct+'/'+total;
  document.getElementById('rAccuracy').textContent   =accuracy+'%';
  document.getElementById('rStreak').textContent     =G.maxStreak;

  document.getElementById('histList').innerHTML=G.history.map(h=>{
    if(h.correct===null) return `<div class="hist-item"><div class="hist-dot" style="background:var(--yellow)"></div><div class="hist-q">${h.q}</div><div class="hist-a" style="color:var(--yellow)">🎲</div></div>`;
    const hn=h.hintsUsed>0?` <span class="hist-hint">(${h.hintsUsed}💡)</span>`:'';
    return `<div class="hist-item">
      <div class="hist-dot ${h.correct?'c':'w'}"></div>
      <div class="hist-q">${h.q}${hn}</div>
      <div class="hist-a ${h.correct?'c':'w'}">${h.correct?'+'+h.pts+'pts':h.rightAns}</div>
    </div>`;
  }).join('');

  showScreen('resultScreen');
}

function playAgain() {
  clearInterval(G.timerId);
  G=freshGame();
  startGame();
}

function changeCat() {
  clearInterval(G.timerId);
  G=freshGame();
  document.getElementById('catGreeting').textContent=cfg.name+', kya khelna hai?';
  showScreen('categoryScreen');
}

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
(function init() {
  applyTheme('math');
  selectGroup('middle');
  document.querySelector('.diff-btn[data-d="Medium"]').classList.add('active');
  document.querySelector('.round-btn[data-r="10"]').classList.add('active');
  document.querySelector('.master-card.cat-math').classList.add('selected');
  cfg.timerOn  = true;
  cfg.timerSec = TIMER_DEFAULTS['math'];
  updateTimerConfigUI();
})();
