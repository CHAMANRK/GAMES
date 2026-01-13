// --- 1. CONFIGURATION & VARIABLES ---
let pdfDoc = null;
let currentGlobalPage = parseInt(localStorage.getItem('quranLastPage')) || 1;
let pageRendering = false;
let pageNumPending = null;
let bookmarks = JSON.parse(localStorage.getItem('quranBookmarks')) || [];
let isNightMode = localStorage.getItem('nightMode') === 'true';

// PDF Parts Configuration
const PART_1_LIMIT = 201;
const PART_2_LIMIT = 401;
const TOTAL_PAGES = 610;

// Para Start Pages
const juzStartPages = [
    1, 22, 42, 62, 82, 102, 122, 142, 162, 182, 
    202, 222, 242, 262, 282, 302, 322, 342, 362, 382, 
    402, 422, 442, 462, 482, 502, 522, 542, 562, 586
];

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

// --- 2. DROPDOWN LOGIC (Fix for "Select Nahi Ho Raha") ---
function getParaPageCount(paraIndex) {
    if (paraIndex === 1) return 21;
    if (paraIndex === 29) return 24;
    if (paraIndex === 30) return 25;
    return 20;
}

function fillPageDropdown(selectElement, paraIndex) {
    // Dropdown ko reset karein
    selectElement.innerHTML = '<option value="">-- Select Page --</option>';
    
    if (!paraIndex || isNaN(paraIndex)) return;

    let startPage = juzStartPages[parseInt(paraIndex) - 1];
    let count = getParaPageCount(parseInt(paraIndex));

    for (let i = 1; i <= count; i++) {
        let realPage = startPage + i - 1;
        // User ko "Page 1, 2" dikhega, Value "Real Page" hogi
        let option = document.createElement("option");
        option.text = `Page ${i}`;
        option.value = realPage;
        selectElement.add(option);
    }
}

function populateOverlayPages(paraIndex) {
    const initPage = document.getElementById('init-page');
    if (initPage) {
        fillPageDropdown(initPage, paraIndex);
    }
}

function handleParaChange(paraIndex) {
    const sub = document.getElementById('sub-page-select');
    if (sub) {
        fillPageDropdown(sub, paraIndex);
        // Auto jump to start of Para
        if (paraIndex) jumpToPage(juzStartPages[parseInt(paraIndex) - 1]);
    }
}

// --- 3. OVERLAY CONTROL (Fix for "Button Not Working") ---
function startFromOverlay() {
    const pageSelect = document.getElementById('init-page');
    const paraSelect = document.getElementById('init-juz');
    
    let p = pageSelect ? pageSelect.value : null;
    let para = paraSelect ? paraSelect.value : null;

    if (p) {
        currentGlobalPage = parseInt(p);
    } else if (para) {
        // Agar page select nahi kiya, to Para ke start pe jao
        currentGlobalPage = juzStartPages[parseInt(para) - 1];
    }

    // Overlay band karo
    closeOverlay();
    
    // Ab PDF Load karo (Agar fail hua to bhi Overlay band rahega)
    try {
        loadAndRender();
    } catch(e) {
        console.error("Render error:", e);
        alert("PDF load hone mein waqt lag raha hai. Internet check karein.");
    }
}

function closeOverlay() {
    localStorage.setItem('hasVisited', 'true');
    const overlay = document.getElementById('selectionOverlay');
    if (overlay) overlay.style.display = 'none';
}

// --- 4. PDF RENDERING ---
function getPartInfo(globalPage) {
    if (globalPage <= PART_1_LIMIT) return { file: 'part1.pdf', offset: 0, partNum: 1 };
    else if (globalPage <= PART_2_LIMIT) return { file: 'part2.pdf', offset: PART_1_LIMIT, partNum: 2 };
    else return { file: 'part3.pdf', offset: PART_2_LIMIT, partNum: 3 };
}

async function loadAndRender() {
    // Check if PDF.js is loaded
    if (typeof pdfjsLib === 'undefined') {
        document.getElementById('page-info').innerText = "Error: No Internet";
        return;
    }

    const info = getPartInfo(currentGlobalPage);
    const localPage = currentGlobalPage - info.offset;
    const canvas = document.getElementById('pdf-render');
    const ctx = canvas.getContext('2d');

    if (!pdfDoc || pdfDoc.sourceFile !== info.file) {
        try {
            document.getElementById('page-info').innerText = "Loading...";
            pdfDoc = await pdfjsLib.getDocument(info.file).promise;
            pdfDoc.sourceFile = info.file;
        } catch (err) {
            document.getElementById('page-info').innerText = "File Error";
            return;
        }
    }

    pageRendering = true;
    if (localPage < 1) localPage = 1; 
    
    const page = await pdfDoc.getPage(localPage);
    
    // HD Quality Logic (Mobile Responsive)
    const viewportRaw = page.getViewport({ scale: 1 });
    const screenWidth = window.innerWidth;
    const desiredScale = (screenWidth < 800) ? (screenWidth - 20) / viewportRaw.width : 2.0; // Desktop par 2.0x quality
    
    const viewport = page.getViewport({ scale: desiredScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.width = "100%";
    canvas.style.height = "auto";

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    
    pageRendering = false;
    updateUI();
}

function updateUI() {
    document.getElementById('page-info').innerText = `Pg ${currentGlobalPage} / ${TOTAL_PAGES}`;
    document.getElementById('progressBar').style.width = `${(currentGlobalPage / TOTAL_PAGES) * 100}%`;
    document.getElementById('prev-btn').disabled = (currentGlobalPage <= 1);
    document.getElementById('next-btn').disabled = (currentGlobalPage >= TOTAL_PAGES);
    localStorage.setItem('quranLastPage', currentGlobalPage);
    
    const btn = document.getElementById('bookmarkBtn');
    if(btn) btn.innerHTML = bookmarks.includes(currentGlobalPage) ? '❤️' : '🤍';
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

// --- 5. INITIALIZATION ---
function initApp() {
    // 1. Fill Para Dropdowns
    const jSel = document.getElementById('juz-select');
    const iJSel = document.getElementById('init-juz');
    
    if (jSel && iJSel) {
        juzStartPages.forEach((p, i) => {
            let txt = `Para ${i+1}`;
            jSel.add(new Option(txt, i+1));
            iJSel.add(new Option(txt, i+1));
        });
        
        // Explicitly set default value to Para 1
        iJSel.value = 1;
        populateOverlayPages(1); // Fill page dropdown immediately
    }

    // 2. Fill Surah Dropdown
    const sSel = document.getElementById('surah-select');
    if (sSel) {
        Object.entries(surahMap).forEach(([id, data]) => {
            sSel.add(new Option(`${id}. ${data[0]}`, data[1]));
        });
    }

    // 3. Handle Overlay & Night Mode
    if(localStorage.getItem('hasVisited')) {
        const overlay = document.getElementById('selectionOverlay');
        if(overlay) overlay.style.display = 'none';
    }
    
    if(isNightMode) document.body.classList.add('night-mode');
    
    renderBookmarksList();
    
    // 4. Try Loading PDF
    try {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            loadAndRender();
        } else {
            console.warn("PDF.js library not loaded yet.");
        }
    } catch (e) {
        console.error("Init Error:", e);
    }
}

// --- 6. HELPERS ---
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

// Start App when Window Loads
window.onload = initApp;
