// Sequelize/MySQL errors -> the Mongoose/MongoDB errors controllers check for
// (code 11000 + keyPattern, ValidationError, CastError).

class CastError extends Error {
  constructor(path, value, kind = "ObjectId") {
    super(`Cast to ${kind} failed for value "${value}" (type ${typeof value}) at path "${path}"`);
    this.name = "CastError";
    this.kind = kind;
    this.path = path;
    this.value = value;
  }
}

const apiFieldFor = (entry, column) => {
  if (!entry) return column;
  if (column === "id") return "_id";
  const field = Object.values(entry.fields).find((f) => f.column === column && !f.alias);
  return field ? field.path : column;
};

function mapError(err, entry) {
  if (!err || err.__mapped) return err;
  const name = err.name || "";
  if (name === "SequelizeUniqueConstraintError") {
    // MySQL: "Duplicate entry 'x' for key 'users.email'"
    const msg = err.parent?.sqlMessage || err.message || "";
    const m = msg.match(/Duplicate entry '(.*)' for key '(?:[^.']*\.)?([^']*)'/);
    let column = m ? m[2] : Object.keys(err.fields || {})[0] || "field";
    column = column.replace(/^.*_(?=[^_]+_unique$)/, "").replace(/_unique$/, "");
    if (entry && !Object.values(entry.fields).some((f) => f.column === column) && err.fields) column = Object.keys(err.fields)[0] || column;
    const field = apiFieldFor(entry, column);
    const value = m ? m[1] : Object.values(err.fields || {})[0];
    const e = new Error(`E11000 duplicate key error collection: ${entry?.table || ""} index: ${field}_1 dup key: { ${field}: "${value}" }`);
    e.code = 11000;
    e.keyPattern = { [field]: 1 };
    e.keyValue = { [field]: value };
    e.__mapped = true;
    return e;
  }
  if (name === "SequelizeValidationError") {
    const e = new Error(err.errors?.map((x) => x.message).join(", ") || err.message);
    e.name = "ValidationError";
    e.errors = Object.fromEntries((err.errors || []).map((x) => [apiFieldFor(entry, x.path), { message: x.message, path: apiFieldFor(entry, x.path), kind: x.validatorKey || "user defined" }]));
    e.__mapped = true;
    return e;
  }
  if (name === "SequelizeDatabaseError") {
    const code = err.parent?.code;
    if (code === "WARN_DATA_TRUNCATED" || code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" || code === "ER_DATA_TOO_LONG") {
      const col = (err.parent.sqlMessage.match(/column '([^']+)'/) || [])[1];
      const e = new Error(`Validation failed: ${apiFieldFor(entry, col)}: invalid value`);
      e.name = "ValidationError";
      e.__mapped = true;
      return e;
    }
  }
  return err;
}

module.exports = { CastError, mapError };
