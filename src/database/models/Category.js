const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

module.exports = (sequelize) => {
  const Category = sequelize.define("Category", {
    id: primaryKey(),
    name: { type: DataTypes.STRING(120), allowNull: false },
    slug: { type: DataTypes.STRING(190), allowNull: false, unique: true },
    parentId: foreignKey(true), // subcategories
    description: { type: DataTypes.TEXT, allowNull: true },
    imageUrl: { type: DataTypes.STRING(500), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { tableName: "categories", timestamps: true });

  Category.associate = (m) => {
    Category.belongsTo(Category, { as: "parent", foreignKey: "parentId" });
    Category.hasMany(Category, { as: "children", foreignKey: "parentId" });
    Category.hasMany(m.Product, { as: "products", foreignKey: "categoryId" });
  };
  Category.prototype.toApi = function () { return withIds(this); };
  return Category;
};
