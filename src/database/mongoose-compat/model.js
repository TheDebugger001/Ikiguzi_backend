// Mongoose-compatible models over Sequelize: documents, queries, updates, populate.
const { Op } = require("sequelize");
const { sequelize } = require("..");
const C = require("./convert");
const { buildWhere, resolvePath, isArrayField } = require("./where");
const { mapError, CastError } = require("./errors");
const { resolveTx } = require("./session");

const { ObjectId, idString, toObjectId, getPath, setPath, isObjectId, isDoc } = C;
const registryRef = { registry: null, models: {} };
const entryOf = (name) => registryRef.registry[name];

// ---------------------------------------------------------------- helpers
const withErrors = async (entry, fn) => {
  try { return await fn(); } catch (err) { throw mapError(err, entry); }
};

async function loadChildren(entry, ids, transaction) {
  const out = {};
  for (const [name, child] of Object.entries(entry.children || {})) {
    if (!ids.length) { out[name] = {}; continue; }
    const rows = await child.Model.findAll({
      where: { [child.parentKey]: ids },
      order: [[child.hasPosition ? "position" : child.orderBy || "id", "ASC"]],
      raw: true,
      transaction,
    });
    const grouped = {};
    rows.forEach((r) => { (grouped[r[child.parentKey]] = grouped[r[child.parentKey]] || []).push(r); });
    out[name] = grouped;
  }
  return out;
}

const childRowsFor = (children, id) => Object.fromEntries(Object.entries(children).map(([name, g]) => [name, g[id] || []]));

// ---------------------------------------------------------------- projection
function parseSelect(sel) {
  if (!sel) return null;
  const out = { include: new Set(), exclude: new Set(), plus: new Set() };
  const add = (key, on) => {
    if (key.startsWith("+")) out.plus.add(key.slice(1));
    else if (key.startsWith("-")) out.exclude.add(key.slice(1));
    else if (on === 0 || on === false) out.exclude.add(key);
    else out.include.add(key);
  };
  if (typeof sel === "string") sel.split(/\s+/).filter(Boolean).forEach((k) => add(k));
  else if (Array.isArray(sel)) sel.forEach((k) => add(k));
  else Object.entries(sel).forEach(([k, v]) => add(k, v));
  return out;
}
const mergeSelect = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return { include: new Set([...a.include, ...b.include]), exclude: new Set([...a.exclude, ...b.exclude]), plus: new Set([...a.plus, ...b.plus]) };
};

// Applies projection + hidden (select:false) fields to document data.
function project(entry, data, sel) {
  const hidden = (entry.hidden || []).filter((h) => !(sel && (sel.plus.has(h) || sel.include.has(h))));
  let out = data;
  if (sel && sel.include.size) {
    out = { _id: data._id };
    for (const p of sel.include) {
      const v = getPath(data, p);
      if (v !== undefined) setPath(out, p, v);
    }
    for (const p of sel.plus) {
      const v = getPath(data, p);
      if (v !== undefined) setPath(out, p, v);
    }
    if (sel.exclude.has("_id")) delete out._id;
  } else if (sel && sel.exclude.size) {
    out = { ...data };
    for (const p of sel.exclude) {
      const parts = p.split(".");
      if (parts.length === 1) delete out[p];
      else { const parent = getPath(out, parts.slice(0, -1).join(".")); if (parent) delete parent[parts[parts.length - 1]]; }
    }
  }
  if (hidden.length) {
    if (out === data) out = { ...data };
    hidden.forEach((h) => delete out[h]);
  }
  return out;
}

// ---------------------------------------------------------------- documents
const plain = (v, json) => {
  if (v === null || v === undefined) return v;
  if (isObjectId(v) || v instanceof Date) return v;
  if (isDoc(v)) return json ? v.toJSON() : v.toObject();
  if (Array.isArray(v)) return v.map((x) => plain(x, json));
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const c = plain(x, json);
      // Mongoose "minimize": empty objects are left out of toObject()/toJSON().
      if (c && typeof c === "object" && !Array.isArray(c) && !isObjectId(c) && !(c instanceof Date) && !Object.keys(c).length) continue;
      o[k] = c;
    }
    if (json && o._id && o.id === undefined && (isObjectId(o._id) || typeof o._id === "string")) o.id = idString(o._id);
    return o;
  }
  return v;
};

function snapshotOf(entry, doc) {
  const { columns, children } = C.dataToColumns(entry, doc);
  return { columns: C.fingerprint(columns), columnValues: JSON.parse(C.fingerprint(columns)), children: Object.fromEntries(Object.entries(children).map(([k, v]) => [k, C.fingerprint(v)])) };
}

