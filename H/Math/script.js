import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FIREBASE CONFIGURATION ===
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

// === GLOBAL STATE ===
let currentUser = null;
let currentTxType = 'deposit';
let allTransactions = [];
let allWallets = [];
let allFriends = [];
let allRecurring = [];
let pinSet = false;
let isLocked = false;
let securitySetup = { pin: null, question: null, answer: null };
let darkMode = false;
let autoNightMode = false;
let currentPage = 'home';
let categoryChart = null;
let trendChart = null;
let analysisFilter = { friendId: '', dateFrom: null, dateTo: null, type: '', search: '' };

// === INITIALIZATION ===
document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
});

onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        await loadProfile();
        await loadSecurity();
        loadWallets();
        loadTransactions();
        loadFriends();
        loadRecurring();
        checkAutoNightMode();
        updateFriendFilters();
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
    loader.classList.add('hidden');
});

// === AUTHENTICATION ===
window.loginGoogle = async () => {
    try { 
        await signInWithPopup(auth, provider); 
    } catch (e) { 
        window.showToast("❌ " + e.message, "error");
    }
};

window.logout = () => signOut(auth);

// === PROFILE MANAGEMENT ===
async function loadProfile() {
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/profile/details`));
        if (snap.exists()) {
            const data = snap.data();
            const name = data.displayName || currentUser.displayName;
            const age = data.age || '--';
            document.getElementById('header-name').innerText = name;
            document.getElementById('header-age').innerText = `Age: ${age}`;
            document.getElementById('profile-name').value = name;
            document.getElementById('profile-age').value = data.age || '';
            document.getElementById('profile-gender').value = data.gender || 'Male';
            
            const avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
            document.getElementById('header-avatar').src = avatar;
            document.getElementById('profile-avatar-large').src = `https://ui-avatars.com/api/?name=${name}&background=random&size=100`;
        } else {
            const name = currentUser.displayName || 'User';
            document.getElementById('header-name').innerText = name;
            document.getElementById('header-avatar').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${name}`;
            document.getElementById('profile-avatar-large').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${name}&size=100`;
        }
    } catch (e) {
        console.error("Error loading profile:", e);
    }
}

window.saveProfile = async () => {
    if (!window.triggerPINVerification('edit-profile')) return;
    
    const name = document.getElementById('profile-name').value;
    const age = document.getElementById('profile-age').value;
    const gender = document.getElementById('profile-gender').value;
    
    if (!name.trim()) return window.showToast("👤 Please enter your name", "error");
    
    try {
        await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), { displayName: name, age, gender });
        window.closeModal('profile-modal');
        await loadProfile();
        window.showToast("✅ Profile updated", "success");
    } catch (e) {
        window.showToast("❌ Error updating profile", "error");
    }
};

