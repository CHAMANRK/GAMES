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
        document.getElementById('profile-avatar-large').src = `https://ui-avatars.com/api/?name=${data.displayName}&background=random&size=100`;
    } else {
        document.getElementById('user-name').innerText = currentUser.displayName;
        document.getElementById('user-avatar').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}`;
        document.getElementById('profile-avatar-large').src = currentUser.photoURL || `https://ui-avatars.com/api/?name=${currentUser.displayName}&size=100`;
    }
}

window.saveProfile = async () => {
    const name = document.getElementById('profile-name').value;
    const age = document.getElementById('profile-age').value;
    const gender = document.getElementById('profile-gender').value;
    if (!name.trim()) return window.showToast("👤 Please enter your name", "error");
    
    await setDoc(doc(db, `users/${currentUser.uid}/profile/details`), { displayName: name, age, gender });
    window.closeModal('profile-modal');
    await loadProfile();
    window.showToast("✅ Profile updated successfully", "success");
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
            if (data.hidden) return; // Skip hidden wallets
            
            allWallets.push({ id: d.id, ...data });
            grandTotal += data.balance;
            if (!data.isOwner) liability += data.balance;

            const reserved = data.reserved || 0;
            const available = data.balance - reserved;
            const isLow = available < reserved && reserved > 0;

            // Add to List
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
    
    if (!name.trim()) return window.showToast("⚠️ Enter wallet name", "error");
    if (isNaN(bal) || bal < 0) return window.showToast("⚠️ Enter valid balance", "error");
    if (reserved > bal) return window.showToast("⚠️ Reserved amount cannot exceed balance", "error");

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
};

window.openEditWallet = async (walletId) => {
    editingWalletId = walletId;
    const snap = await getDoc(doc(db, `users/${currentUser.uid}/wallets`, walletId));
    const data = snap.data();
    
    document.getElementById('edit-wallet-name').value = data.name;
    document.getElementById('edit-wallet-bal').value = data.balance;
    document.getElementById('edit-wallet-reserved').value = data.reserved || 0;
    document.getElementById('edit-wallet-desc').value = data.desc || '';
    
    updateReservedWarning();
    window.openModal('edit-wallet-modal');
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
    
    await updateDoc(doc(db, `users/${currentUser.uid}/wallets`, editingWalletId), {
        name, balance: bal, reserved, desc
    });
    
    window.closeModal('edit-wallet-modal');
    window.showToast("✅ Wallet updated", "success");
};

window.hideWallet = async () => {
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
                    🔄 
