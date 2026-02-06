import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// === FIREBASE CONFIGURATION ===
// WARNING: Never expose API keys in client-side code. Use Firebase Security Rules to protect data.
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
        document.getElementById('profile-gender').value = data.gender || 'Male';
        document.getElementById('user-avatar').src = `https://ui-avatars.com/api/?name=${data.displayName}&background=random`;
    } else {
        document.getElementById('user-name').innerText = currentUser.displayName;
        document.getElementById('user-avatar').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}`;
    }
}

window.saveProfile = async () => {
    const name = document.getElementById('profile-name').value;
    const age = document.getElementById('profile-age').value;
    const gender = document.getElementById('profile-gender').value;
    if (!name.trim()) return window.showToast("Please enter your name", "error");
    
    await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), { displayName: name, age, gender });
    window.closeModal('profile-modal');
    await loadProfile();
    window.showToast("Profile updated", "success");
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
                    <span onclick="window.deleteWallet('${d.id}')" style="cursor:pointer; opacity:0.3; font-size:1.5rem;">×</span>
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
    const reserved = Number(document.getElementById('new-wallet-reserved').value) || 0;
    const desc = document.getElementById('new-wallet-desc').value;
    const isOwner = document.getElementById('new-wallet-owner').checked;
    
    if (!name.trim()) return window.showToast("Enter wallet name", "error");
    if (isNaN(bal) || bal < 0) return window.showToast("Enter valid balance", "error");

    await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
        name, balance: bal, reserved, desc, isOwner, createdAt: serverTimestamp()
    });
    
    // Clear form
    document.getElementById('new-wallet-name').value = '';
    document.getElementById('new-wallet-bal').value = '';
    document.getElementById('new-wallet-reserved').value = '';
    document.getElementById('new-wallet-desc').value = '';
    document.getElementById('new-wallet-owner').checked = false;
    
    window.closeModal('add-wallet-modal');
    window.showToast("Wallet added", "success");
};

window.deleteWallet = async (id) => {
    if (!confirm("Delete this wallet? This action cannot be undone.")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/wallets`, id));
        window.showToast("Wallet deleted", "success");
    } catch (e) {
        window.showToast("Error deleting wallet", "error");
    }
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

    if (!walletId || !amount || !desc.trim()) return window.showToast("Fill all fields", "error");
    if (amount <= 0) return window.showToast("Amount must be positive", "error");

    await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
        type: currentTxType, amount, description: desc, category: cat, walletId, walletName, timestamp: serverTimestamp()
    });

    const change = currentTxType === 'deposit' ? amount : -amount;
    await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
    
    // Clear form
    document.getElementById('tx-amount').value = '';
    document.getElementById('tx-desc').value = '';
    
    window.closeModal('transaction-modal');
    window.showToast("Transaction added", "success");
};

