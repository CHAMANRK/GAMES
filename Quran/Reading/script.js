pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// --- VARIABLES ---
let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';
let currentZoom = 1.5; // Default zoom
let isZenMode = false;

// 6-PART CONFIG
const P1 = 101, P2 = 201, P3 = 301, P4 = 401, P5 = 501, TOTAL_PAGES = 610;

const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');

// MAPPINGS
const juzStartPages = [1,22,42,62,82,102,122,142,162,182,202,222,242,262,282,302,322,342,362,382,402,422,442,462,482,502,522,542,562,586];
const surahMap =
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
// --- 1. OFFLINE DOWNLOAD MANAGER ---
async function checkDownloadStatus() {
    if(!localStorage.getItem('offlineDataDownloaded')) {
        document.getElementById('downloadModal').style.display = 'flex';
    }
}

async function startDownload() {
    const files = ['part1.pdf', 'part2.pdf', 'part3.pdf', 'part4.pdf', 'part5.pdf', 'part6.pdf'];
    const progressBar = document.getElementById('dl-progress-bar');
    const statusText = document.getElementById('dl-status');
    
    document.getElementById('dl-progress-container').style.display = 'block';
    
    if ('caches' in window) {
        try {
            const cache = await caches.open('quran-pdf-cache-v1');
            for (let i = 0; i < files.length; i++) {
                statusText.innerText = `Downloading ${files[i]}...`;
                await cache.add(files[i]);
                progressBar.style.width = `${((i+1)/files.length)*100}%`;
            }
            localStorage.setItem('offlineDataDownloaded', 'true');
            alert("Download Complete! Ab aap bina internet ke padh sakte hain.");
            document.getElementById('downloadModal').style.display = 'none';
        } catch (err) {
            alert("Download Failed: " + err.message);
        }
    } else {
        alert("Aapka browser offline save support nahi karta.");
    }
}

function skipDownload() {
    document.getElementById('downloadModal').style.display = 'none';
}

// --- 2. FILE SELECTION (Offline First) ---
function getPartInfo(globalPage) {
    if (globalPage <= P1) return { file: 'part1.pdf', offset: 0, part: 1 };
    if (globalPage <= P2) return { file: 'part2.pdf', offset: P1, part: 2 };
    if (globalPage <= P3) return { file: 'part3.pdf', offset: P2, part: 3 };
    if (globalPage <= P4) return { file: 'part4.pdf', offset: P3, part: 4 };
    if (globalPage <= P5) return { file: 'part5.pdf', offset: P4, part: 5 };
    return { file: 'part6.pdf', offset: P5, part: 6 };
}

async function loadAndRender() {
    const info = getPartInfo(currentGlobalPage);
    let localPage = currentGlobalPage - info.offset;
    
    // Check Cache First
    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        document.getElementById('page-info').innerText = `Loading Pt ${info.part}...`;
        
        try {
            // Try fetching from Cache logic here (Simplified: PDF.js handles URLs, if SW is active it intercepts)
            // But to be explicit with cache API:
            let docData = info.file;
            if('caches' in window) {
                const cache = await caches.open('quran-pdf-cache-v1');
                const response = await cache.match(info.file);
                if(response) {
                    const blob = await response.blob();
                    docData = URL.createObjectURL(blob); // Load from Blob
                }
            }
            
            pdfDoc = await pdfjsLib.getDocument(docData).promise;
            pdfDoc.sourceFile = info.file;
        } catch (err) {
            document.getElementById('page-info').innerText = "Load Error";
            console.error(err);
            return;
        }
    }
    
    document.getElementById('part-info').innerText = `(File: Part${info.part}, Loc: ${localPage})`;
    renderPage(localPage);
}

// --- 3. RENDER WITH ZOOM ---
async function renderPage(num) {
    pageRendering = true;
    if (num < 1) num = 1; 
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;

    const page = await pdfDoc.getPage(num);
    
    // Use Current Zoom Slider Value
    const pixelRatio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: currentZoom * pixelRatio });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    canvas.style.height = "auto";

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    pageRendering = false;
    updateUI();
}

