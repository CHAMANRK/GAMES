import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, deleteDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── FIREBASE CONFIG ───
const firebaseConfig = {
    apiKey: "AIzaSyBANSAU7O96OjywYA4XItIvKpA467xTuhA",
    authDomain: "money-ledger-49779.firebaseapp.com",
    projectId: "money-ledger-49779",
    storageBucket: "money-ledger-49779.firebasestorage.app",
    messagingSenderId: "1027802752902",
    appId: "1:1027802752902:web:bfd7e907424495ebe9ae07"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ─── STATE ───
let currentUser = null;
let currentTxType = 'deposit';
let txFilter = 'all';
let allTransactions = [];
let walletsMap = {};        // id → wallet data
let categoriesMap = {};     // id → category
let budgetsMap = {};        // categoryId → limit
let locksMap = {};          // walletId → {amount, reason, threshold}
let pendingPasswordAction = null;
let selectedWalletId = null; // for detail modal

// Default categories
const DEFAULT_CATEGORIES = [
    { id: 'food',          emoji: '🍔', name: 'Food & Dining' },
    { id: 'transport',     emoji: '🚕', name: 'Transport' },
    { id: 'shopping',      emoji: '🛍️', name: 'Shopping' },
    { id: 'utilities',     emoji: '⚡', name: 'Utilities' },
    { id: 'entertainment', emoji: '🎬', name: 'Entertainment' },
    { id: 'health',        emoji: '🏥', name: 'Health' },
    { id: 'salary',        emoji: '💼', name: 'Salary' },
    { id: 'investment',    emoji: '📊', name: 'Investment' },
    { id: 'other',         emoji: '📌', name: 'Other' },
];

// ════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════
window.showToast = (msg, type = 'success') => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 3500);
};

// ════════════════════════════════════════
//  THEME
// ════════════════════════════════════════
window.toggleTheme = () => {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    document.getElementById('theme-btn').querySelector('span').textContent =
        newTheme === 'dark' ? 'light_mode' : 'dark_mode';
};

function applyStoredTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-btn');
    if (btn) btn.querySelector('span').textContent = saved === 'dark' ? 'light_mode' : 'dark_mode';
}

// ════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════
onAuthStateChanged(auth, (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        document.getElementById('user-name').innerText = `Hi, ${user.displayName?.split(' ')[0] || 'User'} 👋`;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        applyStoredTheme();
        initApp();
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
    loader.classList.add('hidden');
});

window.loginGoogle = async () => {
    try {
        document.getElementById('loading-overlay').classList.remove('hidden');
        await signInWithPopup(auth, provider);
    } catch (e) {
        window.showToast('Login failed: ' + e.message, 'error');
        document.getElementById('loading-overlay').classList.add('hidden');
    }
};

window.logout = () => {
    document.getElementById('loading-overlay').classList.remove('hidden');
    signOut(auth).catch(() => {
        window.showToast('Logout failed!', 'error');
        document.getElementById('loading-overlay').classList.add('hidden');
    });
};

// ════════════════════════════════════════
//  INIT APP
// ════════════════════════════════════════
function initApp() {
    checkPasswordSetup();
    loadWallets();
    loadTransactions();
    loadCategories();
    loadBudgets();
    loadLocks();
    populateMonthFilter();
}

// ════════════════════════════════════════
//  PASSWORD SYSTEM
// ════════════════════════════════════════
function checkPasswordSetup() {
    const pass = localStorage.getItem(`mm_pass_${currentUser.uid}`);
    if (!pass) {
        openModal('set-password-modal');
    }
}

window.saveNewPassword = () => {
    const p1 = document.getElementById('set-pass-1').value;
    const p2 = document.getElementById('set-pass-2').value;
    const err = document.getElementById('set-pass-error');

    if (!p1 || p1.length < 4) {
        err.textContent = '❌ Password must be at least 4 characters!';
        err.classList.remove('hidden');
        return;
    }
    if (p1 !== p2) {
        err.classList.remove('hidden');
        return;
    }

    localStorage.setItem(`mm_pass_${currentUser.uid}`, btoa(p1));
    closeModal('set-password-modal');
    window.showToast('🔐 Password set successfully!', 'success');
};