// === SECURITY MANAGEMENT ===
async function loadSecurity() {
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/security/config`));
        if (snap.exists()) {
            securitySetup = snap.data();
            pinSet = !!securitySetup.pin;
        }
    } catch (e) {
        console.log("📭 No security config found");
    }
}

function updateSecurityIcon() {
    const icon = document.getElementById('security-icon');
    const btn = document.getElementById('security-btn');
    if (isLocked) {
        icon.innerText = '🔒';
        btn.classList.add('locked');
    } else {
        icon.innerText = '🔓';
        btn.classList.remove('locked');
    }
}

window.savePIN = async () => {
    const pin = document.getElementById('new-pin').value;
    const confirm = document.getElementById('confirm-pin').value;
    
    if (!pin || pin.length !== 4) return window.showToast("⚠️ PIN must be 4 digits", "error");
    if (pin !== confirm) return window.showToast("⚠️ PINs don't match", "error");
    if (!/^\d+$/.test(pin)) return window.showToast("⚠️ PIN must contain only digits", "error");
    
    try {
        securitySetup.pin = pin;
        await setDoc(doc(db, `users/${currentUser.uid}/security/config`), securitySetup);
        pinSet = true;
        document.getElementById('new-pin').value = '';
        document.getElementById('confirm-pin').value = '';
        window.closeModal('pin-modal');
        window.showToast("✅ PIN set successfully", "success");
    } catch (e) {
        window.showToast("❌ Error setting PIN", "error");
    }
};

window.saveSecurityQuestion = async () => {
    const question = document.getElementById('security-question').value;
    const answer = document.getElementById('security-answer').value.toLowerCase().trim();
    
    if (!question || !answer) return window.showToast("⚠️ Fill all fields", "error");
    
    try {
        securitySetup.question = question;
        securitySetup.answer = answer;
        await setDoc(doc(db, `users/${currentUser.uid}/security/config`), securitySetup);
        document.getElementById('security-question').value = '';
        document.getElementById('security-answer').value = '';
        window.closeModal('security-question-modal');
        window.showToast("✅ Security question saved", "success");
    } catch (e) {
        window.showToast("❌ Error saving question", "error");
    }
};

window.verifyPIN = () => {
    const pin = document.getElementById('verify-pin').value;
    if (!pin) return window.showToast("⚠️ Enter PIN", "error");
    if (pin === securitySetup.pin) {
        isLocked = false;
        updateSecurityIcon();
        document.getElementById('verify-pin').value = '';
        window.closeModal('pin-verify-modal');
        window.showToast("🔓 Unlocked!", "success");
    } else {
        window.showToast("❌ Wrong PIN", "error");
        document.getElementById('verify-pin').value = '';
    }
};

window.triggerPINVerification = (action) => {
    if (!pinSet) {
        window.showToast("⚠️ Please set a PIN first in Settings", "warning");
        return false;
    }
    isLocked = true;
    updateSecurityIcon();
    window.openModal('pin-verify-modal');
    return true;
};

// === DARK MODE ===
window.toggleDarkMode = () => {
    darkMode = !darkMode;
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', darkMode);
};

window.toggleAutoNightMode = () => {
    autoNightMode = !autoNightMode;
    localStorage.setItem('autoNightMode', autoNightMode);
    if (autoNightMode) checkAutoNightMode();
};

function checkAutoNightMode() {
    if (!autoNightMode) return;
    const hour = new Date().getHours();
    if (hour >= 18 || hour < 6) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    setTimeout(checkAutoNightMode, 60000);
}

function initDarkMode() {
    darkMode = localStorage.getItem('darkMode') === 'true';
    autoNightMode = localStorage.getItem('autoNightMode') === 'true';
    const manualToggle = document.getElementById('manual-dark-mode');
    const autoToggle = document.getElementById('auto-night-mode');
    if (manualToggle) manualToggle.checked = darkMode;
    if (autoToggle) autoToggle.checked = autoNightMode;
    if (darkMode) document.body.classList.add('dark-mode');
    if (autoNightMode) checkAutoNightMode();
}

// === PAGE NAVIGATION ===
window.switchPage = (page) => {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + '-page').classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.getElementById('nav-' + page).classList.add('active');
    
    if (page === 'analysis') {
        updateAnalysisCharts();
    }
};

// === WALLETS ===
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('createdAt'));
    onSnapshot(q, (snapshot) => {
        allWallets = [];
        const select = document.getElementById('tx-wallet');
        const recurringSelect = document.getElementById('recurring-wallet');
        select.innerHTML = "";
        if (recurringSelect) recurringSelect.innerHTML = "";
        
        snapshot.forEach((d) => {
            const data = d.data();
            allWallets.push({ id: d.id, ...data });
            
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.innerText = data.name;
            select.appendChild(opt);
            
            if (recurringSelect) {
                const opt2 = document.createElement('option');
                opt2.value = d.id;
                opt2.innerText = data.name;
                recurringSelect.appendChild(opt2);
            }
        });
        
        displayWallets();
        updateStats();
    });
}

function displayWallets() {
    const list = document.getElementById('wallets-list');
    if (!list) return;
    list.innerHTML = "";
    
    if (allWallets.length === 0) {
        list.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px; color:#94a3b8;">🏦 No wallets added</div>';
        return;
    }
    
    allWallets.forEach((wallet) => {
        const div = document.createElement('div');
        div.className = 'wallet-card';
        div.innerHTML = `
            <div class="w-name">${wallet.name}</div>
            <div class="w-bal">₹${wallet.balance.toLocaleString('en-IN')}</div>
            <small style="color: #94a3b8; margin-top: 8px;">${wallet.desc || 'Account'}</small>
        `;
        list.appendChild(div);
    });
}

window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value.trim();
    const bal = Number(document.getElementById('new-wallet-bal').value);
    const desc = document.getElementById('new-wallet-desc').value.trim();
    
    if (!name) return window.showToast("⚠️ Enter wallet name", "error");
    if (isNaN(bal) || bal < 0) return window.showToast("⚠️ Enter valid balance", "error");
    
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
            name, balance: bal, desc, createdAt: serverTimestamp()
        });
        
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('new-wallet-bal').value = '';
        document.getElementById('new-wallet-desc').value = '';
        window.closeModal('add-wallet-modal');
        window.showToast("✅ Wallet added", "success");
    } catch (e) {
        window.showToast("❌ Error adding wallet", "error");
    }
};

// === TRANSACTIONS ===
function loadTransactions() {
    const q = query(collection(db, `users/${currentUser.uid}/transactions`), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snap) => {
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        displayTodayActivity();
        displayAnalysisTransactions();
        updateStats();
        updateAnalysisCharts();
    });
}

function displayTodayActivity() {
    const today = new Date().toDateString();
    const todayTxs = allTransactions.filter(t => {
        if (!t.timestamp) return false;
        return new Date(t.timestamp.seconds * 1000).toDateString() === today;
    });
    
    const list = document.getElementById('today-activity');
    if (!list) return;
    list.innerHTML = "";
    
    if (todayTxs.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">📭 No transactions today</div>';
        return;
    }
    
    todayTxs.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'tx-item';
        const time = new Date(tx.timestamp.seconds * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        
        const categoryEmojis = {
            'food': '🍔',
            'transport': '🚗',
            'shopping': '🛍️',
            'utilities': '💡',
            'salary': '💼',
            'other': '🔹'
        };
        const emoji = categoryEmojis[tx.category] || '🔹';
        
        item.innerHTML = `
            <div class="tx-left">
                <div class="tx-desc">${emoji} ${tx.description}</div>
                <div class="tx-meta">
                    <span class="cat-badge">${tx.category || 'general'}</span>
                    <span>• ${time}</span>
                </div>
            </div>
            <div class="tx-right">
                <div class="tx-amt ${tx.type === 'deposit' ? 'in' : 'out'}">
                    ${tx.type === 'deposit' ? '✅ +' : '❌ -'} ₹${tx.amount.toLocaleString('en-IN')}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

function displayAnalysisTransactions() {
    const list = document.getElementById('analysis-transactions');
    if (!list) return;
    list.innerHTML = "";
    
    let filtered = allTransactions;
    
    // Apply filters
    if (analysisFilter.friendId) {
        filtered = filtered.filter(t => t.friendId === analysisFilter.friendId);
    }
    if (analysisFilter.type) {
        filtered = filtered.filter(t => t.type === analysisFilter.type);
    }
    if (analysisFilter.dateFrom) {
        filtered = filtered.filter(t => {
            if (!t.timestamp) return false;
            return new Date(t.timestamp.seconds * 1000) >= new Date(analysisFilter.dateFrom);
        });
    }
    if (analysisFilter.dateTo) {
        filtered = filtered.filter(t => {
            if (!t.timestamp) return false;
            return new Date(t.timestamp.seconds * 1000) <= new Date(analysisFilter.dateTo);
        });
    }
    if (analysisFilter.search) {
        const search = analysisFilter.search.toLowerCase();
        filtered = filtered.filter(t => 
            t.description.toLowerCase().includes(search) || 
            t.amount.toString().includes(search)
        );
    }
    
    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">📭 No transactions found</div>';
        return;
    }
    
    filtered.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'tx-item';
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        
        const categoryEmojis = {
            'food': '🍔',
            'transport': '🚗',
            'shopping': '🛍️',
            'utilities': '💡',
            'salary': '💼',
            'other': '🔹'
        };
        const emoji = categoryEmojis[tx.category] || '🔹';
        
        item.innerHTML = `
            <div class="tx-left">
                <div class="tx-desc">${emoji} ${tx.description}</div>
                <div class="tx-meta">
                    <span class="cat-badge">${tx.category || 'general'}</span>
                    <span>• ${date}</span>
                </div>
            </div>
            <div class="tx-right">
                <div class="tx-amt ${tx.type === 'deposit' ? 'in' : 'out'}">
                    ${tx.type === 'deposit' ? '✅ +' : '❌ -'} ₹${tx.amount.toLocaleString('en-IN')}
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

window.saveTransaction = async () => {
    const walletId = document.getElementById('tx-wallet').value;
    const amount = Number(document.getElementById('tx-amount').value);
    const desc = document.getElementById('tx-desc').value.trim();
    const cat = document.getElementById('tx-category').value;
    
    if (!walletId || !amount || !desc) return window.showToast("⚠️ Fill all fields", "error");
    if (amount <= 0) return window.showToast("⚠️ Amount must be positive", "error");
    
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: currentTxType, 
            amount, 
            description: desc, 
            category: cat, 
            walletId, 
            timestamp: serverTimestamp()
        });
        
        const change = currentTxType === 'deposit' ? amount : -amount;
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
        
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-desc').value = '';
        window.closeModal('transaction-modal');
        window.showToast("✅ Transaction added", "success");
    } catch (e) {
        window.showToast("❌ Error adding transaction", "error");
    }
};

window.setTxType = (t) => {
    currentTxType = t;
    document.getElementById('btn-deposit').classList.toggle('active', t === 'deposit');
    document.getElementById('btn-expense').classList.toggle('active', t === 'expense');
};

function updateStats() {
    let inc = 0, exp = 0;
    allTransactions.forEach(t => t.type === 'deposit' ? inc += t.amount : exp += t.amount);
    document.getElementById('total-income').innerText = `₹${inc.toLocaleString('en-IN')}`;
    document.getElementById('total-expense').innerText = `₹${exp.toLocaleString('en-IN')}`;
    
    let myMoney = 0, owedToMe = 0, iOwe = 0;
    allWallets.forEach(w => myMoney += w.balance);
    
    allFriends.forEach(friend => {
        let balance = 0;
        allTransactions.filter(t => t.friendId === friend.id).forEach(t => {
            if (t.type === 'deposit') balance += t.amount;
            else balance -= t.amount;
        });
        if (balance > 0) owedToMe += balance;
        else iOwe += Math.abs(balance);
    });
    
    document.getElementById('my-money').innerText = `₹${myMoney.toLocaleString('en-IN')}`;
    document.getElementById('owed-to-me').innerText = `₹${owedToMe.toLocaleString('en-IN')}`;
    document.getElementById('i-owe').innerText = `₹${iOwe.toLocaleString('en-IN')}`;
    document.getElementById('actual-worth').innerText = `₹${(myMoney - iOwe + owedToMe).toLocaleString('en-IN')}`;
}

// === FRIENDS ===
function loadFriends() {
    const q = query(collection(db, `users/${currentUser.uid}/friends`), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
        allFriends = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        displayFriendsCarousel();
        updateFriendFilters();
        updateStats();
    });
}

function displayFriendsCarousel() {
    const carousel = document.getElementById('friends-carousel');
    if (!carousel) return;
    carousel.innerHTML = "";
    
    if (allFriends.length === 0) {
        carousel.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;width:100%;">👥 No friends added yet</div>';
        return;
    }
    
    allFriends.forEach(friend => {
        let balance = 0;
        allTransactions.filter(t => t.friendId === friend.id).forEach(t => {
            if (t.type === 'deposit') balance += t.amount;
            else balance -= t.amount;
        });
        
        const div = document.createElement('div');
        div.className = 'friend-circle';
        const color = balance > 0 ? '#10b981' : balance < 0 ? '#ef4444' : '#94a3b8';
        
        div.innerHTML = `
            <div class="friend-avatar" style="background: linear-gradient(135deg, #6366f1, #8b5cf6);">
                ${friend.name.charAt(0).toUpperCase()}
            </div>
            <div class="friend-name">${friend.name}</div>
            <div class="friend-balance" style="color: ${color};">
                ${balance > 0 ? '✅' : balance < 0 ? '❌' : '⚪'} ₹${Math.abs(balance).toLocaleString('en-IN')}
            </div>
        `;
        carousel.appendChild(div);
    });
}

window.addFriend = async () => {
    const name = document.getElementById('friend-name').value.trim();
    const phone = document.getElementById('friend-phone').value.trim();
    
    if (!name) return window.showToast("👤 Enter friend name", "error");
    
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/friends`), {
            name, phone, createdAt: serverTimestamp()
        });
        
        document.getElementById('friend-name').value = '';
        document.getElementById('friend-phone').value = '';
        window.closeModal('add-friend-modal');
        window.showToast("✅ Friend added", "success");
    } catch (e) {
        window.showToast("❌ Error adding friend", "error");
    }
};

