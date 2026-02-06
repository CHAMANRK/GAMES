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
let allWallets = [];
let currentFilter = { type: '' };
let categoryChart = null;
let comparisonChart = null;
let budgets = {};
let editingWalletId = null;

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
    try { 
        await signInWithPopup(auth, provider); 
    } catch (e) { 
        window.showToast("❌ " + e.message, "error");
    }
};

window.logout = () => signOut(auth);

// === PROFILE ===
async function loadProfile() {
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/profile/details`));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('user-name').innerText = data.displayName || currentUser.displayName;
            document.getElementById('profile-name').value = data.displayName || '';
            document.getElementById('profile-age').value = data.age || '';
            document.getElementById('profile-gender').value = data.gender || 'Male';
            document.getElementById('user-avatar').src = `https://ui-avatars.com/api/?name=${data.displayName}&background=random`;
            document.getElementById('profile-avatar-large').src = `https://ui-avatars.com/api/?name=${data.displayName}&background=random&size=100`;
        } else {
            document.getElementById('user-name').innerText = currentUser.displayName;
            document.getElementById('user-avatar').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}`;
            document.getElementById('profile-avatar-large').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}&size=100`;
        }
    } catch (e) {
        console.error("Error loading profile:", e);
    }
}

window.saveProfile = async () => {
    const name = document.getElementById('profile-name').value;
    const age = document.getElementById('profile-age').value;
    const gender = document.getElementById('profile-gender').value;
    if (!name.trim()) return window.showToast("👤 Please enter your name", "error");
    
    try {
        await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), { displayName: name, age, gender });
        window.closeModal('profile-modal');
        await loadProfile();
        window.showToast("✅ Profile updated successfully", "success");
    } catch (e) {
        window.showToast("❌ Error updating profile", "error");
    }
};

// === WALLETS ===
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('createdAt'));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('wallets-list');
        const select = document.getElementById('tx-wallet');
        list.innerHTML = "";
        select.innerHTML = "";
        allWallets = [];
        
        let grandTotal = 0, liability = 0;

        snapshot.forEach((d) => {
            const data = d.data();
            if (data.hidden) return;
            
            allWallets.push({ id: d.id, ...data });
            grandTotal += data.balance;
            if (!data.isOwner) liability += data.balance;

            const reserved = data.reserved || 0;
            const available = data.balance - reserved;
            const isLow = available < reserved && reserved > 0;

            const div = document.createElement('div');
            div.className = `wallet-card ${data.hidden ? 'hidden-wallet' : ''}`;
            div.onclick = () => window.openEditWallet(d.id);
            
            div.innerHTML = `
                <div class="wallet-top">
                    <div>
                        <div class="w-name">${data.name}</div>
                        ${data.hidden ? '<span class="wallet-status">👁️ Hidden</span>' : ''}
                    </div>
                    <div class="w-actions">
                        <button class="wallet-action-btn" onclick="event.stopPropagation(); window.openEditWallet('${d.id}')">✏️</button>
                    </div>
                </div>
                <div class="w-bal">₹${data.balance.toLocaleString('en-IN')}</div>
                ${reserved > 0 ? `<div class="w-reserved ${isLow ? 'alert' : ''}">🔒 Reserved: ₹${reserved.toLocaleString('en-IN')}</div>` : ''}
            `;
            list.appendChild(div);

            const opt = document.createElement('option');
            opt.value = d.id;
            opt.innerText = data.name;
            select.appendChild(opt);
        });

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
    
    if (!name.trim()) return window.showToast("⚠️ Enter wallet name", "error");
    if (isNaN(bal) || bal < 0) return window.showToast("⚠️ Enter valid balance", "error");
    if (reserved > bal) return window.showToast("⚠️ Reserved amount cannot exceed balance", "error");

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
            name, balance: bal, reserved, desc, isOwner, hidden: false, createdAt: serverTimestamp()
        });
        
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('new-wallet-bal').value = '';
        document.getElementById('new-wallet-reserved').value = '';
        document.getElementById('new-wallet-desc').value = '';
        document.getElementById('new-wallet-owner').checked = false;
        
        window.closeModal('add-wallet-modal');
        window.showToast("✅ Wallet added successfully", "success");
    } catch (e) {
        window.showToast("❌ Error adding wallet", "error");
    }
};

