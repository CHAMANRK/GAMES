pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let pdfDoc          = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering   = false;
let isZoomed        = false;
let isZenMode       = false;
let bookmarks       = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let currentTheme    = localStorage.getItem('quranTheme') || 'day';
let pageMode        = localStorage.getItem('pageMode') || 'swipe';  // 'swipe' | 'scroll'
let autoScrollActive = false;
let autoScrollSpeed  = 3;
let autoScrollRAF    = null;
let readingTimerInterval = null;
let sessionSeconds  = 0;
let todaySeconds    = getTodaySeconds();
let lastPageFPNumTimeout = null;
let fabOpen         = false;

// ══════════════════════════════════════
// CONFIG
// ══════════════════════════════════════
const P1=101, P2=201, P3=301, P4=401, P5=501, TOTAL_PAGES=610;
const juzStartPages = [1,22,42,62,82,102,122,142,162,182,202,222,242,262,282,302,322,342,362,382,402,422,442,462,482,502,522,542,562,586];

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

const canvas = document.getElementById('pdf-render');
const ctx    = canvas.getContext('2d');

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
window.onload = function() {
    // Populate dropdowns
    const jSel  = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    jSel.innerHTML = ''; iJSel.innerHTML = '';

    juzStartPages.forEach((p, i) => {
        const txt = `Para ${i+1}`;
        jSel.add(new Option(txt, i+1));
        iJSel.add(new Option(txt, i+1));
    });
    iJSel.value = 1;
    fillPageDropdown(document.getElementById('init-page'), 1);

    // Surah dropdown
    const sSel = document.getElementById('surah-select');
    sSel.innerHTML = '';
    Object.entries(surahMap).forEach(([id, data]) => {
        sSel.add(new Option(`${id}. ${data[0]}`, data[1]));
    });

    // Para Jump Bar
    buildParaJumpBar();

    // Restore state
    if (localStorage.getItem('hasVisited')) {
        document.getElementById('selectionOverlay').style.display = 'none';
    }
    if (!localStorage.getItem('offlineDownloaded')) {
        document.getElementById('downloadModal').style.display = 'flex';
    }

    applyTheme(currentTheme);
    applyPageMode(pageMode);

    renderBookmarksList();
    updateStreak();
    startReadingTimer();
    loadAndRender();
};

// ══════════════════════════════════════
// RENDER ENGINE
// ══════════════════════════════════════
function getPartInfo(gp) {
    if (gp <= P1) return { file: 'part1.pdf', offset: 0   };
    if (gp <= P2) return { file: 'part2.pdf', offset: P1  };
    if (gp <= P3) return { file: 'part3.pdf', offset: P2  };
    if (gp <= P4) return { file: 'part4.pdf', offset: P3  };
    if (gp <= P5) return { file: 'part5.pdf', offset: P4  };
    return             { file: 'part6.pdf', offset: P5  };
}

async function loadAndRender(direction) {
    if (typeof pdfjsLib === 'undefined') return;

    const info = getPartInfo(currentGlobalPage);
    const localPage = currentGlobalPage - info.offset;

    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = 'Loading...';
            let url = info.file;
            if ('caches' in window) {
                const cache = await caches.open('quran-cache-v1');
                const resp  = await cache.match(info.file);
                if (resp) { const blob = await resp.blob(); url = URL.createObjectURL(blob); }
            }
            pdfDoc = await pdfjsLib.getDocument(url).promise;
            pdfDoc.sourceFile = info.file;
        } catch(e) {
            document.getElementById('page-info').innerText = 'Error (Internet check karein)';
            return;
        }
    }
    renderPage(localPage, direction);
}

async function renderPage(num, direction) {
    pageRendering = true;

    // Page turn animation
    const frame = document.getElementById('zoomWrapper');
    if (direction) {
        const cls = direction === 1 ? 'turning-left' : 'turning-right';
        frame.classList.add(cls);
        setTimeout(() => frame.classList.remove(cls), 350);
        showRipple();
    }

    const page     = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: 2.5 });
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    pageRendering = false;
    updateUI();
}