// Sub-document methods: deleteOne()/remove() take it out of its parent array
// (persisted when the parent document is saved, as in Mongoose).
function attachSubdocMethods(sub, arr) {
  if (!sub || typeof sub !== "object" || sub.deleteOne) return sub;
  const removeSelf = () => { const i = arr.indexOf(sub); if (i >= 0) arr.splice(i, 1); return sub; };
  Object.defineProperties(sub, {
    deleteOne: { value: removeSelf, enumerable: false, configurable: true },
    remove: { value: removeSelf, enumerable: false, configurable: true },
    toObject: { value: () => plain({ ...sub }, false), enumerable: false, configurable: true },
  });
  return sub;
}

function attachArrayHelpers(arr) {
  if (!Array.isArray(arr) || arr.id) return arr;
  arr.forEach((sub) => attachSubdocMethods(sub, arr));
  Object.defineProperty(arr, "id", {
    value(x) { const s = idString(x); const found = this.find((d) => d && idString(d._id) === s) || null; return attachSubdocMethods(found, this); },
    enumerable: false,
  });
  Object.defineProperty(arr, "pull", {
    value(...xs) {
      const ids = xs.map((x) => idString(x && x._id !== undefined ? x._id : x));
      for (let i = this.length - 1; i >= 0; i--) if (ids.includes(idString(this[i] && this[i]._id !== undefined ? this[i]._id : this[i]))) this.splice(i, 1);
      return this;
    },
    enumerable: false,
  });
  return arr;
}

// Shared document methods live on a per-model prototype (as in Mongoose), so
// `Model.prototype.save = ...` overrides and `doc instanceof Model` work.
const protos = {};
function protoFor(entry) {
  if (protos[entry.name]) return protos[entry.name];
  const proto = {};
  Object.defineProperties(proto, {
    id: { get() { return this._id === null || this._id === undefined ? undefined : idString(this._id); }, set() {}, enumerable: false, configurable: true },
    isNew: { get() { return this.$__state.isNew; }, enumerable: false, configurable: true },
    save: { value(opts = {}) { return saveDoc(this, opts); }, writable: true, enumerable: false, configurable: true },
    toObject: { value() { return plain({ ...this }, false); }, writable: true, enumerable: false, configurable: true },
    toJSON: { value() { return plain({ ...this }, true); }, writable: true, enumerable: false, configurable: true },
    populate: { async value(...args) { await populateDocs(this.$__entry, [this], normalizePopulate(args)); return this; }, writable: true, enumerable: false, configurable: true },
    deleteOne: {
      async value(opts = {}) {
        const transaction = await resolveTx(opts.session);
        await withErrors(this.$__entry, () => this.$__entry.Model.destroy({ where: { id: idString(this._id) }, transaction }));
        return this;
      },
      writable: true, enumerable: false, configurable: true,
    },
    remove: { value(opts) { return this.deleteOne(opts); }, writable: true, enumerable: false, configurable: true },
    isModified: { value(path) { return isModified(this, path); }, writable: true, enumerable: false, configurable: true },
    markModified: { value() {}, writable: true, enumerable: false, configurable: true },
    get: { value(path) { return getPath(this, path); }, writable: true, enumerable: false, configurable: true },
    set: { value(path, value) { if (typeof path === "object") Object.assign(this, path); else setPath(this, path, value); return this; }, writable: true, enumerable: false, configurable: true },
    equals: { value(other) { return idString(other) === idString(this._id); }, writable: true, enumerable: false, configurable: true },
    validate: { async value() {}, writable: true, enumerable: false, configurable: true },
  });
  for (const [name, fn] of Object.entries(entry.methods || {})) Object.defineProperty(proto, name, { value: fn, writable: true, enumerable: false, configurable: true });
  protos[entry.name] = proto;
  return proto;
}

function makeDoc(entry, data, { isNew = false, selected = null } = {}) {
  const doc = data;
  Object.setPrototypeOf(doc, protoFor(entry));
  for (const name of Object.keys(entry.children || {})) {
    // A projection that leaves out an embedded array keeps it undefined, so save() won't wipe it.
    if (doc[name] === undefined && !(selected && selected.include.size)) doc[name] = [];
    if (Array.isArray(doc[name])) attachArrayHelpers(doc[name]);
  }
  const state = { entry, isNew, snapshot: isNew ? null : snapshotOf(entry, doc), selected };
  Object.defineProperties(doc, {
    $__entry: { value: entry, enumerable: false, writable: true },
    $__state: { value: state, enumerable: false, writable: true },
  });
  return doc;
}