window.openEditWallet = async (walletId) => {
    editingWalletId = walletId;
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId));
        const data = snap.data();
        
        document.getElementById('edit-wallet-name').value = data.name;
        document.getElementById('edit-wallet-bal').value = data.balance;
        document.getElementById('edit-wallet-reserved').value = data.reserved || 0;
        document.getElementById('edit-wallet-desc').value = data.desc || '';
        
        window.updateReservedWarning();
        window.openModal('edit-wallet-modal');
    } catch (e) {
        window.showToast("❌ Error loading wallet", "error");
    }
};

window.updateReservedWarning = () => {
    const balance = Number(document.getElementById('edit-wallet-bal').value) || 0;
    const reserved = Number(document.getElementById('edit-wallet-reserved').value) || 0;
    const available = balance - reserved;
    
    const warningDiv = document.getElementById('reserved-warning-display');
    const availDiv = document.getElementById('available-amount');
    
    availDiv.innerText = `₹${available.toLocaleString('en-IN')}`;
    
    if (reserved > 0) {
        if (available < 0) {
            warningDiv.className = 'reserved-warning alert';
            warningDiv.innerHTML = '⚠️ Reserved amount exceeds balance! Please adjust.';
        } else if (available < reserved * 0.5) {
            warningDiv.className = 'reserved-warning alert';
            warningDiv.innerHTML = '⚠️ Available balance is low compared to reserved amount';
        } else {
            warningDiv.className = 'reserved-warning safe';
            warningDiv.innerHTML = '✅ Reserved amount is safe';
        }
    } else {
        warningDiv.className = '';
        warningDiv.innerHTML = '';
    }
};

window.saveWalletEdit = async () => {
    const name = document.getElementById('edit-wallet-name').value;
    const bal = Number(document.getElementById('edit-wallet-bal').value);
    const reserved = Number(document.getElementById('edit-wallet-reserved').value) || 0;
    const desc = document.getElementById('edit-wallet-desc').value;
    
    if (!name.trim()) return window.showToast("⚠️ Enter wallet name", "error");
    if (isNaN(bal) || bal < 0) return window.showToast("⚠️ Enter valid balance", "error");
    if (reserved > bal) return window.showToast("⚠️ Reserved amount cannot exceed balance", "error");
    
    try {
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId), {
            name, balance: bal, reserved, desc
        });
        
        window.closeModal('edit-wallet-modal');
        window.showToast("✅ Wallet updated", "success");
    } catch (e) {
        window.showToast("❌ Error updating wallet", "error");
    }
};

window.hideWallet = async () => {
    try {
        const snap = await getDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId));
        const data = snap.data();
        
        if (data.balance !== 0) {
            return window.showToast("⚠️ Cannot hide wallet. Balance must be zero!", "error");
        }
        
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId), {
            hidden: true
        });
        
        window.closeModal('edit-wallet-modal');
        window.showToast("👁️ Wallet hidden successfully", "success");
    } catch (e) {
        window.showToast("❌ Error hiding wallet", "error");
    }
};

