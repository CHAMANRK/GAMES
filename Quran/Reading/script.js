// --- CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// State Variables
let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let pageNumPending = null;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// PDF Structure (User's Specific Data)
const PART_1_LIMIT = 201; // File: part1.pdf (Pages 1-201)
const PART_2_LIMIT = 401; // File: part2.pdf (Pages 202-401)
const TOTAL_PAGES = 610;  // File: part3.pdf (Pages 402-610)

const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');

// --- SURAH & PARA MAPPING (15 Line Standard) ---
// Note: Standard mapping is 1-604. User's PDF is 610. Minor differences may occur.
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

const juzMap = Array.from({length: 30}, (_, i) => (i * 20) + 2).map((p, i) => i === 0 ? 1 : p);

// --- HELPER: Determine which PDF File to use ---
function getPartInfo(globalPage) {
    // Part 1: Page 1 to 201
    if (globalPage <= PART_1_LIMIT) {
        return { file: 'part1.pdf', offset: 0, partNum: 1 };
    } 
    // Part 2: Page 202 to 401
    else if (globalPage <= PART_2_LIMIT) {
        return { file: 'part2.pdf', offset: PART_1_LIMIT, partNum: 2 };
    } 
    // Part 3: Page 402 to 610
    else {
        return { file: 'part3.pdf', offset: PART_2_LIMIT, partNum: 3 };
    }
}

// --- CORE RENDER LOGIC ---
async function loadAndRender() {
    const info = getPartInfo(currentGlobalPage);
    const localPage = currentGlobalPage - info.offset;

    document.getElementById('part-info').innerText = `(File: Part ${info.partNum}, Local Pg: ${localPage})`;

    // Agar humein PDF file badalni pade (e.g., Part 1 se Part 2)
    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = "Loading File...";
            pdfDoc = await pdfjsLib.getDocument(info.file).promise;
            pdfDoc.sourceFile = info.file; // Tag the file
        } catch (err) {
            console.error(err);
            document.getElementById('page-info').innerText = "Error: File Missing";
            return;
        }
    }

    renderPage(localPage);
}

async function renderPage(num) {
    pageRendering = true;
    
    // Safety check for Local Page
    if (num < 1) num = 1;
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;

    const page = await pdfDoc.getPage(num);
    
    // Responsive Scale Calculation
    const viewportRaw = page.getViewport({ scale: 1 });
    const screenWidth = document.body.clientWidth;
    // Mobile par thoda margin, Desktop par max-width control CSS se hoga
    const desiredScale = (screenWidth < 800) ? (screenWidth - 20) / viewportRaw.width : 1.5;
    
    const viewport = page.getViewport({ scale: desiredScale });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderCtx = { canvasContext: ctx, viewport: viewport };
    await page.render(renderCtx).promise;

    pageRendering = false;
    updateUI();
}

function updateUI() {
    document.getElementById('page-info').innerText = `Page ${currentGlobalPage} / ${TOTAL_PAGES}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage / TOTAL_PAGES) * 100}%`;
    
    // Bookmark Status
    const btn = document.getElementById('bookmarkBtn');
    btn.innerHTML = bookmarks.includes(currentGlobalPage) ? '❤️' : '🤍';
    
    // Buttons Lock
    document.getElementById('prev-btn').disabled = (currentGlobalPage <= 1);
    document.getElementById('next-btn').disabled = (currentGlobalPage >= TOTAL_PAGES);

    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// --- NAVIGATION ---
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

// --- SIDEBAR & OVERLAY LOGIC ---
function openNav() { 
    document.getElementById("mySidebar").style.width = "300px"; 
    document.getElementById("sidebarOverlay").style.display = "block";
}
function closeNav() { 
    document.getElementById("mySidebar").style.width = "0"; 
    document.getElementById("sidebarOverlay").style.display = "none";
}

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

// Overlay Dropdowns Logic
function populateOverlayPages(startPage) {
    const initPage = document.getElementById('init-page');
    initPage.innerHTML = '';
    // Show next 25 pages from selected Para
    for(let i=0; i<25; i++) {
        let p = parseInt(startPage) + i;
        if(p > TOTAL_PAGES) break;
        initPage.add(new Option(`Page ${p}`, p));
    }
}

function handleParaChange(startPage) {
    const sub = document.getElementById('sub-page-select');
    sub.innerHTML = '<option value="">-- Choose Page --</option>';
    for(let i=0; i<25; i++) {
        let p = parseInt(startPage) + i;
        if(p > TOTAL_PAGES) break;
        sub.add(new Option(`Page ${p}`, p));
    }
    jumpToPage(startPage);
}

function startFromOverlay() {
    const p = document.getElementById('init-page').value;
    if(p) { currentGlobalPage = parseInt(p); }
    closeOverlay();
    loadAndRender();
}

function closeOverlay() {
    localStorage.setItem('hasVisited', 'true');
    document.getElementById('selectionOverlay').style.display = 'none';
}

// --- BOOKMARKS ---
function toggleBookmark() {
    if(bookmarks.includes(currentGlobalPage)) {
        bookmarks = bookmarks.filter(p => p !== currentGlobalPage);
    } else {
        bookmarks.push(currentGlobalPage);
    }
    localStorage.setItem('quranBookmarks', JSON.stringify(bookmarks));
    updateUI();
    renderBookmarksList();
}

function renderBookmarksList() {
    const container = document.getElementById('bookmarksList');
    container.innerHTML = bookmarks.map(p => 
        `<button class="btn-primary" style="padding:5px 10px; font-size:11px; margin:2px;" onclick="jumpToPage(${p})">Pg ${p}</button>`
    ).join('');
}

// --- INITIALIZATION ---
window.onload = () => {
    // Fill Dropdowns
    const jSel = document.getElementById('juz-select');
    const sSel = document.getElementById('surah-select');
    const iJSel = document.getElementById('init-juz');
    
    juzMap.forEach((p, i) => {
        let txt = `Para ${i+1}`;
        jSel.add(new Option(txt, p));
        iJSel.add(new Option(txt, p));
    });

    Object.entries(surahMap).forEach(([id, data]) => {
        sSel.add(new Option(`${id}. ${data[0]}`, data[1]));
    });

    // Setup state
    if(localStorage.getItem('hasVisited')) document.getElementById('selectionOverlay').style.display = 'none';
    if(isNightMode) document.body.classList.add('night-mode');
    
    // Default overlay population
    populateOverlayPages(1);
    renderBookmarksList();
    
    // Start App
    loadAndRender();
};
  