window.promptPassword = (action, data = null) => {
    pendingPasswordAction = { action, data };
    const msgs = {
        'add-wallet': 'Enter password to add a new wallet.',
        'edit-wallet': 'Enter password to edit this wallet.',
        'delete-wallet': 'Enter password to delete this wallet.',
        'lock-money': 'Enter password to manage locked money.',
        'budget': 'Enter password to manage budgets.',
        'change-password': 'Enter your current password to change it.',
    };
    document.getElementById('password-modal-msg').textContent = msgs[action] || 'This action is password protected.';
    document.getElementById('password-input').value = '';
    document.getElementById('password-error').classList.add('hidden');
    openModal('password-modal');
};

window.verifyPassword = () => {
    const input = document.getElementById('password-input').value;
    const stored = localStorage.getItem(`mm_pass_${currentUser.uid}`);
    const errEl = document.getElementById('password-error');

    if (btoa(input) === stored) {
        errEl.classList.add('hidden');
        closeModal('password-modal');
        executePasswordAction(pendingPasswordAction);
    } else {
        errEl.classList.remove('hidden');
        document.getElementById('password-input').value = '';
    }
};

function executePasswordAction({ action, data }) {
    if (action === 'add-wallet') {
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('new-wallet-bal').value = '';
        openModal('add-wallet-modal');
    } else if (action === 'edit-wallet') {
        const w = walletsMap[selectedWalletId];
        if (!w) return;
        document.getElementById('edit-wallet-id').value = selectedWalletId;
        document.getElementById('edit-wallet-name').value = w.name;
        document.getElementById('edit-wallet-bal').value = w.balance;
        closeModal('wallet-detail-modal');
        openModal('edit-wallet-modal');
    } else if (action === 'delete-wallet') {
        closeModal('wallet-detail-modal');
        confirmDeleteWallet(selectedWalletId);
    } else if (action === 'lock-money') {
        const lock = locksMap[selectedWalletId] || {};
        document.getElementById('lock-wallet-id').value = selectedWalletId;
        document.getElementById('lock-amount').value = lock.amount || '';
        document.getElementById('lock-reason').value = lock.reason || '';
        document.getElementById('lock-alert-threshold').value = lock.threshold || '';
        closeModal('wallet-detail-modal');
        openModal('lock-modal');
    } else if (action === 'budget') {
        populateBudgetModal();
        openModal('budget-modal');
    } else if (action === 'change-password') {
        openChangePasswordFlow();
    }
}

window.togglePassVisibility = () => {
    const inp = document.getElementById('password-input');
    const icon = document.querySelector('.toggle-pass');
    if (inp.type === 'password') {
        inp.type = 'text';
        icon.textContent = 'visibility_off';
    } else {
        inp.type = 'password';
        icon.textContent = 'visibility';
    }
};

function openChangePasswordFlow() {
    const newPass = prompt('Enter new password (min 4 chars):');
    if (!newPass || newPass.length < 4) {
        window.showToast('Password too short!', 'error');
        return;
    }
    const confirm = prompt('Confirm new password:');
    if (newPass !== confirm) {
        window.showToast('Passwords do not match!', 'error');
        return;
    }
    localStorage.setItem(`mm_pass_${currentUser.uid}`, btoa(newPass));
    window.showToast('🔐 Password changed!', 'success');
}

// ════════════════════════════════════════
//  WALLETS
// ════════════════════════════════════════
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('name'));
    onSnapshot(q, (snapshot) => {
        walletsMap = {};
        if (snapshot.empty) {
            createDefaultWallet();
            return;
        }
        snapshot.forEach(d => { walletsMap[d.id] = { id: d.id, ...d.data() }; });
        renderWallets();
        populateWalletSelects();
        updateHeroTotals();
    });
}