function isModified(doc, path) {
  const state = doc.$__state;
  if (state.isNew) return true;
  const { columns, children } = C.dataToColumns(state.entry, doc);
  const now = JSON.parse(C.fingerprint(columns));
  if (!path) return C.fingerprint(columns) !== state.snapshot.columns || Object.keys(children).some((k) => C.fingerprint(children[k]) !== state.snapshot.children[k]);
  if (state.entry.children?.[path]) return C.fingerprint(children[path]) !== state.snapshot.children[path];
  const cols = Object.values(state.entry.fields).filter((f) => f.path === path || f.path.startsWith(`${path}.`)).map((f) => f.column);
  return cols.some((c) => JSON.stringify(now[c]) !== JSON.stringify(state.snapshot.columnValues[c]));
}

// Defaults applied when a document is constructed (Mongoose fills them immediately).
function applyDefaults(entry, data) {
  const attrs = entry.Model.rawAttributes;
  for (const field of Object.values(entry.fields)) {
    if (field.alias || getPath(data, field.path) !== undefined) continue;
    if (field.kind === "json" || field.kind === "refArray") {
      const def = field.kind === "refArray" ? [] : field.jsonDefault;
      if (def !== undefined && def !== null) setPath(data, field.path, C.clone(def));
      continue;
    }
    const attr = attrs[field.column];
    if (attr && attr.defaultValue !== undefined && typeof attr.defaultValue !== "function" && typeof attr.defaultValue !== "object") {
      setPath(data, field.path, C.fromColumn(field, attr.defaultValue));
    } else if (field.apiDefault !== undefined) {
      setPath(data, field.path, field.apiDefault);
    }
  }
  for (const name of Object.keys(entry.children || {})) if (data[name] === undefined) data[name] = [];
  return data;
}

function newDoc(entry, input = {}) {
  const data = { ...(input && typeof input === "object" ? input : {}) };
  // Copy nested objects so later mutation doesn't affect the caller's input.
  for (const k of Object.keys(data)) if (data[k] && typeof data[k] === "object" && !isObjectId(data[k]) && !(data[k] instanceof Date) && !isDoc(data[k]) && !Array.isArray(data[k])) data[k] = { ...data[k] };
  data._id = data._id ? toObjectId(data._id) : new ObjectId();
  for (const [name, child] of Object.entries(entry.children || {})) {
    if (Array.isArray(data[name])) data[name] = data[name].map((s) => (child.noId || (s && s._id) ? { ...s } : { _id: new ObjectId(), ...s }));
  }
  applyDefaults(entry, data);
  return makeDoc(entry, data, { isNew: true });
}

// Refreshes document fields from the saved Sequelize instance (hook output, defaults, timestamps).
function refreshFromRow(doc, row) {
  const entry = doc.$__entry;
  const values = row.get({ plain: true });
  for (const field of Object.values(entry.fields)) {
    if (!(field.column in values)) continue;
    const current = getPath(doc, field.path);
    if (current !== undefined && isDoc(current)) continue; // keep populated refs
    if (field.kind === "ref" && current && typeof current === "object" && !isObjectId(current) && idString(current) === values[field.column]) continue;
    setPath(doc, field.path, C.fromColumn(field, values[field.column]));
  }
  if (entry.timestamps) {
    if (values.createdAt !== undefined) doc.createdAt = values.createdAt;
    if (entry.timestamps !== "createdAt" && values.updatedAt !== undefined) doc.updatedAt = values.updatedAt;
  }
}

async function writeChildren(entry, doc, childRows, transaction, onlyChanged) {
  const id = idString(doc._id);
  for (const [name, rows] of Object.entries(childRows)) {
    if (onlyChanged && C.fingerprint(rows) === doc.$__state.snapshot?.children?.[name]) continue;
    const child = entry.children[name];
    await child.Model.destroy({ where: { [child.parentKey]: id }, transaction });
    if (!rows.length) continue;
    const toInsert = rows.map((r, i) => {
      const row = { ...r, [child.parentKey]: id };
      if (!row.id) {
        row.id = new ObjectId().toHexString();
        if (!child.noId && doc[name][i]) doc[name][i]._id = new ObjectId(row.id);
      }
      return row;
    });
    await child.Model.bulkCreate(toInsert, { transaction });
  }
}

