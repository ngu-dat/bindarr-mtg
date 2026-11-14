const { CONDITION_MAP, parsePrice, parseThirdPartyCSV } = require('./csvMappers');
const languages = require('./languages');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COPIES = 25000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNSUPPORTED_COLUMNS = [
  'Misprint', 'Altered', 'Signed', 'Proxy', 'ManaBox ID', 'Purchase price currency'
];

const normalizeHeader = value => String(value || '').trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function issue(row, field, message) {
  return { row, field, message };
}

function parseRecords(source) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const records = [];
  let cells = [];
  let value = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  const pushCell = () => {
    cells.push(value);
    value = '';
    afterQuote = false;
  };
  const pushRecord = () => {
    pushCell();
    if (cells.some(cell => cell.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    recordLine = line + 1;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        value += char;
        if (char === '\n') line++;
      }
      continue;
    }

    if (afterQuote) {
      if (char === ',') pushCell();
      else if (char === '\n') {
        pushRecord();
        line++;
      } else if (!/\s/.test(char)) {
        return { records: [], errors: [issue(recordLine, 'CSV', 'Malformed CSV: unexpected character after closing quote.')] };
      }
      continue;
    }

    if (char === '"') {
      if (value.trim() !== '') {
        return { records: [], errors: [issue(recordLine, 'CSV', 'Malformed CSV: quote inside an unquoted field.')] };
      }
      value = '';
      quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\n') {
      pushRecord();
      line++;
    } else value += char;
  }

  if (quoted) return { records: [], errors: [issue(recordLine, 'CSV', 'Malformed CSV: unclosed quote.')] };
  if (cells.length || value !== '' || afterQuote) pushRecord();
  return { records, errors: [] };
}

function canonicalLanguage(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'English';
  const lower = raw.toLowerCase();
  const language = languages.LANGUAGES.find(item =>
    item.code.toLowerCase() === lower
    || item.name.toLowerCase() === lower
    || item.scryfall.toLowerCase() === lower
    || item.tcgdex.toLowerCase() === lower
  );
  return language ? languages.toName(language.code) : null;
}

function validCondition(value) {
  const key = normalizeHeader(value);
  if (!key) return true;
  return Object.keys(CONDITION_MAP).some(condition => normalizeHeader(condition) === key);
}

function validFoil(value) {
  return ['', 'normal', 'nonfoil', 'regular', 'false', '0', 'no', 'none', 'unlimited',
    'foil', 'holofoil', 'true', '1', 'yes', 'holo', 'premium', 'etched', 'etchedfoil']
    .includes(normalizeHeader(value));
}

function validTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw;
}

