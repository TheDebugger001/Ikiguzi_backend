// Aggregation pipelines: the first $match runs in SQL, remaining stages in JS.
// Supports the stages/operators the app uses: $match $group $sort $limit $skip
// $project $count with $sum $avg $min $max $first $last $push $addToSet,
// $dateToString $size $ifNull $toString.
const { matchDoc } = require("./where");
const { isObjectId } = require("./convert");

const getP = (o, p) => p.split(".").reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const keyOf = (v) => JSON.stringify(v, (k, x) => (isObjectId(x) ? `oid:${x.toHexString()}` : x instanceof Date ? `date:${x.toISOString()}` : x));
const cmp = (a, b) => {
  const va = isObjectId(a) ? a.toHexString() : a instanceof Date ? a.getTime() : a;
  const vb = isObjectId(b) ? b.toHexString() : b instanceof Date ? b.getTime() : b;
  if (va === vb) return 0;
  if (va === null || va === undefined) return -1;
  if (vb === null || vb === undefined) return 1;
  return va < vb ? -1 : 1;
};

function evalExpr(expr, doc) {
  if (typeof expr === "string" && expr.startsWith("$")) return getP(doc, expr.slice(1));
  if (expr === null || typeof expr !== "object" || expr instanceof Date || isObjectId(expr) || Array.isArray(expr)) return expr;
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith("$")) {
    const [op] = keys;
    const arg = expr[op];
    switch (op) {
      case "$dateToString": {
        const d = evalExpr(arg.date, doc);
        if (!d) return null;
        const date = new Date(d);
        return String(arg.format || "%Y-%m-%dT%H:%M:%S.%LZ")
          .replace(/%Y/g, date.getUTCFullYear()).replace(/%m/g, pad(date.getUTCMonth() + 1)).replace(/%d/g, pad(date.getUTCDate()))
          .replace(/%H/g, pad(date.getUTCHours())).replace(/%M/g, pad(date.getUTCMinutes())).replace(/%S/g, pad(date.getUTCSeconds()))
          .replace(/%L/g, pad(date.getUTCMilliseconds(), 3));
      }
      case "$size": { const v = evalExpr(arg, doc); return Array.isArray(v) ? v.length : 0; }
      case "$ifNull": { const [a, b] = arg; const v = evalExpr(a, doc); return v === null || v === undefined ? evalExpr(b, doc) : v; }
      case "$toString": { const v = evalExpr(arg, doc); return isObjectId(v) ? v.toHexString() : v === null || v === undefined ? null : String(v); }
      case "$literal": return arg;
      case "$sum": return (Array.isArray(arg) ? arg : [arg]).reduce((s, a) => s + (Number(evalExpr(a, doc)) || 0), 0);
      default: throw new Error(`Unsupported aggregation expression ${op}`);
    }
  }
  return Object.fromEntries(keys.map((k) => [k, evalExpr(expr[k], doc)]));
}

function group(docs, spec) {
  const groups = new Map();
  for (const doc of docs) {
    const id = evalExpr(spec._id, doc);
    const key = keyOf(id ?? null);
    if (!groups.has(key)) groups.set(key, { _id: id ?? null, docs: [] });
    groups.get(key).docs.push(doc);
  }
  return [...groups.values()].map(({ _id, docs: members }) => {
    const out = { _id };
    for (const [field, acc] of Object.entries(spec)) {
      if (field === "_id") continue;
      const [op] = Object.keys(acc);
      const vals = members.map((d) => evalExpr(acc[op], d));
      switch (op) {
        case "$sum": out[field] = vals.reduce((s, v) => s + (typeof v === "number" ? v : Number.isFinite(Number(v)) && v !== null && v !== "" && typeof v !== "boolean" ? Number(v) : 0), 0); break;
        case "$avg": { const nums = vals.filter((v) => typeof v === "number"); out[field] = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null; break; }
        case "$max": out[field] = vals.filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === undefined || cmp(v, m) > 0 ? v : m), undefined) ?? null; break;
        case "$min": out[field] = vals.filter((v) => v !== null && v !== undefined).reduce((m, v) => (m === undefined || cmp(v, m) < 0 ? v : m), undefined) ?? null; break;
        case "$first": out[field] = vals.length ? vals[0] ?? null : null; break;
        case "$last": out[field] = vals.length ? vals[vals.length - 1] ?? null : null; break;
        case "$push": out[field] = vals; break;
        case "$addToSet": { const seen = new Map(); vals.forEach((v) => { if (v !== undefined) seen.set(keyOf(v), v); }); out[field] = [...seen.values()]; break; }
        default: throw new Error(`Unsupported accumulator ${op}`);
      }
    }
    return out;
  });
}

async function runAggregate(entry, pipeline, { loadDocs, buildWhere, transaction }) {
  const stages = [...pipeline];
  const first = stages[0] && stages[0].$match ? stages.shift().$match : {};
  const docs = await loadDocs(entry, { where: buildWhere(entry, first), transaction });
  let rows = docs.map((d) => d.toObject());
  for (const stage of stages) {
    const [op] = Object.keys(stage);
    const arg = stage[op];
    switch (op) {
      case "$match": rows = rows.filter((r) => matchDoc(r, arg)); break;
      case "$group": rows = group(rows, arg); break;
      case "$sort": {
        const keys = Object.entries(arg);
        rows = rows.slice().sort((a, b) => { for (const [k, dir] of keys) { const c = cmp(getP(a, k), getP(b, k)); if (c) return c * (Number(dir) < 0 ? -1 : 1); } return 0; });
        break;
      }
      case "$limit": rows = rows.slice(0, Number(arg)); break;
      case "$skip": rows = rows.slice(Number(arg)); break;
      case "$count": rows = [{ [arg]: rows.length }]; break;
      case "$project": {
        const includes = Object.entries(arg).filter(([, v]) => v !== 0 && v !== false);
        const excludes = Object.entries(arg).filter(([, v]) => v === 0 || v === false).map(([k]) => k);
        rows = rows.map((r) => {
          if (!includes.length) { const o = { ...r }; excludes.forEach((k) => delete o[k]); return o; }
          const o = excludes.includes("_id") ? {} : { _id: r._id };
          includes.forEach(([k, v]) => { o[k] = v === 1 || v === true ? getP(r, k) : evalExpr(v, r); });
          return o;
        });
        break;
      }
      default: throw new Error(`Unsupported aggregation stage ${op}`);
    }
  }
  return rows;
}

module.exports = { runAggregate, evalExpr };
