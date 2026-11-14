const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDb = path.join(os.tmpdir(), `bindarr-magic-bulk-${process.pid}.db`);
process.env.DB_PATH = tmpDb;
process.env.DEFAULT_ADMIN_PASSWORD = 'test-admin-password';

const express = require('express');
const db = require('../src/db');
const adminRoutes = require('../src/routes/admin');
const scryfallApi = require('../src/scryfallApi');
const { hashSessionToken } = require('../src/utils/authHelpers');

const forest = {
  id: 'mtg-f8a0a7be-a72e-4eeb-82f8-c0eeb0e94148',
  name: 'Forest', game: 'mtg', rarity: 'Common', set_id: 'ddl',
  set_name: 'Duel Decks: Heroes vs. Monsters', number: '81', language: 'English'
};
const yarok = {
  id: 'mtg-c86a8974-df86-43ee-b07f-fd2837c08a6a',
  name: "Yarok's Wavecrasher", game: 'mtg', rarity: 'Uncommon', set_id: 'm20',
  set_name: 'Core Set 2020', number: '81', language: 'German'
};

const header = [
  'Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity',
  'Quantity', 'ManaBox ID', 'Scryfall ID', 'Purchase price', 'Misprint',
  'Altered', 'Signed', 'Condition', 'Language', 'Proxy',
  'Purchase price currency', 'Added'
].join(',');

const row = values => [
  values.name, values.set, values.setName, values.number, values.foil, values.rarity,
  values.quantity, '12345', values.id, values.price, 'false', 'false', 'false',
  values.condition, values.language, 'false', 'EUR', values.added
].join(',');

