const { DataTypes } = require("sequelize");
const { newId } = require("../objectId");

// CHAR(24) primary key holding a MongoDB-style ObjectId.
const primaryKey = () => ({ type: DataTypes.CHAR(24), primaryKey: true, allowNull: false, defaultValue: newId });
const foreignKey = (allowNull = true) => ({ type: DataTypes.CHAR(24), allowNull });

// Base row -> object with both `_id` and `id`, like the Mongoose JSON output.
const withIds = (row) => {
  const plain = row.get({ plain: true });
  return { _id: plain.id, ...plain };
};

module.exports = { DataTypes, primaryKey, foreignKey, withIds };