async function saveDoc(doc, opts = {}) {
  const entry = doc.$__entry;
  const state = doc.$__state;
  const transaction = await resolveTx(opts.session);
  return withErrors(entry, async () => {
    const { columns, children } = C.dataToColumns(entry, doc);
    if (state.isNew) {
      const row = entry.Model.build({ ...columns, id: idString(doc._id) });
      await row.save({ transaction });
      await writeChildren(entry, doc, children, transaction, false);
      state.row = row;
      state.isNew = false;
      refreshFromRow(doc, row);
    } else {
      let row = state.row;
      if (!row) row = await entry.Model.unscoped().findByPk(idString(doc._id), { transaction });
      if (!row) throw new Error(`No document found for query { _id: "${idString(doc._id)}" } on model "${entry.name}"`);
      const before = state.snapshot.columnValues;
      const now = JSON.parse(C.fingerprint(columns));
      for (const [col, value] of Object.entries(columns)) {
        if (JSON.stringify(now[col]) !== JSON.stringify(before[col])) row.set(col, value);
      }
      if (row.changed()) {
        // Validate first so values set by beforeValidate hooks (e.g. Product.discountPrice)
        // count as changed when save() picks the columns to write.
        await row.validate();
        await row.save({ transaction });
      }
      await writeChildren(entry, doc, children, transaction, true);
      state.row = row;
      refreshFromRow(doc, row);
    }
    state.snapshot = snapshotOf(entry, doc);
    return doc;
  });
}

// ---------------------------------------------------------------- loading
async function loadDocs(entry, { where, order, limit, offset, transaction, select, lock }) {
  const rows = await entry.Model.unscoped().findAll({ where, order, limit, offset, transaction, lock });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const children = await loadChildren(entry, ids, transaction);
  return rows.map((row) => {
    const data = C.rowToData(entry, row.get({ plain: true }), childRowsFor(children, row.id));
    const projected = project(entry, data, select);
    const doc = makeDoc(entry, projected, { selected: select });
    doc.$__state.row = row;
    return doc;
  });
}

function buildOrder(entry, sort) {
  if (!sort) return undefined;
  const pairs = typeof sort === "string"
    ? sort.split(/\s+/).filter(Boolean).map((s) => (s.startsWith("-") ? [s.slice(1), -1] : [s, 1]))
    : Array.isArray(sort) ? sort : Object.entries(sort);
  const order = [];
  for (const [path, dir] of pairs) {
    const { field, child } = resolvePath(entry, path);
    const column = path === "createdAt" || path === "updatedAt" ? path : field && !child ? field.column : null;
    const direction = String(dir).toLowerCase() === "desc" || Number(dir) < 0 ? "DESC" : "ASC";
    // MongoDB compares strings byte-wise (case-sensitive); the column collation is case-insensitive.
    if (column && field && field.kind === "string") order.push([sequelize.literal(`\`${column}\` COLLATE utf8mb4_bin`), direction]);
    else if (column) order.push([column, direction]);
  }
  // ObjectIds are time-ordered: id as tie-breaker matches Mongo's insertion order.
  if (order.length && !order.some(([c]) => c === "id")) order.push(["id", order[order.length - 1][1]]);
  return order.length ? order : undefined;
}

// ---------------------------------------------------------------- populate
function normalizePopulate(args) {
  const out = [];
  const push = (p, select, model) => {
    if (!p) return;
    if (Array.isArray(p)) return p.forEach((x) => push(x));
    if (typeof p === "string") return p.split(/\s+/).filter(Boolean).forEach((path) => out.push({ path, select, model }));
    out.push({ path: p.path, select: p.select, model: p.model, populate: p.populate, match: p.match, options: p.options });
  };
  if (args.length >= 2 && typeof args[0] === "string" && (typeof args[1] === "string" || (args[1] && typeof args[1] === "object" && !args[1].path))) push(args[0], args[1], args[2]);
  else args.forEach((a) => push(a));
  return out;
}

