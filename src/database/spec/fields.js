// Shorthand field builders for table specs.
const ref = (table, o = {}) => ({ type: "ref", ref: table, ...o });
const str = (o = {}) => ({ type: "string", ...o });
const text = (o = {}) => ({ type: "text", ...o });
const int = (o = {}) => ({ type: "int", ...o });
const num = (o = {}) => ({ type: "number", ...o });
const money = (o = {}) => ({ type: "money", ...o });
const bool = (def, o = {}) => ({ type: "bool", default: def, required: true, ...o });
const date = (o = {}) => ({ type: "date", ...o });
const en = (values, o = {}) => ({ type: "enum", values, ...o });
const json = (def, o = {}) => ({ type: "json", default: def, ...o });

module.exports = { ref, str, text, int, num, money, bool, date, en, json };
