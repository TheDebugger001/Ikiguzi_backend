const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

module.exports = (sequelize) => {
  const StockMovement = sequelize.define("StockMovement", {
    id: primaryKey(),
    vendorId: foreignKey(false),
    productId: foreignKey(false), // kept (no FK) if the product is later deleted
    productName: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    storeId: foreignKey(true),
    type: { type: DataTypes.ENUM("RESTOCK", "REMOVE", "COUNT", "TRANSFER"), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    before: { type: DataTypes.INTEGER, allowNull: true },
    after: { type: DataTypes.INTEGER, allowNull: true },
    fromStoreId: foreignKey(true),
    toStoreId: foreignKey(true),
    reason: { type: DataTypes.STRING(60), allowNull: false, defaultValue: "" },
    note: { type: DataTypes.STRING(300), allowNull: false, defaultValue: "" },
    performedById: foreignKey(true),
  }, { tableName: "stock_movements", timestamps: true });

  StockMovement.associate = (m) => {
    StockMovement.belongsTo(m.Store, { as: "store", foreignKey: "storeId" });
    StockMovement.belongsTo(m.Store, { as: "fromStore", foreignKey: "fromStoreId" });
    StockMovement.belongsTo(m.Store, { as: "toStore", foreignKey: "toStoreId" });
    StockMovement.belongsTo(m.User, { as: "performedBy", foreignKey: "performedById" });
  };
  StockMovement.prototype.toApi = function () {
    const { vendorId, productId, storeId, fromStoreId, toStoreId, performedById, store, fromStore, toStore, performedBy, ...rest } = withIds(this);
    return {
      ...rest,
      vendor: vendorId, product: productId,
      store: store ? this.store.toApi() : storeId,
      fromStore: fromStore ? this.fromStore.toApi() : fromStoreId,
      toStore: toStore ? this.toStore.toApi() : toStoreId,
      performedBy: performedBy ? this.performedBy.toApi() : performedById,
    };
  };
  return StockMovement;
};