async function populateDocs(entry, docs, specs, transaction) {
  docs = docs.filter(Boolean);
  if (!docs.length || !specs.length) return docs;
  for (const spec of specs) {
    for (const path of String(spec.path).split(/\s+/).filter(Boolean)) {
      const { field, child } = resolvePath(entry, path);
      if (!field || !(field.kind === "ref" || field.kind === "refArray")) continue;
      const targetName = typeof spec.model === "string" ? spec.model : spec.model?.modelName || field.refModel;
      const target = targetName && entryOf(targetName);
      if (!target) continue;
      // Collect holders: { obj, key } where obj[key] holds the ref(s).
      const holders = [];
      for (const d of docs) {
        if (child) {
          const arr = d[path.split(".")[0]];
          (Array.isArray(arr) ? arr : []).forEach((sub) => sub && holders.push({ obj: sub, key: field.path }));
        } else {
          holders.push({ obj: d, key: field.path });
        }
      }
      const ids = new Set();
      holders.forEach(({ obj, key }) => {
        const v = getPath(obj, key);
        (Array.isArray(v) ? v : [v]).forEach((x) => { const s = idString(x); if (s && C.HEX24.test(s)) ids.add(s); });
      });
      if (!ids.size) {
        holders.forEach(({ obj, key }) => { if (field.kind === "ref" && getPath(obj, key) !== undefined && getPath(obj, key) !== null && !isDoc(getPath(obj, key))) setPath(obj, key, null); });
        continue;
      }
      const filter = { _id: { $in: [...ids] }, ...(spec.match || {}) };
      const targets = await new Query(target, "find", filter).select(spec.select).populate(spec.populate || []).session(null)._withTx(transaction).exec();
      const byId = new Map(targets.map((t) => [idString(t._id), t]));
      holders.forEach(({ obj, key }) => {
        const v = getPath(obj, key);
        if (Array.isArray(v)) setPath(obj, key, v.map((x) => byId.get(idString(x))).filter(Boolean));
        else if (v !== undefined && v !== null) setPath(obj, key, byId.get(idString(v)) || null);
      });
    }
  }
  return docs;
}

// ---------------------------------------------------------------- query
class Query {
  constructor(entry, op, filter = {}, extra = {}) {
    this.entry = entry;
    this.op = op;
    this.filter = filter || {};
    this.extra = extra;
    this._sort = undefined;
    this._select = null;
    this._limit = undefined;
    this._skip = undefined;
    this._lean = false;
    this._populate = [];
    this._session = undefined;
    this._tx = undefined;
  }
  populate(...args) { this._populate.push(...normalizePopulate(args)); return this; }
  sort(s) { this._sort = s; return this; }
  select(s) { this._select = mergeSelect(this._select, parseSelect(s)); return this; }
  limit(n) { this._limit = n === undefined || n === null ? undefined : Number(n); return this; }
  skip(n) { this._skip = n === undefined || n === null ? undefined : Number(n); return this; }
  lean(v = true) { this._lean = v !== false; return this; }
  session(s) { this._session = s || undefined; return this; }
  setOptions(o = {}) { if (o.session) this._session = o.session; if (o.lean) this._lean = true; return this; }
  distinct(field) { this.op = "distinct"; this.extra.field = field; return this; }
  countDocuments(filter) { this.op = "count"; if (filter) this.filter = filter; return this; }
  _withTx(t) { this._tx = t; return this; }
  exec() { return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }
  catch(reject) { return this._run().catch(reject); }
  finally(fn) { return this._run().finally(fn); }

  async _run() {
    if (!this._promise) this._promise = this._execute();
    return this._promise;
  }

  async _execute() {
    const entry = this.entry;
    const transaction = this._tx !== undefined ? this._tx : await resolveTx(this._session);
    return withErrors(entry, async () => {
      const where = buildWhere(entry, this.filter);
      if (this.op === "count") return entry.Model.unscoped().count({ where, transaction });
      if (this.op === "exists") {
        const row = await entry.Model.unscoped().findOne({ where, attributes: ["id"], transaction, raw: true });
        return row ? { _id: toObjectId(row.id) } : null;
      }
      if (this.op === "distinct") {
        const path = this.extra.field;
        const { field, child } = resolvePath(entry, path);
        if (!field) return [];
        if (child) {
          const docs = await loadDocs(entry, { where, transaction });
          const seen = new Map();
          docs.forEach((d) => (d[path.split(".")[0]] || []).forEach((s) => { const v = getPath(s, field.path); if (v !== null && v !== undefined) seen.set(String(v), v); }));
          return [...seen.values()];
        }
        const rows = await entry.Model.unscoped().findAll({ where, attributes: [[sequelize.fn("DISTINCT", sequelize.col(field.column)), "v"]], transaction, raw: true });
        return rows.map((r) => C.fromColumn(field, r.v)).filter((v) => v !== null && v !== undefined);
      }
      const one = this.op === "findOne";
      const docs = await loadDocs(entry, {
        where,
        order: buildOrder(entry, this._sort) || [["id", "ASC"]], // natural (insertion) order
        limit: one ? 1 : this._limit,
        offset: this._skip,
        transaction,
        select: this._select,
      });
      if (this._populate.length) await populateDocs(entry, docs, this._populate, transaction);
      const out = this._lean ? docs.map((d) => d.toObject()) : docs;
      return one ? out[0] || null : out;
    });
  }
}

