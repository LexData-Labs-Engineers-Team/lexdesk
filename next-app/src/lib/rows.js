// Row <-> object helpers for the Postgres data layer. Postgres columns are
// snake_case; the API/reader layer speaks camelCase. These helpers make the
// mapping mechanical while preserving Firestore's "skip undefined" write
// semantics (ignoreUndefinedProperties) — an undefined field is omitted from the
// generated SQL (column keeps its DEFAULT / prior value); explicit null -> NULL.

export const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
export const toSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

// timestamptz (pg -> JS Date) -> ISO string. Also tolerates a legacy Firestore
// Timestamp (.toDate()) and an already-ISO string. Anything else -> null.
export const tsToIso = (v) => (
  v instanceof Date ? v.toISOString()
    : (v && typeof v.toDate === 'function' ? v.toDate().toISOString()
      : (typeof v === 'string' ? v : null))
);

// Generic snake row -> camel object; timestamptz Date -> ISO string. Use for
// simple shapes; hand-write an explicit mapper when a reader needs specific
// null-defaults or coercions.
export function rowToObject(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v instanceof Date ? v.toISOString() : v;
  return out;
}

// Build a parameterized INSERT from a (snake- or camel-keyed) object. Skips
// `undefined` keys (Firestore ignoreUndefinedProperties parity); jsonbKeys are
// JSON.stringify'd and cast ::jsonb; JS arrays pass straight through to text[].
export function buildInsert(table, obj, { jsonbKeys = [], returning } = {}) {
  const cols = [];
  const ph = [];
  const params = [];
  let i = 1;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const col = k.includes('_') ? k : toSnake(k);
    cols.push(col);
    if (jsonbKeys.includes(k) || jsonbKeys.includes(col)) { ph.push(`$${i}::jsonb`); params.push(JSON.stringify(v)); }
    else { ph.push(`$${i}`); params.push(v); }
    i++;
  }
  const text = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph.join(', ')})`
    + (returning ? ` RETURNING ${returning}` : '');
  return { text, params, cols };
}

// Build "col1=$n, col2=$n+1" from a partial object (skips undefined). Returns the
// clause, its params, and the next placeholder index so a caller can append WHERE.
export function buildUpdateSet(obj, { jsonbKeys = [], startIndex = 1 } = {}) {
  const sets = [];
  const params = [];
  let i = startIndex;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const col = k.includes('_') ? k : toSnake(k);
    if (jsonbKeys.includes(k) || jsonbKeys.includes(col)) { sets.push(`${col}=$${i}::jsonb`); params.push(JSON.stringify(v)); }
    else { sets.push(`${col}=$${i}`); params.push(v); }
    i++;
  }
  return { setClause: sets.join(', '), params, nextIndex: i };
}