window.deleteWallet = async (id) => {
    if (!confirm("🗑️ Delete this wallet? This action cannot be undone.")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/wallets`, id));
        window.showToast("✅ Wallet deleted", "success");
    } catch (e) {
        window.showToast("❌ Error deleting wallet", "error");
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
        updateComparisonChart();
    });
}

function displayTransactions() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = "";
    
    let filtered = currentFilter.type ? allTransactions.filter(t => t.type === currentFilter.type) : allTransactions;

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">📭 No transactions found</div>';
        return;
    }

    filtered.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'tx-item';
        
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'N/A';
        const catName = (tx.category || 'General').toUpperCase();
        
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
                    <span class="cat-badge">${catName}</span>
                    <span>${tx.walletName}</span>
                    <span>• ${date}</span>
                </div>
            </div>
            <div class="tx-right">
                <div class="tx-amt ${tx.type === 'deposit' ? 'in' : 'out'}">
                    ${tx.type === 'deposit' ? '✅ +' : '❌ -'} ₹${tx.amount.toLocaleString('en-IN')}
                </div>
                <div class="tx-del" onclick="window.deleteTx('${tx.id}', ${tx.amount}, '${tx.type}', '${tx.walletId}')">
                    🔄 Undo
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

    if (!walletId || !amount || !desc.trim()) return window.showToast("⚠️ Fill all fields", "error");
    if (amount <= 0) return window.showToast("⚠️ Amount must be positive", "error");

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: currentTxType, amount, description: desc, category: cat, walletId, walletName, timestamp: serverTimestamp()
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

window.deleteTx = async (id, amount, type, walletId) => {
    if (!confirm("🗑️ Delete this transaction?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, id));
        const change = type === 'deposit' ? -amount : amount;
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
        window.showToast("✅ Transaction deleted", "success");
    } catch (e) {
        window.showToast("❌ Error deleting transaction", "error");
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
    window.showToast("✅ Filter applied", "success");
};

window.clearFilters = () => {
    currentFilter.type = '';
    document.getElementById('filter-type').value = '';
    displayTransactions();
    window.closeModal('filter-modal');
    window.showToast("🔄 Filter cleared", "success");
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
    window.showToast("📥 Data exported successfully", "success");
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
    if (!month) return window.showToast("⚠️ Select a month", "error");
    
    const [year, monthNum] = month.split('-');
    const filtered = allTransactions.filter(t => {
        if (!t.timestamp) return false;
        const txDate = new Date(t.timestamp.seconds * 1000);
        return txDate.getFullYear() == year && (txDate.getMonth() + 1) == monthNum;
    });
    
    let html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1 style="text-align: center; color: #6366f1;">💎 Smart Ledger Report</h1>
            <h2 style="text-align: center; color: #666;">${new Date(year, monthNum - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
            <table border="1" cellpadding="10" style="width:100%; border-collapse:collapse; margin-top: 20px;">
                <tr style="background-color: #f1f5f9;">
                    <th>📅 Date</th>
                    <th>📊 Type</th>
                    <th>💰 Amount</th>
                    <th>🏷️ Category</th>
                    <th>📝 Description</th>
                    <th>🏦 Wallet</th>
                </tr>
    `;
    
    let totalIncome = 0, totalExpense = 0;
    filtered.forEach(t => {
        const date = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        const type = t.type === 'deposit' ? '📈 Income' : '📉 Expense';
        html += `<tr><td>${date}</td><td>${type}</td><td>₹${t.amount}</td><td>${t.category}</td><td>${t.description}</td><td>${t.walletName}</td></tr>`;
        if (t.type === 'deposit') totalIncome += t.amount;
        else totalExpense += t.amount;
    });
    
    html += `<tr style="font-weight:bold; background-color: #e0e7ff;">
        <td colspan="2">📊 SUMMARY</td>
        <td>📈 Income: ₹${totalIncome.toLocaleString('en-IN')}</td>
        <td>📉 Expense: ₹${totalExpense.toLocaleString('en-IN')}</td>
        <td colspan="2">💰 Net: ₹${(totalIncome - totalExpense).toLocaleString('en-IN')}</td>
    </tr>`;
    html += '</table></div>';
    
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
    window.showToast("📄 PDF generated successfully", "success");
};

// === MODAL CONTROLLERS ===
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.toggleMenu = () => document.getElementById('side-menu').classList.toggle('hidden');

window.showPage = (page) => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(page + '-page').classList.add('active');
};