// Thenable wrapper for write operations that may chain .session()/.populate()/.select()/.lean().
class Operation {
  constructor(entry, fn) { this.entry = entry; this.fn = fn; this._session = undefined; this._populate = []; this._select = null; this._lean = false; }
  session(s) { this._session = s || undefined; return this; }
  populate(...args) { this._populate.push(...normalizePopulate(args)); return this; }
  select(s) { this._select = mergeSelect(this._select, parseSelect(s)); return this; }
  lean(v = true) { this._lean = v !== false; return this; }
  exec() { return this._run(); }
  then(a, b) { return this._run().then(a, b); }
  catch(b) { return this._run().catch(b); }
  _run() { if (!this._promise) this._promise = withErrors(this.entry, () => this.fn(this)); return this._promise; }
}

// ---------------------------------------------------------------- updates
const isOperatorUpdate = (u) => u && Object.keys(u).some((k) => k.startsWith("$"));

// Equality fields of a filter (used to seed upserts).
function filterEqualities(filter) {
  const out = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith("$")) continue;
    if (v && typeof v === "object" && !isObjectId(v) && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).some((x) => x.startsWith("$"))) {
      if (v.$eq !== undefined) out[k] = v.$eq;
      continue;
    }
    out[k] = v;
  }
  return out;
}

// Translates a Mongo update to column assignments for one existing row.
function updateAssignments(entry, update, current) {
  const u = isOperatorUpdate(update) ? update : { $set: update };
  const values = {};
  const childSets = {};
  const setField = (path, value) => {
    if (entry.children?.[path]) { childSets[path] = value; return; }
    const exact = entry.fields[path];
    if (exact) { values[exact.column] = C.toColumn(exact, value); return; }
    // Setting a whole nested object (e.g. { shippingAddress: {...} }).
    const nested = Object.values(entry.fields).filter((f) => f.path.startsWith(`${path}.`));
    if (nested.length && value && typeof value === "object") {
      nested.forEach((f) => { const v = getPath(value, f.path.slice(path.length + 1)); values[f.column] = v === undefined ? null : C.toColumn(f, v); });
    }
  };
  for (const [path, value] of Object.entries(u.$set || {})) setField(path, value);
  for (const path of Object.keys(u.$unset || {})) setField(path, null);
  for (const [path, by] of Object.entries(u.$inc || {})) {
    const f = entry.fields[path];
    if (!f) continue;
    values[f.column] = sequelize.literal(`COALESCE(\`${f.column}\`, 0) + ${sequelize.escape(Number(by))}`);
  }
  for (const [path, by] of Object.entries(u.$mul || {})) {
    const f = entry.fields[path];
    if (f) values[f.column] = sequelize.literal(`COALESCE(\`${f.column}\`, 0) * ${sequelize.escape(Number(by))}`);
  }
  const arrayOp = (op, fn) => {
    for (const [path, raw] of Object.entries(u[op] || {})) {
      const f = entry.fields[path];
      if (!f || !isArrayField(f)) throw new Error(`${op} is only supported on array fields (${path})`);
      const list = (current?.[f.column] || []).slice();
      const items = raw && typeof raw === "object" && raw.$each ? raw.$each : [raw];
      values[f.column] = C.toColumn(f, fn(list, items.map((x) => (f.kind === "refArray" ? idString(x) : C.toJsonValue(x)))));
    }
  };
  arrayOp("$addToSet", (list, items) => { items.forEach((x) => { if (!list.some((y) => JSON.stringify(y) === JSON.stringify(x))) list.push(x); }); return list; });
  arrayOp("$push", (list, items) => list.concat(items));
  arrayOp("$pull", (list, items) => list.filter((y) => !items.some((x) => JSON.stringify(y) === JSON.stringify(x))));
  return { values, childSets, setOnInsert: u.$setOnInsert || {} };
}