function updateFriendFilters() {
    const select = document.getElementById('analysis-friend-filter');
    if (!select) return;
    const firstOption = select.innerHTML;
    select.innerHTML = firstOption;
    
    allFriends.forEach(friend => {
        const opt = document.createElement('option');
        opt.value = friend.id;
        opt.innerText = friend.name;
        select.appendChild(opt);
    });
}

// === SPLIT BILL ===
window.showFeature = (feature) => {
    document.querySelectorAll('.feature-tool').forEach(f => f.classList.add('hidden'));
    document.getElementById('features-grid').classList.remove('hidden');
    
    if (!feature) return;
    
    document.getElementById('features-grid').classList.add('hidden');
    document.getElementById(feature + '-tool').classList.remove('hidden');
    
    if (feature === 'split-bill') {
        displaySplitFriendsList();
    } else if (feature === 'debt-manager') {
        displayDebtManager();
    } else if (feature === 'calendar-view') {
        displayCalendar();
    } else if (feature === 'recurring') {
        displayRecurringList();
    }
};

function displaySplitFriendsList() {
    const list = document.getElementById('split-friends-list');
    list.innerHTML = "";
    
    if (allFriends.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:#94a3b8;">👥 Add friends first</p>';
        return;
    }
    
    allFriends.forEach(friend => {
        const div = document.createElement('label');
        div.className = 'checkbox-item';
        div.innerHTML = `
            <input type="checkbox" class="friend-split-checkbox" value="${friend.id}" data-name="${friend.name}">
            <span>${friend.name}</span>
        `;
        list.appendChild(div);
    });
    
    document.querySelectorAll('.friend-split-checkbox').forEach(cb => {
        cb.addEventListener('change', () => updateSplitPreview());
    });
    
    document.getElementById('split-amount').addEventListener('input', () => updateSplitPreview());
}