function parseMagicCsv(input) {
  const text = typeof input === 'string' ? input : '';
  const empty = { rows: [], errors: [], unsupportedColumns: [], rowCount: 0, copyCount: 0 };
  if (!text.trim()) return { ...empty, errors: [issue(1, 'CSV', 'The CSV file is empty.')] };
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { ...empty, errors: [issue(1, 'CSV', 'The CSV file exceeds the 5 MiB limit.')] };
  }

  const { records, errors: parseErrors } = parseRecords(text);
  if (parseErrors.length) return { ...empty, errors: parseErrors };
  if (records.length < 2) {
    return { ...empty, errors: [issue(1, 'header', 'The CSV file must include a header and at least one data row.')] };
  }
  if (records.length - 1 > MAX_ROWS) {
    return { ...empty, errors: [issue(1, 'CSV', `The CSV cannot contain more than ${MAX_ROWS.toLocaleString('en-US')} data rows.`)] };
  }

  const headers = records[0].cells.map(cell => cell.replace(/^\uFEFF/, '').trim());
  const normalizedHeaders = headers.map(normalizeHeader);
  const duplicate = normalizedHeaders.find((name, index) => name && normalizedHeaders.indexOf(name) !== index);
  if (duplicate) return { ...empty, errors: [issue(1, 'header', `The CSV header contains a duplicate "${duplicate}" column.`)] };
  const headerIndex = new Map(normalizedHeaders.map((name, index) => [name, index]));

  const hasScryfallId = headerIndex.has('scryfallid') || headerIndex.has('scryfalluuid');
  const hasSetNumber = (headerIndex.has('setcode') || headerIndex.has('setid') || headerIndex.has('set'))
    && (headerIndex.has('collectornumber') || headerIndex.has('cardnumber') || headerIndex.has('number'));
  const missing = [];
  if (!headerIndex.has('quantity') && !headerIndex.has('qty')) missing.push('Quantity');
  if (!hasScryfallId && !hasSetNumber) missing.push('Scryfall ID or Set code and Collector number');
  if (missing.length) return { ...empty, errors: [issue(1, 'header', `Missing required CSV columns: ${missing.join(', ')}.`)] };

  const unsupportedColumns = UNSUPPORTED_COLUMNS.filter(column => headerIndex.has(normalizeHeader(column)));
  const errors = [];
  const rows = [];
  let copyCount = 0;

  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length) {
      errors.push(issue(record.line, 'CSV', 'The row has a different number of columns than the header.'));
      continue;
    }
    const source = Object.fromEntries(headers.map((name, index) => [name, record.cells[index].trim()]));
    const item = parseThirdPartyCSV([source], 'csv')[0];
    const get = (...names) => {
      for (const name of names) {
        const index = headerIndex.get(normalizeHeader(name));
        if (index !== undefined) return String(record.cells[index] || '').trim();
      }
      return '';
    };
    const rowErrors = [];

    const rawId = get('Scryfall ID', 'Scryfall UUID').replace(/^mtg-/i, '');
    const scryfallId = UUID.test(rawId) ? rawId.toLowerCase() : '';
    const setCode = item.set_code || '';
    const collectorNumber = item.collector_number || '';
    if (!scryfallId && (!setCode || !collectorNumber)) {
      rowErrors.push(issue(record.line, 'Scryfall ID', 'Provide a valid Scryfall ID or both Set code and Collector number.'));
    }

    const rawQuantity = get('Quantity', 'Qty');
    const quantity = /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      rowErrors.push(issue(record.line, 'Quantity', 'Quantity must be a positive whole number.'));
    } else if (quantity > MAX_COPIES || copyCount + quantity > MAX_COPIES) {
      rowErrors.push(issue(record.line, 'Quantity', `The import cannot exceed ${MAX_COPIES.toLocaleString('en-US')} total copies.`));
    }

    const rawPrice = get('Purchase price', 'Price bought', 'Price paid');
    const priceChars = rawPrice.replace(/[0-9.,\-€$£¥\s]/g, '');
    const purchasePrice = rawPrice ? parsePrice(rawPrice) : 0;
    if (priceChars || rawPrice.includes('-') || !Number.isFinite(purchasePrice)) {
      rowErrors.push(issue(record.line, 'Purchase price', 'Purchase price must be a non-negative number.'));
    }

    const rawFoil = get('Foil', 'Printing', 'Finish');
    if (!validFoil(rawFoil)) rowErrors.push(issue(record.line, 'Foil', 'Foil must identify a normal or foil printing.'));

    const rawCondition = get('Condition');
    if (!validCondition(rawCondition)) rowErrors.push(issue(record.line, 'Condition', 'Condition is not supported by Bindarr.'));

    const language = canonicalLanguage(get('Language', 'Lang'));
    if (!language) rowErrors.push(issue(record.line, 'Language', 'Language is not supported by Bindarr.'));

    const addedAt = validTimestamp(get('Added'));
    if (addedAt === undefined) rowErrors.push(issue(record.line, 'Added', 'Added must be a valid ISO 8601 timestamp.'));

    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      csvRow: record.line,
      item: {
        ...item,
        card_id: scryfallId ? `mtg-${scryfallId}` : undefined,
        game: 'mtg',
        quantity,
        language,
        purchase_price: purchasePrice
      },
      added_at: addedAt
    });
    copyCount += quantity;
  }

  return { rows, errors, unsupportedColumns, rowCount: rows.length, copyCount };
}

module.exports = { MAX_BYTES, MAX_ROWS, MAX_COPIES, UNSUPPORTED_COLUMNS, parseMagicCsv };