// ══════════════════════════════════════
// RIPPLE EFFECT
// ══════════════════════════════════════
function showRipple() {
    const r = document.getElementById('pageRipple');
    r.classList.remove('animate');
    void r.offsetWidth;
    r.classList.add('animate');
}

// ══════════════════════════════════════
// FLOATING PAGE NUMBER
// ══════════════════════════════════════
function showFloatingPageNum() {
    const fp = document.getElementById('floatingPageNum');
    fp.classList.add('visible');
    clearTimeout(lastPageFPNumTimeout);
    lastPageFPNumTimeout = setTimeout(() => fp.classList.remove('visible'), 2500);
}

// ══════════════════════════════════════
// TOUCH / SWIPE (only in swipe mode)
// ══════════════════════════════════════
let lastTap     = 0;
let touchStartX = 0;
const touchZone   = document.getElementById('touchArea');
const zoomWrapper = document.getElementById('zoomWrapper');

touchZone.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

touchZone.addEventListener('touchend', e => {
    const now = Date.now();
    const gap = now - lastTap;
    if (gap < 280 && gap > 0) {
        e.preventDefault();
        toggleZoom();
        if (isZenMode) toggleZenMode();
    }
    lastTap = now;

    if (pageMode === 'swipe') {
        handleSwipe(e.changedTouches[0].screenX);
    }
});

function toggleZoom() {
    isZoomed = !isZoomed;
    zoomWrapper.classList.toggle('zoomed', isZoomed);
}

function handleSwipe(endX) {
    if (isZoomed) return;
    const diff = endX - touchStartX;
    if (Math.abs(diff) > 50) {
        if (diff > 0) changePage(1);   // swipe right = prev (Urdu/Arabic order)
        else changePage(-1);
    }
}

// ══════════════════════════════════════
// PAGE NAVIGATION
// ══════════════════════════════════════
function changePage(step) {
    if (pageRendering) return;
    const target = currentGlobalPage + step;
    if (target >= 1 && target <= TOTAL_PAGES) {
        currentGlobalPage = target;
        loadAndRender(step);
        document.querySelector('.quran-container').scrollTop = 0;
    }
}

// ══════════════════════════════════════
// PAGE MODE: SWIPE vs SCROLL
// ══════════════════════════════════════
function setPageMode(mode) {
    pageMode = mode;
    localStorage.setItem('pageMode', mode);
    applyPageMode(mode);
}

function applyPageMode(mode) {
    const btnSwipe  = document.getElementById('modeSwipe');
    const btnScroll = document.getElementById('modeScroll');
    const autoRow   = document.getElementById('autoScrollRow');
    const speedRow  = document.getElementById('autoScrollSpeed');
    const container = document.querySelector('.quran-container');

    if (mode === 'swipe') {
        btnSwipe.classList.add('active');
        btnScroll.classList.remove('active');
        autoRow.classList.add('hidden');
        speedRow.classList.add('hidden');
        stopAutoScroll();
        container.style.overflowX = 'hidden';
    } else {
        btnScroll.classList.add('active');
        btnSwipe.classList.remove('active');
        autoRow.classList.remove('hidden');
    }
}

// ══════════════════════════════════════
// AUTO SCROLL
// ══════════════════════════════════════
function toggleAutoScroll(enabled) {
    if (enabled) {
        document.getElementById('autoScrollSpeed').classList.remove('hidden');
        startAutoScroll();
    } else {
        document.getElementById('autoScrollSpeed').classList.add('hidden');
        stopAutoScroll();
    }
}