function renderWallets() {
    const list = document.getElementById('wallets-list');
    list.innerHTML = '';
    const sorted = Object.values(walletsMap).sort((a, b) => {
        if (a.isOwner && !b.isOwner) return -1;
        if (!a.isOwner && b.isOwner) return 1;
        return a.name.localeCompare(b.name);
    });
    sorted.forEach(w => {
        const card = document.createElement('div');
        card.className = `wallet-card ${w.isOwner ? 'is-owner' : ''}`;
        card.innerHTML = `
            <div class="wallet-tag">${w.isOwner ? '👤 Mine' : '👥 Friend'}</div>
            <div class="wallet-name">${w.name}</div>
            <div class="wallet-bal">₹${(w.balance || 0).toLocaleString('en-IN')}</div>
        `;
        card.onclick = () => openWalletDetail(w.id);
        list.appendChild(card);
    });
}

function populateWalletSelects() {
    const selects = ['tx-wallet', 'tx-wallet-to'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        const prev = sel.value;
        sel.innerHTML = `<option value="" disabled selected>${id === 'tx-wallet-to' ? 'Transfer To' : 'Select Account'}</option>`;
        Object.values(walletsMap).forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.id;
            opt.textContent = `${w.isOwner ? '👤' : '👥'} ${w.name}  (₹${(w.balance || 0).toLocaleString('en-IN')})`;
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
    });
}

function updateHeroTotals() {
    let myTotal = 0, friendsTotal = 0;
    Object.values(walletsMap).forEach(w => {
        if (w.isOwner) myTotal += w.balance || 0;
        else friendsTotal += w.balance || 0;
    });
    const grand = myTotal + friendsTotal;
    document.getElementById('grand-total').textContent = `₹${grand.toLocaleString('en-IN')}`;
    document.getElementById('my-total').textContent = `₹${myTotal.toLocaleString('en-IN')}`;
    document.getElementById('friends-total').textContent = `₹${friendsTotal.toLocaleString('en-IN')}`;
}

window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value.trim();
    const bal = parseFloat(document.getElementById('new-wallet-bal').value) || 0;
    const type = document.querySelector('input[name="wallet-type"]:checked')?.value || 'owner';

    if (!name) { window.showToast('Name daalo!', 'error'); return; }

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
            name, balance: bal,
            isOwner: type === 'owner',
            createdAt: serverTimestamp()
        });
        closeModal('add-wallet-modal');
        window.showToast(`✅ ${name} wallet added!`);
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

async function createDefaultWallet() {
    await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
        name: 'My Pocket', balance: 0,
        isOwner: true, createdAt: serverTimestamp()
    });
}

window.setWalletType = (val) => {};

// Wallet Detail
function openWalletDetail(walletId) {
    selectedWalletId = walletId;
    const w = walletsMap[walletId];
    if (!w) return;
    document.getElementById('wallet-detail-name').textContent = `${w.isOwner ? '👤' : '👥'} ${w.name}`;
    document.getElementById('wallet-detail-bal').textContent = `₹${(w.balance || 0).toLocaleString('en-IN')}`;

    const lockInfo = document.getElementById('wallet-lock-info');
    const lock = locksMap[walletId];
    if (lock && lock.amount > 0) {
        const available = (w.balance || 0) - lock.amount;
        lockInfo.textContent = `🔒 Locked: ₹${lock.amount.toLocaleString('en-IN')} (${lock.reason}) | Available: ₹${Math.max(0, available).toLocaleString('en-IN')}`;
        lockInfo.classList.remove('hidden');
    } else {
        lockInfo.classList.add('hidden');
    }
    openModal('wallet-detail-modal');
}

window.saveWalletEdit = async () => {
    const id = document.getElementById('edit-wallet-id').value;
    const name = document.getElementById('edit-wallet-name').value.trim();
    const bal = parseFloat(document.getElementById('edit-wallet-bal').value) || 0;

    if (!name) { window.showToast('Name daalo!', 'error'); return; }

    try {
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, id), { name, balance: bal });
        closeModal('edit-wallet-modal');
        window.showToast('✅ Wallet updated!');
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

async function confirmDeleteWallet(walletId) {
    const w = walletsMap[walletId];
    if (!confirm(`"${w?.name}" wallet delete karna chahte ho?`)) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId));
        window.showToast('🗑️ Wallet deleted!');
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
}

