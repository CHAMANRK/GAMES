pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- STATE ---
let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let isZoomed = false;
let isZenMode = false;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// --- CONFIG ---
const P1=101, P2=201, P3=301, P4=401, P5=501, TOTAL_PAGES=610;
const juzStartPages = [1,22,42,62,82,102,122,142,162,182,202,222,242,262,282,302,322,342,362,382,402,422,442,462,482,502,522,542,562,586];
const surahMap = {
    1: ["Al-Fatihah", 1], 2: ["Al-Baqarah", 2], 3: ["Al-Imran", 50], 4: ["An-Nisa", 77],
    5: ["Al-Ma'idah", 106], 6: ["Al-An'am", 128], 7: ["Al-A'raf", 151], 8: ["Al-Anfal", 177],
    9: ["At-Tawbah", 187], 10: ["Yunus", 208], 11: ["Hud", 221], 12: ["Yusuf", 235],
    13: ["Ar-Ra'd", 249], 14: ["Ibrahim", 255], 15: ["Al-Hijr", 262], 16: ["An-Nahl", 267],
    17: ["Al-Isra", 282], 18: ["Al-Kahf", 293], 19: ["Maryam", 305], 20: ["Ta-Ha", 312],
    21: ["Al-Anbiya", 322], 22: ["Al-Hajj", 332], 23: ["Al-Mu'minun", 342], 24: ["An-Nur", 350],
    25: ["Al-Furqan", 359], 26: ["Ash-Shu'ara", 367], 27: ["An-Naml", 377], 28: ["Al-Qasas", 385],
    29: ["Al-Ankabut", 396], 30: ["Ar-Rum", 404], 31: ["Luqman", 411], 32: ["As-Sajdah", 415],
    33: ["Al-Ahzab", 418], 34: ["Saba", 428], 35: ["Fatir", 434], 36: ["Ya-Sin", 440],
    37: ["As-Saffat", 446], 38: ["Sad", 453], 39: ["Az-Zumar", 458], 40: ["Ghafir", 467],
    41: ["Fussilat", 477], 42: ["Ash-Shura", 483], 43: ["Az-Zukhruf", 489], 44: ["Ad-Dukhan", 496],
    45: ["Al-Jathiyah", 499], 46: ["Al-Ahqaf", 502], 47: ["Muhammad", 507], 48: ["Al-Fath", 511],
    49: ["Al-Hujurat", 515], 50: ["Qaf", 518], 51: ["Adh-Dhariyat", 520], 52: ["At-Tur", 523],
    53: ["An-Najm", 526], 54: ["Al-Qamar", 528], 55: ["Ar-Rahman", 531], 56: ["Al-Waqi'ah", 534],
    57: ["Al-Hadid", 537], 58: ["Al-Mujadilah", 542], 59: ["Al-Hashr", 545], 60: ["Al-Mumtahanah", 549],
    61: ["As-Saff", 551], 62: ["Al-Jumu'ah", 553], 63: ["Al-Munafiqun", 554], 64: ["At-Taghabun", 556],
    65: ["At-Talaq", 558], 66: ["At-Tahrim", 560], 67: ["Al-Mulk", 562], 68: ["Al-Qalam", 564],
    69: ["Al-Haqqah", 567], 70: ["Al-Ma'arij", 568], 71: ["Nuh", 570], 72: ["Al-Jinn", 572],
    73: ["Al-Muzzammil", 574], 74: ["Al-Muddaththir", 575], 75: ["Al-Qiyamah", 577], 76: ["Al-Insan", 578],
    77: ["Al-Mursalat", 580], 78: ["An-Naba", 582], 79: ["An-Nazi'at", 583], 80: ["Abasa", 585],
    81: ["At-Takwir", 586], 82: ["Al-Infitar", 587], 83: ["Al-Mutaffifin", 587], 84: ["Al-Inshiqaq", 589],
    85: ["Al-Buruj", 590], 86: ["At-Tariq", 591], 87: ["Al-A'la", 591], 88: ["Al-Ghashiyah", 592],
    89: ["Al-Fajr", 593], 90: ["Al-Balad", 594], 91: ["Ash-Shams", 595], 92: ["Al-Layl", 595],
    93: ["Ad-Duha", 596], 94: ["Ash-Sharh", 596], 95: ["At-Tin", 597], 96: ["Al-Alaq", 597],
    97: ["Al-Qadr", 598], 98: ["Al-Bayyinah", 598], 99: ["Az-Zalzalah", 599], 100: ["Al-Adiyat", 599],
    101: ["Al-Qari'ah", 600], 102: ["At-Takathur", 600], 103: ["Al-Asr", 601], 104: ["Al-Humazah", 601],
    105: ["Al-Fil", 601], 106: ["Quraysh", 602], 107: ["Al-Ma'un", 602], 108: ["Al-Kawthar", 602],
    109: ["Al-Kafirun", 603], 110: ["An-Nasr", 603], 111: ["Al-Masad", 603], 112: ["Al-Ikhlas", 604],
    113: ["Al-Falaq", 604], 114: ["An-Nas", 604]
};

