// --- 1. CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let pageNumPending = null;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// 6-PART LIMITS (Your PDF Breakdown)
const P1 = 101; // Part 1 (1-101)
const P2 = P1 + 100; // 201
const P3 = P2 + 100; // 301
const P4 = P3 + 100; // 401
const P5 = P4 + 100; // 501
const TOTAL_PAGES = 610; // Part 6 ends at 610

const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');

// Juz Start Mapping (For Jumping)
const juzStartPages = [
    1, 22, 42, 62, 82, 102, 122, 142, 162, 182, 
    202, 222, 242, 262, 282, 302, 322, 342, 362, 382, 
    402, 422, 442, 462, 482, 502, 522, 542, 562, 586
];

// Surah Mapping (Standard 15 Line)
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

// --- 2. LOGIC: 6-PART FILE SELECTION ---
function getPartInfo(globalPage) {
    if (globalPage <= P1) return { file: 'part1.pdf', offset: 0, partNum: 1 };
    if (globalPage <= P2) return { file: 'part2.pdf', offset: P1, partNum: 2 };
    if (globalPage <= P3) return { file: 'part3.pdf', offset: P2, partNum: 3 };
    if (globalPage <= P4) return { file: 'part4.pdf', offset: P3, partNum: 4 };
    if (globalPage <= P5) return { file: 'part5.pdf', offset: P4, partNum: 5 };
    return { file: 'part6.pdf', offset: P5, partNum: 6 };
}

// --- 3. LOGIC: PARA PAGE COUNTS ---
function getParaPageCount(paraIndex) {
    if (paraIndex === 1) return 21;
    if (paraIndex === 29) return 24;
    if (paraIndex === 30) return 25;
    return 20; // Default
}

// --- 4. HD RENDER ENGINE ---
async function loadAndRender() {
    if (typeof pdfjsLib === 'undefined') {
        document.getElementById('page-info').innerText = "No Internet!";
        return;
    }

    const info = getPartInfo(currentGlobalPage);
    let localPage = currentGlobalPage - info.offset;

    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = `Loading Part ${info.partNum}...`;
            pdfDoc = await pdfjsLib.getDocument(info.file).promise;
            pdfDoc.sourceFile = info.file;
        } catch (err) {
            console.error(err);
            document.getElementById('page-info').innerText = "File Error!";
            return;
        }
    }
    
    document.getElementById('part-info').innerText = `(File: ${info.file}, Loc: ${localPage})`;
    renderPage(localPage);
}

