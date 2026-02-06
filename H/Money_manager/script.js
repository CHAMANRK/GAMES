import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, setDoc, deleteDoc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
let currentFilter = { type: '', category: '' };
let editingWalletId = null;
let categoryChart = null;
let budgets = {};

const categories = {
    food: '🍔 Food',
    transport: '🚕 Transport',
    shopping: '🛍️ Shopping',
    utilities: '⚡ Bills/Rent',
    salary: '💼 Salary',
    other: '📌 Other'
};

// AUTH LISTENER
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        await loadProfile();
        await loadBudgets();
        loadWallets();
        loadTransactions();
        populateReportMonths();
    } else {
        document.getElementById('auth-view').classList.remove('hidden');
        document.getElementById('app-view').classList.add('hidden');
    }
    loader.classList.add('hidden');
});

window.loginGoogle = async () => {
    try { await signInWithPopup(auth, provider); } 
    catch (e) { alert("Login Failed: " + e.message); }
};

window.logout = () => signOut(auth);

// ===== PROFILE FUNCTIONS =====
async function loadProfile() {
    if (!currentUser) return;
    const docSnap = await getDoc(doc(db, `users/${currentUser.uid}/profile/details`));
    if (docSnap.exists()) {
        const data = docSnap.data();
        document.getElementById('user-name').innerText = (data.displayName || currentUser.displayName).toUpperCase();
        document.getElementById('user-tagline').innerText = `${data.gender || 'Human'} • ${data.age || '??'} Y/O`;
        document.getElementById('profile-name').value = data.displayName || '';
        document.getElementById('profile-age').value = data.age || '';
        document.getElementById('profile-gender').value = data.gender || 'Male';
    } else {
        document.getElementById('user-name').innerText = currentUser.displayName;
    }
}

window.saveProfile = async () => {
    try {
        const displayName = document.getElementById('profile-name').value.trim();
        const age = document.getElementById('profile-age').value;
        
        if (!displayName) return window.showToast('Name required', 'error');
        if (age && (age < 1 || age > 120)) return window.showToast('Invalid age', 'error');
        
        await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), {
            displayName: displayName,
            age: age || '',
            gender: document.getElementById('profile-gender').value,
            updatedAt: serverTimestamp()
        });
        window.closeModal('profile-modal');
        loadProfile();
        window.showToast('✅ Identity Updated', 'success');
    } catch (e) { 
        console.error(e);
        window.showToast('Error: ' + e.message, 'error');
    }
};

