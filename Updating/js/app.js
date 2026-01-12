const UI = {
  showScreen(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }
};

const Quiz = {
  allData:[], questions:[],
  currentIndex:0, score:0, streak:0,
  mode:'practice',
  timer:null,
  soundEnabled:true,
  hintUsed:0,

  playBG(){
    if(this.soundEnabled){
      document.getElementById('bgMusic').play().catch(()=>{});
    }
  },

  toggleSound(){
    this.soundEnabled=!this.soundEnabled;
    document.getElementById('soundToggle').innerText=this.soundEnabled?'🔊':'🔇';
    if(!this.soundEnabled){
      document.getElementById('bgMusic').pause();
      document.getElementById('heartbeat').pause();
    }
  },

  selectMode(el,mode){
    document.querySelectorAll('.mode-card').forEach(m=>m.classList.remove('active'));
    el.classList.add('active');
    this.mode=mode;
  },

  async start(){
    const from=Number(document.getElementById('fromPara').value)||1;
    const to=Number(document.getElementById('toPara').value)||30;

    const res=await fetch('quran_full.json');
    this.allData=await res.json();

    // Para approx mapping (20 pages = 1 para)
    const pool=this.allData.filter(a=>{
      const para=Math.ceil(a.page/20);
      return para>=from && para<=to;
    });

    if(!pool.length) return alert("Is para range me ayat nahi mili");

    this.questions=pool.sort(()=>Math.random()-0.5).slice(0,10);
    this.currentIndex=0; this.score=0; this.streak=0; this.hintUsed=0;

    UI.showScreen('quizScreen');
    this.load();
  },

  load(){
    clearInterval(this.timer);
    const q=this.questions[this.currentIndex];

    document.getElementById('ayatText').innerText=q.text;
    document.getElementById('quizProgress').innerText=
      `Q ${this.currentIndex+1}/${this.questions.length}`;

    document.getElementById('resultMessage').innerHTML='';
    document.getElementById('hintInfo').innerText=`Hint: ${this.hintUsed}/2`;
    document.getElementById('nextBtn').classList.add('hidden');

    if(this.mode!=='practice') this.startTimer();
  },

  startTimer(){
    let t=25;
    document.getElementById('timer').innerText=t+"s";
    this.timer=setInterval(()=>{
      t--; document.getElementById('timer').innerText=t+"s";
      if(t<=0){ clearInterval(this.timer); this.handleAnswer(null,true); }
    },1000);
  },

  showHint(){
    if(this.hintUsed>=2) return;
    this.hintUsed++;
    const q=this.questions[this.currentIndex];
    document.getElementById('resultMessage').innerHTML=
      `<small>Surah: ${q.surah_name}</small>`;
    document.getElementById('hintInfo').innerText=`Hint: ${this.hintUsed}/2`;
  },

  handleAnswer(e,timeout=false){
    if(e) e.preventDefault();
    clearInterval(this.timer);

    const userPara=Number(document.getElementById('userParaInput').value);
    const correctPara=Math.ceil(this.questions[this.currentIndex].page/20);

    if(!timeout && userPara===correctPara){
      this.score++; this.streak++;
      document.getElementById('correctSound').play();
      document.getElementById('resultMessage').innerHTML=
        `<span style="color:var(--neon-green)">Correct!</span>`;
    }else{
      this.streak=0;
      document.getElementById('wrongSound').play();
      document.getElementById('resultMessage').innerHTML=
        `Wrong! Para ${correctPara}`;
      if(this.mode==='survival') return this.end();
    }
    document.getElementById('nextBtn').classList.remove('hidden');
  },

  next(){
    this.currentIndex++;
    if(this.currentIndex<this.questions.length) this.load();
    else this.end();
  },

  end(){
    UI.showScreen('gameOverScreen');
    document.getElementById('finalStats').innerHTML=
      `<h2>${this.score}/${this.questions.length}</h2>`;
  }
};