function updateSplitPreview() {
    const amount = Number(document.getElementById('split-amount').value) || 0;
    const selectedFriends = document.querySelectorAll('.friend-split-checkbox:checked');
    
    if (!amount || selectedFriends.length === 0) {
        document.getElementById('split-preview').classList.add('hidden');
        return;
    }
    
    const perPerson = amount / (selectedFriends.length + 1);
    const breakdown = document.getElementById('split-breakdown');
    breakdown.innerHTML = `
        <div class="split-item">
            <span style="font-weight: 700;">You (Payer)</span>
            <strong>₹${perPerson.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
        </div>
    `;
    
    selectedFriends.forEach(cb => {
        const div = document.createElement('div');
        div.className = 'split-item';
        div.innerHTML = `
            <span>${cb.dataset.name}</span>
            <strong>₹${perPerson.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong>
        `;
        breakdown.appendChild(div);
    });
    
    document.getElementById('split-preview').classList.remove('hidden');
}

window.addSplitBill = async () => {
    const amount = Number(document.getElementById('split-amount').value);
    const selectedFriends = document.querySelectorAll('.friend-split-checkbox:checked');
    
    if (!amount || selectedFriends.length === 0) {
        return window.showToast("⚠️ Enter amount and select friends", "error");
    }
    
    const perPerson = amount / (selectedFriends.length + 1);
    
    try {
        const wallet = allWallets[0];
        if (!wallet) return window.showToast("⚠️ Add a wallet first", "error");
        
        // Add total expense entry
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: 'expense',
            amount: amount,
            description: `Split bill with ${selectedFriends.length} people`,
            category: 'other',
            walletId: wallet.id,
            timestamp: serverTimestamp()
        });
        
        // Update wallet balance
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, wallet.id), { 
            balance: increment(-amount) 
        });
        
        // Add income entries for settlements
        for (const cb of selectedFriends) {
            const friendId = cb.value;
            const friendName = cb.dataset.name;
            
            await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
                type: 'income',
                amount: perPerson,
                description: `Settlement from ${friendName}`,
                category: 'other',
                friendId: friendId,
                walletId: wallet.id,
                timestamp: serverTimestamp()
            });
        }
        
        document.getElementById('split-amount').value = '';
        document.querySelectorAll('.friend-split-checkbox').forEach(cb => cb.checked = false);
        window.showFeature('');
        window.showToast("✅ Split bill added", "success");
    } catch (e) {
        console.error(e);
        window.showToast("❌ Error adding split bill", "error");
    }
};

