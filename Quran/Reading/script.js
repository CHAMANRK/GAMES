let currentP = parseInt(localStorage.getItem('quranLastPage')) || 1;
const totalP = 604;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// Surah Map
const surahMap = {
    1:["Al-Fatihah",1],2:["Al-Baqarah",2],3:["Al-Imran",50],4:["An-Nisa",77],
    5:["Al-Ma'idah",106],6:["Al-An'am",128],7:["Al-A'raf",151],8:["Al-Anfal",177],
    9:["At-Tawbah",187],10:["Yunus",208],11:["Hud",221],12:["Yusuf",235],
    13:["Ar-Ra'd",249],14:["Ibrahim",255],15:["Al-Hijr",262],16:["An-Nahl",267],
    17:["Al-Isra",282],18:["Al-Kahf",293],19:["Maryam",305],20:["Ta-Ha",312],
    21:["Al-Anbiya",322],22:["Al-Hajj",332],23:["Al-Mu'minun",342],24:["An-Nur",350],
    25:["Al-Furqan",359],26:["Ash-Shu'ara",367],27:["An-Naml",377],28:["Al-Qasas",385],
    29:["Al-Ankabut",396],30:["Ar-Rum",404],31:["Luqman",411],32:["As-Sajdah",415],
    33:["Al-Ahzab",418],34:["Saba",428],35:["Fatir",434],36:["Ya-Sin",440],
    37:["As-Saffat",446],38:["Sad",453],39:["Az-Zumar",458],40:["Ghafir",467],
    41:["Fussilat",477],42:["Ash-Shura",483],43:["Az-Zukhruf",489],44:["Ad-Dukhan",496],
    45:["Al-Jathiyah",499],46:["Al-Ahqaf",502],47:["Muhammad",507],48:["Al-Fath",511],
    49:["Al-Hujurat",515],50:["Qaf",518],51:["Adh-Dhariyat",520],52:["At-Tur",523],
    53:["An-Najm",526],54:["Al-Qamar",528],55:["Ar-Rahman",531],56:["Al-Waqi'ah",534],
    57:["Al-Hadid",537],58:["Al-Mujadilah",542],59:["Al-Hashr",545],60:["Al-Mumtahanah",549],
    61:["As-Saff",551],62:["Al-Jumu'ah",553],63:["Al-Munafiqun",554],64:["At-Taghabun",556],
    65:["At-Talaq",558],66:["At-Tahrim",560],67:["Al-Mulk",562],68:["Al-Qalam",564],
    69:["Al-Haqqah",567],70:["Al-Ma'arij",568],71:["Nuh",570],72:["Al-Jinn",572],
    73:["Al-Muzzammil",574],74:["Al-Muddaththir",575],75:["Al-Qiyamah",577],76:["Al-Insan",578],
    77:["Al-Mursalat",580],78:["An-Naba",582],79:["An-Nazi'at",583],80:["Abasa",585],
    81:["At-Takwir",586],82:["Al-Infitar",587],83:["Al-Mutaffifin",587],84:["Al-Inshiqaq",589],
    85:["Al-Buruj",590],86:["At-Tariq",591],87:["Al-A'la",591],88:["Al-Ghashiyah",592],
    89:["Al-Fajr",593],90:["Al-Balad",594],91:["Ash-Shams",595],92:["Al-Layl",595],
    93:["Ad-Duha",596],94:["Ash-Sharh",596],95:["At-Tin",597],96:["Al-Alaq",597],
    97:["Al-Qadr",598],98:["Al-Bayyinah",598],99:["Az-Zalzalah",599],100:["Al-Adiyat",599],
    101:["Al-Qari'ah",600],102:["At-Takathur",600],103:["Al-Asr",601],104:["Al-Humazah",601],
    105:["Al-Fil",601],106:["Quraysh",602],107:["Al-Ma'un",602],108:["Al-Kawthar",602],
    109:["Al-Kafirun",603],110:["An-Nasr",603],111:["Al-Masad",603],112:["Al-Ikhlas",604],
    113:["Al-Falaq",604],114:["An-Nas",604]
};

const juzMap = Array.from({length: 30}, (_, i) => (i * 20) + 2).map((p, i) => i === 0 ? 1 : p);

