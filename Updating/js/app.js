const UI = {
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        if(id === 'modeScreen' && Quiz.soundEnabled) Quiz.playBG();
    }
};

const Quiz = {
    data: [], questions: [], currentIndex: 0, score: 0, streak: 0,
    mode: 'practice', timerInterval: null, soundEnabled: true,

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        const btn = document.getElementById('soundToggle');
        const bg = document.getElementById('bgMusic');
        btn.innerText = this.soundEnabled ? "🔊" : "🔇";
        if(!this.soundEnabled) { 
            bg.pause(); 
            document.getElementById('heartbeat').pause(); 
        } else if(document.getElementById('quizScreen').classList.contains('active')) {
            bg.play();
        }
    },

    playBG() { if(this.soundEnabled) document.getElementById('bgMusic').play().catch(()=>{}); },

    selectMode(el, mode) {
        document.querySelectorAll('.mode-card').forEach(m => m.classList.remove('active'));
        el.classList.add('active');
        this.mode = mode;
    },

    async start() {
        const from = parseInt(document.getElementById('fromPara').value) || 1;
        const to = parseInt(document.getElementById('toPara').value) || 30;
        
        try {
            const response = await fetch('quran_full.json');
            const allData = await response.json();
            const pool = allData.filter(a => a.para >= from && a.para <= to);
            
            if(pool.length === 0) return alert("Is range mein ayats nahi hain!");

            this.questions = pool.sort(() => 0.5 - Math.random()).slice(0, 10);
            this.currentIndex = 0; this.score = 0; this.streak = 0;
            UI.showScreen('quizScreen');
            this.loadQuestion();
        } catch(e) { alert("Data load nahi ho saka!"); }
    },

    loadQuestion() {
        const q = this.questions[this.currentIndex];
        document.getElementById('ayatText').innerText = q.text;
        document.getElementById('quizProgress').innerText = `Q ${this.currentIndex + 1} / 10`;
        document.getElementById('resultMessage').innerText = "";
        document.getElementById('userParaInput').value = "";
        document.getElementById('nextBtn').classList.add('hidden');
        
        if(this.mode !== 'practice') this.startTimer();
        if(this.mode === 'survival' && this.soundEnabled) document.getElementById('heartbeat').play();
    },

    startTimer() {
        let timeLeft = this.streak >= 5 ? 15 : 25; 
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            timeLeft--;
            document.getElementById('timer').innerText = timeLeft + "s";
            if(timeLeft <= 0) { 
                clearInterval(this.timerInterval); 
                this.handleAnswer(null, true); 
            }
        }, 1000);
    },

    handleAnswer(e, isTimeout = false) {
        if(e) e.preventDefault();
        clearInterval(this.timerInterval);
        const userVal = parseInt(document.getElementById('userParaInput').value);
        const correctVal = this.questions[this.currentIndex].para;
        const card = document.getElementById('mainQuizCard');

        if(!isTimeout && userVal === correctVal) {
            this.score++; this.streak++;
            if(this.soundEnabled) document.getElementById('correctSound').play();
            this.applyStreakEffects();
            document.getElementById('resultMessage').innerHTML = "<span style='color:var(--neon-green)'>Correct!</span>";
        } else {
            this.streak = 0;
            if(this.soundEnabled) document.getElementById('wrongSound').play();
            card.className = "card neon-card quiz-card"; 
            document.getElementById('resultMessage').innerHTML = `<span style='color:var(--danger)'>Wrong! Para ${correctVal}</span>`;
            if(this.mode === 'survival') return setTimeout(() => this.end(), 1200);
        }
        document.getElementById('nextBtn').classList.remove('hidden');
    },

    applyStreakEffects() {
        const card = document.getElementById('mainQuizCard');
        const badge = document.getElementById('streakBadge');
        card.className = "card neon-card quiz-card";
        if(this.streak >= 10) { 
            card.classList.add('legendary-glow'); 
            badge.innerText = "👑 LEGENDARY"; 
        } else if(this.streak >= 5) { 
            card.classList.add('speed-glow'); 
            badge.innerText = "⚡ SPEED BONUS"; 
        } else if(this.streak >= 3) { 
            card.classList.add('fire-glow'); 
            badge.innerText = "🔥 FIRE GLOW"; 
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
        document.getElementById('finalStats').innerHTML = `<p style="font-size:2rem">${this.score}/10</p>`;
    }
};