window.showToast = (msg, type = 'info') => {
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
        console.log("📭 No budgets found");
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
    
    try {
        await setDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`), newBudgets);
        budgets = newBudgets;
        displayBudgetTracker();
        window.closeModal('budget-modal');
        window.showToast("✅ Budgets saved successfully", "success");
    } catch (e) {
        window.showToast("❌ Error saving budgets", "error");
    }
};

function displayBudgetTracker() {
    const div = document.getElementById('budget-items');
    const form = document.getElementById('budget-form');
    
    div.innerHTML = "";
    form.innerHTML = "";
    
    const categories = ['food', 'transport', 'shopping', 'utilities', 'salary'];
    const categoryEmojis = {
        'food': '🍔',
        'transport': '🚗',
        'shopping': '🛍️',
        'utilities': '💡',
        'salary': '💼'
    };
    
    categories.forEach(cat => {
        const spent = allTransactions.filter(t => t.category === cat && t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const limit = budgets[cat] || 2000;
        const percentage = (spent / limit) * 100;
        const emoji = categoryEmojis[cat];
        
        let statusColor = '#10b981';
        let statusEmoji = '✅';
        if (percentage > 100) {
            statusColor = '#ef4444';
            statusEmoji = '⚠️';
        } else if (percentage > 80) {
            statusColor = '#f59e0b';
            statusEmoji = '⚠️';
        }
        
        div.innerHTML += `
            <div style="margin-bottom:15px; background: white; padding: 15px; border-radius: 12px;">
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;font-weight:700;margin-bottom:8px;">
                    <span>${emoji} ${cat.toUpperCase()}</span>
                    <span style="color: ${statusColor};">${statusEmoji} ₹${spent} / ₹${limit}</span>
                </div>
                <div style="height:8px;background:#e0e7ff;border-radius:4px;overflow:hidden;">
                    <div style="width:${Math.min(percentage, 100)}%;height:100%;background:${statusColor};border-radius:4px;transition: width 0.3s ease;"></div>
                </div>
                <small style="color: #64748b; margin-top: 4px; display: block;">${Math.round(percentage)}% used</small>
            </div>
        `;
        
        form.innerHTML += `
            <div class="form-group">
                <label>${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)} Budget (₹)</label>
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
    
    if (Object.keys(data).length === 0) {
        if (categoryChart) categoryChart.destroy();
        const emptyDiv = ctx.parentElement;
        emptyDiv.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-size: 1rem;">📭 No expense data available</div>';
        return;
    }
    
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data).map(k => {
                const categoryEmojis = {
                    'food': '🍔 Food',
                    'transport': '🚗 Transport',
                    'shopping': '🛍️ Shopping',
                    'utilities': '💡 Bills',
                    'salary': '💼 Salary',
                    'other': '🔹 Other'
                };
                return categoryEmojis[k] || k;
            }),
            datasets: [{
                data: Object.values(data),
                backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],
                borderColor: 'white',
                borderWidth: 3
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
                        font: { size: 13, weight: 'bold' },
                        usePointStyle: true
                    }
                }
            }
        }
    });
}

function updateComparisonChart() {
    const ctx = document.getElementById('comparisonChart');
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
    
    const labels = Object.keys(monthlyData).slice(0, 6).reverse();
    const incomeData = labels.map(m => monthlyData[m].income);
    const expenseData = labels.map(m => monthlyData[m].expense);
    
    if (labels.length === 0) {
        if (comparisonChart) comparisonChart.destroy();
        const emptyDiv = ctx.parentElement;
        emptyDiv.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-size: 1rem;">📭 No data available</div>';
        return;
    }
    
    if (comparisonChart) comparisonChart.destroy();
    comparisonChart = new Chart(ctx, {
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
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 13, weight: 'bold' },
                        usePointStyle: true
                    }
                }
            }
        }
    });
}