// --- Page Turn Logic ---
function changePage(step) {
    let target = currentP + step;
    if (target < 1 || target > totalP) return; // Glitch fix

    const img = document.getElementById('quran-img');
    const animation = step > 0 ? 'flip-left' : 'flip-right';

    img.classList.add(animation);
    setTimeout(() => {
        currentP = target;
        updateDisplay();
        img.classList.remove(animation);
    }, 400);
}

function updateDisplay() {
    document.getElementById('quran-img').src = `Images/${currentP}.png`;
    document.getElementById('page-info').innerText = `Page ${currentP} / ${totalP}`;
    document.getElementById('progressBar').style.width = `${(currentP / totalP) * 100}%`;
    
    // Heart Icon status
    document.getElementById('bookmarkBtn').innerHTML = bookmarks.includes(currentP) ? '❤️' : '🤍';
    
    // Buttons lock
    document.getElementById('prev-btn').disabled = (currentP <= 1);
    document.getElementById('next-btn').disabled = (currentP >= totalP);

    localStorage.setItem('quranLastPage', currentP);
    closeNav();
    window.scrollTo(0,0);
}

// --- Sidebar & Search ---
function toggleNightMode() {
    isNightMode = !isNightMode;
    document.body.classList.toggle('night-mode', isNightMode);
    localStorage.setItem('nightMode', isNightMode);
}

function filterSurahs() {
    let input = document.getElementById('surahSearch').value.toLowerCase();
    let select = document.getElementById('surah-select');
    Array.from(select.options).forEach(opt => {
        opt.style.display = opt.text.toLowerCase().includes(input) ? "block" : "none";
    });
}

function openNav() { document.getElementById("mySidebar").style.width = "280px"; }
function closeNav() { document.getElementById("mySidebar").style.width = "0"; }

// --- Bookmarks ---
function toggleBookmark() {
    if (bookmarks.includes(currentP)) {
        bookmarks = bookmarks.filter(p => p !== currentP);
    } else {
        bookmarks.push(currentP);
    }
    localStorage.setItem('quranBookmarks', JSON.stringify(bookmarks));
    updateDisplay();
    renderBookmarks();
}

function renderBookmarks() {
    const container = document.getElementById('bookmarksList');
    container.innerHTML = bookmarks.map(p => 
        `<button class="btn" style="padding:5px 10px; font-size:12px;" onclick="jumpToPage(${p})">Page ${p}</button>`
    ).join('');
}

// --- Navigation Helpers ---
function initialStart(val) { if(val) { currentP = parseInt(val); closeOverlay(); } }

function closeOverlay() {
    localStorage.setItem('hasVisited', 'true');
    document.getElementById('selectionOverlay').style.display = 'none';
    updateDisplay();
}

function jumpToPage(p) { currentP = parseInt(p); updateDisplay(); }

function handleParaChange(start) {
    const sub = document.getElementById('sub-page-select');
    sub.innerHTML = '<option value="">-- Choose Page --</option>';
    for(let i=0; i<20; i++) {
        let p = parseInt(start) + i;
        if(p > totalP) break;
        sub.add(new Option(`Page ${i+1}`, p));
    }
    jumpToPage(start);
}

// Double Tap to Zoom logic
let lastTap = 0;
document.getElementById('imageContainer').addEventListener('click', function(e) {
    let now = new Date().getTime();
    if(now - lastTap < 300) { this.classList.toggle('zoomed'); }
    lastTap = now;
});

// --- Initialization ---
window.onload = () => {
    const jSel = document.getElementById('juz-select');
    const sSel = document.getElementById('surah-select');
    const iJSel = document.getElementById('init-juz');
    const iSSel = document.getElementById('init-surah');

    // Populate Para
    juzMap.forEach((p, i) => {
        let optText = `Para ${i+1}`;
        jSel.add(new Option(optText, p));
        iJSel.add(new Option(optText, p));
    });

    // Populate Surah
    Object.entries(surahMap).forEach(([id, data]) => {
        let name = `${id}. ${data[0]}`;
        sSel.add(new Option(name, data[1]));
        iSSel.add(new Option(name, data[1]));
    });

    if(localStorage.getItem('hasVisited')) document.getElementById('selectionOverlay').style.display = 'none';
    if(isNightMode) document.body.classList.add('night-mode');
    renderBookmarks();
    updateDisplay();
};
