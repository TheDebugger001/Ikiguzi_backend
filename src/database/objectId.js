// MySQL rows keep MongoDB-style ids (24 hex chars) so existing `_id` values,
// links and ObjectId validation keep working during and after the migration.
const { ObjectId } = require("bson");

const newId = () => new ObjectId().toHexString();
const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

// Column definition for primary / foreign keys.
const idColumn = (Sequelize, extra = {}) => ({ type: Sequelize.CHAR(24), ...extra });

module.exports = { newId, isObjectId, idColumn };