function startAutoScroll() {
    stopAutoScroll();
    autoScrollActive = true;
    const container = document.querySelector('.quran-container');

    function scroll() {
        if (!autoScrollActive) return;
        container.scrollTop += autoScrollSpeed * 0.4;

        // Auto page flip when near bottom
        const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
        if (nearBottom) {
            changePage(-1);
            setTimeout(() => { container.scrollTop = 0; }, 400);
        }
        autoScrollRAF = requestAnimationFrame(scroll);
    }
    autoScrollRAF = requestAnimationFrame(scroll);
}

function stopAutoScroll() {
    autoScrollActive = false;
    if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
    const tog = document.getElementById('autoScrollToggle');
    if (tog) tog.checked = false;
    document.getElementById('autoScrollSpeed').classList.add('hidden');
}

function updateScrollSpeed(val) {
    autoScrollSpeed = parseInt(val);
    document.getElementById('speedLabel').innerText = val;
}

// ══════════════════════════════════════
// THEME
// ══════════════════════════════════════
function setTheme(theme) {
    currentTheme = theme;
    localStorage.setItem('quranTheme', theme);
    applyTheme(theme);
}

function applyTheme(theme) {
    document.body.classList.remove('theme-day', 'theme-sepia', 'theme-night');
    if (theme !== 'day') document.body.classList.add('theme-' + theme);

    // Update active button
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector('.theme-btn.' + theme);
    if (btn) btn.classList.add('active');
}

// ══════════════════════════════════════
// BRIGHTNESS
// ══════════════════════════════════════
function updateBrightness(val) {
    document.documentElement.style.setProperty('--brightness', val / 100);
}

// ══════════════════════════════════════
// ZEN MODE
// ══════════════════════════════════════
function toggleZenMode() {
    isZenMode = !isZenMode;
    document.body.classList.toggle('zen-active', isZenMode);
    const zenTog = document.getElementById('zenToggle');
    if (zenTog) zenTog.checked = isZenMode;
}

// ══════════════════════════════════════
// BOOKMARK
// ══════════════════════════════════════
function toggleBookmark() {
    const btn = document.getElementById('bookmarkBtn');
    if (bookmarks.includes(currentGlobalPage)) {
        bookmarks = bookmarks.filter(p => p !== currentGlobalPage);
    } else {
        bookmarks.push(currentGlobalPage);
    }
    localStorage.setItem('quranBookmarks', JSON.stringify(bookmarks));
    renderBookmarksList();
    updateUI();
}

function renderBookmarksList() {
    const list = document.getElementById('bookmarksList');
    if (bookmarks.length === 0) {
        list.innerHTML = '<span style="font-size:12px;color:var(--text2)">Koi bookmark nahi</span>';
        return;
    }
    list.innerHTML = bookmarks
        .sort((a, b) => a - b)
        .map(p => `<button class="bookmark-chip" onclick="jumpToPage(${p})">P${p}</button>`)
        .join('');
}

// ══════════════════════════════════════
// READING TIMER
// ══════════════════════════════════════
function startReadingTimer() {
    clearInterval(readingTimerInterval);
    readingTimerInterval = setInterval(() => {
        sessionSeconds++;
        todaySeconds++;
        saveTodaySeconds();
        updateTimerDisplay();
    }, 1000);
}

function getTodaySeconds() {
    const key = 'readingTime_' + getTodayKey();
    return parseInt(localStorage.getItem(key)) || 0;
}
function saveTodaySeconds() {
    localStorage.setItem('readingTime_' + getTodayKey(), todaySeconds);
}
function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function updateTimerDisplay() {
    const t = formatTime(sessionSeconds);
    const d = document.getElementById('panel-timer');
    if (d) d.innerText = t;
    const sd = document.getElementById('sb-timer-disp');
    if (sd) {
        const mins = Math.round(todaySeconds / 60);
        sd.innerText = mins < 60 ? mins + 'm' : Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
    }
}

