/* ================= UI CONTROLLER ================= */
const UI = {
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s =>
      s.classList.remove('active')
    );
    document.getElementById(id).classList.add('active');

    if (id === 'modeScreen' && Quiz.soundEnabled) {
      Quiz.playBG();
    }
  }
};

/* ================= QUIZ ENGINE ================= */
const Quiz = {
  allData: [],
  questions: [],
  currentIndex: 0,
  score: 0,
  streak: 0,
  mode: 'practice',
  timerInterval: null,
  soundEnabled: true,

  /* ---------- SOUND ---------- */
  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    const btn = document.getElementById('soundToggle');
    const bg = document.getElementById('bgMusic');
    const hb = document.getElementById('heartbeat');

    btn.innerText = this.soundEnabled ? '🔊' : '🔇';

    if (!this.soundEnabled) {
      bg.pause();
      hb.pause();
    } else {
      bg.play().catch(() => {});
    }
  },

  playBG() {
    if (this.soundEnabled) {
      document.getElementById('bgMusic').play().catch(() => {});
    }
  },

  /* ---------- MODE ---------- */
  selectMode(el, mode) {
    document.querySelectorAll('.mode-card').forEach(m =>
      m.classList.remove('active')
    );
    el.classList.add('active');
    this.mode = mode;
  },

  /* ---------- START GAME ---------- */
  async start() {
    const fromPage = parseInt(
      document.getElementById('fromPara').value
    ) || 1;
    const toPage = parseInt(
      document.getElementById('toPara').value
    ) || 604;

    try {
      const res = await fetch('quran_full.json');
      this.allData = await res.json();

      const pool = this.allData.filter(
        a => a.page >= fromPage && a.page <= toPage
      );

      if (pool.length === 0) {
        alert('Is page range mein koi ayat nahi mili');
        return;
      }

      this.questions = pool
        .sort(() => Math.random() - 0.5)
        .slice(0, 10);

      this.currentIndex = 0;
      this.score = 0;
      this.streak = 0;

      UI.showScreen('quizScreen');
      this.loadQuestion();

    } catch (e) {
      alert('Quran data load nahi ho saka');
      console.error(e);
    }
  },

  /* ---------- LOAD QUESTION ---------- */
  loadQuestion() {
    clearInterval(this.timerInterval);

    const q = this.questions[this.currentIndex];
    document.getElementById('ayatText').innerText = q.text;
    document.getElementById('quizProgress').innerText =
      `Q ${this.currentIndex + 1} / ${this.questions.length}`;

    document.getElementById('resultMessage').innerHTML = '';
    document.getElementById('userParaInput').value = '';
    document.getElementById('nextBtn').classList.add('hidden');
    document.getElementById('streakBadge').innerText = '';

    if (this.mode !== 'practice') {
      this.startTimer();
    }

    if (this.mode === 'survival' && this.soundEnabled) {
      document.getElementById('heartbeat').play().catch(() => {});
    }
  },

  /* ---------- TIMER ---------- */
  startTimer() {
    let timeLeft = this.mode === 'timed' ? 25 : 20;
    document.getElementById('timer').innerText = timeLeft + 's';

    this.timerInterval = setInterval(() => {
      timeLeft--;
      document.getElementById('timer').innerText = timeLeft + 's';

      if (timeLeft <= 0) {
        clearInterval(this.timerInterval);
        this.handleAnswer(null, true);
      }
    }, 1000);
  },

  /* ---------- ANSWER ---------- */
  handleAnswer(e, timeout = false) {
    if (e) e.preventDefault();
    clearInterval(this.timerInterval);

    const input = document.getElementById('userParaInput');
    const userVal = parseInt(input.value);
    const correctPage = this.questions[this.currentIndex].page;

    const card = document.getElementById('mainQuizCard');
    card.className = 'card neon-card quiz-card';

    if (!timeout && userVal === correctPage) {
      this.score++;
      this.streak++;

      if (this.soundEnabled)
        document.getElementById('correctSound').play();

      this.applyStreakEffects();

      document.getElementById('resultMessage').innerHTML =
        `<span style="color:var(--neon-green)">Correct!</span>`;
    } else {
      this.streak = 0;

      if (this.soundEnabled)
        document.getElementById('wrongSound').play();

      document.getElementById('resultMessage').innerHTML =
        `<span style="color:var(--danger)">
          Wrong! Page ${correctPage}
        </span>`;

      if (this.mode === 'survival') {
        setTimeout(() => this.end(), 1200);
        return;
      }
    }

    document.getElementById('nextBtn').classList.remove('hidden');
  },

  /* ---------- STREAK FX ---------- */
  applyStreakEffects() {
    const card = document.getElementById('mainQuizCard');
    const badge = document.getElementById('streakBadge');

    if (this.streak >= 10) {
      card.classList.add('legendary-glow');
      badge.innerText = '👑 LEGENDARY';
    } else if (this.streak >= 5) {
      card.classList.add('speed-glow');
      badge.innerText = '⚡ SPEED';
    } else if (this.streak >= 3) {
      card.classList.add('fire-glow');
      badge.innerText = '🔥 FIRE';
    }
  },

  /* ---------- NEXT ---------- */
  next() {
    this.currentIndex++;
    if (this.currentIndex < this.questions.length) {
      this.loadQuestion();
    } else {
      this.end();
    }
  },

  /* ---------- GAME OVER ---------- */
  end() {
    clearInterval(this.timerInterval);
    document.getElementById('heartbeat').pause();

    UI.showScreen('gameOverScreen');
    document.getElementById('finalStats').innerHTML = `
      <p style="font-size:2rem">${this.score} / ${this.questions.length}</p>
      <p>Accuracy: ${Math.round((this.score / this.questions.length) * 100)}%</p>
    `;
  }
};
