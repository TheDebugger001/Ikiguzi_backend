const { DataTypes, primaryKey, foreignKey, withIds } = require("./_shared");

const PERMISSIONS = ["canViewDashboard", "canManageProducts", "canManageOrders", "canManagePayouts", "canManageStaff", "canViewAnalytics", "canManageSettings"];

module.exports = (sequelize) => {
  const Staff = sequelize.define("Staff", {
    id: primaryKey(),
    storeId: foreignKey(false),
    vendorOwnerId: foreignKey(false),
    userId: foreignKey(false),
    role: { type: DataTypes.ENUM("STORE_MANAGER", "ORDER_MANAGER", "CATALOG_MANAGER"), allowNull: false, defaultValue: "ORDER_MANAGER" },
    // `permissions` sub-document as boolean columns.
    canViewDashboard: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    canManageProducts: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canManageOrders: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    canManagePayouts: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canManageStaff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canViewAnalytics: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canManageSettings: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.ENUM("INVITED", "ACTIVE", "SUSPENDED"), allowNull: false, defaultValue: "ACTIVE" },
    // Email invitations: the token is stored hashed and is select:false in Mongoose.
    email: { type: DataTypes.STRING(190), allowNull: true },
    invitationTokenHash: { type: DataTypes.STRING(128), allowNull: true },
    invitationExpiresAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "staff",
    timestamps: true,
    defaultScope: { attributes: { exclude: ["invitationTokenHash", "invitationExpiresAt"] } },
  });

  Staff.associate = (m) => {
    Staff.belongsTo(m.Store, { as: "store", foreignKey: "storeId" });
    Staff.belongsTo(m.User, { as: "user", foreignKey: "userId" });
    Staff.belongsTo(m.User, { as: "vendorOwner", foreignKey: "vendorOwnerId" });
  };

  // Mongo shape, including the legacy alias fields (vendor_id, user_id, permission_role).
  Staff.prototype.toApi = function () {
    const plain = withIds(this);
    const permissions = Object.fromEntries(PERMISSIONS.map((p) => [p, plain[p]]));
    PERMISSIONS.forEach((p) => delete plain[p]);
    const { storeId, vendorOwnerId, userId, store, user, vendorOwner, ...rest } = plain;
    return {
      ...rest,
      store: store ? this.store.toApi() : storeId,
      user: user ? this.user.toApi() : userId,
      vendorOwner: vendorOwner ? this.vendorOwner.toApi() : vendorOwnerId,
      vendor_id: storeId,
      user_id: userId,
      permission_role: rest.role,
      permissions,
    };
  };
  Staff.PERMISSIONS = PERMISSIONS;
  return Staff;
};