const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');

// --- 1. INITIALIZATION ---
window.onload = function() {
    // Fill Para Dropdowns (Ensures they are never empty)
    const jSel = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    jSel.innerHTML = ''; iJSel.innerHTML = ''; // Clean start
    
    juzStartPages.forEach((p, i) => {
        let txt = `Para ${i+1}`;
        jSel.add(new Option(txt, i+1));
        iJSel.add(new Option(txt, i+1));
    });
    iJSel.value = 1; 
    fillPageDropdown(document.getElementById('init-page'), 1);

    // Fill Surah Dropdown
    const sSel = document.getElementById('surah-select');
    sSel.innerHTML = '';
    Object.entries(surahMap).forEach(([id, data]) => {
        sSel.add(new Option(`${id}. ${data[0]}`, data[1]));
    });

    // Check Previous State
    if(localStorage.getItem('hasVisited')) {
        document.getElementById('selectionOverlay').style.display='none';
    }
    if(isNightMode) document.body.classList.add('night-mode');
    
    // Check Offline Status
    if(!localStorage.getItem('offlineDownloaded')) {
        document.getElementById('downloadModal').style.display='flex';
    }

    renderBookmarksList();
    loadAndRender();
};

// --- 2. RENDER ENGINE (6-PART + HD) ---
function getPartInfo(globalPage) {
    if (globalPage <= P1) return { file: 'part1.pdf', offset: 0 };
    if (globalPage <= P2) return { file: 'part2.pdf', offset: P1 };
    if (globalPage <= P3) return { file: 'part3.pdf', offset: P2 };
    if (globalPage <= P4) return { file: 'part4.pdf', offset: P3 };
    if (globalPage <= P5) return { file: 'part5.pdf', offset: P4 };
    return { file: 'part6.pdf', offset: P5 };
}

async function loadAndRender() {
    if(typeof pdfjsLib === 'undefined') return;
    
    const info = getPartInfo(currentGlobalPage);
    let localPage = currentGlobalPage - info.offset;

    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = "Loading...";
            let finalUrl = info.file;
            // Check Offline Cache
            if('caches' in window) {
                const cache = await caches.open('quran-cache-v1');
                const resp = await cache.match(info.file);
                if(resp) {
                    const blob = await resp.blob();
                    finalUrl = URL.createObjectURL(blob);
                }
            }
            pdfDoc = await pdfjsLib.getDocument(finalUrl).promise;
            pdfDoc.sourceFile = info.file;
        } catch (e) {
            console.error(e);
            document.getElementById('page-info').innerText = "Error (Check Internet)";
            return;
        }
    }
    renderPage(localPage);
}

async function renderPage(num) {
    pageRendering = true;
    const page = await pdfDoc.getPage(num);
    
    // HD Render Scale 2.5
    const viewport = page.getViewport({ scale: 2.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    
    pageRendering = false;
    updateUI();
}

// --- 3. GESTURES & ZOOM ---
let lastTap = 0;
let touchStartX = 0;
const touchZone = document.getElementById('touchArea');
const zoomWrapper = document.getElementById('zoomWrapper');

// Double Tap to Zoom / Exit Zen
touchZone.addEventListener('touchend', function(e) {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
        e.preventDefault();
        toggleZoom();
        if(isZenMode) toggleZenMode(); // Double tap also exits Zen Mode
    }
    lastTap = currentTime;
    
    let touchEndX = e.changedTouches[0].screenX;
    handleSwipe(touchEndX);
});

touchZone.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, {passive: false});

function toggleZoom() {
    isZoomed = !isZoomed;
    if(isZoomed) zoomWrapper.classList.add('zoomed');
    else zoomWrapper.classList.remove('zoomed');
}

function handleSwipe(endX) {
    if(isZoomed) return; // No swipe if zoomed
    const diff = endX - touchStartX;
    if(Math.abs(diff) > 50) {
        // SWAPPED: Left->Right = Next, Right->Left = Prev
        if(diff > 0) changePage(1); 
        else changePage(-1);
    }
}