// === DEBT MANAGER ===
function displayDebtManager() {
    const summary = document.getElementById('debt-summary');
    const list = document.getElementById('debt-list');
    summary.innerHTML = "";
    list.innerHTML = "";
    
    let totalOwedToMe = 0, totalIOwe = 0;
    const debts = [];
    
    allFriends.forEach(friend => {
        let balance = 0;
        allTransactions.filter(t => t.friendId === friend.id).forEach(t => {
            if (t.type === 'deposit') balance += t.amount;
            else balance -= t.amount;
        });
        
        if (balance > 0) totalOwedToMe += balance;
        if (balance < 0) totalIOwe += Math.abs(balance);
        
        debts.push({ friend, balance });
    });
    
    summary.innerHTML = `
        <div class="summary-card">
            <div>✅ Owed to Me: <strong>₹${totalOwedToMe.toLocaleString('en-IN')}</strong></div>
        </div>
        <div class="summary-card">
            <div>❌ I Owe: <strong>₹${totalIOwe.toLocaleString('en-IN')}</strong></div>
        </div>
    `;
    
    if (debts.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">👥 No friends added</div>';
        return;
    }
    
    debts.forEach(({ friend, balance }) => {
        const item = document.createElement('div');
        item.className = 'debt-item';
        
        let status = '';
        if (balance > 0) {
            status = `<span style="color: #10b981;">✅ Owes me ₹${balance.toLocaleString('en-IN')}</span>`;
        } else if (balance < 0) {
            status = `<span style="color: #ef4444;">❌ I owe ₹${Math.abs(balance).toLocaleString('en-IN')}</span>`;
        } else {
            status = `<span style="color: #94a3b8;">⚪ Settled</span>`;
        }
        
        item.innerHTML = `
            <div class="debt-name">${friend.name}</div>
            <div class="debt-status">${status}</div>
        `;
        list.appendChild(item);
    });
}

// === CALENDAR VIEW ===
function displayCalendar() {
    const calendar = document.getElementById('calendar-widget');
    const detail = document.getElementById('calendar-detail');
    calendar.innerHTML = "";
    detail.innerHTML = "";
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    let html = `<div style="font-weight:700; margin-bottom:10px; color: var(--primary);">📅 ${firstDay.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</div>`;
    html += '<div style="display:grid; grid-template-columns: repeat(7, 1fr); gap: 5px;">';
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach(d => html += `<div style="text-align:center; font-weight:700; font-size:0.8rem; color: var(--text-muted);">${d}</div>`);
    
    for (let i = 0; i < startingDayOfWeek; i++) {
        html += '<div></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const txForDay = allTransactions.filter(t => {
            if (!t.timestamp) return false;
            return new Date(t.timestamp.seconds * 1000).toDateString() === date.toDateString();
        });
        const hasEvent = txForDay.length > 0 ? 'calendar-has-event' : '';
        html += `<div class="calendar-day ${hasEvent}" onclick="window.showCalendarDetail(${day}, ${year}, ${month})">${day}</div>`;
    }
    
    html += '</div>';
    calendar.innerHTML = html;
}

