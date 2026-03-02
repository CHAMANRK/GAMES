const express = require('express');
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0
    )
  `);
  // Session ki jagah challenges DB mein store honge
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      token TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Purane challenges clean karo (5 min se zyada purane)
  await pool.query(`
    DELETE FROM challenges WHERE created_at < NOW() - INTERVAL '5 minutes'
  `).catch(() => {});
  console.log('✅ DB ready');
}

function toBase64url(val) {
  if (typeof val === 'string') {
    if (val.includes(',')) return Buffer.from(Uint8Array.from(val.split(',').map(Number))).toString('base64url');
    return val;
  }
  return Buffer.from(val).toString('base64url');
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const RP_NAME = 'Fingerprint Auth';
const RP_ID   = process.env.RP_ID   || 'localhost';
const ORIGIN  = process.env.ORIGIN  || `http://localhost:${PORT}`;

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER START
// ═══════════════════════════════════════════════════════════════════════════
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

  // Challenge DB mein save karo — token frontend ko bhejo
  const token = uid() + uid();
  await pool.query(
    'INSERT INTO challenges(token, challenge, user_id, type) VALUES($1,$2,$3,$4)',
    [token, options.challenge, user.id, 'register']
  );

  res.json({ options, token });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER FINISH
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/register/finish', async (req, res) => {
  const { response, token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token missing' });

  const { rows } = await pool.query(
    'SELECT * FROM challenges WHERE token=$1 AND type=$2', [token, 'register']
  );
  const ch = rows[0];
  if (!ch) return res.status(400).json({ error: 'Session expire ho gaya — dobara register karo' });

  // Challenge use ho gaya — delete karo
  await pool.query('DELETE FROM challenges WHERE token=$1', [token]);

  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge: ch.challenge,
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

    console.log('✅ Saving credential:', credentialId);

    await pool.query(
      `INSERT INTO credentials(id,user_id,credential_id,public_key,counter)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(credential_id) DO UPDATE SET public_key=$4, counter=$5`,
      [uid(), ch.user_id, credentialId, publicKey, counter]
    );

    const { rows: u } = await pool.query('SELECT username FROM users WHERE id=$1', [ch.user_id]);
    res.json({ success: true, message: `${u[0].username} registered! 🎉` });
  } catch (err) {
    console.error('Reg finish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN START
// ═══════════════════════════════════════════════════════════════════════════
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

  const token = uid() + uid();
  await pool.query(
    'INSERT INTO challenges(token, challenge, user_id, type) VALUES($1,$2,$3,$4)',
    [token, options.challenge, users[0].id, 'login']
  );

  res.json({ options, token });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOGIN FINISH
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/login/finish', async (req, res) => {
  const { response, token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token missing' });

  const { rows } = await pool.query(
    'SELECT * FROM challenges WHERE token=$1 AND type=$2', [token, 'login']
  );
  const ch = rows[0];
  if (!ch) return res.status(400).json({ error: 'Session expire ho gaya — dobara try karo' });

  await pool.query('DELETE FROM challenges WHERE token=$1', [token]);

  const { rows: userCreds } = await pool.query(
    'SELECT * FROM credentials WHERE user_id=$1', [ch.user_id]
  );
  if (!userCreds.length) return res.status(404).json({ error: 'Koi credential nahi' });

  console.log('Response ID:', response?.id);
  console.log('Stored IDs :', userCreds.map(c => c.credential_id));

  for (const cred of userCreds) {
    try {
      const publicKey = new Uint8Array(Buffer.from(cred.public_key, 'base64'));
      const counter   = Number(cred.counter) || 0;
      const credId    = toBase64url(cred.credential_id);

      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: ch.challenge,
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
        const { rows: u } = await pool.query('SELECT username FROM users WHERE id=$1', [ch.user_id]);
        console.log('✅ Login success:', u[0].username);
        return res.json({ success: true, username: u[0].username, message: `Welcome back, ${u[0].username}! ✅` });
      }
    } catch (err) {
      console.log('Cred failed:', err.message);
    }
  }
  res.status(400).json({ error: 'Fingerprint match nahi hua. Dobara try karo.' });
});

// ─── Misc ──────────────────────────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.username, COUNT(c.id) as fingerprints
    FROM users u LEFT JOIN credentials c ON c.user_id=u.id
    GROUP BY u.id ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

app.get('/api/status', (req, res) => res.json({ loggedIn: false }));
app.post('/api/logout', (req, res) => res.json({ success: true }));

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 http://localhost:${PORT}`);
    console.log(`RP_ID: ${RP_ID} | ORIGIN: ${ORIGIN}\n`);
  });
});
                     
