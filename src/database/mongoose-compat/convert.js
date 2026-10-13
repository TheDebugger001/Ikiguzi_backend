// MySQL row <-> Mongo-shaped document conversion.
const { Types } = require("mongoose");

const { ObjectId } = Types;
const HEX24 = /^[a-f0-9]{24}$/i;

const isObjectId = (v) => v instanceof ObjectId || (v && v._bsontype === "ObjectId");
const isDoc = (v) => v && typeof v === "object" && v.$__entry !== undefined;

// Any id-ish value (ObjectId, populated doc, string) -> 24-hex string or null.
function idString(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (isObjectId(v)) return v.toHexString();
  if (typeof v === "object" && v._id !== undefined && v._id !== v) return idString(v._id);
  return String(v);
}
const toObjectId = (v) => {
  const s = idString(v);
  return s && HEX24.test(s) ? new ObjectId(s) : s;
};

const getPath = (obj, dotted) => dotted.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
const setPath = (obj, dotted, value) => {
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== "object" || isObjectId(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// JSON column values: ObjectIds / docs become plain id strings.
const toJsonValue = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => (isDoc(x) ? idString(x) : x))));

// DB column value -> API value for a field.
function fromColumn(field, value) {
  switch (field.kind) {
    case "ref": return value === null || value === undefined ? null : toObjectId(value);
    case "refArray": return (Array.isArray(value) ? value : []).map(toObjectId);
    case "json": return value === null || value === undefined ? (field.jsonDefault === undefined ? null : clone(field.jsonDefault)) : value;
    case "number": return value === null || value === undefined ? null : Number(value);
    case "bool": return value === null || value === undefined ? null : Boolean(value);
    case "date": return value === null || value === undefined ? null : new Date(value);
    default: return value === null || value === undefined ? (field.apiDefault === undefined ? null : field.apiDefault) : value;
  }
}

// API value -> DB column value (undefined = leave untouched).
function toColumn(field, value) {
  if (value === undefined) return undefined;
  switch (field.kind) {
    case "ref": return idString(value);
    case "refArray": return (Array.isArray(value) ? value : value === null ? [] : [value]).map(idString);
    case "json": return toJsonValue(value);
    case "number": return value === null || value === "" ? null : Number(value);
    case "bool": return value === null ? null : Boolean(value);
    case "date": return value === null || value === "" ? null : new Date(value);
    default: return value === null ? null : typeof value === "string" ? value : isObjectId(value) ? value.toHexString() : String(value);
  }
}

// Plain row (column -> value) -> document data.
function rowToData(entry, row, childRows = {}) {
  const data = { _id: toObjectId(row.id) };
  for (const field of Object.values(entry.fields)) {
    setPath(data, field.path, fromColumn(field, row[field.column]));
  }
  for (const [name, child] of Object.entries(entry.children || {})) {
    const rows = childRows[name] || [];
    data[name] = rows.map((r) => {
      const sub = child.noId ? {} : { _id: toObjectId(r.id) };
      for (const field of Object.values(child.fields)) setPath(sub, field.path, fromColumn(field, r[field.column]));
      return sub;
    });
  }
  if (entry.timestamps) {
    if (row.createdAt !== undefined) data.createdAt = row.createdAt ? new Date(row.createdAt) : row.createdAt;
    if (entry.timestamps !== "createdAt" && row.updatedAt !== undefined) data.updatedAt = row.updatedAt ? new Date(row.updatedAt) : row.updatedAt;
  }
  return data;
}

// Document data -> { columns, children } for writing.
function dataToColumns(entry, data) {
  const columns = {};
  const aliases = [];
  for (const field of Object.values(entry.fields)) {
    if (field.timestamp) continue; // maintained by Sequelize
    if (field.alias) { aliases.push(field); continue; }
    const v = toColumn(field, getPath(data, field.path));
    if (v !== undefined) columns[field.column] = v;
  }
  // Alias fields (e.g. Staff.user_id) fill their column only when the primary is unset.
  for (const field of aliases) {
    const v = toColumn(field, getPath(data, field.path));
    if (v !== undefined && v !== null && (columns[field.column] === undefined || columns[field.column] === null)) columns[field.column] = v;
  }
  const children = {};
  for (const [name, child] of Object.entries(entry.children || {})) {
    const arr = data[name];
    if (arr === undefined) continue;
    children[name] = (Array.isArray(arr) ? arr : []).map((sub, position) => {
      const row = {};
      for (const field of Object.values(child.fields)) {
        const v = toColumn(field, getPath(sub || {}, field.path));
        if (v !== undefined) row[field.column] = v;
      }
      if (!child.noId) row.id = idString(sub && sub._id);
      if (child.hasPosition) row.position = position;
      return row;
    });
  }
  return { columns, children };
}

// Stable string for change detection.
const fingerprint = (value) => JSON.stringify(value, (k, x) => (x instanceof Date ? x.toISOString() : x));

module.exports = { ObjectId, HEX24, isObjectId, isDoc, idString, toObjectId, getPath, setPath, clone, fromColumn, toColumn, toJsonValue, rowToData, dataToColumns, fingerprint };