async function updateOneImpl(entry, filter, update, opts = {}, op) {
  const transaction = await resolveTx(op?._session || opts.session);
  const where = buildWhere(entry, filter);
  const sort = buildOrder(entry, opts.sort);
  const needsCurrent = ["$addToSet", "$push", "$pull"].some((k) => update && update[k]);
  const existing = await entry.Model.unscoped().findOne({ where, order: sort, transaction, raw: true, lock: transaction && needsCurrent ? transaction.LOCK.UPDATE : undefined });

  if (!existing) {
    if (!opts.upsert) return { doc: null, matched: 0, modified: 0 };
    const u = isOperatorUpdate(update) ? update : { $set: update };
    const seed = { ...filterEqualities(filter), ...(u.$setOnInsert || {}), ...(u.$set || {}) };
    for (const [path, by] of Object.entries(u.$inc || {})) seed[path] = (Number(getPath(seed, path)) || 0) + Number(by);
    const doc = newDoc(entry, {});
    for (const [path, value] of Object.entries(seed)) {
      if (path === "_id") doc._id = toObjectId(value);
      else setPath(doc, path, value);
    }
    await saveDoc(doc, { session: op?._session || opts.session });
    return { doc, before: null, matched: 0, modified: 0, upsertedId: doc._id };
  }

  const before = opts.returnBefore ? (await loadDocs(entry, { where: { id: existing.id }, transaction }))[0] : null;
  const { values, childSets } = updateAssignments(entry, update, existing);
  let affected = 1;
  if (Object.keys(values).length) {
    const [count] = await entry.Model.unscoped().update(values, { where: { [Op.and]: [{ id: existing.id }, where] }, transaction, hooks: false, validate: !!opts.runValidators });
    affected = count;
    if (!count) {
      // Zero rows changed: either the new values equal the old ones (still a match) or
      // the guard no longer holds (e.g. a stock/balance guard lost a race: no match,
      // like Mongo). Re-check with a locking *current* read; a plain SELECT would
      // read this transaction's older snapshot and wrongly report the guard as met.
      const still = await entry.Model.unscoped().findOne({
        where: { [Op.and]: [{ id: existing.id }, where] },
        attributes: ["id"],
        raw: true,
        transaction,
        lock: transaction ? transaction.LOCK.UPDATE : undefined,
      });
      if (!still) return { doc: null, matched: 0, modified: 0 };
    }
  }
  if (Object.keys(childSets).length) {
    const fakeDoc = { _id: toObjectId(existing.id), ...childSets, $__state: { snapshot: null } };
    const { children } = C.dataToColumns(entry, fakeDoc);
    await writeChildren(entry, fakeDoc, children, transaction, false);
  }
  return { doc: null, before, id: existing.id, matched: 1, modified: affected ? 1 : 0, transaction };
}

// ---------------------------------------------------------------- aggregation
let runAggregate;