// ===== BUDGET FUNCTIONS (FEATURE 1) =====
async function loadBudgets() {
    try {
        const docSnap = await getDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`));
        if (docSnap.exists()) {
            budgets = docSnap.data();
        } else {
            budgets = {
                food: 5000,
                transport: 2000,
                shopping: 3000,
                utilities: 10000,
                other: 2000
            };
        }
        displayBudgetTracker();
        renderBudgetForm();
    } catch (e) {
        console.error('Error loading budgets:', e);
    }
}

function displayBudgetTracker() {
    const container = document.getElementById('budget-items');
    container.innerHTML = '';

    Object.keys(budgets).forEach(category => {
        if (category === 'salary') return;
        
        const spent = allTransactions
            .filter(t => t.type === 'expense' && t.category === category && isCurrentMonth(t.timestamp))
            .reduce((sum, t) => sum + t.amount, 0);
        
        const budget = budgets[category] || 0;
        const percentage = budget > 0 ? (spent / budget) * 100 : 0;
        const status = spent > budget ? 'over' : 'ok';
        
        const item = document.createElement('div');
        item.className = `budget-item ${status}`;
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span>${categories[category] || category}</span>
                <span style="color:${spent > budget ? 'var(--secondary)' : 'var(--primary)'};">₹${spent} / ₹${budget}</span>
            </div>
            <div class="budget-bar">
                <div class="budget-fill" style="width: ${Math.min(percentage, 100)}%; background: ${spent > budget ? 'var(--secondary)' : 'var(--primary)'};">
                    ${Math.round(percentage)}%
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

function renderBudgetForm() {
    const form = document.getElementById('budget-form');
    form.innerHTML = '';

    Object.keys(categories).forEach(cat => {
        if (cat === 'salary') return;
        
        const input = document.createElement('div');
        input.className = 'form-group';
        input.innerHTML = `
            <label>${categories[cat]}</label>
            <input type="number" id="budget-${cat}" class="cyber-input" 
                   value="${budgets[cat] || 0}" placeholder="Monthly Budget">
        `;
        form.appendChild(input);
    });
}

window.saveBudgets = async () => {
    try {
        Object.keys(categories).forEach(cat => {
            if (cat !== 'salary') {
                budgets[cat] = parseInt(document.getElementById(`budget-${cat}`).value) || 0;
            }
        });

        await setDoc(doc(db, `users/${currentUser.uid}/budgets/monthly`), budgets);
        window.closeModal('budget-modal');
        displayBudgetTracker();
        window.showToast('✅ Budgets Saved', 'success');
    } catch (e) {
        console.error(e);
        window.showToast('Error saving budgets', 'error');
    }
};

// ===== ANALYTICS FUNCTIONS (FEATURE 2) =====
function displayAnalytics() {
    const currentMonth = new Date();
    const monthSpending = {};
    
    Object.keys(categories).forEach(cat => {
        monthSpending[cat] = allTransactions
            .filter(t => t.type === 'expense' && t.category === cat && isCurrentMonth(t.timestamp))
            .reduce((sum, t) => sum + t.amount, 0);
    });

    updateCategoryChart(monthSpending);
    displayAnalyticsDetail(monthSpending);
}

function updateCategoryChart(monthSpending) {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    const labels = Object.keys(monthSpending)
        .filter(cat => categories[cat] && cat !== 'salary')
        .map(cat => categories[cat]);
    
    const data = Object.keys(monthSpending)
        .filter(cat => categories[cat] && cat !== 'salary')
        .map(cat => monthSpending[cat]);

    if (categoryChart) {
        categoryChart.data.labels = labels;
        categoryChart.data.datasets[0].data = data;
        categoryChart.update();
    } else {
        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#FF6B6B',
                        '#4ECDC4',
                        '#45B7D1',
                        '#FFA07A',
                        '#98D8C8',
                        '#F7DC6F'
                    ],
                    borderColor: '#1a1a1a',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#e0e0e0',
                            padding: 15,
                            font: { size: 12 }
                        }
                    }
                }
            }
        });
    }
}

function displayAnalyticsDetail(monthSpending) {
    const container = document.getElementById('analytics-detail');
    container.innerHTML = '<h4 style="color:var(--primary); margin-bottom:15px;">📊 This Month Breakdown</h4>';

    const total = Object.values(monthSpending).reduce((a, b) => a + b, 0);

    Object.keys(monthSpending).forEach(cat => {
        const amount = monthSpending[cat];
        const percentage = total > 0 ? ((amount / total) * 100).toFixed(1) : 0;
        
        if (amount > 0) {
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px; margin:8px 0; background:rgba(255,255,255,0.05); border-radius:8px; border-left:3px solid var(--primary);';
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>${categories[cat] || cat}</span>
                    <span style="color:var(--primary); font-weight:bold;">₹${amount.toLocaleString()} (${percentage}%)</span>
                </div>
            `;
            container.appendChild(item);
        }
    });

    const totalItem = document.createElement('div');
    totalItem.style.cssText = 'padding:12px; margin-top:15px; background:rgba(0,242,234,0.1); border-radius:8px; border:1px solid var(--primary);';
    totalItem.innerHTML = `<strong>Total Spent: ₹${total.toLocaleString()}</strong>`;
    container.appendChild(totalItem);
}

