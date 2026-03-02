import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── FIREBASE ──
const firebaseConfig = {
    apiKey: "AIzaSyBANSAU7O96OjywYA4XItIvKpA467xTuhA",
    authDomain: "money-ledger-49779.firebaseapp.com",
    projectId: "money-ledger-49779",
    storageBucket: "money-ledger-49779.firebasestorage.app",
    messagingSenderId: "1027802752902",
    appId: "1:1027802752902:web:bfd7e907424495ebe9ae07"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);
const gProvider = new GoogleAuthProvider();

// ── STATE ──
let currentUser   = null;
let currentTxType = 'deposit';
let txTypeFilter  = 'all';
let walletType    = 'owner';
let selectedWalletId = null;
let pendingPinAction = null;
let analyticsMonth   = new Date().getMonth();
let analyticsYear    = new Date().getFullYear();
let barChartInst  = null;
let donutChartInst = null;

let allTransactions = [];
let walletsMap      = {};
let categoriesMap   = {};
let budgetsMap      = {};
let locksMap        = {};

// PIN state
let pinEntry     = '';
let setPinStep   = 1;
let setPinFirst  = '';
let verifyPinEntry = '';

// ── DEFAULT CATEGORIES ──
const DEFAULT_CATS = [
    { id:'food',          emoji:'🍔', name:'Food & Dining' },
    { id:'transport',     emoji:'🚕', name:'Transport' },
    { id:'shopping',      emoji:'🛍️', name:'Shopping' },
    { id:'utilities',     emoji:'⚡', name:'Utilities' },
    { id:'entertainment', emoji:'🎬', name:'Entertainment' },
    { id:'health',        emoji:'🏥', name:'Health' },
    { id:'salary',        emoji:'💼', name:'Salary' },
    { id:'investment',    emoji:'📊', name:'Investment' },
    { id:'other',         emoji:'📌', name:'Other' },
];

const SETTLE_LABELS = {
    udhar:'💸 Udhar Wapas', diya:'🎁 Gift',
    split:'🍽️ Bill Split', kiraya:'🏠 Kiraya', other:'📌 Other'
};
const TX_ICONS = {
    deposit:'arrow_downward', expense:'arrow_upward',
    transfer:'swap_horiz', settlement:'handshake'
};

// ════════════════════════════
//  TOAST
// ════════════════════════════
window.showToast = (msg, type='success') => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 3500);
};

// ════════════════════════════
//  THEME
// ════════════════════════════
window.toggleTheme = () => {
    const html = document.documentElement;
    const dark = html.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('mm_theme', next);
    updateThemeUI(next);
};
function updateThemeUI(theme) {
    const icon = document.getElementById('theme-btn')?.querySelector('span');
    if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
    const siIcon = document.getElementById('theme-si-icon')?.querySelector('span');
    const siLabel = document.getElementById('theme-si-label');
    if (siIcon) siIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
    if (siLabel) siLabel.textContent = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
}
function applyTheme() {
    const t = localStorage.getItem('mm_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    updateThemeUI(t);
}

// ════════════════════════════
//  AUTH
// ════════════════════════════
onAuthStateChanged(auth, user => {
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
        if (user) {
            currentUser = user;
            handleUserLogin(user);
        } else {
            show('auth-screen');
        }
    }, 1800);
});

window.loginGoogle = async () => {
    try {
        show('loading-screen');
        await signInWithPopup(auth, gProvider);
    } catch(e) {
        hide('loading-screen');
        window.showToast('Login failed: ' + e.message, 'error');
    }
};

window.logout = () => {
    if (!confirm('Logout karna chahte ho?')) return;
    signOut(auth).then(() => location.reload());
};

function handleUserLogin(user) {
    applyTheme();
    const pin = getPin();
    if (!pin) {
        // New user: set PIN first
        showSetPinScreen();
    } else {
        // Existing user: lock screen
        showLockScreen(user);
    }
}

// ════════════════════════════
//  PIN SYSTEM
// ════════════════════════════
function getPin() { return localStorage.getItem(`mm_pin_${currentUser.uid}`); }
function savePin(pin) { localStorage.setItem(`mm_pin_${currentUser.uid}`, btoa(pin)); }