function handleZoom(val) {
    currentZoom = parseFloat(val);
    loadAndRender(); // Re-render with new zoom
}

// --- 4. SWIPE LOGIC ---
let touchStartX = 0;
let touchEndX = 0;
const gestureZone = document.getElementById('mainContainer');

gestureZone.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
gestureZone.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, false);

function handleSwipe() {
    if (touchEndX < touchStartX - 50) changePage(1); // Swipe Left -> Next
    if (touchEndX > touchStartX + 50) changePage(-1); // Swipe Right -> Prev
}

// --- 5. ZEN MODE ---
function toggleZenMode() {
    isZenMode = !isZenMode;
    document.body.classList.toggle('zen-active', isZenMode);
    // Double tap on screen creates Zen mode toggle too
}
document.getElementById('pdf-render').addEventListener('dblclick', toggleZenMode);

// --- 6. STANDARD LOGIC (Nav, Dropdowns, etc) ---
function changePage(step) {
    if (pageRendering) return;
    let target = currentGlobalPage + step;
    if (target >= 1 && target <= TOTAL_PAGES) {
        currentGlobalPage = target;
        loadAndRender();
        window.scrollTo(0,0);
    }
}

function updateUI() {
    document.getElementById('page-info').innerText = `Pg ${currentGlobalPage}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage/TOTAL_PAGES)*100}%`;
    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// Para Page Counts (Same as before)
function getParaPageCount(idx) {
    if(idx===1) return 21; if(idx===29) return 24; if(idx===30) return 25; return 20;
}

function fillPageDropdown(el, idx) {
    el.innerHTML = '<option value="">-- Page --</option>';
    let start = juzStartPages[idx-1];
    let count = getParaPageCount(idx);
    for(let i=1; i<=count; i++) el.add(new Option(`Page ${i}`, start+i-1));
}

function handleParaChange(val) {
    const sub = document.getElementById('sub-page-select');
    if(val) {
        fillPageDropdown(sub, parseInt(val));
        jumpToPage(juzStartPages[parseInt(val)-1]);
    }
}

function jumpToPage(p) {
    if(!p) return;
    currentGlobalPage = parseInt(p);
    loadAndRender();
    closeNav();
}

// --- INITIALIZATION ---
window.onload = () => {
    // Dropdowns Fill
    const jSel = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    juzStartPages.forEach((p, i) => {
        jSel.add(new Option(`Para ${i+1}`, i+1));
        iJSel.add(new Option(`Para ${i+1}`, i+1));
    });
    iJSel.value = 1;
    fillPageDropdown(document.getElementById('init-page'), 1);

    // Surah Fill (Add your full list here)
    const sSel = document.getElementById('surah-select');
    Object.entries(surahMap).forEach(([id, data]) => sSel.add(new Option(`${id}. ${data[0]}`, data[1])));

    // Settings Load
    if(localStorage.getItem('hasVisited')) document.getElementById('selectionOverlay').style.display='none';
    if(isNightMode) document.body.classList.add('night-mode');
    
    // Check for Download
    checkDownloadStatus();
    loadAndRender();
};

// Overlay & Nav Helpers
function startFromOverlay() {
    const p = document.getElementById('init-page').value;
    const para = document.getElementById('init-juz').value;
    if(p) currentGlobalPage = parseInt(p);
    else if(para) currentGlobalPage = juzStartPages[parseInt(para)-1];
    document.getElementById('selectionOverlay').style.display='none';
    localStorage.setItem('hasVisited','true');
    loadAndRender();
}
function toggleNightMode() {
    isNightMode = !isNightMode;
    document.body.classList.toggle('night-mode', isNightMode);
    localStorage.setItem('nightMode', isNightMode);
}
function openNav() { document.getElementById("mySidebar").style.width = "300px"; document.getElementById("sidebarOverlay").style.display="block";}
function closeNav() { document.getElementById("mySidebar").style.width = "0"; document.getElementById("sidebarOverlay").style.display="none";}
