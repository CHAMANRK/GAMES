// chat.js - FIXED VERSION

class ChatApp {
  constructor() {
    this.messages = [];
    this.currentUser = null;
    this.init();
  }

  async init() {
    try {
      await this.setupFirebase();
      this.setupUI();
      this.loadMessages();
      this.checkAdminMode();
    } catch (error) {
      console.error('Init error:', error);
    }
  }

  async setupFirebase() {
    const firebaseConfig = {
      apiKey: "AIzaSyDo2U1-D2Yljs8n9_Td3Bky5vVH0U",
      authDomain: "chaman-ai.firebaseapp.com",
      projectId: "chaman-ai",
      storageBucket: "chaman-ai.appspot.com",
      messagingSenderId: "294",
      appId: "1:294:web:74d1b1d1be25f26"
    };

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    this.db = firebase.firestore();
    this.auth = firebase.auth();
  }

  setupUI() {
    // Elements
    this.msgsContainer = document.getElementById('msgs');
    this.inpField = document.getElementById('inp');
    this.sendBtn = document.getElementById('sendBtn');
    this.settBtn = document.getElementById('settBtn');
    this.modal = document.getElementById('modal');
    this.pki = document.getElementById('pki');
    this.unlockBtn = document.getElementById('unlockBtn');
    this.cancelBtn = document.getElementById('cancelBtn');
    this.hintLink = document.getElementById('hintLink');
    this.pubswitch = document.getElementById('pubswitch');

    // Event listeners
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.inpField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.hintLink.addEventListener('click', () => this.showLoginModal());
    this.unlockBtn.addEventListener('click', () => this.verifyPasskey());
    this.cancelBtn.addEventListener('click', () => this.closeModal());
    this.settBtn.addEventListener('click', () => this.toggleSettings());
    this.pubswitch.addEventListener('click', () => this.toggleMode());

    // Auto-resize textarea
    this.inpField.addEventListener('input', () => {
      this.inpField.style.height = 'auto';
      this.inpField.style.height = this.inpField.scrollHeight + 'px';
    });
  }

  async sendMessage() {
    const text = this.inpField.value.trim();
    
    if (!text) return;

    // Add user message
    this.addMessageToUI('user', text);
    this.inpField.value = '';
    this.inpField.style.height = 'auto';

    try {
      // Send to backend/API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          user: this.currentUser || 'anonymous',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Add AI response
      this.addMessageToUI('ai', data.reply || 'Kuch error ho gaya');
      
      // Save to Firestore
      await this.db.collection('chats').add({
        userMessage: text,
        aiResponse: data.reply,
        user: this.currentUser || 'anonymous',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        mode: document.body.classList.contains('om') ? 'orange' : 'normal'
      });

    } catch (error) {
      console.error('Error:', error);
      this.addMessageToUI('ai', `Error: ${error.message}`);
    }
  }

  addMessageToUI(role, text) {
    const msgEl = document.createElement('div');
    msgEl.className = `msg ${role === 'user' ? 'user' : 'ai'}`;

    const avEl = document.createElement('div');
    avEl.className = `av ${role === 'user' ? 'u' : 'ai'}`;
    avEl.textContent = role === 'user' ? '👤' : '🤖';

    const mwEl = document.createElement('div');
    mwEl.className = 'mw';

    const bubEl = document.createElement('div');
    bubEl.className = 'bub';
    bubEl.textContent = text;

    mwEl.appendChild(bubEl);
    msgEl.appendChild(avEl);
    msgEl.appendChild(mwEl);

    this.msgsContainer.appendChild(msgEl);
    this.msgsContainer.scrollTop = this.msgsContainer.scrollHeight;
  }

  showLoginModal() {
    this.modal.style.display = 'flex';
  }

  closeModal() {
    this.modal.style.display = 'none';
    this.pki.value = '';
    document.getElementById('em').textContent = '';
  }

  async verifyPasskey() {
    const passkey = this.pki.value;
    const em = document.getElementById('em');

    if (!passkey) {
      em.textContent = 'Passkey enter karo';
      return;
    }

    try {
      // Verify with backend
      const response = await fetch('/api/verify-passkey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passkey })
      });

      const data = await response.json();

      if (data.success) {
        this.currentUser = 'admin';
        this.settBtn.style.display = 'inline-block';
        this.pubswitch.style.display = 'flex';
        this.closeModal();
        alert('Admin logged in! ✓');
      } else {
        this.pki.classList.add('wrong');
        em.textContent = 'Galat passkey!';
        setTimeout(() => {
          this.pki.classList.remove('wrong');
        }, 400);
      }
    } catch (error) {
      em.textContent = 'Error: ' + error.message;
      console.error('Passkey error:', error);
    }
  }

  toggleSettings() {
    const opnl = document.getElementById('opnl');
    opnl.classList.toggle('open');
  }

  toggleMode() {
    document.body.classList.toggle('om');
    localStorage.setItem('chamanMode', document.body.classList.contains('om') ? 'orange' : 'normal');
  }

  loadMessages() {
    // Load from Firestore
    this.db.collection('chats')
      .orderBy('timestamp', 'asc')
      .limit(50)
      .onSnapshot((snapshot) => {
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Add to messages
          this.messages.push(data);
        });
      });
  }

  checkAdminMode() {
    const savedMode = localStorage.getItem('chamanMode');
    if (savedMode === 'orange') {
      document.body.classList.add('om');
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.chatApp = new ChatApp();
});