const csv = [
  header,
  row({ name: 'Forest', set: 'DDL', setName: forest.set_name, number: '81', foil: 'normal', rarity: 'common', quantity: '2', id: 'f8a0a7be-a72e-4eeb-82f8-c0eeb0e94148', price: '0.11', condition: 'near_mint', language: 'en', added: '2026-10-10T12:30:20.354Z' }),
  row({ name: "Yarok's Wavecrasher", set: 'M20', setName: yarok.set_name, number: '81', foil: 'foil', rarity: 'uncommon', quantity: '1', id: '', price: '1.25', condition: 'lightly_played', language: 'de', added: '' }),
  row({ name: 'Unmatched Card', set: 'ZZZ', setName: 'Missing Set', number: '1', foil: 'normal', rarity: 'common', quantity: '1', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', price: '0', condition: 'near_mint', language: 'en', added: '' }),
  row({ name: 'Invalid Quantity', set: 'DDL', setName: forest.set_name, number: '81', foil: 'normal', rarity: 'common', quantity: '0', id: 'f8a0a7be-a72e-4eeb-82f8-c0eeb0e94148', price: '0', condition: 'near_mint', language: 'en', added: '' })
].join('\n');

async function runTests() {
  const app = express();
  app.use('/api/admin', adminRoutes);
  const server = app.listen(0, '127.0.0.1');
  const address = await new Promise(resolve => server.once('listening', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const originalBulkFetch = scryfallApi.bulkFetchByIdentifier;
  const originalCacheCards = scryfallApi.cacheCards;

  try {
    await db.initDb();
    const admin = await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    const memberId = (await db.run(`
      INSERT INTO users (username, password_hash, role, share_token)
      VALUES ('collection-owner', 'test-hash', 'member', ?)
    `, [crypto.randomBytes(16).toString('hex')])).lastID;
    const adminToken = crypto.randomBytes(32).toString('hex');
    const memberToken = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATETIME(\'now\', \'+1 day\'))', [hashSessionToken(adminToken), admin.id]);
    await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATETIME(\'now\', \'+1 day\'))', [hashSessionToken(memberToken), memberId]);

    const request = (url, token, body = csv) => fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body
    });

    assert.equal((await request(`/api/admin/users/${memberId}/mtg-import/preview`)).status, 401);
    assert.equal((await request(`/api/admin/users/${memberId}/mtg-import/preview`, memberToken)).status, 403);
    assert.equal((await request(`/api/admin/users/${memberId}/mtg-import`, memberToken)).status, 403);
    assert.equal((await request('/api/admin/users/999999/mtg-import/preview', adminToken)).status, 404);

    let lookups = 0;
    const mockBulkFetch = async rows => {
      lookups++;
      const pairs = [];
      for (const item of rows) {
        if (item.card_id === forest.id) pairs.push({ row: item, card: forest });
        else if (String(item.set_id).toLowerCase() === 'm20' && item.number === '81') pairs.push({ row: item, card: yarok });
      }
      return { cards: [forest, yarok], pairs, notFound: 1 };
    };
    scryfallApi.bulkFetchByIdentifier = mockBulkFetch;
    scryfallApi.cacheCards = async cards => {
      for (const card of cards) {
        await db.run(`INSERT OR REPLACE INTO card_cache (id, name, game, rarity, set_id, set_name, number, language)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [card.id, card.name, card.game, card.rarity, card.set_id, card.set_name, card.number, card.language]);
      }
    };

    const previewResponse = await request(`/api/admin/users/${memberId}/mtg-import/preview`, adminToken);
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.targetUser.id, memberId);
    assert.equal(preview.rowCount, 3);
    assert.equal(preview.copyCount, 4);
    assert.equal(preview.errors.length, 1);
    assert.deepEqual(preview.unsupportedColumns, [
      'Misprint', 'Altered', 'Signed', 'Proxy', 'ManaBox ID', 'Purchase price currency'
    ]);
    assert.equal(lookups, 0, 'preview must not call Scryfall');

    const importResponse = await request(`/api/admin/users/${memberId}/mtg-import`, adminToken);
    assert.equal(importResponse.status, 200);
    const imported = await importResponse.json();
    assert.equal(imported.importedRows, 2);
    assert.equal(imported.importedCopies, 3);
    assert.equal(imported.unmatchedRows, 1);
    assert.equal(imported.unmatchedCopies, 1);
    assert.equal(imported.invalidRows, 1);

    const rows = await db.all(`SELECT card_id, user_id, condition, printing, language, purchase_price, game, added_at
      FROM collection WHERE user_id = ? ORDER BY id`, [memberId]);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(item => item.user_id === memberId && item.game === 'mtg'));
    assert.equal(rows.filter(item => item.card_id === forest.id).length, 2);
    assert.deepEqual([rows[0].condition, rows[0].printing, rows[0].language, rows[0].purchase_price], ['Near Mint', 'Normal', 'English', 0.11]);
    assert.equal(rows[0].added_at, '2026-10-10T12:30:20.354Z');
    assert.deepEqual([rows[2].condition, rows[2].printing, rows[2].language, rows[2].purchase_price], ['Lightly Played', 'Holofoil', 'German', 1.25]);
    assert.equal(await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [admin.id]).then(x => x.n), 0);

    const repeated = await request(`/api/admin/users/${memberId}/mtg-import`, adminToken);
    assert.equal((await repeated.json()).importedCopies, 3);
    const beforeFailure = await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [memberId]).then(x => x.n);

    scryfallApi.bulkFetchByIdentifier = async () => { throw new Error('offline'); };
    const failedLookup = await request(`/api/admin/users/${memberId}/mtg-import`, adminToken);
    assert.equal(failedLookup.status, 502);
    assert.equal(await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [memberId]).then(x => x.n), beforeFailure);

    scryfallApi.bulkFetchByIdentifier = mockBulkFetch;
    await db.run(`CREATE TRIGGER fail_magic_collection_insert BEFORE INSERT ON collection
      WHEN NEW.card_id = 'mtg-c86a8974-df86-43ee-b07f-fd2837c08a6a'
      BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
    const failedTransaction = await request(`/api/admin/users/${memberId}/mtg-import`, adminToken);
    assert.equal(failedTransaction.status, 500);
    assert.equal(await db.get('SELECT COUNT(*) AS n FROM collection WHERE user_id = ?', [memberId]).then(x => x.n), beforeFailure);
    await db.run('DROP TRIGGER fail_magic_collection_insert');
    console.log('Magic CSV admin import API tests passed.');
  } finally {
    scryfallApi.bulkFetchByIdentifier = originalBulkFetch;
    scryfallApi.cacheCards = originalCacheCards;
    await new Promise(resolve => server.close(resolve));
    try { db.dbConnection.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDb + suffix); } catch { /* absent */ }
    }
  }
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
