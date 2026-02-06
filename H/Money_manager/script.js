import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, setDoc, deleteDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
let currentFilter = { type: '', category: '' };

// --- TOAST NOTIFICATION SYSTEM ---
window.showToast = (message, type = 'success') => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
};

// --- AUTH HANDLING ---
onAuthStateChanged(auth, (user) => {
    const loader = document.getElementById('loading-overlay');
    
    try {
        if (user) {
            currentUser = user;
            document.getElementById('user-name').innerText = `Hi, ${user.displayName?.split(' ')[0] || 'User'}`;
            document.getElementById('auth-view').classList.add('hidden');
            document.getElementById('app-view').classList.remove('hidden');
            
            loadWallets();
            loadTransactions();
        } else {
            document.getElementById('auth-view').classList.remove('hidden');
            document.getElementById('app-view').classList.add('hidden');
        }
    } catch (error) {
        console.error('Auth Error:', error);
        window.showToast('Authentication failed!', 'error');
    }
    
    loader.classList.add('hidden');
});

window.loginGoogle = async () => {
    try {
        document.getElementById('loading-overlay').classList.remove('hidden');
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error('Login Error:', error);
        window.showToast('Login failed! ' + error.message, 'error');
        document.getElementById('loading-overlay').classList.add('hidden');
    }
};

window.logout = () => {
    document.getElementById('loading-overlay').classList.remove('hidden');
    signOut(auth).catch(err => {
        window.showToast('Logout failed!', 'error');
        document.getElementById('loading-overlay').classList.add('hidden');
    });
};

// --- REAL-TIME WALLETS ---
let walletsSnapshot = [];

function loadWallets() {
    if (!currentUser) return;
    
    const q = query(collection(db, `users/${currentUser.uid}/wallets`), orderBy('name'));
    
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('wallets-list');
        const select = document.getElementById('tx-wallet');
        walletsSnapshot = snapshot.docs;
        let total = 0;
        
        list.innerHTML = "";
        select.innerHTML = '<option value="" disabled selected>Select Account</option>';

        if (snapshot.empty) {
            createDefaultWallet();
            return;
        }

        snapshot.forEach((doc) => {
            const data = doc.data();
            total += data.balance || 0;

            // Add to Card List
            const card = document.createElement('div');
            card.className = `wallet-card ${data.isOwner ? 'myself' : ''}`;
            card.innerHTML = `
                <div class="wallet-name">${data.name}</div>
                <div class="wallet-bal">₹${(data.balance || 0).toLocaleString('en-IN')}</div>
            `;
            card.onclick = () => window.showToast(`💳 ${data.name} - ₹${data.balance}`, 'info');
            list.appendChild(card);

            // Add to Dropdown
            const option = document.createElement('option');
            option.value = doc.id;
            option.innerText = `${data.name} (₹${(data.balance || 0).toLocaleString('en-IN')})`;
            select.appendChild(option);
        });

        document.getElementById('grand-total').innerText = `₹${total.toLocaleString('en-IN')}`;
    }, (error) => {
        console.error('Wallet Load Error:', error);
        window.showToast('Failed to load wallets', 'error');
    });
}

async function createDefaultWallet() {
    try {
        await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
            name: "My Pocket",
            balance: 0,
            isOwner: true,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Wallet Creation Error:', error);
    }
}

// --- REAL-TIME TRANSACTIONS ---
let allTransactions = [];

function loadTransactions() {
    if (!currentUser) return;
    
    const q = query(
        collection(db, `users/${currentUser.uid}/transactions`),
        orderBy('timestamp', 'desc')
    );
    
    onSnapshot(q, (snapshot) => {
        allTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateStats();
        displayFilteredTransactions();
    }, (error) => {
        console.error('Transaction Load Error:', error);
        window.showToast('Failed to load transactions', 'error');
    });
}

// --- UPDATE STATS (NEW FEATURE) ---
function updateStats() {
    let income = 0, expense = 0;
    
    allTransactions.forEach(tx => {
        if (tx.type === 'deposit') {
            income += tx.amount || 0;
        } else {
            expense += tx.amount || 0;
        }
    });
    
    document.getElementById('total-income').innerText = `₹${income.toLocaleString('en-IN')}`;
    document.getElementById('total-expense').innerText = `₹${expense.toLocaleString('en-IN')}`;
    document.getElementById('net-savings').innerText = `₹${(income - expense).toLocaleString('en-IN')}`;
}

// --- FILTER TRANSACTIONS (NEW FEATURE) ---
window.applyFilters = () => {
    currentFilter.type = document.getElementById('filter-type').value;
    currentFilter.category = document.getElementById('filter-category').value;
    window.closeModal('filter-modal');
    displayFilteredTransactions();
    window.showToast('Filters applied!', 'success');
};

window.clearFilters = () => {
    currentFilter = { type: '', category: '' };
    document.getElementById('filter-type').value = '';
    document.getElementById('filter-category').value = '';
    displayFilteredTransactions();
    window.showToast('Filters cleared!', 'info');
};

