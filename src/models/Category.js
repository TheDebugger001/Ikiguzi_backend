// MySQL (DB_DRIVER=mysql): same API, backed by Sequelize. See src/database/mongoose-compat.
if (require("../database/driver").isMysql) {
  module.exports = require("../database/mongoose-compat").model("Category");
  return;
}

const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null }, // subcategories
  description: String,
  imageUrl: String,
  sortOrder: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

// Expose `id` alongside `_id`; the dashboards address categories by `id`.
categorySchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Category", categorySchema);