// ══════════════════════════════════════
// READING STREAK
// ══════════════════════════════════════
function updateStreak() {
    const today   = getTodayKey();
    const lastDay = localStorage.getItem('lastReadDay');
    let streak    = parseInt(localStorage.getItem('readingStreak')) || 0;

    if (lastDay !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yKey = yesterday.toISOString().slice(0, 10);
        if (lastDay === yKey) {
            streak++;
        } else if (lastDay !== today) {
            streak = 1;
        }
        localStorage.setItem('lastReadDay', today);
        localStorage.setItem('readingStreak', streak);
    }

    const el1 = document.getElementById('sb-streak');
    const el2 = document.getElementById('panel-streak');
    if (el1) el1.innerText = streak + '🔥';
    if (el2) el2.innerText = streak;
}

// ══════════════════════════════════════
// UI UPDATE
// ══════════════════════════════════════
function getCurrentSurah() {
    let found = { id: 1, name: 'Al-Fatihah' };
    for (const [id, data] of Object.entries(surahMap)) {
        if (data[1] <= currentGlobalPage) found = { id, name: data[0] };
        else break;
    }
    return found;
}
function getCurrentPara() {
    for (let i = juzStartPages.length - 1; i >= 0; i--) {
        if (currentGlobalPage >= juzStartPages[i]) return i + 1;
    }
    return 1;
}

function updateUI() {
    const surah = getCurrentSurah();
    const para  = getCurrentPara();
    const pct   = Math.round((currentGlobalPage / TOTAL_PAGES) * 100);

    // Top bar
    document.getElementById('page-info').innerText  = `Para ${para}  •  Page ${currentGlobalPage}`;
    document.getElementById('surah-info').innerText = surah.name;

    // Progress bar
    document.getElementById('progressBar').style.width = pct + '%';

    // Floating page num
    const fp = document.getElementById('floatingPageNum');
    fp.innerText = `${currentGlobalPage} / ${TOTAL_PAGES}`;
    showFloatingPageNum();

    // Bookmark heart
    const btn = document.getElementById('bookmarkBtn');
    btn.innerHTML = bookmarks.includes(currentGlobalPage)
        ? '<i class="fa-solid fa-heart" style="color:#e74c3c"></i>'
        : '<i class="fa-regular fa-heart"></i>';

    // Para jump bar highlight
    document.querySelectorAll('.para-chip').forEach((c, i) => {
        c.classList.toggle('active', i + 1 === para);
    });

    // Progress ring
    const ring = document.getElementById('progressRing');
    const circumference = 2 * Math.PI * 34;
    const offset = circumference - (pct / 100) * circumference;
    if (ring) { ring.style.strokeDasharray = circumference; ring.style.strokeDashoffset = offset; }
    const rt  = document.getElementById('ringText');
    if (rt) rt.innerText = pct + '%';

    // Panel / sidebar stats
    const pp = document.getElementById('panel-progress');
    if (pp) pp.innerText = pct + '%';
    const sp = document.getElementById('sb-progress');
    if (sp) sp.innerText = pct + '%';

    // Last read info
    const lr = document.getElementById('lastReadInfo');
    if (lr) lr.innerText = `Para ${para} • Page ${currentGlobalPage} • ${surah.name}`;

    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// ══════════════════════════════════════
// PARA JUMP BAR
// ══════════════════════════════════════
function buildParaJumpBar() {
    const inner = document.getElementById('paraJumpInner');
    inner.innerHTML = '';
    juzStartPages.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.className = 'para-chip';
        btn.textContent = i + 1;
        btn.onclick = () => { jumpToPage(p); scrollParaChipIntoView(btn); };
        inner.appendChild(btn);
    });
}

function scrollParaChipIntoView(el) {
    const bar = document.getElementById('paraJumpBar');
    const left = el.offsetLeft - bar.clientWidth / 2 + el.clientWidth / 2;
    bar.scrollTo({ left, behavior: 'smooth' });
}