// ── LOCK SCREEN ──
function showLockScreen(user) {
    document.getElementById('lock-username').textContent = `Hi, ${user.displayName?.split(' ')[0] || 'User'}! 👋`;
    const photo = user.photoURL;
    if (photo) {
        document.getElementById('lock-avatar').innerHTML = `<img src="${photo}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    }
    show('lock-screen');
}

window.pinInput = (digit) => {
    if (pinEntry.length >= 4) return;
    pinEntry += digit;
    updatePinDisplay('pin-display', pinEntry.length);
    if (pinEntry.length === 4) setTimeout(window.pinSubmit, 200);
};
window.pinClear = () => {
    pinEntry = pinEntry.slice(0, -1);
    updatePinDisplay('pin-display', pinEntry.length);
};
window.pinSubmit = () => {
    if (btoa(pinEntry) === getPin()) {
        hide('lock-screen');
        pinEntry = '';
        updatePinDisplay('pin-display', 0);
        initApp();
    } else {
        shakePin('pin-display');
        document.getElementById('pin-error').classList.remove('hidden');
        pinEntry = '';
        setTimeout(() => {
            updatePinDisplay('pin-display', 0);
            document.getElementById('pin-error').classList.add('hidden');
        }, 1000);
    }
};
window.forgotPin = () => {
    if (confirm('PIN reset karne ke liye logout hoga. Continue?')) {
        localStorage.removeItem(`mm_pin_${currentUser.uid}`);
        signOut(auth).then(() => location.reload());
    }
};

// ── SET PIN SCREEN ──
function showSetPinScreen() {
    setPinStep = 1;
    setPinFirst = '';
    setPinEntry = '';
    document.getElementById('setpin-msg').textContent = 'Apna 4-digit PIN set karo';
    document.getElementById('setpin-error').classList.add('hidden');
    updatePinDisplay('setpin-display', 0);
    show('setpin-screen');
}
let setPinEntry = '';
window.setPinInput = (digit) => {
    if (setPinEntry.length >= 4) return;
    setPinEntry += digit;
    updatePinDisplay('setpin-display', setPinEntry.length);
    if (setPinEntry.length === 4) setTimeout(window.setPinNext, 200);
};
window.setPinClear = () => {
    setPinEntry = setPinEntry.slice(0, -1);
    updatePinDisplay('setpin-display', setPinEntry.length);
};
window.setPinNext = () => {
    if (setPinStep === 1) {
        setPinFirst = setPinEntry;
        setPinEntry = '';
        setPinStep = 2;
        document.getElementById('setpin-msg').textContent = 'Dobara enter karo (Confirm PIN)';
        updatePinDisplay('setpin-display', 0);
    } else {
        if (setPinEntry === setPinFirst) {
            savePin(setPinEntry);
            hide('setpin-screen');
            window.showToast('🔐 PIN set! App unlock ho raha hai...');
            setTimeout(() => initApp(), 600);
        } else {
            shakePin('setpin-display');
            document.getElementById('setpin-error').classList.remove('hidden');
            setPinEntry = '';
            setPinStep = 1;
            setPinFirst = '';
            setTimeout(() => {
                updatePinDisplay('setpin-display', 0);
                document.getElementById('setpin-error').classList.add('hidden');
                document.getElementById('setpin-msg').textContent = 'Apna 4-digit PIN set karo';
            }, 1000);
        }
    }
};

// Change PIN
window.openChangePinFlow = () => {
    window.promptPin('change-pin');
};

// ── VERIFY PIN MODAL ──
window.promptPin = (action) => {
    pendingPinAction = action;
    const msgs = {
        'add-wallet': 'Wallet add karne ke liye PIN enter karo.',
        'edit-wallet': 'Wallet edit karne ke liye PIN enter karo.',
        'delete-wallet': 'Wallet delete karne ke liye PIN enter karo.',
        'lock-money': 'Lock money manage karne ke liye PIN enter karo.',
        'budget': 'Budget limits ke liye PIN enter karo.',
        'manage-categories': 'Categories manage karne ke liye PIN enter karo.',
        'change-pin': 'Current PIN verify karo.',
    };
    document.getElementById('pin-verify-msg').textContent = msgs[action] || 'PIN enter karo.';
    verifyPinEntry = '';
    updatePinDisplay('pin-verify-display', 0);
    document.getElementById('pin-verify-error').classList.add('hidden');
    openModal('pin-verify-modal');
};

window.verifyPinInput = (digit) => {
    if (verifyPinEntry.length >= 4) return;
    verifyPinEntry += digit;
    updatePinDisplay('pin-verify-display', verifyPinEntry.length);
    if (verifyPinEntry.length === 4) setTimeout(window.verifyPinSubmit, 200);
};
window.verifyPinClear = () => {
    verifyPinEntry = verifyPinEntry.slice(0, -1);
    updatePinDisplay('pin-verify-display', verifyPinEntry.length);
};
window.verifyPinSubmit = () => {
    if (btoa(verifyPinEntry) === getPin()) {
        closeModal('pin-verify-modal');
        verifyPinEntry = '';
        executePinAction(pendingPinAction);
    } else {
        shakePin('pin-verify-display');
        document.getElementById('pin-verify-error').classList.remove('hidden');
        verifyPinEntry = '';
        setTimeout(() => {
            updatePinDisplay('pin-verify-display', 0);
            document.getElementById('pin-verify-error').classList.add('hidden');
        }, 1000);
    }
};

function executePinAction(action) {
    if (action === 'add-wallet') {
        document.getElementById('nw-name').value = '';
        document.getElementById('nw-bal').value = '';
        walletType = 'owner';
        document.getElementById('wt-mine').classList.add('active');
        document.getElementById('wt-friend').classList.remove('active');
        openModal('add-wallet-modal');
    } else if (action === 'edit-wallet') {
        const w = walletsMap[selectedWalletId];
        if (!w) return;
        document.getElementById('ew-id').value = selectedWalletId;
        document.getElementById('ew-name').value = w.name;
        document.getElementById('ew-bal').value = w.balance;
        closeModal('wallet-detail-modal');
        openModal('edit-wallet-modal');
    } else if (action === 'delete-wallet') {
        closeModal('wallet-detail-modal');
        doDeleteWallet(selectedWalletId);
    } else if (action === 'lock-money') {
        const lock = locksMap[selectedWalletId] || {};
        document.getElementById('lm-wallet-id').value = selectedWalletId;
        document.getElementById('lm-amount').value = lock.amount || '';
        document.getElementById('lm-reason').value = lock.reason || '';
        document.getElementById('lm-threshold').value = lock.threshold || '';
        closeModal('wallet-detail-modal');
        openModal('lock-modal');
    } else if (action === 'budget') {
        populateBudgetCatSelect();
        renderBudgetList();
        openModal('budget-modal');
    } else if (action === 'manage-categories') {
        renderAllCats();
        openModal('manage-cat-modal');
    } else if (action === 'change-pin') {
        doChangePinFlow();
    }
}

function doChangePinFlow() {
    showSetPinScreen();
}

// PIN display helpers
function updatePinDisplay(id, filled) {
    const dots = document.getElementById(id)?.querySelectorAll('.pin-dot');
    if (!dots) return;
    dots.forEach((d, i) => {
        d.classList.toggle('filled', i < filled);
        d.classList.remove('error');
    });
}
function shakePin(id) {
    const dots = document.getElementById(id)?.querySelectorAll('.pin-dot');
    dots?.forEach(d => {
        d.classList.remove('filled');
        d.classList.add('error');
    });
}

// ════════════════════════════
//  INIT APP
// ════════════════════════════
function initApp() {
    show('app');
    setGreeting();
    setUserInfo();
    applyTheme();
    loadWallets();
    loadTransactions();
    loadCategories();
    loadBudgets();
    loadLocks();
    populateMonthFilter();
    populateMonthFilterAnalytics();
    goToPage('dashboard');
}

function setGreeting() {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 👋' : 'Good evening 🌙';
    document.getElementById('hero-greeting').textContent = greet;
}
function setUserInfo() {
    const name = currentUser.displayName?.split(' ')[0] || 'User';
    document.getElementById('hero-name').textContent = name;
    document.getElementById('settings-name').textContent = currentUser.displayName || 'User';
    document.getElementById('settings-email').textContent = currentUser.email || '';
    const photo = currentUser.photoURL;
    if (photo) {
        document.getElementById('settings-avatar').innerHTML = `<img src="${photo}">`;
    }
}

// ════════════════════════════
//  PAGE NAVIGATION
// ════════════════════════════
const pageTitles = { dashboard:'Dashboard', transactions:'Transactions', analytics:'Analytics', settings:'Settings' };

window.goToPage = (name) => {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    document.getElementById(`page-${name}`)?.classList.remove('hidden');
    document.getElementById(`nav-${name}`)?.classList.add('active');
    document.getElementById('page-title').textContent = pageTitles[name] || name;

    if (name === 'analytics') renderAnalytics();
};

// ════════════════════════════
//  WALLETS
// ════════════════════════════
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('name'));
    onSnapshot(q, snap => {
        walletsMap = {};
        if (snap.empty) { createDefaultWallet(); return; }
        snap.forEach(d => { walletsMap[d.id] = { id:d.id, ...d.data() }; });
        renderWallets();
        populateTxWalletSelects();
        updateHero();
    });
}

function renderWallets() {
    const scroll = document.getElementById('wallets-scroll');
    scroll.innerHTML = '';
    Object.values(walletsMap)
        .sort((a,b) => (b.isOwner ? 1:-1) - (a.isOwner ? 1:-1) || a.name.localeCompare(b.name))
        .forEach(w => {
            const lock = locksMap[w.id];
            const lockText = lock?.amount > 0 ? `🔒 ₹${lock.amount.toLocaleString('en-IN')} locked` : '';
            const div = document.createElement('div');
            div.className = `wallet-card ${w.isOwner ? 'is-owner' : 'is-friend'}`;
            div.innerHTML = `
                <div class="wc-tag">${w.isOwner ? '👤 Mine' : '👥 Friend'}</div>
                <div class="wc-name">${w.name}</div>
                <div class="wc-bal">₹${(w.balance||0).toLocaleString('en-IN')}</div>
                ${lockText ? `<div class="wc-lock">${lockText}</div>` : ''}
            `;
            div.onclick = () => openWalletDetail(w.id);
            scroll.appendChild(div);
        });
}

function updateHero() {
    let mine=0, friends=0;
    Object.values(walletsMap).forEach(w => {
        if (w.isOwner) mine += w.balance||0;
        else friends += w.balance||0;
    });
    const total = mine + friends;
    document.getElementById('grand-total').textContent = `₹${total.toLocaleString('en-IN')}`;
    document.getElementById('my-total').textContent = `₹${mine.toLocaleString('en-IN')}`;
    document.getElementById('friends-total').textContent = `₹${friends.toLocaleString('en-IN')}`;
}

function populateTxWalletSelects() {
    ['tx-from-wallet','tx-to-wallet'].forEach(id => {
        const sel = document.getElementById(id);
        const prev = sel.value;
        sel.innerHTML = `<option value="" disabled selected>${id.includes('to') ? 'Transfer To →' : 'Select Account'}</option>`;
        Object.values(walletsMap).forEach(w => {
            const o = document.createElement('option');
            o.value = w.id;
            o.textContent = `${w.isOwner?'👤':'👥'} ${w.name} (₹${(w.balance||0).toLocaleString('en-IN')})`;
            sel.appendChild(o);
        });
        if (prev) sel.value = prev;
    });
}

async function createDefaultWallet() {
    await addDoc(collection(db,`users/${currentUser.uid}/wallets`), {
        name:'My Pocket', balance:0, isOwner:true, createdAt:serverTimestamp()
    });
}

window.setWalletType = (type, btn) => {
    walletType = type;
    document.querySelectorAll('.wt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

window.addWallet = async () => {
    const name = document.getElementById('nw-name').value.trim();
    const bal  = parseFloat(document.getElementById('nw-bal').value) || 0;
    if (!name) { window.showToast('Name daalo!','error'); return; }
    try {
        await addDoc(collection(db,`users/${currentUser.uid}/wallets`), {
            name, balance:bal, isOwner:walletType==='owner', createdAt:serverTimestamp()
        });
        closeModal('add-wallet-modal');
        window.showToast(`✅ ${name} wallet add ho gaya!`);
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

function openWalletDetail(id) {
    selectedWalletId = id;
    const w = walletsMap[id];
    if (!w) return;
    document.getElementById('wd-name').textContent = `${w.isOwner?'👤':'👥'} ${w.name}`;
    document.getElementById('wd-balance').textContent = `₹${(w.balance||0).toLocaleString('en-IN')}`;
    const lock = locksMap[id];
    const badge = document.getElementById('wd-lock-badge');
    if (lock?.amount > 0) {
        const avail = (w.balance||0) - lock.amount;
        badge.textContent = `🔒 Locked: ₹${lock.amount.toLocaleString('en-IN')} (${lock.reason}) | Available: ₹${Math.max(0,avail).toLocaleString('en-IN')}`;
        badge.classList.remove('hidden');
    } else { badge.classList.add('hidden'); }
    openModal('wallet-detail-modal');
}

window.saveWalletEdit = async () => {
    const id   = document.getElementById('ew-id').value;
    const name = document.getElementById('ew-name').value.trim();
    const bal  = parseFloat(document.getElementById('ew-bal').value)||0;
    if (!name) { window.showToast('Name daalo!','error'); return; }
    try {
        await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,id), {name, balance:bal});
        closeModal('edit-wallet-modal');
        window.showToast('✅ Wallet updated!');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

async function doDeleteWallet(id) {
    const w = walletsMap[id];
    if (!confirm(`"${w?.name}" delete karna chahte ho?`)) return;
    try {
        await deleteDoc(doc(db,`users/${currentUser.uid}/wallets`,id));
        window.showToast('🗑️ Wallet deleted!');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
}

// ════════════════════════════
//  LOCK MONEY
// ════════════════════════════
function loadLocks() {
    onSnapshot(collection(db,`users/${currentUser.uid}/locks`), snap => {
        locksMap = {};
        snap.forEach(d => { locksMap[d.id] = d.data(); });
        renderWallets();
    });
}

window.saveLock = async () => {
    const wid       = document.getElementById('lm-wallet-id').value;
    const amount    = parseFloat(document.getElementById('lm-amount').value)||0;
    const reason    = document.getElementById('lm-reason').value.trim()||'Reserved';
    const threshold = parseFloat(document.getElementById('lm-threshold').value)||0;
    try {
        await setDoc(doc(db,`users/${currentUser.uid}/locks`,wid), {amount,reason,threshold});
        closeModal('lock-modal');
        window.showToast(`🔒 ₹${amount.toLocaleString('en-IN')} locked for "${reason}"!`,'info');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

window.removeLock = async () => {
    const wid = document.getElementById('lm-wallet-id').value;
    try {
        await deleteDoc(doc(db,`users/${currentUser.uid}/locks`,wid));
        closeModal('lock-modal');
        window.showToast('🔓 Lock remove ho gaya!');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

function checkLockAlert(wid, newBal) {
    const lock = locksMap[wid];
    if (!lock?.amount) return;
    const avail = newBal - lock.amount;
    const name  = walletsMap[wid]?.name || 'Wallet';
    if (avail < 0) {
        window.showToast(`⚠️ ${name}: Total ₹${newBal.toLocaleString('en-IN')} | Locked ₹${lock.amount.toLocaleString('en-IN')} | Lock exceed ho gaya!`,'warning');
    } else if (lock.threshold && avail < lock.threshold) {
        window.showToast(`🔔 ${name}: Available ₹${avail.toLocaleString('en-IN')} — Lock limit ke qareeb!`,'warning');
    } else {
        window.showToast(`💰 ${name}: Total ₹${newBal.toLocaleString('en-IN')} | 🔒 ₹${lock.amount.toLocaleString('en-IN')} | Available ₹${avail.toLocaleString('en-IN')}`,'info');
    }
}

// ════════════════════════════
//  CATEGORIES
// ════════════════════════════
function loadCategories() {
    onSnapshot(collection(db,`users/${currentUser.uid}/categories`), async snap => {
        categoriesMap = {};
        if (snap.empty) {
            for (const c of DEFAULT_CATS)
                await setDoc(doc(db,`users/${currentUser.uid}/categories`,c.id), {emoji:c.emoji, name:c.name});
            return;
        }
        snap.forEach(d => { categoriesMap[d.id] = {id:d.id,...d.data()}; });
        populateCatSelects();
    });
}

function populateCatSelects() {
    ['tx-cat','budget-cat'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = id==='tx-cat'
            ? '<option value="">Category (Optional)</option>'
            : '<option value="" disabled selected>Select Category</option>';
        Object.values(categoriesMap).forEach(c => {
            const o = document.createElement('option');
            o.value = c.id; o.textContent = `${c.emoji} ${c.name}`;
            sel.appendChild(o);
        });
        if (prev) sel.value = prev;
    });
}

window.addCategory = async () => {
    const emoji = document.getElementById('nc-emoji').value.trim()||'📌';
    const name  = document.getElementById('nc-name').value.trim();
    if (!name) { window.showToast('Name daalo!','error'); return; }
    const id = name.toLowerCase().replace(/\s+/g,'_');
    try {
        await setDoc(doc(db,`users/${currentUser.uid}/categories`,id), {emoji,name});
        closeModal('add-cat-modal');
        document.getElementById('nc-emoji').value='';
        document.getElementById('nc-name').value='';
        window.showToast(`${emoji} "${name}" add ho gaya!`);
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

function renderAllCats() {
    const list = document.getElementById('all-cats-list');
    list.innerHTML = '';
    Object.values(categoriesMap).forEach(c => {
        const div = document.createElement('div');
        div.className = 'cat-row-item';
        div.innerHTML = `
            <span>${c.emoji} ${c.name}</span>
            <button class="cat-del" onclick="window.deleteCat('${c.id}')">
                <span class="material-icons-round">delete</span>
            </button>
        `;
        list.appendChild(div);
    });
}

window.deleteCat = async (id) => {
    if (!confirm('Category delete karo?')) return;
    await deleteDoc(doc(db,`users/${currentUser.uid}/categories`,id));
    renderAllCats();
    window.showToast('🗑️ Category deleted!');
};

// ════════════════════════════
//  BUDGETS
// ════════════════════════════
function loadBudgets() {
    onSnapshot(collection(db,`users/${currentUser.uid}/budgets`), snap => {
        budgetsMap = {};
        snap.forEach(d => { budgetsMap[d.id] = d.data(); });
    });
}

function populateBudgetCatSelect() { populateCatSelects(); }

function renderBudgetList() {
    const list = document.getElementById('budget-list');
    list.innerHTML = '';
    if (!Object.keys(budgetsMap).length) {
        list.innerHTML = '<p style="color:var(--text3);font-size:0.82em;text-align:center;padding:10px">No budgets set</p>';
        return;
    }
    Object.entries(budgetsMap).forEach(([catId,b]) => {
        const cat = categoriesMap[catId]||{emoji:'📌',name:catId};
        const div = document.createElement('div');
        div.className = 'budget-row';
        div.innerHTML = `
            <div>
                <div style="font-size:0.88em;font-weight:600">${cat.emoji} ${cat.name}</div>
                <div style="font-size:0.75em;color:var(--text3)">₹${b.limit.toLocaleString('en-IN')}/month</div>
            </div>
            <button class="budget-del" onclick="window.deleteBudget('${catId}')">
                <span class="material-icons-round">delete</span>
            </button>
        `;
        list.appendChild(div);
    });
}

window.saveBudget = async () => {
    const catId = document.getElementById('budget-cat').value;
    const limit = parseFloat(document.getElementById('budget-amt').value);
    if (!catId) { window.showToast('Category select karo!','error'); return; }
    if (!limit||limit<=0) { window.showToast('Valid limit daalo!','error'); return; }
    try {
        await setDoc(doc(db,`users/${currentUser.uid}/budgets`,catId), {limit,catId});
        document.getElementById('budget-amt').value='';
        renderBudgetList();
        window.showToast('✅ Budget set ho gaya!');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

window.deleteBudget = async (id) => {
    await deleteDoc(doc(db,`users/${currentUser.uid}/budgets`,id));
    renderBudgetList();
    window.showToast('🗑️ Budget removed!');
};

function checkBudgetAlert(catId, newAmt) {
    const b = budgetsMap[catId]; if (!b) return;
    const now=new Date(), mo=now.getMonth(), yr=now.getFullYear();
    const spent = allTransactions
        .filter(t => t.type==='expense' && t.category===catId && t.timestamp?.toDate()?.getMonth()===mo && t.timestamp?.toDate()?.getFullYear()===yr)
        .reduce((s,t) => s+(t.amount||0), 0);
    const total = spent + newAmt;
    const cat = categoriesMap[catId]||{emoji:'📌',name:catId};
    if (total >= b.limit) window.showToast(`🚨 ${cat.emoji} ${cat.name} budget exceed! ₹${total.toLocaleString('en-IN')} / ₹${b.limit.toLocaleString('en-IN')}`,'error');
    else if (total >= b.limit*0.8) window.showToast(`⚠️ ${cat.emoji} ${cat.name} 80% budget use: ₹${total.toLocaleString('en-IN')} / ₹${b.limit.toLocaleString('en-IN')}`,'warning');
}

// ════════════════════════════
//  TRANSACTIONS
// ════════════════════════════
function loadTransactions() {
    const q = query(collection(db,`users/${currentUser.uid}/transactions`), orderBy('timestamp','desc'));
    onSnapshot(q, snap => {
        allTransactions = snap.docs.map(d => ({id:d.id,...d.data()}));
        updateStatPills();
        renderRecentList();
        applyFilters();
    });
}

window.setTxType = (type, btn) => {
    currentTxType = type;
    document.querySelectorAll('.tx-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tx-to-wrap').classList.toggle('hidden', type!=='transfer');
    document.getElementById('tx-settle-wrap').classList.toggle('hidden', type!=='settlement');
    document.getElementById('tx-cat-wrap').classList.toggle('hidden', type==='transfer'||type==='settlement');
};

window.saveTransaction = async () => {
    const fromId = document.getElementById('tx-from-wallet').value;
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const desc   = document.getElementById('tx-desc').value.trim();
    const cat    = document.getElementById('tx-cat').value;
    const toId   = document.getElementById('tx-to-wallet').value;
    const settle = document.getElementById('tx-settle-reason').value;

    if (!fromId) { window.showToast('Account select karo!','error'); return; }
    if (!amount||amount<=0) { window.showToast('Amount daalo!','error'); return; }
    if (currentTxType==='transfer'&&!toId) { window.showToast('"Transfer To" select karo!','error'); return; }
    if (currentTxType==='transfer'&&fromId===toId) { window.showToast('Same wallet mein transfer nahi!','error'); return; }

    const fromName = walletsMap[fromId]?.name||'';
    const toName   = walletsMap[toId]?.name||'';

    try {
        if (currentTxType==='transfer') {
            await addDoc(collection(db,`users/${currentUser.uid}/transactions`), {
                type:'transfer', amount, walletId:fromId, walletName:fromName,
                walletToId:toId, walletToName:toName,
                description: desc||`Transfer → ${toName}`, timestamp:serverTimestamp()
            });
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,fromId), {balance:increment(-amount)});
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,toId),   {balance:increment(amount)});
            checkLockAlert(fromId, (walletsMap[fromId]?.balance||0)-amount);
            checkLockAlert(toId,   (walletsMap[toId]?.balance||0)+amount);
            window.showToast(`🔁 ₹${amount.toLocaleString('en-IN')} transferred to ${toName}!`);

        } else if (currentTxType==='settlement') {
            await addDoc(collection(db,`users/${currentUser.uid}/transactions`), {
                type:'settlement', amount, walletId:fromId, walletName:fromName,
                settlementReason:settle, settlementLabel:SETTLE_LABELS[settle],
                description: desc||SETTLE_LABELS[settle], timestamp:serverTimestamp()
            });
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,fromId), {balance:increment(amount)});
            checkLockAlert(fromId, (walletsMap[fromId]?.balance||0)+amount);
            window.showToast(`🤝 Settlement: ₹${amount.toLocaleString('en-IN')} — ${SETTLE_LABELS[settle]}`);

        } else {
            const change = currentTxType==='deposit' ? amount : -amount;
            await addDoc(collection(db,`users/${currentUser.uid}/transactions`), {
                type:currentTxType, amount, walletId:fromId, walletName:fromName,
                description: desc||(currentTxType==='deposit'?'Income':'Expense'),
                category: cat||'other', timestamp:serverTimestamp()
            });
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,fromId), {balance:increment(change)});
            checkLockAlert(fromId, (walletsMap[fromId]?.balance||0)+change);
            if (currentTxType==='expense'&&cat) checkBudgetAlert(cat, amount);
            window.showToast(`${currentTxType==='deposit'?'📈':'📉'} ₹${amount.toLocaleString('en-IN')} saved!`);
        }

        closeModal('tx-modal');
        document.getElementById('tx-amount').value='';
        document.getElementById('tx-desc').value='';
        document.getElementById('tx-from-wallet').value='';
        document.getElementById('tx-cat').value='';
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

window.deleteTransaction = async (id) => {
    if (!confirm('Delete?')) return;
    const tx = allTransactions.find(t=>t.id===id);
    if (!tx) return;
    try {
        if (tx.type==='transfer') {
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,tx.walletId),   {balance:increment(tx.amount)});
            if (tx.walletToId) await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,tx.walletToId), {balance:increment(-tx.amount)});
        } else if (tx.type==='settlement') {
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,tx.walletId), {balance:increment(-tx.amount)});
        } else {
            await updateDoc(doc(db,`users/${currentUser.uid}/wallets`,tx.walletId), {balance:increment(tx.type==='deposit'?-tx.amount:tx.amount)});
        }
        await deleteDoc(doc(db,`users/${currentUser.uid}/transactions`,id));
        window.showToast('🗑️ Deleted!');
    } catch(e) { window.showToast('Error: '+e.message,'error'); }
};

function updateStatPills() {
    const now=new Date(), mo=now.getMonth(), yr=now.getFullYear();
    let inc=0, exp=0;
    allTransactions.forEach(t => {
        const d=t.timestamp?.toDate();
        if (!d||d.getMonth()!==mo||d.getFullYear()!==yr) return;
        if (t.type==='deposit') inc+=t.amount||0;
        if (t.type==='expense') exp+=t.amount||0;
    });
    document.getElementById('stat-income').textContent   = `₹${inc.toLocaleString('en-IN')}`;
    document.getElementById('stat-expense').textContent  = `₹${exp.toLocaleString('en-IN')}`;
    document.getElementById('stat-savings').textContent  = `₹${(inc-exp).toLocaleString('en-IN')}`;
}

function renderRecentList() {
    const container = document.getElementById('recent-list');
    container.innerHTML = '';
    const recent = allTransactions.slice(0,5);
    if (!recent.length) {
        container.innerHTML='<div class="empty-state"><span class="material-icons-round">receipt_long</span><p>No transactions yet</p></div>';
        return;
    }
    recent.forEach(tx => container.appendChild(makeTxItem(tx)));
}

// ── FILTERS ──
window.setTypeFilter = (f, btn) => {
    txTypeFilter = f;
    document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
};
window.applyFilters = () => {
    const search = document.getElementById('tx-search')?.value.toLowerCase()||'';
    const month  = document.getElementById('month-select')?.value||'';
    let list = [...allTransactions];
    if (txTypeFilter!=='all') list=list.filter(t=>t.type===txTypeFilter);
    if (month) {
        const [y,m]=month.split('-').map(Number);
        list=list.filter(t=>{ const d=t.timestamp?.toDate(); return d&&d.getFullYear()===y&&d.getMonth()+1===m; });
    }
    if (search) list=list.filter(t=>(t.description||'').toLowerCase().includes(search)||(t.walletName||'').toLowerCase().includes(search)||String(t.amount).includes(search));
    const container=document.getElementById('tx-list-full');
    container.innerHTML='';
    document.getElementById('tx-count-label').textContent=`${list.length} transaction${list.length!==1?'s':''}`;
    if (!list.length) { container.innerHTML='<div class="empty-state"><span class="material-icons-round">search_off</span><p>Koi transaction nahi mila</p></div>'; return; }
    list.forEach(tx=>container.appendChild(makeTxItem(tx)));
};

function makeTxItem(tx) {
    const date = tx.timestamp?.toDate()?.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})||'Just now';
    const cat  = categoriesMap[tx.category];
    const catEmoji = cat?cat.emoji:'';
    const prefixes = {deposit:'+',expense:'-',transfer:'↔',settlement:'✓'};
    const icons    = {deposit:'arrow_downward',expense:'arrow_upward',transfer:'swap_horiz',settlement:'handshake'};
    let meta = `${date} • ${tx.walletName}`;
    if (tx.type==='transfer') meta+=` → ${tx.walletToName}`;
    const badge = tx.settlementLabel ? `<span class="tx-badge">${tx.settlementLabel}</span>` : '';
    const div = document.createElement('div');
    div.className = `tx-item ${tx.type}`;
    div.innerHTML = `
        <div class="tx-icon"><span class="material-icons-round">${icons[tx.type]||'payments'}</span></div>
        <div class="tx-body">
            <div class="tx-desc">${catEmoji} ${tx.description}${badge}</div>
            <div class="tx-meta">${meta}</div>
        </div>
        <div class="tx-right-col">
            <div class="tx-amount">${prefixes[tx.type]||''}₹${(tx.amount||0).toLocaleString('en-IN')}</div>
            <button class="tx-del-btn" onclick="window.deleteTransaction('${tx.id}')"><span class="material-icons-round">delete</span></button>
        </div>
    `;
    return div;
}

// ── MONTH FILTER ──
function populateMonthFilter() {
    const sel = document.getElementById('month-select');
    const now = new Date();
    for (let i=0;i<12;i++) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        const o = document.createElement('option');
        o.value=`${d.getFullYear()}-${d.getMonth()+1}`;
        o.textContent=d.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
        sel.appendChild(o);
    }
}

// ════════════════════════════
//  ANALYTICS
// ════════════════════════════
function populateMonthFilterAnalytics() {
    const label = new Date(analyticsYear, analyticsMonth, 1)
        .toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    document.getElementById('analytics-month-label').textContent = label;
}

window.analyticsMonthNav = (dir) => {
    analyticsMonth += dir;
    if (analyticsMonth > 11) { analyticsMonth=0; analyticsYear++; }
    if (analyticsMonth < 0)  { analyticsMonth=11; analyticsYear--; }
    populateMonthFilterAnalytics();
    renderAnalytics();
};

function renderAnalytics() {
    const txs = allTransactions.filter(t => {
        const d=t.timestamp?.toDate();
        return d && d.getMonth()===analyticsMonth && d.getFullYear()===analyticsYear;
    });

    let inc=0,exp=0;
    txs.forEach(t=>{ if(t.type==='deposit') inc+=t.amount||0; if(t.type==='expense') exp+=t.amount||0; });
    document.getElementById('an-income').textContent  = `₹${inc.toLocaleString('en-IN')}`;
    document.getElementById('an-expense').textContent = `₹${exp.toLocaleString('en-IN')}`;
    document.getElementById('an-savings').textContent = `₹${(inc-exp).toLocaleString('en-IN')}`;

    renderBarChart(txs);
    renderDonutChart(txs);
    renderBudgetProgress(txs);
}

function renderBarChart(txs) {
    const daysInMonth = new Date(analyticsYear, analyticsMonth+1, 0).getDate();
    const incArr = Array(daysInMonth).fill(0);
    const expArr = Array(daysInMonth).fill(0);
    txs.forEach(t=>{
        const d=t.timestamp?.toDate(); if(!d) return;
        const day=d.getDate()-1;
        if(t.type==='deposit') incArr[day]+=t.amount||0;
        if(t.type==='expense') expArr[day]+=t.amount||0;
    });
    const labels = Array.from({length:daysInMonth},(_,i)=>i+1);
    const ctx = document.getElementById('bar-chart').getContext('2d');
    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(ctx, {
        type:'bar',
        data:{
            labels,
            datasets:[
                { label:'Income', data:incArr, backgroundColor:'rgba(16,185,129,0.7)', borderRadius:4, borderSkipped:false },
                { label:'Expense', data:expArr, backgroundColor:'rgba(239,68,68,0.7)', borderRadius:4, borderSkipped:false }
            ]
        },
        options:{
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{labels:{color:'#aaa',font:{size:11}}} },
            scales:{
                x:{ticks:{color:'#666',font:{size:10}}, grid:{color:'rgba(255,255,255,0.05)'}},
                y:{ticks:{color:'#666',font:{size:10}}, grid:{color:'rgba(255,255,255,0.05)'}}
            }
        }
    });
}

function renderDonutChart(txs) {
    const catTotals={};
    txs.filter(t=>t.type==='expense').forEach(t=>{
        const cid=t.category||'other';
        catTotals[cid]=(catTotals[cid]||0)+(t.amount||0);
    });
    const cats=Object.keys(catTotals);
    if (!cats.length) {
        document.getElementById('cat-legend').innerHTML='<p style="color:var(--text3);font-size:0.8em">No expense data</p>';
        return;
    }
    const COLORS=['#a855f7','#10b981','#ef4444','#f97316','#3b82f6','#ec4899','#eab308','#06b6d4','#84cc16'];
    const labels=cats.map(id=>{ const c=categoriesMap[id]; return c?`${c.emoji} ${c.name}`:id; });
    const data=cats.map(id=>catTotals[id]);
    const colors=cats.map((_,i)=>COLORS[i%COLORS.length]);
    const ctx=document.getElementById('donut-chart').getContext('2d');
    if (donutChartInst) donutChartInst.destroy();
    donutChartInst = new Chart(ctx,{
        type:'doughnut',
        data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0, hoverOffset:6 }] },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{display:false} } }
    });
    const legend=document.getElementById('cat-legend');
    legend.innerHTML='';
    cats.forEach((id,i)=>{
        const c=categoriesMap[id]||{emoji:'📌',name:id};
        const div=document.createElement('div');
        div.className='cat-legend-item';
        div.innerHTML=`<span class="legend-dot" style="background:${colors[i]}"></span>${c.emoji} ${c.name}: ₹${catTotals[id].toLocaleString('en-IN')}`;
        legend.appendChild(div);
    });
}

function renderBudgetProgress(txs) {
    const container=document.getElementById('budget-progress-list');
    container.innerHTML='';
    if (!Object.keys(budgetsMap).length) {
        container.innerHTML='<p style="color:var(--text3);font-size:0.82em;text-align:center">No budgets set. Settings mein add karo.</p>';
        return;
    }
    Object.entries(budgetsMap).forEach(([catId,b])=>{
        const cat=categoriesMap[catId]||{emoji:'📌',name:catId};
        const spent=txs.filter(t=>t.type==='expense'&&t.category===catId).reduce((s,t)=>s+(t.amount||0),0);
        const pct=Math.min(100, (spent/b.limit)*100);
        const color = pct>=100?'var(--red)':pct>=80?'var(--orange)':'var(--green)';
        const div=document.createElement('div');
        div.className='budget-item';
        div.innerHTML=`
            <div class="budget-item-header">
                <span>${cat.emoji} ${cat.name}</span>
                <span style="color:${color}">₹${spent.toLocaleString('en-IN')} / ₹${b.limit.toLocaleString('en-IN')}</span>
            </div>
            <div class="budget-bar-track">
                <div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

// ════════════════════════════
//  EXPORT
// ════════════════════════════
window.exportCSV = () => {
    let csv='Date,Type,Amount,Description,Category,Wallet,Reason\n';
    allTransactions.forEach(t=>{
        const date=t.timestamp?.toDate()?.toLocaleDateString()||'N/A';
        const cat=categoriesMap[t.category]?.name||t.category||'';
        csv+=`"${date}","${t.type}",${t.amount},"${t.description}","${cat}","${t.walletName||''}","${t.settlementLabel||''}"\n`;
    });
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`money-manager-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.showToast('📊 CSV exported!');
};

// ════════════════════════════
//  MODAL UTILS
// ════════════════════════════
window.openModal  = id => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = id => document.getElementById(id)?.classList.add('hidden');
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal')) e.target.classList.add('hidden');
});

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── Fix missing lm-wallet-id input
document.getElementById('lock-modal')?.addEventListener('show', () => {});