// ===== WALLETS FUNCTIONS =====
function loadWallets() {
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('createdAt'));
    
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('wallets-list');
        const select = document.getElementById('tx-wallet');
        list.innerHTML = "";
        select.innerHTML = '<option value="" disabled selected>Select Wallet</option>';

        let grandTotal = 0;   
        let liability = 0;    
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            grandTotal += data.balance || 0;
            if (!data.isOwner) liability += data.balance || 0;

            const safeName = data.name.replace(/'/g, "\\'"); 
            const safeNote = (data.note || '').replace(/'/g, "\\'");
            const reserved = data.reserved || 0;

            const card = document.createElement('div');
            card.className = `wallet-card`;
            if (reserved > 0) card.classList.add('has-reserved');
            card.style.borderColor = data.isOwner ? 'rgba(255,255,255,0.1)' : 'var(--warning)';
            
            let reservedHtml = '';
            if (reserved > 0) {
                reservedHtml = `
                    <div class="reserved-pill">
                        <span style="opacity:0.7">🔒 Reserved:</span> ₹${reserved} ${data.note ? '('+data.note+')' : ''}
                    </div>
                `;
            } else if (data.note) {
                 reservedHtml = `<div style="font-size:0.75em; color:#888; margin-top:8px;">${data.note}</div>`;
            }

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <div style="font-size:0.7em; opacity:0.7; letter-spacing:1px; margin-bottom:4px;">${data.isOwner ? 'VAULT' : 'LIABILITY'}</div>
                        <div class="wallet-name">${data.name}</div>
                    </div>
                    <div onclick="window.prepareEdit('${doc.id}', '${safeName}', ${data.balance}, '${safeNote}', ${reserved}, ${data.isOwner})" 
                         class="edit-icon">✏️</div>
                </div>
                
                <div class="wallet-bal">₹${(data.balance || 0).toLocaleString('en-IN')}</div>
                ${reservedHtml}
            `;
            list.appendChild(card);

            const option = document.createElement('option');
            option.value = doc.id;
            option.innerText = `${data.name}`;
            select.appendChild(option);
        });

        const actualWorth = grandTotal - liability;
        document.getElementById('grand-total').innerText = `₹${grandTotal.toLocaleString('en-IN')}`;
        document.getElementById('total-liability').innerText = `₹${liability.toLocaleString('en-IN')}`;
        document.getElementById('actual-worth').innerText = `₹${actualWorth.toLocaleString('en-IN')}`;

        const worthCard = document.querySelector('.worth-card');
        const worthLabel = document.querySelector('.worth-label');
        const worthValue = document.getElementById('actual-worth');

        worthCard.classList.remove('danger-zone', 'critical-zone');
        worthLabel.innerText = "ACTUAL NET WORTH";
        worthValue.style.color = "var(--primary)";

        if (actualWorth < 0) {
            worthCard.classList.add('critical-zone');
            worthLabel.innerText = "⚠️ CRITICAL DEBT";
            worthValue.style.color = "var(--secondary)";
        }
    });
}

window.prepareEdit = (id, name, bal, note, reserved, isOwner) => {
    editingWalletId = id; 
    document.getElementById('new-wallet-name').value = name;
    document.getElementById('new-wallet-bal').value = bal;
    document.getElementById('new-wallet-desc').value = note;
    document.getElementById('new-wallet-reserved').value = reserved || ''; 
    document.getElementById('new-wallet-owner').checked = isOwner;
    
    document.querySelector('#add-wallet-modal h3').innerText = "EDIT DETAILS";
    document.querySelector('#add-wallet-modal button.cyber-btn').innerText = "UPDATE CHANGES";
    window.openModal('add-wallet-modal');
};

window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value.trim();
    const bal = parseInt(document.getElementById('new-wallet-bal').value) || 0;
    const reserved = parseInt(document.getElementById('new-wallet-reserved').value) || 0;
    const note = document.getElementById('new-wallet-desc').value.trim();
    const isOwner = document.getElementById('new-wallet-owner').checked;

    if (!name) return window.showToast('Name required', 'error');
    if (name.length < 2) return window.showToast('Name must be at least 2 characters', 'error');
    if (bal < 0) return window.showToast('Balance cannot be negative', 'error');
    if (reserved > bal) return window.showToast('Reserved cannot exceed balance', 'error');

    const walletData = {
        name: name, 
        balance: bal, 
        reserved: reserved,
        note: note, 
        isOwner: isOwner
    };

    try {
        if (editingWalletId) {
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId), walletData);
            window.showToast('✅ Updated Successfully', 'success');
        } else {
            walletData.createdAt = serverTimestamp();
            await addDoc(collection(db, `users/${currentUser.uid}/wallets`), walletData);
            window.showToast('✅ Pool Created', 'success');
        }
        window.closeModal('add-wallet-modal');
        editingWalletId = null;
    } catch (e) { 
        console.error(e); 
        window.showToast('Error: ' + e.message, 'error'); 
    }
};

// ===== TRANSACTIONS =====
function loadTransactions() {
    const q = query(collection(db, `users/${currentUser.uid}/transactions`), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snap) => {
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        displayTransactions();
        updateStats();
        displayBudgetTracker();
        displayAnalytics();
    });
}

function displayTransactions() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = "";
    let filtered = allTransactions;
    if (currentFilter.type) filtered = filtered.filter(t => t.type === currentFilter.type);

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state" style="text-align:center; padding:20px; color:#555;">No Data</div>';
        return;
    }

    filtered.forEach(tx => {
        const item = document.createElement('div');
        item.className = `tx-item ${tx.type === 'deposit' ? 'in' : 'out'}`;
        const emojis = { food:'🍔', transport:'🚕', shopping:'🛍️', utilities:'⚡', salary:'💼', other:'📌' };
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        
        item.innerHTML = `
            <div>
                <strong style="color:white; font-size:1rem;">${emojis[tx.category]||'📌'} ${tx.description}</strong>
                <br><small style="color:#888;">${tx.walletName} • ${date}</small>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:bold; color:${tx.type === 'deposit' ? 'var(--primary)' : 'var(--secondary)'}">
                    ${tx.type === 'deposit' ? '+' : '-'} ₹${tx.amount}
                </div>
                <small onclick="deleteTx('${tx.id}', ${tx.amount}, '${tx.type}', '${tx.walletId}')" 
                       style="color:#666; cursor:pointer; font-size:0.7rem; text-decoration:underline;">UNDO</small>
            </div>
        `;
        list.appendChild(item);
    });
}

window.saveTransaction = async () => {
    const walletId = document.getElementById('tx-wallet').value;
    const amount = parseInt(document.getElementById('tx-amount').value);
    const desc = document.getElementById('tx-desc').value.trim();
    const cat = document.getElementById('tx-category').value;
    
    if (!walletId) return window.showToast('Select a wallet', 'error');
    if (!amount || amount <= 0) return window.showToast('Amount must be greater than 0', 'error');
    if (amount > 9999999) return window.showToast('Amount too large', 'error');
    if (!desc) return window.showToast('Description required', 'error');

    const walletSelect = document.getElementById('tx-wallet');
    const walletName = walletSelect.options[walletSelect.selectedIndex].text;

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: currentTxType, amount, description: desc, category: cat, walletId, walletName, timestamp: serverTimestamp()
        });
        const change = currentTxType === 'deposit' ? amount : -amount;
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
        window.closeModal('transaction-modal');
        window.showToast('✅ Transaction Executed', 'success');
    } catch (e) { 
        console.error(e);
        window.showToast('Error: ' + e.message, 'error');
    }
};

window.deleteTx = async (id, amount, type, walletId) => {
    if(!confirm("Revert this transaction?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, id));
        const change = type === 'deposit' ? -amount : amount; 
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), { balance: increment(change) });
        window.showToast('✅ Reverted', 'success');
    } catch(e) { 
        console.error(e);
        window.showToast('Error: ' + e.message, 'error');
    }
};

function updateStats() {
    let inc = 0, exp = 0;
    allTransactions.forEach(t => t.type === 'deposit' ? inc += t.amount : exp += t.amount);
    document.getElementById('total-income').innerText = `₹${inc.toLocaleString('en-IN')}`;
    document.getElementById('total-expense').innerText = `₹${exp.toLocaleString('en-IN')}`;
}

window.exportData = () => {
    if (allTransactions.length === 0) return window.showToast('No data to export', 'error');
    let csv = "Date,Type,Amount,Category,Description,Wallet\n";
    allTransactions.forEach(tx => {
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN') : 'N/A';
        csv += `${date},${tx.type},${tx.amount},${tx.category},"${tx.description}",${tx.walletName}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `Ledger-${new Date().toLocaleDateString('en-IN')}.csv`; 
    a.click();
    window.showToast('✅ CSV Exported', 'success');
};

// ===== MONTHLY REPORTS (FEATURE 6) =====
function populateReportMonths() {
    const select = document.getElementById('report-month');
    const currentDate = new Date();
    
    for (let i = 0; i < 12; i++) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthYear = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        const option = document.createElement('option');
        option.value = value;
        option.innerText = monthYear;
        select.appendChild(option);
    }
}