// ---------------------------------------------------------------- model factory
function buildModel(name) {
  const entry = entryOf(name);
  if (!entry) throw new Error(`Schema hasn't been registered for model "${name}" (MySQL compat).`);

  function CompatModel(data) {
    if (!(this instanceof CompatModel)) return new CompatModel(data);
    return newDoc(entry, data);
  }
  CompatModel.prototype = protoFor(entry);
  Object.defineProperty(CompatModel.prototype, "constructor", { value: CompatModel, writable: true, enumerable: false, configurable: true });
  CompatModel.modelName = name;
  CompatModel.collection = { name: entry.table, collectionName: entry.table };
  CompatModel.db = { name: "mysql" };
  CompatModel.schema = { paths: entry.fields };
  CompatModel.$__entry = entry;

  CompatModel.find = (filter, projection, options) => {
    const q = new Query(entry, "find", filter);
    if (projection) q.select(projection);
    if (options) q.setOptions(options);
    return q;
  };
  CompatModel.findOne = (filter, projection, options) => {
    const q = new Query(entry, "findOne", filter);
    if (projection) q.select(projection);
    if (options) q.setOptions(options);
    return q;
  };
  CompatModel.findById = (id, projection, options) => {
    if (id === null || id === undefined) return new Query(entry, "findOne", { _id: null }).limit(0);
    const s = idString(id);
    if (!C.HEX24.test(String(s))) {
      const q = new Query(entry, "findOne", {});
      q._promise = Promise.reject(new CastError("_id", id));
      q._promise.catch(() => {});
      return q;
    }
    const q = new Query(entry, "findOne", { _id: s });
    if (projection) q.select(projection);
    if (options) q.setOptions(options);
    return q;
  };
  CompatModel.countDocuments = (filter) => new Query(entry, "count", filter);
  CompatModel.estimatedDocumentCount = () => new Query(entry, "count", {});
  CompatModel.exists = (filter) => new Query(entry, "exists", filter);
  CompatModel.distinct = (field, filter) => new Query(entry, "distinct", filter, { field });

  CompatModel.create = (input, ...rest) => {
    const options = rest.length && rest[rest.length - 1] && typeof rest[rest.length - 1] === "object" && !Array.isArray(rest[rest.length - 1]) && ("session" in rest[rest.length - 1] || "ordered" in rest[rest.length - 1]) ? rest.pop() : {};
    const list = Array.isArray(input) ? input : [input, ...rest];
    return withErrors(entry, async () => {
      const out = [];
      for (const item of list) out.push(await saveDoc(newDoc(entry, item), options));
      return Array.isArray(input) ? out : out[0];
    });
  };
  CompatModel.insertMany = (docs, options = {}) => CompatModel.create(Array.isArray(docs) ? docs : [docs], options);

  const one = (filter, update, opts = {}, mode) => new Operation(entry, async (op) => {
    const returnNew = opts.new === true || opts.returnDocument === "after" || opts.returnOriginal === false;
    const result = await updateOneImpl(entry, filter, update, { ...opts, returnBefore: mode === "findAndModify" && !returnNew }, op);
    if (mode !== "findAndModify") return { acknowledged: true, matchedCount: result.matched, modifiedCount: result.modified, upsertedId: result.upsertedId || null, upsertedCount: result.upsertedId ? 1 : 0 };
    let doc;
    if (result.doc) doc = returnNew ? result.doc : null; // upsert: original is null
    else if (result.id) doc = returnNew ? (await loadDocs(entry, { where: { id: result.id }, transaction: result.transaction, select: op._select }))[0] : result.before;
    else doc = null;
    if (doc && op._populate.length) await populateDocs(entry, [doc], op._populate, result.transaction);
    return doc && op._lean ? doc.toObject() : doc;
  });
  CompatModel.findOneAndUpdate = (filter, update, opts) => one(filter, update, opts, "findAndModify");
  CompatModel.findByIdAndUpdate = (id, update, opts) => one({ _id: idString(id) }, update, opts, "findAndModify");
  CompatModel.updateOne = (filter, update, opts) => one(filter, update, opts, "update");

  CompatModel.updateMany = (filter, update, opts = {}) => new Operation(entry, async (op) => {
    const transaction = await resolveTx(op._session || opts.session);
    const where = buildWhere(entry, filter);
    const { values } = updateAssignments(entry, update, null);
    if (!Object.keys(values).length) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    const matched = await entry.Model.unscoped().count({ where, transaction });
    const [count] = await entry.Model.unscoped().update(values, { where, transaction, hooks: false });
    return { acknowledged: true, matchedCount: matched, modifiedCount: count };
  });

  const del = (filter, opts = {}, many, returnDoc) => new Operation(entry, async (op) => {
    const transaction = await resolveTx(op._session || opts.session);
    const where = buildWhere(entry, filter);
    if (many) return { acknowledged: true, deletedCount: await entry.Model.unscoped().destroy({ where, transaction }) };
    const docs = await loadDocs(entry, { where, limit: 1, transaction, order: buildOrder(entry, opts.sort) });
    if (!docs.length) return returnDoc ? null : { acknowledged: true, deletedCount: 0 };
    await entry.Model.unscoped().destroy({ where: { id: idString(docs[0]._id) }, transaction });
    return returnDoc ? docs[0] : { acknowledged: true, deletedCount: 1 };
  });
  CompatModel.deleteOne = (filter, opts) => del(filter, opts, false, false);
  CompatModel.deleteMany = (filter, opts) => del(filter || {}, opts, true, false);
  CompatModel.findOneAndDelete = (filter, opts) => del(filter, opts, false, true);
  CompatModel.findByIdAndDelete = (id, opts) => del({ _id: idString(id) }, opts, false, true);
  CompatModel.findByIdAndRemove = CompatModel.findByIdAndDelete;

  CompatModel.populate = async (docs, opts) => {
    const list = Array.isArray(docs) ? docs : [docs];
    await populateDocs(entry, list.filter(isDoc), normalizePopulate(Array.isArray(opts) ? opts : [opts]));
    return docs;
  };
  CompatModel.aggregate = (pipeline = []) => new Operation(entry, async (op) => {
    runAggregate = runAggregate || require("./aggregate").runAggregate;
    const transaction = await resolveTx(op._session);
    return runAggregate(entry, pipeline, { loadDocs, buildWhere, transaction });
  });
  CompatModel.syncIndexes = async () => [];
  CompatModel.createIndexes = async () => [];
  CompatModel.init = async () => CompatModel;
  CompatModel.hydrate = (obj) => makeDoc(entry, { ...obj, _id: toObjectId(obj._id) });

  return CompatModel;
}

function model(name) {
  if (!registryRef.models[name]) registryRef.models[name] = buildModel(name);
  return registryRef.models[name];
}

module.exports = { model, registryRef, Query, populateDocs, normalizePopulate, loadDocs, makeDoc, newDoc };