window.showCalendarDetail = (day, year, month) => {
    const date = new Date(year, month, day);
    const dayTxs = allTransactions.filter(t => {
        if (!t.timestamp) return false;
        return new Date(t.timestamp.seconds * 1000).toDateString() === date.toDateString();
    });
    
    const detail = document.getElementById('calendar-detail');
    detail.innerHTML = `<h4 style="margin-bottom: 15px;">📅 ${date.toLocaleDateString('en-IN')}</h4>`;
    
    if (dayTxs.length === 0) {
        detail.innerHTML += '<p style="color:#94a3b8;">No transactions this day</p>';
    } else {
        dayTxs.forEach(t => {
            const categoryEmojis = {
                'food': '🍔',
                'transport': '🚗',
                'shopping': '🛍️',
                'utilities': '💡',
                'salary': '💼',
                'other': '🔹'
            };
            const emoji = categoryEmojis[t.category] || '🔹';
            
            detail.innerHTML += `
                <div style="padding:12px; background: var(--bg-body); border-radius:8px; margin-bottom:8px; border-left: 3px solid ${t.type === 'deposit' ? '#10b981' : '#ef4444'};">
                    <div style="font-weight: 600;">${emoji} ${t.description}</div>
                    <div style="font-size:0.85rem; color:var(--text-muted); margin-top: 4px;">
                        ${t.type === 'deposit' ? '✅ +' : '❌ -'} ₹${t.amount.toLocaleString('en-IN')}
                    </div>
                </div>
            `;
        });
    }
};

// === RECURRING TRANSACTIONS ===
function loadRecurring() {
    const q = query(collection(db, `users/${currentUser.uid}/recurring`), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snap) => {
        allRecurring = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        checkRecurringTransactions();
    });
}

function checkRecurringTransactions() {
    allRecurring.forEach(async (recurring) => {
        if (!recurring.lastRun) return;
        
        const lastRun = new Date(recurring.lastRun.seconds * 1000);
        const now = new Date();
        let shouldRun = false;
        
        if (recurring.frequency === 'daily') {
            shouldRun = now.toDateString() !== lastRun.toDateString();
        } else if (recurring.frequency === 'weekly') {
            const diff = (now - lastRun) / (1000 * 60 * 60 * 24);
            shouldRun = diff >= 7;
        } else if (recurring.frequency === 'monthly') {
            shouldRun = now.getMonth() !== lastRun.getMonth() || now.getFullYear() !== lastRun.getFullYear();
        }
        
        if (shouldRun) {
            try {
                await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
                    type: recurring.type,
                    amount: recurring.amount,
                    description: recurring.description,
                    category: recurring.category || 'other',
                    walletId: recurring.walletId,
                    isRecurring: true,
                    recurringId: recurring.id,
                    timestamp: serverTimestamp()
                });
                
                const change = recurring.type === 'deposit' ? recurring.amount : -recurring.amount;
                await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, recurring.walletId), { 
                    balance: increment(change) 
                });
                
                await updateDoc(doc(db, `users/${currentUser.uid}/recurring`, recurring.id), {
                    lastRun: serverTimestamp()
                });
                
                window.showToast(`✅ Recurring: ${recurring.description}`, "success");
            } catch (e) {
                console.error("Error running recurring:", e);
            }
        }
    });
}

function displayRecurringList() {
    const list = document.getElementById('recurring-list');
    list.innerHTML = "";
    
    if (allRecurring.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">🔄 No recurring transactions</div>';
        return;
    }
    
    allRecurring.forEach(rec => {
        const item = document.createElement('div');
        item.className = 'recurring-item';
        
        const freqEmoji = {
            'daily': '📅',
            'weekly': '📆',
            'monthly': '🗓️'
        }[rec.frequency] || '📅';
        
        item.innerHTML = `
            <div>
                <div style="font-weight: 700; margin-bottom: 4px;">${rec.description}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted);">
                    ${freqEmoji} ${rec.frequency} | ${rec.type === 'deposit' ? '✅' : '❌'} ₹${rec.amount}
                </div>
            </div>
            <button onclick="window.deleteRecurring('${rec.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-weight: 700;">🗑️</button>
        `;
        list.appendChild(item);
    });
}

