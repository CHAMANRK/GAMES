const UI = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        if(id === 'modeScreen') this.playMusic();
    },
    toggleSound() {
        const bg = document.getElementById('bgMusic');
        const btn = document.getElementById('soundToggle');
        if (bg.paused) {
            bg.play();
            btn.innerText = "🔊";
        } else {
            bg.pause();
            btn.innerText = "🔇";
        }
    },
    playMusic() {
        document.getElementById('bgMusic').volume = 0.3;
        document.getElementById('bgMusic').play().catch(() => {});
    }
};

const Quiz = {
    data: [], questions: [], currentIndex: 0, score: 0, streak: 0,
    mode: 'practice', timerInterval: null,

    selectMode(el, mode) {
        document.querySelectorAll('.mode-card').forEach(m => m.classList.remove('active'));
        el.classList.add('active');
        this.mode = mode;
    },

    async start() {
        const from = parseInt(document.getElementById('fromPara').value) || 1;
        const to = parseInt(document.getElementById('toPara').value) || 30;
        
        const response = await fetch('quran_full.json');
        const allData = await response.json();
        const pool = allData.filter(a => a.para >= from && a.para <= to);
        
        if(pool.length === 0) return alert("No ayats in this range!");

        this.questions = pool.sort(() => 0.5 - Math.random()).slice(0, 10);
        this.currentIndex = 0; this.score = 0; this.streak = 0;
        
        UI.showScreen('quizScreen');
        this.loadQuestion();
    },

    loadQuestion() {
        const q = this.questions[this.currentIndex];
        document.getElementById('ayatText').innerText = q.text;
        document.getElementById('quizProgress').innerText = `Q ${this.currentIndex + 1} / 10`;
        document.getElementById('nextBtn').classList.add('hidden');
        document.getElementById('userParaInput').value = "";
        
        if(this.mode !== 'practice') this.startTimer();
        if(this.mode === 'survival') document.getElementById('heartbeat').play();
    },

    startTimer() {
        let timeLeft = 30;
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            timeLeft--;
            document.getElementById('timer').innerText = timeLeft;
            if(timeLeft <= 0) {
                clearInterval(this.timerInterval);
                this.handleAnswer(null, true);
            }
        }, 1000);
    },

    handleAnswer(e, timeOut = false) {
        if(e) e.preventDefault();
        clearInterval(this.timerInterval);
        
        const userVal = parseInt(document.getElementById('userParaInput').value);
        const correctVal = this.questions[this.currentIndex].para;
        const card = document.getElementById('mainQuizCard');
        
        if(!timeOut && userVal === correctVal) {
            this.score++; this.streak++;
            this.applyEffects();
            document.getElementById('resultMessage').innerHTML = "<span style='color:#39ff14'>Sahi Jawab!</span>";
        } else {
            this.streak = 0;
            card.className = "card neon-card quiz-card"; // Reset effects
            document.getElementById('resultMessage').innerHTML = `<span style='color:#ff4d4d'>Galat! Para ${correctVal} tha.</span>`;
            if(this.mode === 'survival') return setTimeout(() => this.end(), 1000);
        }
        document.getElementById('nextBtn').classList.remove('hidden');
    },

    applyEffects() {
        const card = document.getElementById('mainQuizCard');
        const badge = document.getElementById('streakBadge');
        
        if(this.streak >= 10) {
            card.classList.add('legendary-glow');
            badge.innerText = "👑 LEGENDARY MODE";
        } else if(this.streak >= 5) {
            card.classList.add('speed-glow');
            badge.innerText = "⚡ SPEED BONUS";
        } else if(this.streak >= 3) {
            card.classList.add('fire-glow');
            badge.innerText = "🔥 FIRE STREAK";
        }
    },

    next() {
        this.currentIndex++;
        if(this.currentIndex < this.questions.length) this.loadQuestion();
        else this.end();
    },

    end() {
        document.getElementById('heartbeat').pause();
        UI.showScreen('gameOverScreen');
        document.getElementById('finalStats').innerHTML = `<h3>Score: ${this.score}/10</h3><p>Streak: ${this.streak}</p>`;
    }
};
      