window.deleteTx = async (id, amount, type, walletId) => {
    if (!confirm("Delete this transaction?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, id));
        const change = type === 'deposit' ? -amount : amount;
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
        window.showToast("Transaction deleted", "success");
    } catch (e) {
        window.showToast("Error deleting transaction", "error");
    }
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

// === FILTERS ===
window.applyFilters = () => {
    const type = document.getElementById('filter-type').value;
    currentFilter.type = type;
    displayTransactions();
    window.closeModal('filter-modal');
    window.showToast("Filter applied", "success");
};

window.clearFilters = () => {
    currentFilter.type = '';
    document.getElementById('filter-type').value = '';
    displayTransactions();
    window.closeModal('filter-modal');
    window.showToast("Filter cleared", "success");
};

// === EXPORT & PDF ===
window.exportData = () => {
    let csv = 'Date,Type,Amount,Category,Description,Wallet\n';
    allTransactions.forEach(t => {
        const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        csv += `${date},${t.type},${t.amount},${t.category},${t.description},${t.walletName}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.showToast("Data exported", "success");
};

function populateReportMonths() {
    const select = document.getElementById('report-month');
    const now = new Date();
    select.innerHTML = '';
    
    for (let i = 0; i < 12; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long' });
        const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        const opt = document.createElement('option');
        opt.value = value;
        opt.innerText = label;
        select.appendChild(opt);
    }
}

window.generatePDF = async () => {
    const month = document.getElementById('report-month').value;
    if (!month) return window.showToast("Select a month", "error");
    
    const [year, monthNum] = month.split('-');
    const filtered = allTransactions.filter(t => {
        if (!t.timestamp) return false;
        const txDate = new Date(t.timestamp.seconds * 1000);
        return txDate.getFullYear() == year && (txDate.getMonth() + 1) == monthNum;
    });
    
    let html = `
        <h1>Money Ledger Report - ${new Date(year, monthNum - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h1>
        <table border="1" style="width:100%; border-collapse:collapse;">
            <tr><th>Date</th><th>Type</th><th>Amount</th><th>Category</th><th>Description</th><th>Wallet</th></tr>
    `;
    
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(t => {
        const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        html += `<tr><td>${date}</td><td>${t.type}</td><td>₹${t.amount}</td><td>${t.category}</td><td>${t.description}</td><td>${t.walletName}</td></tr>`;
        if (t.type === 'deposit') totalIncome += t.amount;
        else totalExpense += t.amount;
    });
    
    html += `<tr style="font-weight:bold;"><td colspan="2">TOTAL</td><td>Income: ₹${totalIncome}</td><td>Expense: ₹${totalExpense}</td><td colspan="2">Net: ₹${totalIncome - totalExpense}</td></tr>`;
    html += '</table>';
    
    const element = document.createElement('div');
    element.innerHTML = html;
    
    const opt = {
        margin: 10,
        filename: `ledger-${month}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };
    
    html2pdf().set(opt).from(element).save();
    window.closeModal('reports-modal');
    window.showToast("PDF generated", "success");
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

// === CHART & BUDGETS ===
async function loadBudgets() {
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`));
        if (snap.exists()) budgets = snap.data();
    } catch (e) {
        console.log("No budgets found");
    }
    displayBudgetTracker();
}

window.saveBudgets = async () => {
    const categories = ['food', 'transport', 'shopping', 'utilities', 'salary'];
    const newBudgets = {};
    
    categories.forEach(cat => {
        const input = document.getElementById(`budget-${cat}`);
        if (input) newBudgets[cat] = Number(input.value) || 0;
    });
    
    await setDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`), newBudgets);
    budgets = newBudgets;
    displayBudgetTracker();
    window.closeModal('budget-modal');
    window.showToast("Budgets saved", "success");
};

function displayBudgetTracker() {
    const div = document.getElementById('budget-items');
    const form = document.getElementById('budget-form');
    
    div.innerHTML = "";
    form.innerHTML = "";
    
    const categories = ['food', 'transport', 'shopping', 'utilities', 'salary'];
    
    categories.forEach(cat => {
        const spent = allTransactions.filter(t => t.category === cat && t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const limit = budgets[cat] || 2000;
        
        // Display tracker
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
        
        // Budget edit form
        form.innerHTML += `
            <div class="form-group">
                <label>${cat.charAt(0).toUpperCase() + cat.slice(1)} Budget (₹)</label>
                <input type="number" id="budget-${cat}" class="input-field" value="${limit}">
            </div>
        `;
    });
}

function updateChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;
    
    const data = {};
    allTransactions.filter(t => t.type === 'expense').forEach(t => {
        data[t.category || 'other'] = (data[t.category || 'other'] || 0) + t.amount;
    });
    
    // Check if there's data to display
    if (Object.keys(data).length === 0) {
        if (categoryChart) categoryChart.destroy();
        const emptyDiv = ctx.parentElement;
        emptyDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">No expense data available</div>';
        return;
    }
    
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data),
            datasets: [{
                data: Object.values(data),
                backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
          }
