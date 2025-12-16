// js/quiz.js
(function (w, d) {

  let quranData = [];
  let selectedAyats = [];
  let currentAyat = null;

  let quizIndex = 0;
  let score = 0;

  let usedIndexes = [];
  let mode = 'practice';
  let totalQuestions = 9999;

  let timer = null;
  let hintCount = 0;
  let maxHints = 2;

  /* ---------------- INIT ---------------- */
  function init() {
    quranData = (w.QuranData && w.QuranData.getAll()) || [];

    const modeForm = d.getElementById('modeForm');
    if (modeForm) {
      modeForm.addEventListener('change', () => {
        mode = d.querySelector('input[name="quizMode"]:checked').value;
        totalQuestions = (mode === 'timed') ? 10 : 9999;
      });
    }
  }

  /* ---------------- START GAME ---------------- */
  function startGame() {
    quranData = (w.QuranData && w.QuranData.getAll()) || [];

    const fromPara = parseInt(d.getElementById('fromPara').value);
    const toPara = parseInt(d.getElementById('toPara').value);

    const err = d.getElementById('selectError');
    err.classList.add('hidden');

    if (isNaN(fromPara) || isNaN(toPara) || fromPara < 1 || toPara > 30 || fromPara > toPara) {
      err.textContent = "❌ Para range galat hai";
      err.classList.remove('hidden');
      return;
    }

    selectedAyats = quranData.filter(a => {
      const para = ((a.page - 1) / 20 | 0) + 1;
      return para >= fromPara && para <= toPara;
    });

    if (!selectedAyats.length) {
      err.textContent = "❌ Is range me koi ayat nahi mili";
      err.classList.remove('hidden');
      return;
    }

    quizIndex = 0;
    score = 0;
    usedIndexes = [];

    hintCount = 0;
    maxHints = Level.getHintLimit();
    d.getElementById('hintInfo').textContent = `Hint: 0/${maxHints}`;
    d.getElementById('hintBtn').disabled = false;

    nextQuestion();
    showSection('quizScreen');
    updateScore();
  }

  /* ---------------- RANDOM INDEX ---------------- */
  function randomAyatIndex() {
    if (Level.getLevel() !== 'medium') {
      return Math.floor(Math.random() * selectedAyats.length);
    }

    if (usedIndexes.length >= selectedAyats.length) return 0;

    let i;
    do {
      i = Math.floor(Math.random() * selectedAyats.length);
    } while (usedIndexes.includes(i));

    usedIndexes.push(i);
    return i;
  }

  /* ---------------- NEXT QUESTION ---------------- */
  function nextQuestion() {

    // reset UI
    const nextBtn = d.querySelector('.next-button');
    if (nextBtn) nextBtn.classList.add('hidden');

    const res = d.getElementById('quizResult');
    if (res) res.classList.add('hidden');

    const submitBtn = d.querySelector('#answerForm button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;

    if (quizIndex >= totalQuestions) {
      endQuiz();
      return;
    }

    currentAyat = Level.pickAyat(selectedAyats, randomAyatIndex);
    if (!currentAyat) {
      endQuiz();
      return;
    }

    if (w.ayatTypingEffect) {
      w.ayatTypingEffect(currentAyat.text);
    } else {
      d.getElementById('ayatText').textContent = currentAyat.text;
    }

    quizIndex++;

    const prog = d.getElementById('quizProgress');
    prog.textContent =
      mode === 'practice'
        ? "Practice Mode"
        : `Sawal: ${quizIndex} / ${totalQuestions}`;

    if (mode === 'timed') startTimer(30);
    else clearTimer();
  }

  /* ---------------- TIMER ---------------- */
  function startTimer(sec) {
    let t = sec;
    const box = d.getElementById('timer');
    box.textContent = `⏱️ ${t}s`;

    clearTimer();
    timer = setInterval(() => {
      t--;
      box.textContent = `⏱️ ${t}s`;
      if (t <= 0) {
        clearTimer();
        showWrong("⏱️ Time's up!");
        if (mode === 'survival') setTimeout(endQuiz, 1200);
      }
    }, 1000);
  }

  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    d.getElementById('timer').textContent = '';
  }

  /* ---------------- ANSWER ---------------- */
  function checkAnswer() {
    clearTimer();

    const submitBtn = d.querySelector('#answerForm button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    const userPara = parseInt(d.getElementById('user_para').value);
    const actualPara = ((currentAyat.page - 1) / 20 | 0) + 1;

    const res = d.getElementById('quizResult');

    if (userPara === actualPara) {
      score += Level.getScorePerCorrect();
      res.textContent = "✅ Sahi jawab!";
      res.className = "result";
    } else {
      res.innerHTML = `❌ Galat! <br>Sahi Para: ${actualPara}`;
      res.className = "error";

      if (mode === 'survival') {
        setTimeout(endQuiz, 1200);
        return false;
      }
    }

    res.classList.remove('hidden');

    const nextBtn = d.querySelector('.next-button');
    if (nextBtn) nextBtn.classList.remove('hidden');

    updateScore();
    return false;
  }

  /* ---------------- HINT ---------------- */
  function showHint() {
    if (hintCount >= maxHints) return;
    hintCount++;

    d.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${maxHints}`;
    const para = ((currentAyat.page - 1) / 20 | 0) + 1;
    const box = d.getElementById('quizError');
    box.innerHTML = `💡 Para: <b>${para}</b>`;
    box.classList.remove('hidden');

    if (hintCount >= maxHints) d.getElementById('hintBtn').disabled = true;
  }

  /* ---------------- END ---------------- */
  function endQuiz() {
    d.getElementById('finalResult').innerHTML =
      `🎯 Score: <b>${score}</b><br>🧠 Questions: ${quizIndex}`;
    showSection('resultScreen');
  }

  function showWrong(msg) {
    const r = d.getElementById('quizResult');
    r.textContent = msg;
    r.className = "error";
    r.classList.remove('hidden');
  }

  function updateScore() {
    d.getElementById('scoreBoard').textContent = `Score: ${score}`;
  }

  function restartGame(home = false) {
    showSection(home ? 'welcomeScreen' : 'paraSelectScreen');
  }

  /* ---------------- EXPORT ---------------- */
  w.startGame = startGame;
  w.nextQuestion = nextQuestion;
  w.checkAnswer = checkAnswer;
  w.showHint = showHint;
  w.restartGame = restartGame;

  w.Quiz = { init };

})(window, document);
