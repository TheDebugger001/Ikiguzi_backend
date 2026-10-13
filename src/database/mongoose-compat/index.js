// Mongoose-compatible layer over MySQL (Sequelize). With DB_DRIVER=mysql each
// src/models/* file exports `model("Name")` from here instead of a Mongoose
// model, so controllers, services and workers run unchanged on MySQL.
const mongoose = require("mongoose");
const { registry } = require("./registry");
const { model, registryRef } = require("./model");
const { CompatSession } = require("./session");

registryRef.registry = registry;

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  // Sessions become MySQL transactions.
  mongoose.startSession = async () => new CompatSession();
  // mongoose.model("Vendor") lookups inside app code resolve to compat models.
  const originalModel = mongoose.model.bind(mongoose);
  mongoose.model = (name, schema, ...rest) => {
    if (registry[name]) return model(name);
    return originalModel(name, schema, ...rest);
  };
  // Anything still reaching a real Mongoose model fails fast instead of buffering forever.
  mongoose.set("bufferCommands", false);
}

install();

module.exports = { model, registry, install };