function getMonthTransactions(monthStr) {
    const [year, month] = monthStr.split('-');
    return allTransactions.filter(t => {
        if (!t.timestamp) return false;
        const date = new Date(t.timestamp.seconds * 1000);
        return date.getFullYear() === parseInt(year) && 
               (date.getMonth() + 1) === parseInt(month);
    });
}

window.previewReport = () => {
    const monthStr = document.getElementById('report-month').value;
    if (!monthStr) return window.showToast('Select a month', 'error');

    const transactions = getMonthTransactions(monthStr);
    const preview = generateReportHTML(monthStr, transactions);
    
    document.getElementById('report-preview').innerHTML = preview;
    document.getElementById('report-preview').style.display = 'block';
};

window.generatePDF = () => {
    const monthStr = document.getElementById('report-month').value;
    if (!monthStr) return window.showToast('Select a month', 'error');

    const transactions = getMonthTransactions(monthStr);
    const reportHTML = generateReportHTML(monthStr, transactions);
    
    const element = document.createElement('div');
    element.innerHTML = reportHTML;
    element.style.padding = '20px';
    element.style.background = 'white';
    element.style.color = 'black';

    const options = {
        margin: 10,
        filename: `Ledger-Report-${monthStr}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };

    html2pdf().set(options).from(element).save();
    window.showToast('✅ PDF Generated', 'success');
};

function generateReportHTML(monthStr, transactions) {
    const [year, month] = monthStr.split('-');
    const monthName = new Date(year, month - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    
    let totalIncome = 0, totalExpense = 0;
    const categorySpending = {};
    
    transactions.forEach(t => {
        if (t.type === 'deposit') totalIncome += t.amount;
        else totalExpense += t.amount;
        
        if (t.type === 'expense') {
            categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount;
        }
    });

    let html = `
        <div style="text-align:center; margin-bottom:30px; border-bottom:2px solid #333; padding-bottom:20px;">
            <h1 style="margin:0; color:#000;">💰 FINANCIAL REPORT</h1>
            <p style="margin:10px 0 0 0; font-size:16px; color:#666;">Month of ${monthName}</p>
        </div>

        <div style="margin-bottom:30px;">
            <h2 style="color:#000; border-bottom:1px solid #ddd; padding-bottom:10px;">📊 Summary</h2>
            <table style="width:100%; border-collapse:collapse;">
                <tr>
                    <td style="padding:10px; border-bottom:1px solid #eee;"><strong>Total Income:</strong></td>
                    <td style="padding:10px; border-bottom:1px solid #eee; text-align:right; color:green; font-weight:bold;">₹${totalIncome.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                    <td style="padding:10px; border-bottom:1px solid #eee;"><strong>Total Expense:</strong></td>
                    <td style="padding:10px; border-bottom:1px solid #eee; text-align:right; color:red; font-weight:bold;">₹${totalExpense.toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                    <td style="padding:10px; background:#f5f5f5;"><strong>Net Savings:</strong></td>
                    <td style="padding:10px; background:#f5f5f5; text-align:right; font-weight:bold; color:${totalIncome - totalExpense >= 0 ? 'green' : 'red'};">₹${(totalIncome - totalExpense).toLocaleString('en-IN')}</td>
                </tr>
            </table>
        </div>
    `;

    if (Object.keys(categorySpending).length > 0) {
        html += `
            <div style="margin-bottom:30px;">
                <h2 style="color:#000; border-bottom:1px solid #ddd; padding-bottom:10px;">🏷️ Spending by Category</h2>
                <table style="width:100%; border-collapse:collapse;">
        `;
        
        Object.keys(categorySpending).forEach(cat => {
            const amount = categorySpending[cat];
            const percent = totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : 0;
            html += `
                <tr>
                    <td style="padding:10px; border-bottom:1px solid #eee;">${categories[cat] || cat}</td>
                    <td style="padding:10px; border-bottom:1px solid #eee; text-align:right;">₹${amount.toLocaleString('en-IN')} (${percent}%)</td>
                </tr>
            `;
        });
        
        html += `</table></div>`;
    }

    if (transactions.length > 0) {
        html += `
            <div>
                <h2 style="color:#000; border-bottom:1px solid #ddd; padding-bottom:10px;">📋 Transactions</h2>
                <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <tr style="background:#f5f5f5;">
                        <th style="padding:10px; border-bottom:1px solid #ddd; text-align:left;">Date</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd; text-align:left;">Description</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd; text-align:left;">Category</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd; text-align:right;">Amount</th>
                    </tr>
        `;
        
        transactions.forEach(tx => {
            const date = new Date(tx.timestamp.seconds * 1000).toLocaleDateString('en-IN');
            const color = tx.type === 'deposit' ? 'green' : 'red';
            html += `
                <tr>
                    <td style="padding:10px; border-bottom:1px solid #eee;">${date}</td>
                    <td style="padding:10px; border-bottom:1px solid #eee;">${tx.description}</td>
                    <td style="padding:10px; border-bottom:1px solid #eee;">${categories[tx.category] || tx.category}</td>
                    <td style="padding:10px; border-bottom:1px solid #eee; text-align:right; color:${color}; font-weight:bold;">
                        ${tx.type === 'deposit' ? '+' : '-'} ₹${tx.amount.toLocaleString('en-IN')}
                    </td>
                </tr>
            `;
        });
        
        html += `</table></div>`;
    }

    html += `
        <div style="margin-top:40px; padding-top:20px; border-top:1px solid #ddd; text-align:center; color:#666; font-size:12px;">
            <p>Generated on ${new Date().toLocaleDateString('en-IN')} | Liquid Ledger</p>
        </div>
    `;

    return html;
}

// ===== UTILITY FUNCTIONS =====
function isCurrentMonth(timestamp) {
    if (!timestamp) return false;
    const txDate = new Date(timestamp.seconds * 1000);
    const now = new Date();
    return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
}

window.setTxType = (t) => {
    currentTxType = t;
    document.getElementById('btn-deposit').classList.toggle('active', t === 'deposit');
    document.getElementById('btn-expense').classList.toggle('active', t === 'expense');
};

window.applyFilters = () => { 
    currentFilter.type = document.getElementById('filter-type').value; 
    window.closeModal('filter-modal'); 
    displayTransactions(); 
};

window.clearFilters = () => { 
    currentFilter = {}; 
    document.getElementById('filter-type').value = '';
    window.closeModal('filter-modal'); 
    displayTransactions(); 
};

window.openModal = (id) => document.getElementById(id).classList.remove('hidden');

const originalCloseModal = (id) => document.getElementById(id).classList.add('hidden');

window.closeModal = (id) => {
    originalCloseModal(id);
    if(id === 'add-wallet-modal') {
        editingWalletId = null;
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('new-wallet-bal').value = '';
        document.getElementById('new-wallet-reserved').value = '';
        document.getElementById('new-wallet-desc').value = '';
        document.getElementById('new-wallet-owner').checked = false;
        document.querySelector('#add-wallet-modal h3').innerText = "ADD POOL / FRIEND";
        document.querySelector('#add-wallet-modal button.cyber-btn').innerText = "CREATE NODE";
    }
    if(id === 'transaction-modal') {
        document.getElementById('tx-wallet').value = '';
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-desc').value = '';
        document.getElementById('tx-category').value = 'other';
        if(currentTxType !== 'deposit') {
            window.setTxType('deposit');
        }
    }
};

window.showToast = (msg, type) => {
    const t = document.getElementById('toast');
    t.innerText = msg; 
    t.className = `toast show ${type}`;
    t.style.borderLeft = type === 'success' ? '4px solid #00f2ea' : '4px solid #ff0050';
    setTimeout(() => t.classList.remove('show'), 3000);
};
