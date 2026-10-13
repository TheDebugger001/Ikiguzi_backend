// MongoDB filter -> Sequelize where, preserving Mongo semantics:
//   * `$ne` / `$nin` also match NULL (missing) values
//   * a scalar compared with a JSON array field means "array contains"
//   * `items.vendor` on an embedded array becomes a subquery on the child table
const { Op } = require("sequelize");
const { sequelize } = require("..");
const { idString, isObjectId, HEX24 } = require("./convert");
const { CastError } = require("./errors");

const qg = () => sequelize.getQueryInterface().queryGenerator;
const esc = (v) => sequelize.escape(v);
const qcol = (c) => `\`${c}\``;
const isOpObject = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof RegExp) && !isObjectId(v) && Object.keys(v).some((k) => k.startsWith("$"));

// Normalize a filter value for a field kind.
function normValue(field, value, path) {
  if (value === null || value === undefined) return null;
  if (field.kind === "ref" || field.kind === "refArray") {
    const s = idString(value);
    if (s !== null && !HEX24.test(s)) throw new CastError(path, value);
    return s;
  }
  if (field.kind === "bool") return Boolean(value);
  if (field.kind === "number" && typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) return Number(value);
  if (isObjectId(value)) return value.toHexString();
  return value;
}

// Resolve an API path to { field, child }.
function resolvePath(entry, path) {
  if (path === "_id" || path === "id") return { field: { path, column: "id", kind: "ref" } };
  if (entry.fields[path]) return { field: entry.fields[path] };
  const dot = path.indexOf(".");
  if (dot > 0) {
    const head = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    const child = entry.children?.[head];
    if (child) {
      if (rest === "_id" || rest === "id") return { child, field: { path: rest, column: "id", kind: "ref" } };
      if (child.fields[rest]) return { child, field: child.fields[rest] };
    }
  }
  return {};
}

const regexpSource = (v) => (v instanceof RegExp ? v.source : String(v));

// Condition for one scalar column.
function scalarCondition(field, value, path) {
  const col = field.column;
  if (value instanceof RegExp) return { [col]: { [Op.regexp]: regexpSource(value) } };
  if (!isOpObject(value)) {
    if (Array.isArray(value)) return { [col]: value.map((x) => normValue(field, x, path)) };
    return { [col]: normValue(field, value, path) };
  }
  const parts = [];
  for (const [op, raw] of Object.entries(value)) {
    switch (op) {
      case "$eq": parts.push({ [col]: normValue(field, raw, path) }); break;
      case "$ne": {
        const v = normValue(field, raw, path);
        parts.push(v === null ? { [col]: { [Op.ne]: null } } : { [Op.or]: [{ [col]: { [Op.ne]: v } }, { [col]: null }] });
        break;
      }
      case "$gt": parts.push({ [col]: { [Op.gt]: normValue(field, raw, path) } }); break;
      case "$gte": parts.push({ [col]: { [Op.gte]: normValue(field, raw, path) } }); break;
      case "$lt": parts.push({ [col]: { [Op.lt]: normValue(field, raw, path) } }); break;
      case "$lte": parts.push({ [col]: { [Op.lte]: normValue(field, raw, path) } }); break;
      case "$in": {
        const list = (raw || []).map((x) => (x instanceof RegExp ? x : normValue(field, x, path)));
        const regexes = list.filter((x) => x instanceof RegExp);
        const plain = list.filter((x) => !(x instanceof RegExp));
        const ors = [];
        if (plain.some((x) => x !== null)) ors.push({ [col]: { [Op.in]: plain.filter((x) => x !== null) } });
        if (plain.includes(null)) ors.push({ [col]: null });
        regexes.forEach((r) => ors.push({ [col]: { [Op.regexp]: r.source } }));
        parts.push(ors.length ? { [Op.or]: ors } : sequelize.literal("1=0"));
        break;
      }
      case "$nin": {
        const list = (raw || []).map((x) => normValue(field, x, path));
        const nonNull = list.filter((x) => x !== null);
        if (list.includes(null)) parts.push({ [col]: { [Op.notIn]: nonNull.length ? nonNull : ["__none__"], [Op.ne]: null } });
        else if (nonNull.length) parts.push({ [Op.or]: [{ [col]: { [Op.notIn]: nonNull } }, { [col]: null }] });
        break;
      }
      case "$exists": parts.push(raw ? { [col]: { [Op.ne]: null } } : { [col]: null }); break;
      case "$regex": parts.push({ [col]: { [Op.regexp]: regexpSource(raw) } }); break;
      case "$options": break;
      case "$not": {
        const inner = scalarCondition(field, raw, path);
        parts.push({ [Op.or]: [{ [Op.not]: inner }, { [col]: null }] });
        break;
      }
      default: throw new Error(`Unsupported query operator ${op} on ${path}`);
    }
  }
  return parts.length === 1 ? parts[0] : { [Op.and]: parts };
}