// ══════════════════════════════════════
// FAB PANEL
// ══════════════════════════════════════
function toggleFabPanel() {
    fabOpen ? closeFabPanel() : openFabPanel();
}
function openFabPanel() {
    fabOpen = true;
    document.getElementById('fabPanel').classList.add('open');
    document.getElementById('fabOverlay').classList.add('visible');
    document.getElementById('fabBtn').classList.add('open');
    document.getElementById('fabIcon').className = 'fa-solid fa-xmark';
}
function closeFabPanel() {
    fabOpen = false;
    document.getElementById('fabPanel').classList.remove('open');
    document.getElementById('fabOverlay').classList.remove('visible');
    document.getElementById('fabBtn').classList.remove('open');
    document.getElementById('fabIcon').className = 'fa-solid fa-sliders';
}

// ══════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════
function openNav() {
    document.getElementById('mySidebar').style.width = '300px';
    document.getElementById('sidebarOverlay').style.display = 'block';
}
function closeNav() {
    document.getElementById('mySidebar').style.width = '0';
    document.getElementById('sidebarOverlay').style.display = 'none';
}

// ══════════════════════════════════════
// DROPDOWN HELPERS
// ══════════════════════════════════════
function getParaPageCount(idx) {
    if (idx === 1) return 21; if (idx === 29) return 24; if (idx === 30) return 25; return 20;
}
function fillPageDropdown(el, idx) {
    el.innerHTML = '<option value="">— Page —</option>';
    const start = juzStartPages[idx - 1];
    const count = getParaPageCount(idx);
    for (let i = 1; i <= count; i++) el.add(new Option(`Page ${i}`, start + i - 1));
}
function handleParaChange(val) {
    fillPageDropdown(document.getElementById('sub-page-select'), parseInt(val));
    if (val) jumpToPage(juzStartPages[parseInt(val) - 1]);
}
function populateOverlayPages(val) {
    fillPageDropdown(document.getElementById('init-page'), parseInt(val));
}
function startFromOverlay() {
    const p    = document.getElementById('init-page').value;
    const para = document.getElementById('init-juz').value;
    if (p) currentGlobalPage = parseInt(p);
    else if (para) currentGlobalPage = juzStartPages[parseInt(para) - 1];
    localStorage.setItem('hasVisited', 'true');
    document.getElementById('selectionOverlay').style.display = 'none';
    loadAndRender();
}
function jumpToPage(p) {
    if (!p) return;
    currentGlobalPage = parseInt(p);
    loadAndRender();
    closeNav();
}
function filterSurahs() {
    const q = document.getElementById('surahSearch').value.toLowerCase();
    Array.from(document.getElementById('surah-select').options).forEach(o => {
        o.style.display = o.text.toLowerCase().includes(q) ? 'block' : 'none';
    });
}

// ══════════════════════════════════════
// OFFLINE DOWNLOAD
// ══════════════════════════════════════
async function startDownload() {
    const files  = ['part1.pdf','part2.pdf','part3.pdf','part4.pdf','part5.pdf','part6.pdf'];
    const bar    = document.getElementById('dl-bar');
    const status = document.getElementById('dl-status');
    document.getElementById('dl-progress').style.display = 'block';
    try {
        const cache = await caches.open('quran-cache-v1');
        for (let i = 0; i < files.length; i++) {
            status.innerText = `Part ${i+1}/6 download ho raha hai...`;
            await cache.add(files[i]);
            bar.style.width = `${((i+1)/files.length)*100}%`;
        }
        localStorage.setItem('offlineDownloaded', 'true');
        alert('Download mukammal! Ab offline padh saktay hain.');
        skipDownload();
    } catch(e) {
        alert('Download fail: ' + e.message);
    }
}
function skipDownload() {
    document.getElementById('downloadModal').style.display = 'none';
}

// ══════════════════════════════════════
// KEYBOARD / VOLUME BUTTONS
// ══════════════════════════════════════
window.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'VolumeUp'   || e.keyCode === 175) { e.preventDefault(); changePage(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'VolumeDown' || e.keyCode === 174) { e.preventDefault(); changePage(-1); }
}, false);
