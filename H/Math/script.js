'use strict';
/* ═══════════════════════════════════════════════
   ALL-IN-ONE AI QUIZ — script.js  v3.1 (Fixed)
   Bugs Fixed:
   1. Answer matching: Hindi↔English synonyms, scientific notation
   2. submitBtn.onclick not reset after DON round
   3. Timer arc strokeDasharray set dynamically
   4. GK / Rishte AI prompts made stricter & more accurate
   5. Duplicate selected class on init removed
   6. Score display edge cases handled
═══════════════════════════════════════════════ */

const TIMER_SEC      = 30;
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
  name: '',
  category: 'math',
  group: 'middle', cls: 5, topic: 'Fractions',
  diff: 'Medium', rounds: 10, lang: 'hinglish'
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

/* ── Screen 1 → 2 ── */
function goToCategory() {
  const val = document.getElementById('nameInput').value.trim();
  const err = document.getElementById('nameErr');
  if (!val) { err.classList.add('show'); document.getElementById('nameInput').focus(); return; }
  err.classList.remove('show');
  cfg.name = val;
  document.getElementById('catGreeting').textContent = val + ', kya khelna hai?';
  showScreen('categoryScreen');
}

/* ── Screen 2 → 3 ── */
function goToConfig() {
  const cat = CATEGORIES[cfg.category];
  const titles = {
    math:'Math Settings', jasoos:'Jasoos Settings',
    paheliyan:'Paheli Settings', rishte:'Rishte Settings', gk:'GK Settings'
  };
  document.getElementById('configTitle').textContent = titles[cfg.category] || 'Game Settings';
  document.getElementById('mathConfig').classList.toggle('visible', cat.isMath);
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

/* ── Prompts ── */
function buildQuestionPrompt() {
  const cat  = cfg.category;
  const diff = cfg.diff;
  const lang = cfg.lang==='hinglish'
    ? 'LANGUAGE: Write in Hinglish (Hindi+English mix like Indians speak naturally).'
    : 'LANGUAGE: Write in clear simple English.';

  const prompts = {
    math:
`Generate a math quiz question for Indian school students.
Class: ${cfg.cls}, Topic: ${cfg.topic}, Difficulty: ${diff}
${lang}
RULES:
- Answer = single number or simple fraction only (e.g. "12" or "3/4")
- Question = 1-2 lines, no multiple choice
- Easy=1 step | Medium=2-3 steps | Hard=multi-step
- Answer must be a clean number. Do NOT give units in the answer field.
JSON only: {"question":"...","answer":"...","explanation":"1-line solution"}`,

    jasoos:
`Generate a detective/logic puzzle question for an Indian quiz game.
Difficulty: ${diff}
${lang}
Types: Find the lie, spot the culprit, logical deduction — Indian settings.
Example: "Teen dost ek saath gaye — Amit, Rahul, Priya. Sirf ek ki jacket mein mitti thi par baarish ruk chuki thi. Kaun jhooth bol raha hai?"
RULES:
- Answer = ONE short word or name only (e.g. "Rahul", "Teen", "Haan")
- Give clear logical reasoning in explanation
- No multiple choice
- The answer MUST be logically derivable from the question. Verify your own logic before writing.
JSON only: {"question":"...","answer":"...","explanation":"logical reasoning"}`,

    paheliyan:
`Generate a brain-teaser / paheli for an Indian quiz game.
Difficulty: ${diff}
${lang}
Types: Classic "main kaun hoon" riddles, lateral thinking, wordplay.
Examples:
Q:"Subah char paon dopahar do paon shaam teen paon" A:"Insaan"
Q:"Mujhe todte hain toh kaam aata hoon todte nahi toh bekaar" A:"Anda"
Q:"Jitna kheencho utna lambi wapas chodne par chhoti" A:"Rubber band"
RULES:
- Answer = 1-3 words ONLY (common everyday Hindi/English noun)
- The answer MUST be a real, well-known thing — NOT abstract, NOT a trick with no clear solution
- The riddle clues must ALL logically point to that single answer
- No multiple choice
JSON only: {"question":"...","answer":"...","explanation":"brief explanation of why each clue matches"}`,

    rishte:
`You are an expert at Indian blood relation puzzles. Generate ONE verified puzzle.
Difficulty: ${diff}
${lang}

CORRECT VERIFIED EXAMPLES — use ONLY this style and logic:
Easy (1 step):
  Q:"Aapke papa ki maa aapki kaun hoti hain?" A:"Dadi" ✓
  Q:"Aapki maa ke bhai aapke kaun hote hain?" A:"Mama" ✓
  Q:"Aapke bhai ki beti aapki kaun hoti hai?" A:"Bhanji" ✓
  Q:"Aapke chacha ke bete aapke kaun hote hain?" A:"Cousin" ✓

Medium (2 steps):
  Q:"Aapke mama ki ikloti behen aapki kaun hoti hain?" A:"Maa" ✓
    (Mama ki behen = Maa)
  Q:"Aapki dadi ke bete aapke kaun hote hain?" A:"Papa ya Chacha" ✓
    (Dadi ka beta = Papa ya Chacha)
  Q:"Aapke nana ke damad aapke kaun hote hain?" A:"Papa" ✓
    (Nana ki beti = Maa, Maa ka pati = Papa)

Hard (3 steps MAX):
  Q:"Aapke papa ke mama ke bete aapke kaun hote hain?" A:"Mama" ✓
    (Papa ke mama = Nana, Nana ka beta = Mama)

FORBIDDEN WRONG EXAMPLES (DO NOT generate these):
  ❌ "Papa ke chacha ki beti" → NOT "Mausi" (Wrong! Papa ke chacha ≠ Nana ka bhai)
  ❌ "Papa ke chacha ka beta" → NOT "Mama" (Wrong!)
  ❌ Any chain longer than 3 steps

STRICT RULES:
- Easy = EXACTLY 1 relation step
- Medium = EXACTLY 2 relation steps  
- Hard = EXACTLY 3 steps, NO MORE
- Answer = ONE relation word from this list ONLY:
  Dadi/Nani/Dada/Nana/Mama/Mausi/Chacha/Bua/Phupa/Papa/Maa/Bhai/Behen/Cousin/Bhanji/Bhatija/Saas/Sasur/Pota/Poti
- BEFORE writing the question: mentally trace EVERY step and write it in the explanation
- If ANY step is uncertain, generate an EASIER question instead
- The explanation MUST show each step: "Step 1: X → Step 2: Y → Answer: Z"

JSON only: {"question":"...","answer":"...","explanation":"Step 1: ... → Step 2: ... → Answer: ..."}`,

    gk:
`Generate a mind-blowing GK/science/general knowledge question for an Indian quiz game.
Difficulty: ${diff}
${lang}

VERIFIED CORRECT EXAMPLES (copy this accuracy):
Q:"1 kilo loha aur 1 kilo rui mein zyada bhari kaunsi hai?" A:"Dono barabar"
Q:"Insaan ke jism ka kaun sa ang andhere mein bada hota hai?" A:"Aankh ki putli"
Q:"Ek din mein Prithvi apne aksh par kitni baar ghoomti hai?" A:"1 baar"
Q:"Pani ka chemical formula kya hai?" A:"H2O"
Q:"Insaan ki sabse badi haddi kaun si hai?" A:"Femur"
Q:"Prithvi ka sabse bada mahasagar kaun sa hai?" A:"Pacific Mahasagar"
Q:"Prakash ki gati vaccum mein kitni hoti hai?" A:"3 lakh km/s"
Q:"Sabse halka element kaun sa hai?" A:"Hydrogen"

RULES:
- Answer must be FACTUALLY 100% CORRECT — double-check before writing
- Answer = 1-4 words, simple and direct
- For geography: use HINDI names if well-known in Hindi (e.g. "Pacific Mahasagar" not "Prashant Mahasagar" — use the common Indian school textbook name)
- For speed/measurement: use format like "3 lakh km/s", "1 baar", "365 din"
- NO trick questions, NO ambiguous answers, NO debatable facts
- Explanation = clear, satisfying, factual (1-2 lines)
JSON only: {"question":"...","answer":"...","explanation":"clear factual explanation"}`
  };

  return prompts[cat];
}

async function fetchQuestion() {
  const data = await callProxy(
    [
      { role:'system', content:'You are a quiz question generator. Respond ONLY in pure valid JSON. No markdown, no extra text, no explanation outside JSON. Every answer must be factually verified and logically sound.' },
      { role:'user',   content: buildQuestionPrompt() }
    ],
    { temperature:0.75, max_tokens:500, responseFormat:'json' }
);
  const raw = data.choices[0].message.content;
  return JSON.parse(raw.replace(/```json|```/g,'').trim());
}

async function fetchHint(level) {
  const q   = G.currentQ.question;
  const cat = cfg.category;
  const isH = cfg.lang==='hinglish';

  const allPrompts = {
    math:      { hi:[ `Is math question ke liye sirf ek chhota sa clue do max 12 words, answer bilkul mat batao: "${q}"`,
                      `Is question ka sirf pehla calculation step batao, final answer nahi: "${q}"`,
                      `Is question ko solve karne ka formula ya method batao, answer nahi: "${q}"` ],
                 en:[ `One short clue max 12 words for: "${q}". NO answer.`,
                      `First calculation step only for: "${q}". No final answer.`,
                      `Formula or method to solve: "${q}". No final answer.` ] },
    jasoos:    { hi:[ `Is detective puzzle mein ek chhoti si clue do, solution mat batao: "${q}"`,
                      `Suspect ke bahaane ya logic mein kya dhundhna chahiye bata do: "${q}"`,
                      `Sabse important logical clue batao lekin answer reveal mat karo: "${q}"` ],
                 en:[ `One small clue, no solution: "${q}"`,
                      `What to look for in the alibi, no answer: "${q}"`,
                      `Key logical step, no final answer: "${q}"` ] },
    paheliyan: { hi:[ `Is paheli ka sirf ek chhota sa ishaara do, seedha jawab mat batao: "${q}"`,
                      `Is paheli ko alag angle se sochne ka tarika batao: "${q}"`,
                      `Jawab se related ek cheez batao par seedha jawab nahi: "${q}"` ],
                 en:[ `One small hint, no direct answer: "${q}"`,
                      `Different angle to think about this riddle: "${q}"`,
                      `A clue related to the answer without revealing it: "${q}"` ] },
    rishte:    { hi:[ `Rishte ki chain ka sirf pehla step batao, poori chain nahi: "${q}"`,
                      `Kis side se sochna start karna chahiye ek hint do: "${q}"`,
                      `Is rishtedaari ko solve karne ka shortcut ya method batao: "${q}"` ],
                 en:[ `Only the first step in the relationship chain: "${q}"`,
                      `Which side of the family to start from: "${q}"`,
                      `Method to trace this blood relation: "${q}"` ] },
    gk:        { hi:[ `Is GK question ke baare mein ek dilchasp clue do, jawab mat batao: "${q}"`,
                      `Is topic se related ek scientific fact ya context do: "${q}"`,
                      `Jawab logically deduce karne ka tarika batao: "${q}"` ],
                 en:[ `One interesting clue, no answer: "${q}"`,
                      `Related scientific context or fun fact: "${q}"`,
                      `How to logically deduce the answer: "${q}"` ] }
  };

  const prompts = isH ? allPrompts[cat].hi : allPrompts[cat].en;
  const sysMsg  = isH
    ? 'Tum ek helpful Indian quiz tutor ho. Hints Hinglish mein do. Final answer KABHI reveal mat karo. Max 2 lines mein jawab do.'
    : 'You are a helpful quiz tutor. Give concise hints in max 2 lines. NEVER reveal the final answer.';

  const data = await callProxy(
    [ {role:'system',content:sysMsg}, {role:'user',content:prompts[level-1]} ],
    { temperature:0.5, max_tokens:120 }
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
  const catBadge  = CATEGORIES[cfg.category].badge;
  const topicLabel = CATEGORIES[cfg.category].isMath ? cfg.topic : catBadge;
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

  // FIX: Always reset submit handlers to default (after DON or any other override)
  document.getElementById('submitBtn').disabled=false;
  document.getElementById('submitBtn').onclick=submitAnswer;
  inp.onkeydown=handleKey;

  document.getElementById('feedbackBox').className='feedback-box';
  document.getElementById('nextBtn').className='next-btn';
  document.getElementById('nextBtn').onclick=nextQuestion;

  renderStreak();
  startTimer();
  setTimeout(()=>inp.focus(),150);
}

/* ── Timer ── */
function startTimer() {
  clearInterval(G.timerId);
  G.timeLeft=TIMER_SEC;
  // FIX: Set dasharray dynamically to match circumference (2 * π * 45 ≈ 283)
  const arc = document.getElementById('timerArc');
  arc.style.strokeDasharray = '283';
  arc.style.strokeDashoffset = '0';
  updateTimerUI(TIMER_SEC);
  G.timerId = setInterval(()=>{
    G.timeLeft--;
    updateTimerUI(G.timeLeft);
    if(G.timeLeft<=0){ clearInterval(G.timerId); if(!G.answered) timeUp(); }
  },1000);
}

function updateTimerUI(t) {
  document.getElementById('timerNum').textContent=t;
  const arc=document.getElementById('timerArc');
  arc.style.strokeDashoffset = ((TIMER_SEC-t)/TIMER_SEC)*283;
  arc.style.stroke = t>10?'var(--t-primary)':t>5?'var(--yellow)':'var(--red)';
}

function timeUp() {
  if(G.answered) return;
  G.answered=true; G.streak=0;
  lockInputs();
  document.getElementById('ansInput').className='ans-input wrong';
  G.history.push({q:G.currentQ.question,correct:false,userAns:'⏰ Time Up',rightAns:G.currentQ.answer,hintsUsed:G.hintsUsed});
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
   ANSWER VALIDATION — v3.1
   FIX: Added Hindi↔English synonym map, scientific
   notation handling, and smarter partial matching
═══════════════════════════════════════════════ */

// Synonym map: Hindi geographic/scientific names → English equivalents
const HINDI_SYNONYMS = {
  'prashant':      'pacific',
  'prashant mahasagar': 'pacific mahasagar',
  'shant mahasagar':    'pacific mahasagar',
  'hind mahasagar':     'indian ocean',
  'atlantik':           'atlantic',
  'arktik':             'arctic',
  'bharatiya':          'indian',
  'suraj':              'sun',
  'chand':              'moon',
  'dharti':             'earth',
  'prithvi':            'earth',
  'zameen':             'earth',
  'agni':               'fire',
  'pani':               'water',
  'jal':                'water',
  'vayu':               'air',
  'hawa':               'air',
  'insaan':             'human',
  'manav':              'human',
  'prakash':            'light',
  'andhere':            'dark',
  'andhera':            'dark',
};

function applySynonyms(s) {
  let result = s;
  // Apply multi-word synonyms first (longest match), then single-word
  const keys = Object.keys(HINDI_SYNONYMS).sort((a,b) => b.length - a.length);
  for (const k of keys) {
    if (result.includes(k)) result = result.split(k).join(HINDI_SYNONYMS[k]);
  }
  return result;
}

function normalize(s) {
  let r = String(s).trim().toLowerCase();

  // Scientific notation: 3×10⁸, 3x10^8, 3*10**8 → plain number string
  r = r.replace(/3\s*[×x\*]\s*10\s*[\^]?\s*[⁸8]/gi, '300000000');
  r = r.replace(/3\s*lakh\s*(?:km\/s|km\/sec|kmps)?/gi, '300000');
  r = r.replace(/3\s*lack\s*(?:km\/s|km\/sec|kmps)?/gi, '300000');
  r = r.replace(/3,00,000/g, '300000');
  r = r.replace(/300000\s*(?:km\/s|km\/sec|kmps)?/gi, '300000');

  // Hindi number words
  r = r.replace(/\bek\b/g,'1').replace(/\bdo\b/g,'2').replace(/\bteen\b/g,'3')
       .replace(/\bchar\b/g,'4').replace(/\bpaanch\b/g,'5');

  // baar/bar normalization
  r = r.replace(/\bbaar\b/g,'bar');

  // Apply Hindi↔English synonym map
  r = applySynonyms(r);

  // Strip punctuation, units, currency
  r = r.replace(/\s+/g,' ')
       .replace(/[।,.'"\-]/g,'')
       .replace(/rs\.?/gi,'')
       .replace(/×/g,'*')
       .replace(/÷/g,'/')
       .replace(/\bkm\/s\b|\bkmps\b|\bm\/s\b/gi,'')
       .trim();

  return r;
}

function normalizeCompact(s){ return normalize(s).replace(/\s+/g,''); }

function parseMath(s) {
  const c = s.replace(/\s/g,'');
  if(c.includes('/')) {
    const p = c.split('/');
    if(p.length===2) return parseFloat(p[0])/parseFloat(p[1]);
  }
  return parseFloat(c);
}

function checkAnswer(userRaw, rightRaw) {
  const u  = normalize(userRaw);
  const r  = normalize(rightRaw);
  const uc = normalizeCompact(userRaw);
  const rc = normalizeCompact(rightRaw);

  // Exact match after normalization
  if(u===r || uc===rc) return true;

  // Substring match (min 2 chars to avoid false positives)
  if(rc.length>=2 && uc.includes(rc)) return true;
  if(uc.length>=2 && rc.includes(uc)) return true;

  // Word-level: all words in user answer appear in right answer (and vice versa)
  // Only apply if right answer has 2+ meaningful words (avoids false positives for single-word answers)
  const uw = u.split(' ').filter(w=>w.length>=3);
  const rw = r.split(' ').filter(w=>w.length>=3);
  if(rw.length>=2 && uw.length>0 && uw.every(w=>r.includes(w))) return true;
  if(uw.length>=2 && rw.length>0 && rw.every(w=>u.includes(w))) return true;

  // Numeric match (within tolerance)
  const un = parseMath(uc);
  const rn = parseMath(rc);
  if(!isNaN(un)&&!isNaN(rn)&&isFinite(un)&&isFinite(rn)) return Math.abs(un-rn)<0.01;

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

  const correct=checkAnswer(rawAns,G.currentQ.answer);
  inp.className='ans-input '+(correct?'correct':'wrong');

  if(correct) {
    const timeBonus=Math.max(0,Math.floor(G.timeLeft/3));
    const base=BASE_PTS[cfg.diff]||20;
    const pts=Math.max(1,base+timeBonus-G.hintPenalty);
    G.score+=pts; G.streak++;
    if(G.streak>G.maxStreak) G.maxStreak=G.streak;
    G.history.push({q:G.currentQ.question,correct:true,userAns:rawAns,rightAns:G.currentQ.answer,pts,hintsUsed:G.hintsUsed});

    const sv=document.getElementById('scoreDisplay');
    sv.textContent=G.score; sv.classList.remove('bump'); void sv.offsetWidth; sv.classList.add('bump');
    renderStreak();

    const pen=G.hintPenalty>0?`<br><span class="fb-penalty">🔍 Hint penalty: −${G.hintPenalty}pts</span>`:'';
    showFeedback(true,'✅','Bilkul Sahi! +'+pts+'pts',(G.currentQ.explanation||'Excellent!')+pen);

    if(G.qNum>=cfg.rounds && G.score>0) { showDoubleOrNothing(); return; }
  } else {
    G.streak=0;
    G.history.push({q:G.currentQ.question,correct:false,userAns:rawAns,rightAns:G.currentQ.answer,hintsUsed:G.hintsUsed});
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
  G.history.push({q:'💀 DOUBLE OR NOTHING accepted',correct:null,userAns:'',rightAns:''});

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

    // Override submit for DON
    document.getElementById('submitBtn').onclick=submitDON;
    inp.onkeydown=e=>{ if(e.key==='Enter') submitDON(); };

    renderStreak(); startTimer(); setTimeout(()=>inp.focus(),150);
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

  const correct=checkAnswer(rawAns,G.currentQ.answer);
  inp.className='ans-input '+(correct?'correct':'wrong');

  if(correct) {
    G.score=G.donBet*DON_MULTIPLIER;
    G.history.push({q:G.currentQ.question,correct:true,userAns:rawAns,rightAns:G.currentQ.answer,pts:G.score,hintsUsed:G.hintsUsed});
    document.getElementById('scoreDisplay').textContent=G.score;
    showFeedback(true,'🎉','DOUBLE OR NOTHING JEETA!',`${G.donBet} × ${DON_MULTIPLIER} = <strong>${G.score} pts!</strong> 🏆`);
  } else {
    G.history.push({q:G.currentQ.question,correct:false,userAns:rawAns,rightAns:G.currentQ.answer,hintsUsed:G.hintsUsed});
    showFeedback(false,'💀','HAARE! Score ZERO!',
      `Sahi tha: <span class="fb-ans">${G.currentQ.answer}</span><br><small>${G.currentQ.explanation||''}</small>`);
  }

  const nb=document.getElementById('nextBtn');
  nb.textContent='🏁 Results Dekho →'; nb.className='next-btn show'; nb.onclick=showResults;

  // FIX: Restore original handlers after DON
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
  if     (accuracy>=90){emoji='🌟';title='Zabardast! Expert!';  sub=cfg.name+' tum is category ke king ho! 👑';}
  else if(accuracy>=70){emoji='🏆';title='Bahut Accha!';         sub='Solid performance '+cfg.name+'! Keep it up!';}
  else if(accuracy>=50){emoji='👍';title='Theek Hai!';            sub='Aur practice karo '+cfg.name+', behtar hoge!';}
  else                  {emoji='💪';title='Keep Practicing!';     sub=cfg.name+', haar mat mano! Dobara koshish karo 💪';}

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

/* Play same settings again */
function playAgain() {
  clearInterval(G.timerId);
  G=freshGame();
  startGame();
}

/* Go back to category pick */
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
  // FIX: Don't add 'selected' here — HTML already has it on the math card
  // Just ensure diff and rounds defaults are applied
  document.querySelector('.diff-btn[data-d="Medium"]').classList.add('active');
  document.querySelector('.round-btn[data-r="10"]').classList.add('active');
})();
