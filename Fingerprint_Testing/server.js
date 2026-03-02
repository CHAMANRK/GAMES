const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { Pool } = require('pg');

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  // Session table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire)
  `);
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Credentials table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('✅ Database ready');
}

function toBase64url(val) {
  if (typeof val === 'string') {
    if (val.includes(',')) return Buffer.from(Uint8Array.from(val.split(',').map(Number))).toString('base64url');
    return val;
  }
  return Buffer.from(val).toString('base64url');
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session — PostgreSQL mein store hoga (Vercel serverless ke liye zaroori)
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET || 'fp-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 10 * 60 * 1000, // 10 minutes — registration/login ke liye kaafi
    sameSite: 'none',
  }
}));

const RP_NAME = 'Fingerprint Auth';
const RP_ID  = process.env.RP_ID  || 'localhost';
const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTER START
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/register/start', async (req, res) => {
  const username = req.body.username?.trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username chahiye' });

  let { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  let user = rows[0];
  if (!user) {
    const id = uid();
    await pool.query('INSERT INTO users(id,username) VALUES($1,$2)', [id, username]);
    user = { id, username };
  }

  const { rows: existingCreds } = await pool.query(
    'SELECT credential_id FROM credentials WHERE user_id=$1', [user.id]
  );

  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userID: Buffer.from(user.id), userName: user.username,
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'discouraged',
    },
    excludeCredentials: existingCreds.map(c => ({ id: c.credential_id, type: 'public-key' })),
  });

  // Session mein save karo
  req.session.regChallenge = options.challenge;
  req.session.regUserId = user.id;
  await new Promise((resolve, reject) =>
    req.session.save(err => err ? reject(err) : resolve())
  );

  res.json({ options });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTER FINISH
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/register/finish', async (req, res) => {
  const challenge = req.session.regChallenge;
  const userId    = req.session.regUserId;

  console.log('reg/finish session:', req.session.id, '| challenge:', !!challenge, '| userId:', userId);

  if (!challenge || !userId)
    return res.status(400).json({ error: 'Session expire ho gaya — dobara register karo' });

  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
    if (!verified || !registrationInfo)
      return res.status(400).json({ error: 'Verification fail' });

    const info = registrationInfo;
    const rawId  = info.credential?.id  ?? info.credentialID;
    const rawKey = info.credential?.publicKey ?? info.credentialPublicKey;
    const counter = Number(info.credential?.counter ?? info.counter ?? 0);
    const credentialId = toBase64url(rawId);
    const publicKey = Buffer.from(rawKey).toString('base64');

    console.log('Saving credential_id:', credentialId);

    await pool.query(
      `INSERT INTO credentials(id,user_id,credential_id,public_key,counter)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(credential_id) DO UPDATE SET public_key=$4, counter=$5`,
      [uid(), userId, credentialId, publicKey, counter]
    );

    delete req.session.regChallenge;
    delete req.session.regUserId;
    req.session.loggedIn = userId;
    await new Promise((resolve, reject) =>
      req.session.save(err => err ? reject(err) : resolve())
    );

    const { rows } = await pool.query('SELECT username FROM users WHERE id=$1', [userId]);
    res.json({ success: true, message: `${rows[0].username} registered! 🎉` });
  } catch (err) {
    console.error('Reg finish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN START
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/login/start', async (req, res) => {
  const username = req.body.username?.trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username chahiye' });

  const { rows: users } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  if (!users[0]) return res.status(404).json({ error: 'User nahi mila. Pehle register karo.' });

  const { rows: creds } = await pool.query(
    'SELECT * FROM credentials WHERE user_id=$1', [users[0].id]
  );
  if (!creds.length) return res.status(404).json({ error: 'Koi fingerprint nahi. Register karo.' });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: creds.map(c => ({
      id: c.credential_id,
      type: 'public-key',
      transports: ['internal'],
    })),
    timeout: 60000,
  });

  req.session.authChallenge = options.challenge;
  req.session.authUserId = users[0].id;
  await new Promise((resolve, reject) =>
    req.session.save(err => err ? reject(err) : resolve())
  );

  res.json({ options });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN FINISH
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/login/finish', async (req, res) => {
  const challenge = req.session.authChallenge;
  const userId    = req.session.authUserId;

  console.log('login/finish session:', req.session.id, '| challenge:', !!challenge, '| userId:', userId);

  if (!challenge || !userId)
    return res.status(400).json({ error: 'Session expire ho gaya — dobara try karo' });

  const { rows: userCreds } = await pool.query(
    'SELECT * FROM credentials WHERE user_id=$1', [userId]
  );
  if (!userCreds.length) return res.status(404).json({ error: 'Koi credential nahi' });

  console.log('Response ID:', req.body.response?.id);
  console.log('Stored IDs :', userCreds.map(c => c.credential_id));

  for (const cred of userCreds) {
    try {
      const publicKey = new Uint8Array(Buffer.from(cred.public_key, 'base64'));
      const counter   = Number(cred.counter) || 0;
      const credId    = toBase64url(cred.credential_id);

      const result = await verifyAuthenticationResponse({
        response: req.body.response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        authenticator: {
          credentialID: Buffer.from(credId, 'base64url'),
          credentialPublicKey: publicKey,
          counter,
        },
        credential: { id: credId, publicKey, counter },
      });

      if (result.verified) {
        await pool.query('UPDATE credentials SET counter=$1 WHERE id=$2',
          [result.authenticationInfo.newCounter, cred.id]);

        delete req.session.authChallenge;
        delete req.session.authUserId;
        req.session.loggedIn = userId;
        await new Promise((resolve, reject) =>
          req.session.save(err => err ? reject(err) : resolve())
        );

        const { rows } = await pool.query('SELECT username FROM users WHERE id=$1', [userId]);
        console.log('✅ Login success:', rows[0].username);
        return res.json({ success: true, message: `Welcome back, ${rows[0].username}! ✅` });
      }
    } catch (err) {
      console.log('Cred failed:', err.message);
    }
  }
  res.status(400).json({ error: 'Fingerprint match nahi hua. Dobara try karo.' });
});

// ─── Misc ─────────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  if (req.session.loggedIn) {
    const { rows: u } = await pool.query('SELECT username FROM users WHERE id=$1', [req.session.loggedIn]);
    const { rows: c } = await pool.query('SELECT COUNT(*) as n FROM credentials WHERE user_id=$1', [req.session.loggedIn]);
    res.json({ loggedIn: true, username: u[0]?.username, fingerprintsRegistered: Number(c[0]?.n) || 0 });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/users', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.username, COUNT(c.id) as fingerprints
    FROM users u LEFT JOIN credentials c ON c.user_id=u.id
    GROUP BY u.id ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 http://localhost:${PORT}`);
    console.log(`RP_ID: ${RP_ID} | ORIGIN: ${ORIGIN}\n`);
  });
});