// Conditions for a JSON array column (array-contains semantics).
const contains = (col, v) => sequelize.literal(`JSON_CONTAINS(COALESCE(${qcol(col)}, JSON_ARRAY()), ${esc(JSON.stringify(v))})`);
const notContains = (col, v) => sequelize.literal(`NOT JSON_CONTAINS(COALESCE(${qcol(col)}, JSON_ARRAY()), ${esc(JSON.stringify(v))})`);
function arrayCondition(field, value, path) {
  const col = field.column;
  const norm = (x) => (field.kind === "refArray" ? normValue(field, x, path) : isObjectId(x) ? x.toHexString() : x);
  if (!isOpObject(value)) {
    if (Array.isArray(value)) return sequelize.literal(`${qcol(col)} = CAST(${esc(JSON.stringify(value.map(norm)))} AS JSON)`);
    if (value === null) return { [col]: null };
    return contains(col, norm(value));
  }
  const parts = [];
  for (const [op, raw] of Object.entries(value)) {
    switch (op) {
      case "$eq": parts.push(contains(col, norm(raw))); break;
      case "$ne": parts.push(notContains(col, norm(raw))); break;
      case "$in": parts.push({ [Op.or]: (raw || []).map((x) => contains(col, norm(x))) }); break;
      case "$nin": (raw || []).forEach((x) => parts.push(notContains(col, norm(x)))); break;
      case "$all": (raw || []).forEach((x) => parts.push(contains(col, norm(x)))); break;
      case "$size": parts.push(sequelize.literal(`JSON_LENGTH(COALESCE(${qcol(col)}, JSON_ARRAY())) = ${Number(raw)}`)); break;
      case "$exists": parts.push(raw ? { [col]: { [Op.ne]: null } } : { [col]: null }); break;
      case "$elemMatch": throw new Error(`$elemMatch is not supported on ${path}`);
      default: throw new Error(`Unsupported array operator ${op} on ${path}`);
    }
  }
  return parts.length === 1 ? parts[0] : { [Op.and]: parts };
}

const isArrayField = (field) => field.kind === "refArray" || (field.kind === "json" && Array.isArray(field.jsonDefault));

const warned = new Set();
const warnUnknown = (entry, path) => {
  const key = `${entry.name}.${path}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[mysql-compat] query on unknown path "${path}" of ${entry.name}; it matches only missing values (as in MongoDB).`);
};

function fieldCondition(entry, path, value) {
  const { field, child } = resolvePath(entry, path);
  if (!field) {
    warnUnknown(entry, path);
    // Unknown path: Mongo matches only "missing" checks.
    const wantsMissing = value === null || (isOpObject(value) && value.$exists === false);
    return sequelize.literal(wantsMissing ? "1=1" : "1=0");
  }
  const cond = isArrayField(field) ? arrayCondition(field, value, path) : scalarCondition(field, value, path);
  if (!child) return cond;
  // Embedded array path -> parent id IN (SELECT parentKey FROM child WHERE cond)
  const sql = qg().getWhereConditions(cond, child.Model.tableName, child.Model);
  return sequelize.literal(`${qcol("id")} IN (SELECT ${qcol(child.parentKey)} FROM ${qcol(child.Model.tableName)} WHERE ${sql})`);
}

function buildWhere(entry, filter = {}) {
  if (!filter || typeof filter !== "object") return {};
  const parts = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (key === "$or") parts.push({ [Op.or]: value.map((f) => buildWhere(entry, f)) });
    else if (key === "$and") parts.push({ [Op.and]: value.map((f) => buildWhere(entry, f)) });
    else if (key === "$nor") parts.push({ [Op.not]: { [Op.or]: value.map((f) => buildWhere(entry, f)) } });
    else if (key === "$text" || key === "$where" || key === "$comment") throw new Error(`${key} is not supported`);
    else parts.push(fieldCondition(entry, key, value));
  }
  if (!parts.length) return {};
  return parts.length === 1 ? parts[0] : { [Op.and]: parts };
}

// ---- in-memory matching (aggregation stages after $group) -------------------
const plainVal = (v) => (isObjectId(v) ? v.toHexString() : v instanceof Date ? v.getTime() : v);
const getP = (o, p) => p.split(".").reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o);
function matchValue(actual, cond) {
  if (isOpObject(cond)) {
    return Object.entries(cond).every(([op, v]) => {
      const a = Array.isArray(actual) ? actual.map(plainVal) : plainVal(actual);
      const b = Array.isArray(v) ? v.map(plainVal) : plainVal(v);
      switch (op) {
        case "$eq": return Array.isArray(a) ? a.includes(b) : a === b;
        case "$ne": return Array.isArray(a) ? !a.includes(b) : a !== b;
        case "$gt": return a !== null && a !== undefined && a > b;
        case "$gte": return a !== null && a !== undefined && a >= b;
        case "$lt": return a !== null && a !== undefined && a < b;
        case "$lte": return a !== null && a !== undefined && a <= b;
        case "$in": return Array.isArray(a) ? a.some((x) => b.includes(x)) : b.includes(a ?? null);
        case "$nin": return Array.isArray(a) ? !a.some((x) => b.includes(x)) : !b.includes(a ?? null);
        case "$exists": return v ? a !== undefined && a !== null : a === undefined || a === null;
        case "$regex": return new RegExp(v instanceof RegExp ? v.source : v, cond.$options || (v instanceof RegExp ? v.flags : "")).test(String(actual ?? ""));
        case "$options": return true;
        default: throw new Error(`Unsupported operator ${op} in $match`);
      }
    });
  }
  if (cond instanceof RegExp) return cond.test(String(actual ?? ""));
  const a = Array.isArray(actual) ? actual.map(plainVal) : plainVal(actual);
  const b = plainVal(cond);
  if (Array.isArray(a) && !Array.isArray(b)) return a.includes(b);
  return (a ?? null) === (b ?? null) || JSON.stringify(a) === JSON.stringify(b);
}
function matchDoc(doc, filter = {}) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === "$or") return v.some((f) => matchDoc(doc, f));
    if (k === "$and") return v.every((f) => matchDoc(doc, f));
    if (k === "$nor") return !v.some((f) => matchDoc(doc, f));
    return matchValue(getP(doc, k), v);
  });
}

module.exports = { buildWhere, resolvePath, matchDoc, isArrayField, normValue };
