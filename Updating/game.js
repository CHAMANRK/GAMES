// game.js - Main quiz logic, scoring, modes, and timers
(function() {
  let currentAyat = null;
  let selectedAyats = [];
  let fromPara = 1, toPara = 30;
  let quizIndex = 0;
  let score = 0;
  let totalQuestions = 10;
  let mode = 'practice';
  let usedIndexes = [];
  let bestSurah = '';
  let surahCorrectCount = {};
  let startTime = 0, totalTime = 0, timer = null, timePerQ = [];
  let survivalActive = true;
  let hintCount = 0;
  const maxHints = 2;

  // Mode selection (radio)
  document.getElementById('modeForm').addEventListener('change', e => {
    mode = document.querySelector('input[name="quizMode"]:checked').value;
  });

  // Start Game: Para range
  function startGame() {
    fromPara = parseInt(document.getElementById('fromPara').value);
    toPara = parseInt(document.getElementById('toPara').value);
    const errDiv = document.getElementById('selectError');
    errDiv.classList.add('hidden');
    if (isNaN(fromPara) || isNaN(toPara) || fromPara < 1 || toPara > 30 || fromPara > toPara) {
      errDiv.textContent = "❌ Galat range! Para range 1–30 ke andar aur From <= To hona zaruri hai.";
      errDiv.classList.remove('hidden');
      return;
    }
    if (!window.quranData || window.quranData.length === 0) {
      errDiv.textContent = "❌ Quran data abhi load nahi hui.";
      errDiv.classList.remove('hidden');
      return;
    }
    selectedAyats = window.quranData.filter(
      a => fromPara <= (((a.page - 1) / 20 | 0) + 1) && (((a.page - 1) / 20 | 0) + 1) <= toPara
    );
    if (!selectedAyats.length) {
      errDiv.textContent = "❌ Is range ke andar ayat nahi mile.";
      errDiv.classList.remove('hidden');
      return;
    }
    quizIndex = 0;
    score = 0;
    usedIndexes = [];
    bestSurah = '';
    surahCorrectCount = {};
    timePerQ = [];
    totalTime = 0;
    hintCount = 0;
    document.getElementById('hintBtn').disabled = false;
    document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${maxHints}`;
    document.getElementById('survivalAnswer').classList.add('hidden');
    if (mode === 'timed') totalQuestions = 10;
    else if (mode === 'practice') totalQuestions = 9999;
    else if (mode === 'survival') totalQuestions = 9999, survivalActive = true;
    nextQuestion();
    window.showSection('quizScreen');
    updateScore();
  }

  // Prevent repeat questions
  function randomAyatIndex() {
    if (usedIndexes.length >= Math.min(totalQuestions, selectedAyats.length)) return -1;
    let i;
    do {
      i = Math.floor(Math.random() * selectedAyats.length);
    } while (usedIndexes.includes(i));
    usedIndexes.push(i);
    return i;
  }

  // Next random ayat/question
  function nextQuestion() {
    document.getElementById('quizError').classList.add('hidden');
    document.getElementById('quizResult').classList.add('hidden');
    document.getElementById('survivalAnswer').classList.add('hidden');
    document.getElementById('answerForm').reset();
    document.querySelector('.next-button').classList.add('hidden');
    document.getElementById('hintBtn').disabled = hintCount >= maxHints;
    document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${maxHints}`;
    if (quizIndex >= totalQuestions || usedIndexes.length >= selectedAyats.length) {
      endQuiz();
      return;
    }
    const i = randomAyatIndex();
    if (i === -1) {
      endQuiz();
      return;
    }
    currentAyat = selectedAyats[i];
    window.ayatTypingEffect ? window.ayatTypingEffect(currentAyat.text) : document.getElementById('ayatText').textContent = currentAyat.text;
    quizIndex++;
    updateScore();
    document.getElementById('quizProgress').textContent =
      mode === 'practice' ? `Practice Mode` : `Sawalat: ${quizIndex} / ${mode==='timed'?totalQuestions:'∞'}`;
    startTime = Date.now();
    if (mode === 'timed') {
      startTimer(30);
    } else {
      document.getElementById('timer').textContent = '';
    }
  }

  // Timer for Timed mode
  function startTimer(seconds) {
    let time = seconds;
    document.getElementById('timer').textContent = `⏱️ ${time}s`;
    startTime = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      time--;
      document.getElementById('timer').textContent = `⏱️ ${time}s`;
      if (time <= 0) {
        clearInterval(timer);
        document.getElementById('timer').textContent = "⏱️ Time's up!";
        timePerQ.push(seconds);
        showWrong("⏱️ Time's up!");
        if (mode === 'survival') {
          showSurvivalAnswer();
          setTimeout(() => endQuiz(), 1900);
        }
        else document.querySelector('.next-button').classList.remove('hidden');
      }
    }, 1000);
  }

  // Show wrong answer feedback
  function showWrong(message) {
    const resultDiv = document.getElementById('quizResult');
    resultDiv.textContent = message;
    resultDiv.classList.remove('hidden', 'result');
    resultDiv.classList.add('error');
  }

  // Answer check
  function checkAnswer() {
    if (mode === 'timed' && timer) clearInterval(timer);
    let timeSpent = Math.round((Date.now() - startTime)/1000);
    const user_page = document.getElementById('user_page').value.trim();
    const user_para = document.getElementById('user_para').value.trim();
    const user_page_in_para = document.getElementById('user_page_in_para').value.trim();
    const user_surah = document.getElementById('user_surah').value.trim().toLowerCase();

    const errorDiv = document.getElementById('quizError');
    const resultDiv = document.getElementById('quizResult');
    errorDiv.classList.add('hidden');
    resultDiv.classList.add('hidden');
    document.querySelector('.next-button').classList.add('hidden');
    document.getElementById('survivalAnswer').classList.add('hidden');
    let resultParts = [];
    let page_check = false, para_check = false, page_in_para_check = false, surah_check = true;

    if (!user_page && (!user_para || !user_page_in_para)) {
      errorDiv.textContent = "❌ Kam az kam Page Number ya Para Number + Page In Para likhiye.";
      errorDiv.classList.remove('hidden');
      setTimeout(()=>errorDiv.classList.add('hidden'), 2300);
      return false;
    }

    const page_num_in_data = parseInt(currentAyat.page);
    const actual_para_num = ((page_num_in_data - 1) / 20 | 0) + 1;
    const actual_page_in_para = ((page_num_in_data - 1) % 20) + 1;

    // Page Number Check
    if (user_page) {
      const user_page_num = parseInt(user_page);
      if (user_page_num === page_num_in_data) {
        page_check = true;
      } else {
        resultParts.push(`❌ Page Number Galat! Sahi: ${page_num_in_data}`);
      }
    }

    // Para + Page in Para Check
    if (user_para && user_page_in_para) {
      const user_para_num = parseInt(user_para);
      const user_page_in_para_num = parseInt(user_page_in_para);
      if (user_para_num === actual_para_num) {
        para_check = true;
      } else {
        resultParts.push(`❌ Para Galat! Sahi: ${actual_para_num}`);
      }
      if (user_page_in_para_num + 1 === actual_page_in_para) {
        page_in_para_check = true;
      } else {
        resultParts.push(`❌ Page In Para Galat! Sahi: ${actual_page_in_para - 1}`);
      }
    }

    // Surah Name Check
    if (user_surah) {
      if (!currentAyat.surah_name.toLowerCase().includes(user_surah)) {
        resultParts.push(`❌ Surah Name Galat! Sahi: ${currentAyat.surah_name}`);
        surah_check = false;
      }
    }

    // Final Result
    let isCorrect = ((!user_page || page_check) && para_check && page_in_para_check && surah_check);
    if (isCorrect) {
      score++;
      let sname = currentAyat.surah_name;
      surahCorrectCount[sname] = (surahCorrectCount[sname]||0)+1;
      resultDiv.textContent = "✅ Sahi! +1 Point";
      resultDiv.classList.remove('hidden', 'error');
      resultDiv.classList.add('result');
    } else {
      resultDiv.innerHTML = resultParts.join('<br>') || "❌ Kuch Galat Hai ❌<br> 0 Point";
      resultDiv.classList.remove('hidden', 'result');
      resultDiv.classList.add('error');
      if(mode==='survival') {
        survivalActive = false;
        showSurvivalAnswer();
        setTimeout(() => endQuiz(), 1900);
        timePerQ.push(timeSpent);
        updateScore();
        return false;
      }
    }
    document.querySelector('.next-button').classList.remove('hidden');
    timePerQ.push(timeSpent);
    updateScore();
    setTimeout(() => resultDiv.classList.add('hidden'), 5000);
    return false;
  }

  // Survival mode wrong answer show
  function showSurvivalAnswer() {
    let div = document.getElementById('survivalAnswer');
    let page_num_in_data = parseInt(currentAyat.page);
    let actual_para_num = ((page_num_in_data - 1) / 20 | 0) + 1;
    let actual_page_in_para = ((page_num_in_data - 1) % 20) + 1;
    div.innerHTML = `<b>Sahi Jawab:</b><br>
    Surah: <b>${currentAyat.surah_name}</b><br>
    Para: <b>${actual_para_num}</b><br>
    Page: <b>${page_num_in_data}</b><br>
    Page in Para: <b>${actual_page_in_para-1}</b>`;
    div.classList.remove('hidden');
  }

  // Show result/summary at end
  function endQuiz() {
    let bestSurahName = '';
    let maxCorrect = 0;
    Object.entries(surahCorrectCount).forEach(([s,c])=>{
      if(c>maxCorrect){maxCorrect=c; bestSurahName=s;}
    });
    let avgTime = timePerQ.length ? Math.round(timePerQ.reduce((a,b)=>a+b,0)/timePerQ.length) : 0;
    document.getElementById('finalResult').innerHTML = `
      🧠 Your Score: <b>${score}/${quizIndex}</b><br>
      📖 Best Surah: <b>${bestSurahName||'-'}</b><br>
      ⏱️ Average Time: <b>${avgTime} sec</b><br>
      <br>${mode==='survival' && !survivalActive ? '💥 Survival Ended!':'🎉 Mubarak!'}
    `;
    window.showSection('resultScreen');
  }

  // Restart Game
  function restartGame(home=false) {
    quizIndex = 0;
    score = 0;
    usedIndexes = [];
    bestSurah = '';
    surahCorrectCount = {};
    timePerQ = [];
    totalTime = 0;
    hintCount = 0;
    document.getElementById('hintBtn').disabled = false;
    document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${maxHints}`;
    if(home) window.showSection('welcomeScreen');
    else window.showSection('paraSelectScreen');
  }

  // Hint system
  function showHint() {
    if(hintCount >= maxHints) return;
    hintCount++;
    document.getElementById('hintInfo').textContent = `Hint: ${hintCount}/${maxHints}`;
    if(hintCount >= maxHints) document.getElementById('hintBtn').disabled = true;
    let surahWords = currentAyat.surah_name.split(" ");
    let first2 = surahWords.slice(0,2).join(" ");
    let para = ((parseInt(currentAyat.page)-1)/20|0)+1;
    document.getElementById('quizError').innerHTML =
      `<b>Hint:</b> Surah: <b>${first2}...</b>, Para: <b>${para}</b>`;
    document.getElementById('quizError').classList.remove('hidden');
    setTimeout(() => document.getElementById('quizError').classList.add('hidden'), 3200);
  }

  // Score board update
  function updateScore() {
    document.getElementById('scoreBoard').innerHTML = `Score: ${score} / ${quizIndex}`;
  }

  // Expose to window
  window.startGame = startGame;
  window.nextQuestion = nextQuestion;
  window.checkAnswer = checkAnswer;
  window.showHint = showHint;
  window.restartGame = restartGame;

  window.Game = {
    startGame: startGame,
    nextQuestion: nextQuestion,
    checkAnswer: checkAnswer,
    showHint: showHint,
    restartGame: restartGame
  };
})();