function displayFilteredTransactions() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = "";

    let filtered = allTransactions;
    
    if (currentFilter.type) {
        filtered = filtered.filter(tx => tx.type === currentFilter.type);
    }
    
    if (currentFilter.category) {
        filtered = filtered.filter(tx => tx.category === currentFilter.category);
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">No transactions found</div>';
        return;
    }

    filtered.forEach((tx) => {
        const date = tx.timestamp ? tx.timestamp.toDate().toLocaleDateString() : 'Just now';
        const isDeposit = tx.type === 'deposit';
        const categoryEmoji = getCategoryEmoji(tx.category);
        
        const item = document.createElement('div');
        item.className = 'tx-item';
        item.innerHTML = `
            <div class="tx-left">
                <h4>${categoryEmoji} ${tx.description}</h4>
                <small>${date} • ${tx.walletName}</small>
            </div>
            <div class="tx-right">
                <div class="tx-amount ${isDeposit ? 'tx-in' : 'tx-out'}">
                    ${isDeposit ? '+' : '-'} ₹${(tx.amount || 0).toLocaleString('en-IN')}
                </div>
                <button class="delete-btn" onclick="window.deleteTransaction('${tx.id}')" title="Delete">
                    <span class="material-icons">delete</span>
                </button>
            </div>
        `;
        list.appendChild(item);
    });
}

// --- DELETE TRANSACTION (NEW) ---
window.deleteTransaction = async (txId) => {
    if (!confirm('Delete this transaction?')) return;
    
    try {
        const tx = allTransactions.find(t => t.id === txId);
        if (!tx) return;

        // Reverse the balance update
        const walletRef = doc(db, `users/${currentUser.uid}/wallets`, tx.walletId);
        const change = tx.type === 'deposit' ? -tx.amount : tx.amount;
        
        await updateDoc(walletRef, { balance: increment(change) });
        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, txId));
        
        window.showToast('Transaction deleted!', 'success');
    } catch (error) {
        console.error('Delete Error:', error);
        window.showToast('Failed to delete transaction', 'error');
    }
};

function getCategoryEmoji(category) {
    const emojis = {
        food: '🍔', transport: '🚕', shopping: '🛍️',
        utilities: '⚡', entertainment: '🎬', health: '🏥',
        salary: '💼', investment: '📊', other: '📌'
    };
    return emojis[category] || '📌';
}

// --- ADD WALLET ---
window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value.trim();
    const bal = parseInt(document.getElementById('new-wallet-bal').value) || 0;
    
    if (!name) {
        window.showToast('Please enter a name!', 'error');
        return;
    }

    if (bal < 0) {
        window.showToast('Balance cannot be negative!', 'error');
        return;
    }

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
            name: name,
            balance: bal,
            isOwner: false,
            createdAt: serverTimestamp()
        });

        window.closeModal('add-wallet-modal');
        document.getElementById('new-wallet-name').value = "";
        document.getElementById('new-wallet-bal').value = "";
        window.showToast('Wallet created!', 'success');
    } catch (error) {
        console.error('Add Wallet Error:', error);
        window.showToast('Failed to create wallet', 'error');
    }
};

// --- ADD TRANSACTION ---
window.setTxType = (type) => {
    currentTxType = type;
    document.getElementById('btn-deposit').classList.toggle('active');
    document.getElementById('btn-expense').classList.toggle('active');
};

window.saveTransaction = async () => {
    const walletId = document.getElementById('tx-wallet').value;
    const amount = parseInt(document.getElementById('tx-amount').value);
    const desc = document.getElementById('tx-desc').value.trim();
    const category = document.getElementById('tx-category').value;

    // VALIDATION
    if (!walletId) {
        window.showToast('Please select a wallet!', 'error');
        return;
    }

    if (!amount || amount <= 0) {
        window.showToast('Please enter a valid amount!', 'error');
        return;
    }

    if (amount > 999999) {
        window.showToast('Amount too large!', 'error');
        return;
    }

    try {
        const walletSelect = document.getElementById('tx-wallet');
        const walletName = walletSelect.options[walletSelect.selectedIndex].text.split(' (')[0];

        // Add transaction
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: currentTxType,
            amount: amount,
            description: desc || (currentTxType === 'deposit' ? 'Deposit' : 'Expense'),
            category: category || 'other',
            walletId: walletId,
            walletName: walletName,
            timestamp: serverTimestamp()
        });

        // Update wallet balance
        const walletRef = doc(db, `users/${currentUser.uid}/wallets`, walletId);
        const change = currentTxType === 'deposit' ? amount : -amount;
        
        await updateDoc(walletRef, { balance: increment(change) });

        window.closeModal('transaction-modal');
        document.getElementById('tx-amount').value = "";
        document.getElementById('tx-desc').value = "";
        document.getElementById('tx-category').value = "";
        
        window.showToast(`Transaction saved! ${getCategoryEmoji(category)}`, 'success');
    } catch (error) {
        console.error('Save Transaction Error:', error);
        window.showToast('Failed to save transaction', 'error');
    }
};

// --- EXPORT DATA (NEW) ---
window.exportData = async () => {
    try {
        let csv = "Date,Type,Amount,Description,Category,Wallet\n";
        
        allTransactions.forEach(tx => {
            const date = tx.timestamp ? tx.timestamp.toDate().toLocaleDateString() : 'N/A';
            csv += `${date},"${tx.type}",${tx.amount},"${tx.description}","${tx.category || 'N/A'}","${tx.walletName}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `money-manager-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        
        window.showToast('Data exported!', 'success');
    } catch (error) {
        console.error('Export Error:', error);
        window.showToast('Export failed', 'error');
    }
};

// --- MODAL UTILS ---
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.add('hidden');
    }
});
