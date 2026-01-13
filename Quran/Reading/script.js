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
const surahMap = {1:["Al-Fatihah",1],2:["Al-Baqarah",2],3:["Al-Imran",50],36:["Ya-Sin",440],55:["Ar-Rahman",531],67:["Al-Mulk",562],114:["An-Nas",604]}; // (Full list aapke paas hai, yahan short rakhi hai space ke liye)

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
