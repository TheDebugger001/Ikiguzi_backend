// Builds Sequelize models (and Mongo-shaped JSON) from compact table specs.
//
// Field spec: { type, required, default, unique, index, len, values, ref, onDelete, fk }
//   type: ref | string | text | int | number | money | bool | date | enum | json
//   ref fields are stored as `<name>Id` CHAR(24); `fk: false` skips the constraint.
//   Dotted names ("payoutDetails.accountName") are nested objects in the API and
//   flattened columns ("payoutDetailsAccountName") in MySQL.
// Child spec (embedded arrays of sub-documents) -> own table with `<parent>Id` + `position`.
const crypto = require("crypto");
const { DataTypes } = require("sequelize");
const { newId } = require("../objectId");

const camel = (dotted) => dotted.split(".").map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("");
const columnName = (name, field) => field.column || (field.type === "ref" ? `${camel(name)}Id` : camel(name));

const sqlType = (field) => {
  switch (field.type) {
    case "ref": return DataTypes.CHAR(24);
    case "string": return DataTypes.STRING(field.len || 255);
    case "text": return DataTypes.TEXT;
    case "int": return DataTypes.INTEGER;
    case "number": return DataTypes.DOUBLE;
    case "money": return DataTypes.DECIMAL(14, 2);
    case "bool": return DataTypes.BOOLEAN;
    case "date": return DataTypes.DATE;
    case "enum": return DataTypes.ENUM(...field.values);
    case "json": return DataTypes.JSON;
    default: throw new Error(`Unknown field type ${field.type}`);
  }
};

const attributesFor = (fields) => {
  const attrs = { id: { type: DataTypes.CHAR(24), primaryKey: true, allowNull: false, defaultValue: newId } };
  for (const [name, field] of Object.entries(fields)) {
    const attr = { type: sqlType(field), allowNull: !field.required };
    if (field.default !== undefined && field.type !== "json") attr.defaultValue = field.default;
    if (field.unique) attr.unique = true;
    if (field.type === "money" || field.type === "number") {
      const col = columnName(name, field);
      attr.get = function () { const v = this.getDataValue(col); return v === null || v === undefined ? v : Number(v); };
    }
    if (field.lowercase) {
      const col = columnName(name, field);
      attr.set = function (v) { this.setDataValue(col, v === null || v === undefined ? v : String(v).trim().toLowerCase()); };
    }
    if (field.uppercase) {
      const col = columnName(name, field);
      attr.set = function (v) { this.setDataValue(col, v === null || v === undefined ? v : String(v).trim().toUpperCase()); };
    }
    attrs[columnName(name, field)] = attr;
  }
  return attrs;
};

const setPath = (obj, dotted, value) => {
  const parts = dotted.split(".");
  let cur = obj;
  parts.slice(0, -1).forEach((p) => { cur[p] = cur[p] && typeof cur[p] === "object" ? cur[p] : {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = value;
};

// Row instance -> Mongo-shaped plain object.
const toApiFrom = (spec, row) => {
  const out = { _id: row.id, id: row.id };
  for (const [name, field] of Object.entries(spec.fields)) {
    const col = columnName(name, field);
    let value = row.get(col);
    if (field.type === "ref") {
      const included = row[name];
      value = included && typeof included.toApi === "function" ? included.toApi() : value ?? null;
    } else if (field.type === "json" && (value === null || value === undefined) && field.default !== undefined) {
      value = Array.isArray(field.default) ? [...field.default] : field.default;
    } else if (field.type === "date" && value === undefined) {
      value = null;
    }
    if ((value === null || value === undefined) && field.apiDefault !== undefined) value = field.apiDefault;
    setPath(out, name, value);
  }
  for (const [name, child] of Object.entries(spec.children || {})) {
    const rows = row[name];
    out[name] = Array.isArray(rows) ? [...rows].sort((a, b) => a.position - b.position).map((r) => toApiFrom(child, r)).map((o) => {
      delete o[child.parentKey];
      if (child.noId) { delete o._id; delete o.id; }
      return o;
    }) : [];
  }
  if (spec.timestamps !== false) {
    out.createdAt = row.get("createdAt");
    if (spec.timestamps !== "createdAt") out.updatedAt = row.get("updatedAt");
  }
  return out;
};

function defineModel(sequelize, spec) {
  const hooks = { ...(spec.hooks || {}) };
  if (spec.publicId) {
    const userBeforeSave = hooks.beforeSave;
    hooks.beforeSave = async (row, options) => {
      if (!row.publicId) row.publicId = `${spec.publicId}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      if (userBeforeSave) await userBeforeSave(row, options);
    };
  }
  const Model = sequelize.define(spec.model, attributesFor(spec.fields), {
    tableName: spec.table,
    timestamps: spec.timestamps !== false,
    updatedAt: spec.timestamps === "createdAt" ? false : "updatedAt",
    hooks,
    defaultScope: spec.hidden ? { attributes: { exclude: spec.hidden.map((h) => columnName(h, spec.fields[h])) } } : undefined,
  });
  Model.spec = spec;
  Model.columnName = (name) => columnName(name, spec.fields[name]);
  Model.prototype.toApi = function () { return toApiFrom(spec, this); };

  // Child tables for embedded arrays.
  Model.children = {};
  for (const [name, child] of Object.entries(spec.children || {})) {
    const parentKey = child.parentKey;
    const ChildModel = sequelize.define(child.model, {
      ...attributesFor(child.fields),
      [parentKey]: { type: DataTypes.CHAR(24), allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, { tableName: child.table, timestamps: false });
    ChildModel.spec = { ...child, timestamps: false };
    ChildModel.prototype.toApi = function () { return toApiFrom(ChildModel.spec, this); };
    Model.hasMany(ChildModel, { as: name, foreignKey: parentKey, onDelete: "CASCADE" });
    ChildModel.belongsTo(Model, { foreignKey: parentKey });
    Model.children[name] = ChildModel;
  }
  return Model;
}

// belongsTo associations for ref fields, once every model exists.
function associate(models, tableToModel) {
  const link = (Model, fields) => {
    for (const [name, field] of Object.entries(fields)) {
      if (field.type !== "ref" || !field.ref) continue;
      if (columnName(name, field) === name) continue; // column already carries the api name (e.g. ownerId)
      const Target = models[tableToModel[field.ref]];
      if (Target && !Model.associations[name]) Model.belongsTo(Target, { as: name, foreignKey: columnName(name, field), constraints: false });
    }
  };
  for (const Model of Object.values(models)) {
    if (!Model.spec) continue;
    link(Model, Model.spec.fields);
    Object.values(Model.children || {}).forEach((C) => link(C, C.spec.fields));
  }
}

module.exports = { defineModel, associate, columnName, camel, sqlType };
