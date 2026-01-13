// --- CONFIGURATION ---
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let pageNumPending = null;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// PART LIMITS (Aapke PDF ke hisab se)
const PART_1_LIMIT = 201;
const PART_2_LIMIT = 401;
const TOTAL_PAGES = 610; 

const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');

// --- 1. SMART PARA LOGIC (User Request) ---
// Para Start Mapping (Approximate starts based on your description)
// Note: Para 1 starts at 1. Para 2 starts at 22 (since Para 1 has 21 pages).
const juzStartPages = [
    1, 22, 42, 62, 82, 102, 122, 142, 162, 182, 
    202, 222, 242, 262, 282, 302, 322, 342, 362, 382, 
    402, 422, 442, 462, 482, 502, 522, 542, 562, 586
]; 
// Note: Last entries might need slight adjustment based on exact PDF, 
// but Logic below handles the "Count" perfectly.

function getParaPageCount(paraIndex) {
    // Para 1 has 21 pages
    if (paraIndex === 1) return 21;
    // Para 29 has 24 pages
    if (paraIndex === 29) return 24;
    // Para 30 has 25 pages
    if (paraIndex === 30) return 25;
    // All others have 20 pages
    return 20;
}

// Surah Map
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

// --- 2. FILE HANDLING ---
function getPartInfo(globalPage) {
    if (globalPage <= PART_1_LIMIT) return { file: 'part1.pdf', offset: 0, partNum: 1 };
    else if (globalPage <= PART_2_LIMIT) return { file: 'part2.pdf', offset: PART_1_LIMIT, partNum: 2 };
    else return { file: 'part3.pdf', offset: PART_2_LIMIT, partNum: 3 };
}

// --- 3. HD RENDER LOGIC ---
async function loadAndRender() {
    const info = getPartInfo(currentGlobalPage);
    const localPage = currentGlobalPage - info.offset;

    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = "Loading File...";
            pdfDoc = await pdfjsLib.getDocument(info.file).promise;
            pdfDoc.sourceFile = info.file;
        } catch (err) {
            document.getElementById('page-info').innerText = "Error Loading PDF";
            return;
        }
    }

    renderPage(localPage);
}

async function renderPage(num) {
    pageRendering = true;
    if (num < 1) num = 1;
    if (num > pdfDoc.numPages) num = pdfDoc.numPages;

    const page = await pdfDoc.getPage(num);

    // --- HIGH QUALITY SCALING ---
    // Device Pixel Ratio check karte hain (Mobile screens usually have 2x or 3x)
    const pixelRatio = window.devicePixelRatio || 1;
    
    // Scale badhate hain taaki text crisp dikhe
    // 2.0 = Good Quality, 3.0 = Best Quality (Thoda slow ho sakta hai)
    const qualityScale = 2.5; 

    const viewport = page.getViewport({ scale: qualityScale });

    // Canvas ka internal dimension bada rakhte hain HD ke liye
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // CSS se ise screen par fit karte hain
    // Isse image badi render hogi lekin screen pe sharp dikhegi
    canvas.style.width = "100%";
    canvas.style.height = "auto";

    const renderCtx = {
        canvasContext: ctx,
        viewport: viewport
    };

    await page.render(renderCtx).promise;
    
    pageRendering = false;
    updateUI();
}

// --- 4. DROPDOWN & UI LOGIC ---

// Helper to fill Page Dropdown (Based on Para)
function fillPageDropdown(selectElement, paraIndex) {
    selectElement.innerHTML = '<option value="">-- Page --</option>';
    
    // Determine Start Page and Total Pages
    let startPage = juzStartPages[paraIndex - 1]; // Array is 0-indexed
    let count = getParaPageCount(paraIndex);

    for (let i = 1; i <= count; i++) {
        let realPage = startPage + i - 1;
        // User dekhega "Page 1", "Page 2" (Relative)
        // Value hogi Real Page (e.g., 26)
        selectElement.add(new Option(`Page ${i}`, realPage));
    }
}

function updateUI() {
    // Info Box Update
    document.getElementById('page-info').innerText = `Pg ${currentGlobalPage} / ${TOTAL_PAGES}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage / TOTAL_PAGES) * 100}%`;
    
    const btn = document.getElementById('bookmarkBtn');
    btn.innerHTML = bookmarks.includes(currentGlobalPage) ? '❤️' : '🤍';
    
    document.getElementById('prev-btn').disabled = (currentGlobalPage <= 1);
    document.getElementById('next-btn').disabled = (currentGlobalPage >= TOTAL_PAGES);

    localStorage.setItem('quranLastPage', currentGlobalPage);
}

// --- 5. NAVIGATION ---
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

// --- 6. SIDEBAR HANDLERS ---
function handleParaChange(paraIndex) {
    if(!paraIndex) return;
    const sub = document.getElementById('sub-page-select');
    
    // Populate dropdown with correct counts (21, 24, 25, or 20)
    fillPageDropdown(sub, parseInt(paraIndex));
    
    // Jump to the START of that Para
    let startPage = juzStartPages[parseInt(paraIndex) - 1];
    jumpToPage(startPage);
}

function populateOverlayPages(paraIndex) {
    if(!paraIndex) return;
    const initPage = document.getElementById('init-page');
    fillPageDropdown(initPage, parseInt(paraIndex));
}

function startFromOverlay() {
    const p = document.getElementById('init-page').value;
    // Agar user ne sirf Para select kiya aur page nahi, to Para ke start pe jao
    if(!p) {
        const paraIdx = document.getElementById('init-juz').value;
        if(paraIdx) currentGlobalPage = juzStartPages[parseInt(paraIdx)-1];
    } else {
        currentGlobalPage = parseInt(p); 
    }
    closeOverlay();
    loadAndRender();
}

function closeOverlay() {
    localStorage.setItem('hasVisited', 'true');
    document.getElementById('selectionOverlay').style.display = 'none';
}

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
    document.getElementById('bookmarksList').innerHTML = bookmarks.map(p => 
        `<button class="btn-primary" style="padding:5px; margin:2px; font-size:11px;" onclick="jumpToPage(${p})">${p}</button>`
    ).join('');
}

// --- INITIALIZATION ---
window.onload = () => {
    const jSel = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    
    juzStartPages.forEach((p, i) => {
        let txt = `Para ${i+1}`;
        // Value = Para Number (1, 2, 3...) not Page Number
        jSel.add(new Option(txt, i+1)); 
        iJSel.add(new Option(txt, i+1));
    });

    Object.entries(surahMap).forEach(([id, data]) => {
        document.getElementById('surah-select').add(new Option(`${id}. ${data[0]}`, data[1]));
    });

    if(localStorage.getItem('hasVisited')) document.getElementById('selectionOverlay').style.display = 'none';
    if(isNightMode) document.body.classList.add('night-mode');
    
    renderBookmarksList();
    loadAndRender();
};
          
