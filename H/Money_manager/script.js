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

let currentUser = null;
let currentTxType = 'deposit';
let allTransactions = [];
let currentFilter = { type: '' };
let categoryChart = null;
let budgets = {};

// === AUTHENTICATION ===
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        await loadProfile();
        loadWallets();
        loadTransactions();
        loadBudgets();
        populateReportMonths();
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
    loader.classList.add('hidden');
});

window.loginGoogle = async () => {
    try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); }
};

window.logout = () => signOut(auth);

// === PROFILE ===
async function loadProfile() {
    const snap = await getDoc(doc(db, `users/${currentUser.uid}/profile/details`));
    if (snap.exists()) {
        const data = snap.data();
        document.getElementById('user-name').innerText = data.displayName || currentUser.displayName;
        document.getElementById('profile-name').value = data.displayName || '';
        document.getElementById('profile-age').value = data.age || '';
        document.getElementById('user-avatar').src = `https://ui-avatars.com/api/?name=${data.displayName}&background=random`;
    } else {
        document.getElementById('user-name').innerText = currentUser.displayName;
        document.getElementById('user-avatar').src = currentUser.photoURL;
    }
}

window.saveProfile = async () => {
    const name = document.getElementById('profile-name').value;
    const age = document.getElementById('profile-age').value;
    const gender = document.getElementById('profile-gender').value;
    await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), { displayName: name, age, gender });
    window.closeModal('profile-modal');
    loadProfile();
};

// === WALLETS ===
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('createdAt'));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('wallets-list');
        const select = document.getElementById('tx-wallet');
        list.innerHTML = "";
        select.innerHTML = "";
        
        let grandTotal = 0, liability = 0;

        snapshot.forEach((d) => {
            const data = d.data();
            grandTotal += data.balance;
            if (!data.isOwner) liability += data.balance;

            // Add to List
            const div = document.createElement('div');
            div.className = 'wallet-card';
            div.innerHTML = `
                <div class="wallet-top">
                    <span class="w-name">${data.name}</span>
                    <span onclick="window.deleteWallet('${d.id}')" style="cursor:pointer; opacity:0.3">×</span>
                </div>
                <div class="w-bal">₹${data.balance.toLocaleString('en-IN')}</div>
            `;
            list.appendChild(div);

            // Add to Select
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.innerText = data.name;
            select.appendChild(opt);
        });

        // Update Net Worth UI
        document.getElementById('grand-total').innerText = `₹${grandTotal.toLocaleString('en-IN')}`;
        document.getElementById('total-liability').innerText = `₹${liability.toLocaleString('en-IN')}`;
        document.getElementById('actual-worth').innerText = `₹${(grandTotal - liability).toLocaleString('en-IN')}`;
    });
}

window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value;
    const bal = Number(document.getElementById('new-wallet-bal').value);
    const isOwner = document.getElementById('new-wallet-owner').checked;
    
    if(!name) return;

    await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
        name, balance: bal, isOwner, createdAt: serverTimestamp()
    });
    window.closeModal('add-wallet-modal');
};

// === TRANSACTIONS ===
function loadTransactions() {
    const q = query(collection(db, `users/${currentUser.uid}/transactions`), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snap) => {
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        displayTransactions();
        updateStats();
        displayBudgetTracker();
        updateChart();
    });
}

function displayTransactions() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = "";
    
    let filtered = currentFilter.type ? allTransactions.filter(t => t.type === currentFilter.type) : allTransactions;

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">No transactions found</div>';
        return;
    }

    filtered.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'tx-item';
        
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'N/A';
        const catName = (tx.category || 'General').toUpperCase();

        item.innerHTML = `
            <div class="tx-left">
                <div class="tx-desc">${tx.description}</div>
                <div class="tx-meta">
                    <span class="cat-badge">${catName}</span>
                    <span>${tx.walletName}</span>
                    <span>• ${date}</span>
                </div>
            </div>
            <div class="tx-right">
                <div class="tx-amt ${tx.type === 'deposit' ? 'in' : 'out'}">
                    ${tx.type === 'deposit' ? '+' : '-'} ₹${tx.amount.toLocaleString('en-IN')}
                </div>
                <div class="tx-del" onclick="window.deleteTx('${tx.id}', ${tx.amount}, '${tx.type}', '${tx.walletId}')">
                    Undo
                </div>
            </div>
        `;
        list.appendChild(item);
    });
}

