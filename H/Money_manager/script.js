import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, increment, serverTimestamp, setDoc, deleteDoc, getDoc, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. FIREBASE CONFIG ---
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
let editingWalletId = null; // New: For Editing Mode

// --- 2. AUTH SYSTEM ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('loading-overlay');
    if (user) {
        currentUser = user;
        document.getElementById('auth-view').classList.add('hidden');
        document.getElementById('app-view').classList.remove('hidden');
        
        await loadProfile();
        loadWallets();
        loadTransactions();
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

// --- 3. PROFILE SYSTEM ---
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
        await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), {
            displayName: document.getElementById('profile-name').value,
            age: document.getElementById('profile-age').value,
            gender: document.getElementById('profile-gender').value,
            updatedAt: serverTimestamp()
        });
        window.closeModal('profile-modal');
        loadProfile();
        window.showToast('Identity Updated', 'success');
    } catch (e) { console.error(e); window.showToast('Error saving profile', 'error'); }
};

// --- 4. WALLETS & NET WORTH LOGIC (UPDATED WITH EDIT BTN) ---
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

            const noteColor = data.isOwner ? '#00f2ea' : '#ff9800';
            const noteBg = data.isOwner ? 'rgba(0, 242, 234, 0.1)' : 'rgba(255, 152, 0, 0.15)';

            // Prepare safe strings for onclick
            const safeName = data.name.replace(/'/g, "\\'"); 
            const safeNote = (data.note || '').replace(/'/g, "\\'");

            // Render Card
            const card = document.createElement('div');
            card.className = `wallet-card`;
            card.style.borderColor = data.isOwner ? 'rgba(255,255,255,0.1)' : 'var(--warning)';
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <div style="font-size:0.7em; opacity:0.7; letter-spacing:1px;">${data.isOwner ? 'VAULT' : 'LIABILITY'}</div>
                    <div onclick="window.prepareEdit('${doc.id}', '${safeName}', ${data.balance}, '${safeNote}', ${data.isOwner})" 
                         style="cursor:pointer; font-size:1.2em; opacity:0.8;">✏️</div>
                </div>
                <div class="wallet-name" style="font-weight:bold; font-size:1.1em; color:white;">${data.name}</div>
                <div class="wallet-bal" style="font-size:1.4em; margin-top:5px; color:${data.isOwner ? 'white' : '#ccc'}">₹${(data.balance || 0).toLocaleString('en-IN')}</div>
                
                ${data.note ? `<div style="margin-top:8px; font-size:0.75em; color:${noteColor}; background:${noteBg}; padding:4px 8px; border-radius:4px; line-height:1.4;">${data.note}</div>` : ''}
            `;
            list.appendChild(card);

            const option = document.createElement('option');
            option.value = doc.id;
            option.innerText = `${data.name} (${data.isOwner ? 'My' : 'Liability'})`;
            select.appendChild(option);
        });

        // Math
        const actualWorth = grandTotal - liability;
        document.getElementById('grand-total').innerText = `₹${grandTotal.toLocaleString('en-IN')}`;
        document.getElementById('total-liability').innerText = `₹${liability.toLocaleString('en-IN')}`;
        document.getElementById('actual-worth').innerText = `₹${actualWorth.toLocaleString('en-IN')}`;

        // Danger Zone
        const worthCard = document.querySelector('.worth-card');
        const worthLabel = document.querySelector('.worth-label');
        const worthValue = document.getElementById('actual-worth');

        worthCard.classList.remove('danger-zone', 'critical-zone');
        worthLabel.innerText = "ACTUAL NET WORTH";
        worthValue.style.color = "var(--primary)";

        if (actualWorth < 0) {
            worthCard.classList.add('critical-zone');
            worthLabel.innerText = "⚠️ CRITICAL: USING DEBT!";
            worthValue.style.color = "var(--secondary)";
        } else if (actualWorth < 500) { 
            worthCard.classList.add('danger-zone');
            worthLabel.innerText = "⚠️ LOW LIQUIDITY";
            worthValue.style.color = "var(--warning)";
        }
    });
}

// --- 5. ADD / EDIT WALLET FUNCTION (UPDATED) ---

// Setup Edit Mode
window.prepareEdit = (id, name, bal, note, isOwner) => {
    editingWalletId = id; 
    document.getElementById('new-wallet-name').value = name;
    document.getElementById('new-wallet-bal').value = bal;
    document.getElementById('new-wallet-desc').value = note;
    document.getElementById('new-wallet-owner').checked = isOwner;
    
    // UI Change
    document.querySelector('#add-wallet-modal h3').innerText = "EDIT DETAILS";
    document.querySelector('#add-wallet-modal button.cyber-btn').innerText = "UPDATE CHANGES";
    
    window.openModal('add-wallet-modal');
};

// Handle Save/Update
window.addWallet = async () => {
    const name = document.getElementById('new-wallet-name').value;
    const bal = parseInt(document.getElementById('new-wallet-bal').value) || 0;
    const note = document.getElementById('new-wallet-desc').value;
    const isOwner = document.getElementById('new-wallet-owner').checked;

    if (!name) return window.showToast('Name Required', 'error');

    try {
        if (editingWalletId) {
            // Update Existing
            await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId), {
                name: name, balance: bal, note: note || '', isOwner: isOwner
            });
            window.showToast('Updated Successfully', 'success');
        } else {
            // Create New
            await addDoc(collection(db, `users/${currentUser.uid}/wallets`), {
                name: name, balance: bal, note: note || '', isOwner: isOwner, createdAt: serverTimestamp()
            });
            window.showToast('Pool Created Successfully', 'success');
        }

        window.closeModal('add-wallet-modal');
        // Cleanup will happen in closeModal override
    } catch (e) { console.error(e); window.showToast('Error', 'error'); }
};

// --- 6. TRANSACTIONS ---
function loadTransactions() {
    const q = query(collection(db, `users/${currentUser.uid}/transactions`), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snap) => {
        allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        displayTransactions();
        updateStats();
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
        const emoji = emojis[tx.category] || '📌';

        item.innerHTML = `
            <div>
                <strong style="color:white; font-size:1rem;">${emoji} ${tx.description}</strong>
                <br><small style="color:#888;">${tx.walletName}</small>
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
    const desc = document.getElementById('tx-desc').value;
    const cat = document.getElementById('tx-category').value;
    
    if (!walletId || !amount) return window.showToast('Invalid Input', 'error');

    const walletSelect = document.getElementById('tx-wallet');
    const walletName = walletSelect.options[walletSelect.selectedIndex].text.split(' (')[0];

    try {
        await addDoc(collection(db, `users/${currentUser.uid}/transactions`), {
            type: currentTxType, amount: amount, description: desc || 'Untitled', 
            category: cat, walletId: walletId, walletName: walletName, timestamp: serverTimestamp()
        });

        const change = currentTxType === 'deposit' ? amount : -amount;
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), {
            balance: increment(change)
        });

        window.closeModal('transaction-modal');
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-desc').value = '';
        window.showToast('Transaction Executed', 'success');
    } catch (e) { console.error(e); }
};

