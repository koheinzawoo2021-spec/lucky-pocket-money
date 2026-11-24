const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database(process.env.DB_PATH || 'giveaway.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS prizes (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL, claimed_by TEXT UNIQUE, claimed_at TEXT);
CREATE TABLE IF NOT EXISTS claims (visitor_id TEXT PRIMARY KEY, prize_id INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(prize_id) REFERENCES prizes(id));`);

const prizeCount = db.prepare('SELECT COUNT(*) AS n FROM prizes').get().n;
if (prizeCount === 0) {
  const insert = db.prepare('INSERT INTO prizes (amount) VALUES (?)');
  const seed = db.transaction(() => [30000, 20000, 20000, 15000, 15000].forEach(v => insert.run(v)));
  seed();
}

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const claimPrize = db.transaction((visitorId) => {
  const previous = db.prepare('SELECT p.amount FROM claims c JOIN prizes p ON p.id=c.prize_id WHERE c.visitor_id=?').get(visitorId);
  if (previous) return { status: 'already_claimed', amount: previous.amount };
  const prize = db.prepare('SELECT id, amount FROM prizes WHERE claimed_by IS NULL ORDER BY id LIMIT 1').get();
  if (!prize) return { status: 'expired' };
  const now = new Date().toISOString();
  db.prepare('UPDATE prizes SET claimed_by=?, claimed_at=? WHERE id=? AND claimed_by IS NULL').run(visitorId, now, prize.id);
  db.prepare('INSERT INTO claims (visitor_id, prize_id, created_at) VALUES (?, ?, ?)').run(visitorId, prize.id, now);
  return { status: 'won', amount: prize.amount };
});

app.post('/api/open', (req, res) => {
  let visitorId = String(req.body?.visitorId || '');
  if (!/^[a-f0-9-]{32,36}$/i.test(visitorId)) return res.status(400).json({ status: 'invalid_request' });
  try {
    const result = claimPrize.immediate(visitorId);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'server_error' });
  }
});

app.get('/api/status', (req, res) => {
  const claimed = db.prepare('SELECT COUNT(*) AS n FROM prizes WHERE claimed_by IS NOT NULL').get().n;
  res.set('Cache-Control', 'no-store').json({ remaining: Math.max(0, 5 - claimed), expired: claimed >= 5 });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Lucky Pocket Money running on port ${port}`));