// ════════════════════════════════════════
//  LOCK MONEY
// ════════════════════════════════════════
function loadLocks() {
    const q = collection(db, `users/${currentUser.uid}/locks`);
    onSnapshot(q, (snap) => {
        locksMap = {};
        snap.forEach(d => { locksMap[d.id] = d.data(); });
    });
}

window.saveLock = async () => {
    const walletId = document.getElementById('lock-wallet-id').value;
    const amount = parseFloat(document.getElementById('lock-amount').value) || 0;
    const reason = document.getElementById('lock-reason').value.trim() || 'Reserved';
    const threshold = parseFloat(document.getElementById('lock-alert-threshold').value) || 0;

    if (amount < 0) { window.showToast('Valid amount daalo!', 'error'); return; }

    try {
        await setDoc(doc(db, `users/${currentUser.uid}/locks`, walletId), {
            amount, reason, threshold, walletId
        });
        closeModal('lock-modal');
        window.showToast(`🔒 ₹${amount.toLocaleString('en-IN')} locked for "${reason}"!`);
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

window.removeLock = async () => {
    const walletId = document.getElementById('lock-wallet-id').value;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/locks`, walletId));
        closeModal('lock-modal');
        window.showToast('🔓 Lock removed!');
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

function checkLockAlerts(walletId, newBalance) {
    const lock = locksMap[walletId];
    if (!lock || !lock.amount) return;
    const available = newBalance - lock.amount;

    if (available < 0) {
        window.showToast(
            `⚠️ ${walletsMap[walletId]?.name}: Actual ₹${newBalance.toLocaleString('en-IN')} | Locked ₹${lock.amount.toLocaleString('en-IN')} | Available ₹0 — Lock exceeded!`,
            'warning'
        );
    } else if (lock.threshold && available < lock.threshold) {
        window.showToast(
            `🔔 ${walletsMap[walletId]?.name}: Available ₹${available.toLocaleString('en-IN')} — Near lock limit!`,
            'warning'
        );
    } else {
        window.showToast(
            `💰 ${walletsMap[walletId]?.name}: Total ₹${newBalance.toLocaleString('en-IN')} | Locked ₹${lock.amount.toLocaleString('en-IN')} | Available ₹${available.toLocaleString('en-IN')}`,
            'info'
        );
    }
}

// ════════════════════════════════════════
//  CATEGORIES
// ════════════════════════════════════════
function loadCategories() {
    const q = collection(db, `users/${currentUser.uid}/categories`);
    onSnapshot(q, async (snap) => {
        categoriesMap = {};

        // Seed defaults if empty
        if (snap.empty) {
            for (const cat of DEFAULT_CATEGORIES) {
                await setDoc(doc(db, `users/${currentUser.uid}/categories`, cat.id), {
                    emoji: cat.emoji, name: cat.name
                });
            }
            return;
        }

        snap.forEach(d => {
            categoriesMap[d.id] = { id: d.id, ...d.data() };
        });

        populateCategorySelects();
    });
}

function populateCategorySelects() {
    const selects = ['tx-category', 'budget-cat-select'];
    selects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = id === 'tx-category'
            ? '<option value="">Category (Optional)</option>'
            : '<option value="" disabled selected>Select Category</option>';

        Object.values(categoriesMap).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = `${cat.emoji} ${cat.name}`;
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
    });
}

window.addCategory = async () => {
    const emoji = document.getElementById('new-cat-emoji').value.trim() || '📌';
    const name = document.getElementById('new-cat-name').value.trim();

    if (!name) { window.showToast('Category name daalo!', 'error'); return; }

    const id = name.toLowerCase().replace(/\s+/g, '_');
    try {
        await setDoc(doc(db, `users/${currentUser.uid}/categories`, id), { emoji, name });
        closeModal('add-category-modal');
        document.getElementById('new-cat-emoji').value = '';
        document.getElementById('new-cat-name').value = '';
        window.showToast(`${emoji} "${name}" category added!`);
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

// ════════════════════════════════════════
//  BUDGETS
// ════════════════════════════════════════
function loadBudgets() {
    const q = collection(db, `users/${currentUser.uid}/budgets`);
    onSnapshot(q, (snap) => {
        budgetsMap = {};
        snap.forEach(d => { budgetsMap[d.id] = d.data(); });
    });
}

function populateBudgetModal() {
    populateCategorySelects();
    renderExistingBudgets();
}

function renderExistingBudgets() {
    const container = document.getElementById('existing-budgets');
    container.innerHTML = '';
    if (Object.keys(budgetsMap).length === 0) {
        container.innerHTML = '<p style="color:var(--text3);font-size:0.85em;text-align:center">No budgets set yet</p>';
        return;
    }
    Object.entries(budgetsMap).forEach(([catId, b]) => {
        const cat = categoriesMap[catId] || { emoji: '📌', name: catId };
        const div = document.createElement('div');
        div.className = 'budget-row';
        div.innerHTML = `
            <div class="budget-row-info">
                <span>${cat.emoji} ${cat.name}</span>
                <small>Limit: ₹${b.limit.toLocaleString('en-IN')}/month</small>
            </div>
            <button class="budget-delete-btn" onclick="window.deleteBudget('${catId}')">
                <span class="material-icons-round">delete</span>
            </button>
        `;
        container.appendChild(div);
    });
}

window.saveBudget = async () => {
    const catId = document.getElementById('budget-cat-select').value;
    const limit = parseFloat(document.getElementById('budget-limit-amount').value);

    if (!catId) { window.showToast('Category select karo!', 'error'); return; }
    if (!limit || limit <= 0) { window.showToast('Valid limit daalo!', 'error'); return; }

    try {
        await setDoc(doc(db, `users/${currentUser.uid}/budgets`, catId), { limit, catId });
        document.getElementById('budget-limit-amount').value = '';
        renderExistingBudgets();
        window.showToast('✅ Budget limit set!');
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

window.deleteBudget = async (catId) => {
    await deleteDoc(doc(db, `users/${currentUser.uid}/budgets`, catId));
    renderExistingBudgets();
    window.showToast('🗑️ Budget removed!');
};

function checkBudgetAlert(categoryId, amount) {
    const budget = budgetsMap[categoryId];
    if (!budget) return;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const monthSpent = allTransactions
        .filter(tx => {
            if (tx.type !== 'expense' || tx.category !== categoryId) return false;
            const d = tx.timestamp?.toDate();
            return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        })
        .reduce((sum, tx) => sum + (tx.amount || 0), 0);

    const newTotal = monthSpent + amount;
    const cat = categoriesMap[categoryId] || { emoji: '📌', name: categoryId };

    if (newTotal >= budget.limit) {
        window.showToast(
            `🚨 ${cat.emoji} ${cat.name} budget exceeded! ₹${newTotal.toLocaleString('en-IN')} / ₹${budget.limit.toLocaleString('en-IN')}`,
            'error'
        );
    } else if (newTotal >= budget.limit * 0.8) {
        window.showToast(
            `⚠️ ${cat.emoji} ${cat.name} budget 80% used: ₹${newTotal.toLocaleString('en-IN')} / ₹${budget.limit.toLocaleString('en-IN')}`,
            'warning'
        );
    }
}

// ════════════════════════════════════════
//  TRANSACTIONS
// ════════════════════════════════════════
function loadTransactions() {
    const q = query(
        collection(db, `users/${currentUser.uid}/transactions`),
        orderBy('timestamp', 'desc')
    );
    onSnapshot(q, (snap) => {
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyAllFilters();
    });
}

window.setTxType = (type, btn) => {
    currentTxType = type;
    document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show/hide conditional fields
    document.getElementById('transfer-to-wrap').classList.toggle('hidden', type !== 'transfer');
    document.getElementById('settlement-wrap').classList.toggle('hidden', type !== 'settlement');
    document.getElementById('category-wrap').classList.toggle('hidden', type === 'transfer' || type === 'settlement');
};

window.saveTransaction = async () => {
    const walletId = document.getElementById('tx-wallet').value;
    const amount = parseFloat(document.getElementById('tx-amount').value);
    const desc = document.getElementById('tx-desc').value.trim();
    const category = currentTxType === 'expense' || currentTxType === 'deposit'
        ? document.getElementById('tx-category').value
        : '';
    const walletToId = document.getElementById('tx-wallet-to').value;
    const settlementReason = document.getElementById('settlement-reason').value;

    if (!walletId) { window.showToast('Account select karo!', 'error'); return; }
    if (!amount || amount <= 0) { window.showToast('Valid amount daalo!', 'error'); return; }
    if (amount > 9999999) { window.showToast('Amount too large!', 'error'); return; }
    if (currentTxType === 'transfer' && !walletToId) { window.showToast('"Transfer To" select karo!', 'error'); return; }
    if (currentTxType === 'transfer' && walletId === walletToId) { window.showToast('Same wallet mein transfer nahi ho sakta!', 'error'); return; }

    const walletName = walletsMap[walletId]?.name || 'Unknown';
    const walletToName = walletsMap[walletToId]?.name || '';

    const reasonLabels = {
        udhar: '💸 Udhar Wapas', diya: '🎁 Gift',
        split: '🍽️ Bill Split', kiraya: '🏠 Kiraya', other: '📌 Other'
    };

    try {
        if (currentTxType === 'transfer') {
            // ── Transfer ──
            await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
                type: 'transfer',
                amount, walletId, walletName,
                walletToId, walletToName,
                description: desc || `Transfer to ${walletToName}`,
                timestamp: serverTimestamp()
            });
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(-amount) });
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletToId), { balance: increment(amount) });

            const newFromBal = (walletsMap[walletId]?.balance || 0) - amount;
            const newToBal = (walletsMap[walletToId]?.balance || 0) + amount;
            checkLockAlerts(walletId, newFromBal);
            checkLockAlerts(walletToId, newToBal);

            window.showToast(`🔁 ₹${amount.toLocaleString('en-IN')} transferred to ${walletToName}!`);

        } else if (currentTxType === 'settlement') {
            // ── Settlement ──
            await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
                type: 'settlement',
                amount, walletId, walletName,
                settlementReason,
                settlementLabel: reasonLabels[settlementReason] || 'Settlement',
                description: desc || reasonLabels[settlementReason],
                timestamp: serverTimestamp()
            });
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(amount) });

            const newBal = (walletsMap[walletId]?.balance || 0) + amount;
            checkLockAlerts(walletId, newBal);
            window.showToast(`🤝 Settlement done! ₹${amount.toLocaleString('en-IN')} — ${reasonLabels[settlementReason]}`);

        } else {
            // ── Income / Expense ──
            const change = currentTxType === 'deposit' ? amount : -amount;

            await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
                type: currentTxType, amount, walletId, walletName,
                description: desc || (currentTxType === 'deposit' ? 'Income' : 'Expense'),
                category: category || 'other',
                timestamp: serverTimestamp()
            });
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });

            const newBal = (walletsMap[walletId]?.balance || 0) + change;
            checkLockAlerts(walletId, newBal);
            if (currentTxType === 'expense' && category) checkBudgetAlert(category, amount);

            window.showToast(`${currentTxType === 'deposit' ? '📈' : '📉'} ₹${amount.toLocaleString('en-IN')} saved!`);
        }

        // Reset form
        closeModal('transaction-modal');
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-desc').value = '';
        document.getElementById('tx-category').value = '';
        document.getElementById('tx-wallet').value = '';

    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

window.deleteTransaction = async (txId) => {
    if (!confirm('Delete this transaction?')) return;
    try {
        const tx = allTransactions.find(t => t.id === txId);
        if (!tx) return;

        // Reverse balance
        if (tx.type === 'transfer') {
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, tx.walletId), { balance: increment(tx.amount) });
            if (tx.walletToId) {
                await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, tx.walletToId), { balance: increment(-tx.amount) });
            }
        } else if (tx.type === 'settlement') {
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, tx.walletId), { balance: increment(-tx.amount) });
        } else {
            const change = tx.type === 'deposit' ? -tx.amount : tx.amount;
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, tx.walletId), { balance: increment(change) });
        }

        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, txId));
        window.showToast('🗑️ Transaction deleted!');
    } catch (e) {
        window.showToast('Failed: ' + e.message, 'error');
    }
};

// ════════════════════════════════════════
//  FILTERS & DISPLAY
// ════════════════════════════════════════
window.setTxFilter = (filter, btn) => {
    txFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyAllFilters();
};

window.applyAllFilters = () => {
    const search = document.getElementById('search-input').value.toLowerCase();
    const month = document.getElementById('month-filter').value;

    let filtered = [...allTransactions];

    if (txFilter !== 'all') {
        filtered = filtered.filter(tx => tx.type === txFilter);
    }

    if (month) {
        const [y, m] = month.split('-').map(Number);
        filtered = filtered.filter(tx => {
            const d = tx.timestamp?.toDate();
            return d && d.getFullYear() === y && d.getMonth() + 1 === m;
        });
    }

    if (search) {
        filtered = filtered.filter(tx =>
            (tx.description || '').toLowerCase().includes(search) ||
            (tx.walletName || '').toLowerCase().includes(search) ||
            String(tx.amount).includes(search)
        );
    }

    renderTransactions(filtered);
};

function renderTransactions(list) {
    const container = document.getElementById('transactions-list');
    document.getElementById('tx-count').textContent = list.length;
    container.innerHTML = '';

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="material-icons-round" style="font-size:3em;color:#444">receipt_long</span>
                <p>No transactions found</p>
            </div>`;
        return;
    }

    list.forEach(tx => {
        const date = tx.timestamp?.toDate()?.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        }) || 'Just now';

        let amountClass = 'tx-in', prefix = '+';
        if (tx.type === 'expense') { amountClass = 'tx-out'; prefix = '-'; }
        else if (tx.type === 'transfer') { amountClass = 'tx-transfer'; prefix = '↔'; }
        else if (tx.type === 'settlement') { amountClass = 'tx-settlement'; prefix = '✓'; }

        const cat = categoriesMap[tx.category];
        const catEmoji = cat ? cat.emoji : '';

        let subtitle = `${date} • ${tx.walletName}`;
        if (tx.type === 'transfer') subtitle += ` → ${tx.walletToName}`;

        let reasonBadge = '';
        if (tx.type === 'settlement' && tx.settlementLabel) {
            reasonBadge = `<span class="reason-badge">${tx.settlementLabel}</span>`;
        }

        const item = document.createElement('div');
        item.className = 'tx-item';
        item.innerHTML = `
            <div class="tx-left">
                <h4>${catEmoji} ${tx.description}${reasonBadge}</h4>
                <small>${subtitle}</small>
            </div>
            <div class="tx-right">
                <div class="tx-amount ${amountClass}">${prefix}₹${(tx.amount || 0).toLocaleString('en-IN')}</div>
                <button class="delete-btn" onclick="window.deleteTransaction('${tx.id}')" title="Delete">
                    <span class="material-icons-round">delete</span>
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

function populateMonthFilter() {
    const sel = document.getElementById('month-filter');
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${d.getMonth() + 1}`;
        const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        sel.appendChild(opt);
    }
}

window.applyMonthFilter = () => window.applyAllFilters();

// ════════════════════════════════════════
//  EXPORT CSV
// ════════════════════════════════════════
window.exportData = () => {
    let csv = 'Date,Type,Amount,Description,Category,Wallet,Reason\n';
    allTransactions.forEach(tx => {
        const date = tx.timestamp?.toDate()?.toLocaleDateString() || 'N/A';
        const cat = categoriesMap[tx.category]?.name || tx.category || 'N/A';
        csv += `"${date}","${tx.type}",${tx.amount},"${tx.description}","${cat}","${tx.walletName}","${tx.settlementLabel || ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `money-manager-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.showToast('📊 CSV exported!');
};

// ════════════════════════════════════════
//  MODAL UTILS
// ════════════════════════════════════════
window.openModal = (id) => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id)?.classList.add('hidden');

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
    }
});