window.deleteTx = async (id, amount, type, walletId) => {
    if(!confirm("Revert this transaction?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/transactions`, id));
        const change = type === 'deposit' ? -amount : amount; 
        await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId), {
            balance: increment(change)
        });
        window.showToast('Transaction Reverted', 'success');
    } catch(e) { console.error(e); }
};

function updateStats() {
    let inc = 0, exp = 0;
    allTransactions.forEach(t => t.type === 'deposit' ? inc += t.amount : exp += t.amount);
    document.getElementById('total-income').innerText = `₹${inc.toLocaleString()}`;
    document.getElementById('total-expense').innerText = `₹${exp.toLocaleString()}`;
}

// --- 7. UTILS & EXPORT ---
window.exportData = () => {
    if (allTransactions.length === 0) return window.showToast('No data to export', 'error');
    
    let csv = "Date,Type,Amount,Category,Description,Wallet\n";
    allTransactions.forEach(tx => {
        const date = tx.timestamp ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString() : 'N/A';
        csv += `${date},${tx.type},${tx.amount},${tx.category},"${tx.description}",${tx.walletName}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Chaman_Ledger_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.showToast('Downloading CSV...', 'success');
};

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
    window.closeModal('filter-modal');
    displayTransactions();
};
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');

// Overridden closeModal to reset Edit state
const originalCloseModal = (id) => document.getElementById(id).classList.add('hidden');
window.closeModal = (id) => {
    originalCloseModal(id);
    if(id === 'add-wallet-modal') {
        editingWalletId = null;
        document.getElementById('new-wallet-name').value = '';
        document.getElementById('new-wallet-bal').value = '';
        document.getElementById('new-wallet-desc').value = '';
        document.getElementById('new-wallet-owner').checked = false;
        document.querySelector('#add-wallet-modal h3').innerText = "ADD POOL / FRIEND";
        document.querySelector('#add-wallet-modal button.cyber-btn').innerText = "CREATE NODE";
    }
};

window.showToast = (msg, type) => {
    const t = document.getElementById('toast');
    t.innerText = msg; t.className = `toast show ${type}`;
    t.style.borderLeft = type === 'success' ? '4px solid #00f2ea' : '4px solid #ff0050';
    setTimeout(() => t.classList.remove('show'), 3000);
};