// --- 4. FEATURES ---
function toggleZenMode() {
    isZenMode = !isZenMode;
    document.body.classList.toggle('zen-active', isZenMode);
}

function toggleBookmark() {
    const btn = document.getElementById('bookmarkBtn');
    if(bookmarks.includes(currentGlobalPage)) {
        bookmarks = bookmarks.filter(p => p !== currentGlobalPage);
        btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    } else {
        bookmarks.push(currentGlobalPage);
        btn.innerHTML = '<i class="fa-solid fa-heart" style="color:red;"></i>';
    }
    localStorage.setItem('quranBookmarks', JSON.stringify(bookmarks));
    renderBookmarksList();
}

// Offline Download
async function startDownload() {
    const files = ['part1.pdf', 'part2.pdf', 'part3.pdf', 'part4.pdf', 'part5.pdf', 'part6.pdf'];
    const bar = document.getElementById('dl-bar');
    const status = document.getElementById('dl-status');
    document.getElementById('dl-progress').style.display='block';
    
    try {
        const cache = await caches.open('quran-cache-v1');
        for(let i=0; i<files.length; i++) {
            status.innerText = `Downloading Part ${i+1}/6...`;
            await cache.add(files[i]);
            bar.style.width = `${((i+1)/files.length)*100}%`;
        }
        localStorage.setItem('offlineDownloaded', 'true');
        alert("Download Complete! You can now read offline.");
        skipDownload();
    } catch(e) {
        alert("Download Failed: " + e.message);
    }
}

function skipDownload() {
    document.getElementById('downloadModal').style.display='none';
}

// --- 5. NAVIGATION ---
function changePage(step) {
    if(pageRendering) return;
    let target = currentGlobalPage + step;
    if(target >= 1 && target <= TOTAL_PAGES) {
        currentGlobalPage = target;
        loadAndRender();
        window.scrollTo(0,0);
    }
}

function updateUI() {
    document.getElementById('page-info').innerText = `Page ${currentGlobalPage}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage/TOTAL_PAGES)*100}%`;
    
    const btn = document.getElementById('bookmarkBtn');
    if(bookmarks.includes(currentGlobalPage)) {
        btn.innerHTML = '<i class="fa-solid fa-heart" style="color:red;"></i>';
    } else {
        btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// Dropdown Logic
function getParaPageCount(idx) {
    if(idx===1) return 21; if(idx===29) return 24; if(idx===30) return 25; return 20;
}
function fillPageDropdown(el, idx) {
    el.innerHTML = '<option value="">Select Page</option>';
    let start = juzStartPages[idx-1];
    let count = getParaPageCount(idx);
    for(let i=1; i<=count; i++) el.add(new Option(`Page ${i}`, start+i-1));
}
function handleParaChange(val) {
    const sub = document.getElementById('sub-page-select');
    fillPageDropdown(sub, parseInt(val));
    if(val) jumpToPage(juzStartPages[parseInt(val)-1]);
}
function populateOverlayPages(val) {
    fillPageDropdown(document.getElementById('init-page'), parseInt(val));
}
function startFromOverlay() {
    const p = document.getElementById('init-page').value;
    const para = document.getElementById('init-juz').value;
    if(p) currentGlobalPage = parseInt(p);
    else if(para) currentGlobalPage = juzStartPages[parseInt(para)-1];
    localStorage.setItem('hasVisited', 'true');
    document.getElementById('selectionOverlay').style.display='none';
    loadAndRender();
}
function jumpToPage(p) {
    if(!p) return;
    currentGlobalPage = parseInt(p);
    loadAndRender();
    closeNav();
}

// Helpers
function toggleNightMode() {
    isNightMode = !isNightMode;
    document.body.classList.toggle('night-mode', isNightMode);
    localStorage.setItem('nightMode', isNightMode);
}
function renderBookmarksList() {
    document.getElementById('bookmarksList').innerHTML = bookmarks.map(p => 
        `<button class="action-btn" onclick="jumpToPage(${p})">${p}</button>`
    ).join('');
}
function filterSurahs() {
    let input = document.getElementById('surahSearch').value.toLowerCase();
    Array.from(document.getElementById('surah-select').options).forEach(opt => {
        opt.style.display = opt.text.toLowerCase().includes(input) ? "block" : "none";
    });
}
function openNav() { document.getElementById("mySidebar").style.width = "300px"; document.getElementById("sidebarOverlay").style.display="block";}
function closeNav() { document.getElementById("mySidebar").style.width = "0"; document.getElementById("sidebarOverlay").style.display="none";}
  