async function renderPage(num) {
    pageRendering = true;
    if (num < 1) num = 1;
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;

    try {
        const page = await pdfDoc.getPage(num);
        
        // HD Quality Scale (2.5x)
        const qualityScale = 2.5; 
        const viewport = page.getViewport({ scale: qualityScale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // CSS takes care of fitting it to screen
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        const renderCtx = { canvasContext: ctx, viewport: viewport };
        await page.render(renderCtx).promise;
        
        pageRendering = false;
        updateUI();
    } catch (e) {
        console.error("Render Error:", e);
        pageRendering = false;
    }
}

// --- 5. UI UPDATES ---
function updateUI() {
    document.getElementById('page-info').innerText = `Pg ${currentGlobalPage} / ${TOTAL_PAGES}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage / TOTAL_PAGES) * 100}%`;
    const btn = document.getElementById('bookmarkBtn');
    if(btn) btn.innerHTML = bookmarks.includes(currentGlobalPage) ? '❤️' : '🤍';
    document.getElementById('prev-btn').disabled = (currentGlobalPage <= 1);
    document.getElementById('next-btn').disabled = (currentGlobalPage >= TOTAL_PAGES);
    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// --- 6. NAVIGATION & DROPDOWNS ---
function fillPageDropdown(selectElement, paraIndex) {
    selectElement.innerHTML = '<option value="">-- Select Page --</option>';
    if (!paraIndex) return;

    let startPage = juzStartPages[parseInt(paraIndex) - 1];
    let count = getParaPageCount(parseInt(paraIndex));

    for (let i = 1; i <= count; i++) {
        let realPage = startPage + i - 1;
        // User sees "Page 1", Value is "Real Page"
        selectElement.add(new Option(`Page ${i}`, realPage));
    }
}

function handleParaChange(paraIndex) {
    const sub = document.getElementById('sub-page-select');
    if (sub) {
        fillPageDropdown(sub, paraIndex);
        if(paraIndex) jumpToPage(juzStartPages[parseInt(paraIndex)-1]);
    }
}

function populateOverlayPages(paraIndex) {
    const initPage = document.getElementById('init-page');
    if(initPage) fillPageDropdown(initPage, paraIndex);
}

function startFromOverlay() {
    const p = document.getElementById('init-page').value;
    const para = document.getElementById('init-juz').value;
    
    if (p) currentGlobalPage = parseInt(p);
    else if (para) currentGlobalPage = juzStartPages[parseInt(para) - 1];
    
    closeOverlay();
    loadAndRender();
}

function closeOverlay() {
    localStorage.setItem('hasVisited', 'true');
    const ov = document.getElementById('selectionOverlay');
    if(ov) ov.style.display = 'none';
}

function changePage(step) {
    if (pageRendering) return;
    let target = currentGlobalPage + step;
    if (target >= 1 && target <= TOTAL_PAGES) {
        currentGlobalPage = target;
        loadAndRender();
        window.scrollTo(0,0);
    }
}

function jumpToPage(p) {
    if(!p) return;
    currentGlobalPage = parseInt(p);
    loadAndRender();
    closeNav();
}

// --- 7. INITIALIZATION ---
function initApp() {
    const jSel = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    
    // Fill Para Lists
    if(jSel && iJSel) {
        juzStartPages.forEach((p, i) => {
            let txt = `Para ${i+1}`;
            jSel.add(new Option(txt, i+1));
            iJSel.add(new Option(txt, i+1));
        });
        iJSel.value = 1; // Default
        populateOverlayPages(1);
    }

    // Fill Surah List
    const sSel = document.getElementById('surah-select');
    if(sSel) {
        Object.entries(surahMap).forEach(([id, data]) => {
            sSel.add(new Option(`${id}. ${data[0]}`, data[1]));
        });
    }

    if(localStorage.getItem('hasVisited')) closeOverlay();
    if(isNightMode) document.body.classList.add('night-mode');
    
    renderBookmarksList();
    loadAndRender();
}

// Helpers
function toggleNightMode() {
    isNightMode = !isNightMode;
    document.body.classList.toggle('night-mode', isNightMode);
    localStorage.setItem('nightMode', isNightMode);
}
function filterSurahs() {
    let input = document.getElementById('surahSearch').value.toLowerCase();
    Array.from(document.getElementById('surah-select').options).forEach(opt => {
        opt.style.display = opt.text.toLowerCase().includes(input) ? "block" : "none";
    });
}
function toggleBookmark() {
    if(bookmarks.includes(currentGlobalPage)) bookmarks = bookmarks.filter(p => p !== currentGlobalPage);
    else bookmarks.push(currentGlobalPage);
    localStorage.setItem('quranBookmarks', JSON.stringify(bookmarks));
    updateUI();
    renderBookmarksList();
}
function renderBookmarksList() {
    const list = document.getElementById('bookmarksList');
    if(list) {
        list.innerHTML = bookmarks.map(p => 
            `<button class="btn-primary" style="padding:5px; margin:2px; font-size:11px;" onclick="jumpToPage(${p})">${p}</button>`
        ).join('');
    }
}
function openNav() { 
    document.getElementById("mySidebar").style.width = "300px"; 
    document.getElementById("sidebarOverlay").style.display = "block";
}
function closeNav() { 
    document.getElementById("mySidebar").style.width = "0"; 
    document.getElementById("sidebarOverlay").style.display = "none";
}

window.onload = initApp;
                         