window.saveRecurring = async () => {
    const desc = document.getElementById('recurring-desc').value.trim();
    const amount = Number(document.getElementById('recurring-amount').value);
    const walletId = document.getElementById('recurring-wallet').value;
    const freq = document.getElementById('recurring-freq').value;
    const start = document.getElementById('recurring-start').value;
    
    if (!desc || !amount || !walletId || !freq || !start) {
        return window.showToast("⚠️ Fill all fields", "error");
    }
    
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/recurring`), {
            description: desc,
            amount: amount,
            walletId: walletId,
            frequency: freq,
            type: currentTxType,
            category: document.getElementById('tx-category').value || 'other',
            startDate: new Date(start),
            lastRun: new Date(start),
            createdAt: serverTimestamp()
        });
        
        document.getElementById('recurring-desc').value = '';
        document.getElementById('recurring-amount').value = '';
        document.getElementById('recurring-freq').value = 'daily';
        document.getElementById('recurring-start').value = '';
        window.closeModal('add-recurring-modal');
        window.showToast("✅ Recurring transaction added", "success");
    } catch (e) {
        window.showToast("❌ Error adding recurring", "error");
    }
};

window.deleteRecurring = async (id) => {
    if (!confirm("🗑️ Delete this recurring transaction?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/recurring`, id));
        window.showToast("✅ Recurring deleted", "success");
    } catch (e) {
        window.showToast("❌ Error deleting recurring", "error");
    }
};

// === ANALYSIS FILTERS ===
window.updateDateRange = () => {
    const preset = document.getElementById('date-preset').value;
    const customRange = document.getElementById('custom-date-range');
    const now = new Date();
    
    customRange.classList.add('hidden');
    
    if (preset === 'all') {
        analysisFilter.dateFrom = null;
        analysisFilter.dateTo = null;
    } else if (preset === '7days') {
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        analysisFilter.dateFrom = from.toISOString().split('T')[0];
        analysisFilter.dateTo = now.toISOString().split('T')[0];
    } else if (preset === 'month') {
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        analysisFilter.dateFrom = from.toISOString().split('T')[0];
        analysisFilter.dateTo = now.toISOString().split('T')[0];
    } else if (preset === 'custom') {
        customRange.classList.remove('hidden');
    }
};

window.applyAnalysisFilters = () => {
    const friendId = document.getElementById('analysis-friend-filter').value;
    const type = document.getElementById('analysis-type-filter').value;
    const dateFrom = document.getElementById('date-from').value;
    const dateTo = document.getElementById('date-to').value;
    const search = document.getElementById('search-input').value.trim();
    
    analysisFilter.friendId = friendId;
    analysisFilter.type = type;
    analysisFilter.dateFrom = dateFrom;
    analysisFilter.dateTo = dateTo;
    analysisFilter.search = search;
    
    displayAnalysisTransactions();
    updateAnalysisCharts();
    window.showToast("✅ Filters applied", "success");
};

// === ANALYSIS CHARTS ===
function updateAnalysisCharts() {
    updateCategoryChart();
    updateTrendChart();
}

function updateCategoryChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;
    
    let filtered = allTransactions.filter(t => t.type === 'expense');
    
    if (analysisFilter.friendId) {
        filtered = filtered.filter(t => t.friendId === analysisFilter.friendId);
    }
    if (analysisFilter.dateFrom) {
        filtered = filtered.filter(t => {
            if (!t.timestamp) return false;
            return new Date(t.timestamp.seconds * 1000) >= new Date(analysisFilter.dateFrom);
        });
    }
    if (analysisFilter.dateTo) {
        filtered = filtered.filter(t => {
            if (!t.timestamp) return false;
            return new Date(t.timestamp.seconds * 1000) <= new Date(analysisFilter.dateTo);
        });
    }
    
    const data = {};
    filtered.forEach(t => {
        const cat = t.category || 'other';
        data[cat] = (data[cat] || 0) + t.amount;
    });
    
    if (Object.keys(data).length === 0) {
        if (categoryChart) categoryChart.destroy();
        const parent = ctx.parentElement;
        parent.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8;">📭 No data</div>';
        return;
    }
    
    const categoryLabels = {
        'food': '🍔 Food',
        'transport': '🚗 Transport',
        'shopping': '🛍️ Shopping',
        'utilities': '�� Bills',
        'salary': '💼 Salary',
        'other': '🔹 Other'
    };
    
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data).map(k => categoryLabels[k] || k),
            datasets: [{
                data: Object.values(data),
                backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
                borderColor: 'var(--bg-card)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 12, weight: 'bold' },
                        usePointStyle: true,
                        color: 'var(--text-main)'
                    }
                }
            }
        }
    });
}

function updateTrendChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    
    const monthlyData = {};
    allTransactions.forEach(t => {
        if (!t.timestamp) return;
        const date = new Date(t.timestamp.seconds * 1000);
        const month = date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        
        if (!monthlyData[month]) monthlyData[month] = { income: 0, expense: 0 };
        if (t.type === 'deposit') monthlyData[month].income += t.amount;
        else monthlyData[month].expense += t.amount;
    });
    
    const labels = Object.keys(monthlyData).slice(-6).reverse();
    const incomeData = labels.map(m => monthlyData[m].income);
    const expenseData = labels.map(m => monthlyData[m].expense);
    
    if (labels.length === 0) {
        if (trendChart) trendChart.destroy();
        const parent = ctx.parentElement;
        parent.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8;">📭 No data</div>';
        return;
    }
    
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '📈 Income',
                    data: incomeData,
                    backgroundColor: '#10b981',
                    borderRadius: 8,
                    borderSkipped: false
                },
                {
                    label: '📉 Expense',
                    data: expenseData,
                    backgroundColor: '#ef4444',
                    borderRadius: 8,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₹' + value.toLocaleString('en-IN');
                        },
                        color: 'var(--text-muted)'
                    },
                    grid: {
                        color: 'rgba(99, 102, 241, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: 'var(--text-muted)'
                    },
                    grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 12, weight: 'bold' },
                        usePointStyle: true,
                        color: 'var(--text-main)'
                    }
                }
            }
        }
    });
}

// === DATA EXPORT ===
window.exportDataRange = async () => {
    const dateFrom = document.getElementById('export-from').value;
    const dateTo = document.getElementById('export-to').value;
    const format = document.getElementById('export-format').value;
    
    if (!dateFrom || !dateTo) return window.showToast("⚠️ Select date range", "error");
    
    let filtered = allTransactions.filter(t => {
        if (!t.timestamp) return false;
        const txDate = new Date(t.timestamp.seconds * 1000);
        return txDate >= new Date(dateFrom) && txDate <= new Date(dateTo);
    });
    
    if (format === 'csv') {
        exportAsCSV(filtered, dateFrom, dateTo);
    } else if (format === 'pdf') {
        exportAsPDF(filtered, dateFrom, dateTo);
    }
    
    window.closeModal('export-modal');
    window.showToast("📥 Export completed", "success");
};

function exportAsCSV(transactions, from, to) {
    let csv = 'Date,Type,Amount,Category,Description,Wallet\n';
    
    transactions.forEach(t => {
        const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        const type = t.type === 'deposit' ? 'Income' : 'Expense';
        csv += `"${date}","${type}",${t.amount},"${t.category || 'General'}","${t.description}","${t.walletName || 'Wallet'}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${from}-to-${to}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportAsPDF(transactions, from, to) {
    let html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1 style="text-align: center; color: #6366f1;">💎 Smart Ledger Report</h1>
            <h3 style="text-align: center; color: #64748b;">From ${from} to ${to}</h3>
            <table border="1" cellpadding="10" style="width:100%; border-collapse:collapse; margin-top: 20px;">
                <tr style="background-color: #e0e7ff;">
                    <th>📅 Date</th>
                    <th>📊 Type</th>
                    <th>💰 Amount</th>
                    <th>🏷️ Category</th>
                    <th>📝 Description</th>
                </tr>
    `;
    
    let totalIncome = 0, totalExpense = 0;
    transactions.forEach(t => {
        const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        const type = t.type === 'deposit' ? '📈 Income' : '📉 Expense';
        html += `<tr><td>${date}</td><td>${type}</td><td>₹${t.amount}</td><td>${t.category || 'General'}</td><td>${t.description}</td></tr>`;
        if (t.type === 'deposit') totalIncome += t.amount;
        else totalExpense += t.amount;
    });
    
    html += `<tr style="font-weight:bold; background-color: #fef3c7;">
        <td colspan="2">📊 SUMMARY</td>
        <td>📈 ₹${totalIncome.toLocaleString('en-IN')}</td>
        <td>📉 ₹${totalExpense.toLocaleString('en-IN')}</td>
        <td>💰 Net: ₹${(totalIncome - totalExpense).toLocaleString('en-IN')}</td>
    </tr>`;
    html += '</table></div>';
    
    const element = document.createElement('div');
    element.innerHTML = html;
    
    const opt = {
        margin: 10,
        filename: `ledger-${from}-to-${to}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };
    
    html2pdf().set(opt).from(element).save();
}

// === MODAL CONTROLLERS ===
window.openModal = (id) => {
    document.getElementById(id).classList.remove('hidden');
};

window.closeModal = (id) => {
    document.getElementById(id).classList.add('hidden');
    document.getElementById('verify-pin').value = '';
};

window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.className = `toast show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3000);
};

// === INITIALIZATION ON PAGE LOAD ===
window.addEventListener('load', () => {
    document.getElementById('security-btn').addEventListener('click', () => {
        const newStatus = !isLocked;
        if (newStatus && !pinSet) {
            window.showToast("⚠️ Set a PIN first", "warning");
            return;
        }
        isLocked = newStatus;
        updateSecurityIcon();
        window.showToast(isLocked ? "🔒 Locked!" : "🔓 Unlocked!", isLocked ? "warning" : "success");
    });
});
