const assert = require('node:assert/strict');
const { parseMagicCsv } = require('../src/utils/magicCsvImport');

const headers = [
  'Name', 'Set code', 'Set name', 'Collector number', 'Foil', 'Rarity',
  'Quantity', 'ManaBox ID', 'Scryfall ID', 'Purchase price', 'Misprint',
  'Altered', 'Signed', 'Condition', 'Language', 'Proxy',
  'Purchase price currency', 'Added'
].join(',');

function row({
  name = 'Forest', set = 'DDL', setName = 'Duel Decks: Heroes vs. Monsters',
  number = '81', foil = 'normal', quantity = '1', scryfallId = 'f8a0a7be-a72e-4eeb-82f8-c0eeb0e94148',
  price = '0.11', condition = 'near_mint', language = 'en', added = '2026-10-10T12:30:20.354Z'
} = {}) {
  return [name, set, setName, number, foil, 'common', quantity, '15684', scryfallId,
    price, 'false', 'false', 'false', condition, language, 'false', 'EUR', added].join(',');
}

function testManaBoxMagicRows() {
  const parsed = parseMagicCsv(`${headers}\n${row()}\n${row({
    name: "Yarok's Wavecrasher", set: 'M20', setName: 'Core Set 2020',
    foil: 'foil', quantity: '2', scryfallId: '', condition: 'lightly_played',
    language: 'de', added: ''
  })}`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.copyCount, 3);
  assert.equal(parsed.rows[0].item.card_id, 'mtg-f8a0a7be-a72e-4eeb-82f8-c0eeb0e94148');
  assert.equal(parsed.rows[0].item.game, 'mtg');
  assert.equal(parsed.rows[0].item.printing, 'Normal');
  assert.equal(parsed.rows[0].item.condition, 'Near Mint');
  assert.equal(parsed.rows[0].item.language, 'English');
  assert.equal(parsed.rows[0].item.purchase_price, 0.11);
  assert.equal(parsed.rows[0].added_at, '2026-10-10T12:30:20.354Z');
  assert.equal(parsed.rows[1].item.printing, 'Holofoil');
  assert.equal(parsed.rows[1].item.condition, 'Lightly Played');
  assert.equal(parsed.rows[1].item.language, 'German');
  assert.equal(parsed.rows[1].added_at, null);
}

function testQuotedCsvAndUnsupportedFields() {
  const csv = `\uFEFF${headers}\r\n${row({
    name: '"Forest, Old-Growth"', setName: '"The ""Great"", 2020 Set"'
  })}\r\n`;
  const parsed = parseMagicCsv(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].item.name, 'Forest, Old-Growth');
  assert.equal(parsed.rows[0].item.set_name, 'The "Great", 2020 Set');
  assert.deepEqual(parsed.unsupportedColumns, [
    'Misprint', 'Altered', 'Signed', 'Proxy', 'ManaBox ID', 'Purchase price currency'
  ]);
}

function testInvalidRowsAndLimits() {
  const parsed = parseMagicCsv(`${headers}\n${row({ quantity: '0' })}\n${row({
    quantity: '1', scryfallId: '', set: '', number: ''
  })}\n${row({ price: '-1' })}`);
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.errors.map(item => item.row), [2, 3, 4]);

  const malformed = parseMagicCsv(`${headers}\n${row({ name: '"unterminated' })}`);
  assert.ok(malformed.errors.some(item => item.message.includes('quote')));
  const tooManyCopies = parseMagicCsv(`${headers}\n${row({ quantity: '25001' })}`);
  assert.ok(tooManyCopies.errors.some(item => item.message.includes('25,000')));
  const tooManyRows = parseMagicCsv(`${headers}\n${Array(5001).fill(row()).join('\n')}`);
  assert.ok(tooManyRows.errors.some(item => item.message.includes('5,000 data rows')));
  const tooLarge = parseMagicCsv('x'.repeat(5 * 1024 * 1024 + 1));
  assert.ok(tooLarge.errors.some(item => item.message.includes('5 MiB')));
}

testManaBoxMagicRows();
testQuotedCsvAndUnsupportedFields();
testInvalidRowsAndLimits();
console.log('Magic CSV admin import parser tests passed.');