window.saveTransaction = async () => {
    const walletId = document.getElementById('tx-wallet').value;
    const amount = Number(document.getElementById('tx-amount').value);
    const desc = document.getElementById('tx-desc').value;
    const cat = document.getElementById('tx-category').value;
    const walletName = document.getElementById('tx-wallet').options[document.getElementById('tx-wallet').selectedIndex].text;

    if (!walletId || !amount || !desc) return alert("Fill all fields");

    await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
        type: currentTxType, amount, description: desc, category: cat, walletId, walletName, timestamp: serverTimestamp()
    });

    const change = currentTxType === 'deposit' ? amount : -amount;
    await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
    
    window.closeModal('transaction-modal');
    window.showToast("Transaction added", "success");
};

window.deleteTx = async (id, amount, type, walletId) => {
    if(!confirm("Delete this transaction?")) return;
    await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, id));
    const change = type === 'deposit' ? -amount : amount;
    await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
};

// === UTILS & HELPERS ===
function updateStats() {
    let inc = 0, exp = 0;
    allTransactions.forEach(t => t.type === 'deposit' ? inc += t.amount : exp += t.amount);
    document.getElementById('total-income').innerText = `₹${inc.toLocaleString('en-IN')}`;
    document.getElementById('total-expense').innerText = `₹${exp.toLocaleString('en-IN')}`;
}

window.setTxType = (t) => {
    currentTxType = t;
    document.getElementById('btn-deposit').classList.toggle('active', t === 'deposit');
    document.getElementById('btn-expense').classList.toggle('active', t === 'expense');
};

// === MODAL CONTROLLERS ===
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.toggleMenu = () => document.getElementById('side-menu').classList.toggle('hidden');

window.showPage = (page) => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + '-page').classList.add('active');
};

window.showToast = (msg, type) => {
    const t = document.getElementById('toast');
    t.innerText = msg;
    t.className = `toast show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3000);
};

// === CHART & BUDGETS (Basic Implementations) ===
async function loadBudgets() {
    // Basic placeholder for budget loading
    const snap = await getDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`));
    if(snap.exists()) budgets = snap.data();
    displayBudgetTracker();
}

function displayBudgetTracker() {
    const div = document.getElementById('budget-items');
    div.innerHTML = "";
    // Simplified logic for brevity in this full code dump
    const categories = ['food', 'transport', 'shopping'];
    categories.forEach(cat => {
        const spent = allTransactions.filter(t => t.category === cat && t.type === 'expense').reduce((sum,t)=>sum+t.amount,0);
        const limit = budgets[cat] || 2000;
        div.innerHTML += `
            <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:0.8rem;">
                    <span>${cat.toUpperCase()}</span>
                    <span>₹${spent} / ₹${limit}</span>
                </div>
                <div style="height:6px;background:#eee;border-radius:3px;margin-top:5px;">
                    <div style="width:${Math.min((spent/limit)*100, 100)}%;height:100%;background:var(--primary);border-radius:3px;"></div>
                </div>
            </div>
        `;
    });
}

function updateChart() {
    const ctx = document.getElementById('categoryChart');
    if(!ctx) return;
    // Basic Chart Logic
    const data = {};
    allTransactions.filter(t=>t.type==='expense').forEach(t => {
        data[t.category] = (data[t.category] || 0) + t.amount;
    });
    
    if(categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data),
            datasets: [{ data: Object.values(data), backgroundColor: ['#6366f1','#10b981','#f59e0b','#ef4444'] }]
        }
    });
}
