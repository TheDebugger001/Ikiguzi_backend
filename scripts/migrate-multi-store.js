// One-off migration enabling several stores per vendor.
//  1. Drops the old unique index on stores.vendor (one store per vendor).
//  2. Creates the new Store / Product indexes.
//  3. Flags each vendor's oldest store as primary when none is flagged.
// Safe to run more than once.  Usage: npm run migrate:stores
require("dotenv").config();
const mongoose = require("mongoose");
const Store = require("../src/models/Store");
const Product = require("../src/models/Product");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/your_database_name?replicaSet=rs0&directConnection=true";

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${mongoose.connection.db.databaseName}`);

  const indexes = await Store.collection.indexes().catch(() => []);
  const legacy = indexes.find((i) => i.key && Object.keys(i.key).join() === "vendor" && i.unique);
  if (legacy) {
    await Store.collection.dropIndex(legacy.name);
    console.log(`Dropped unique index ${legacy.name} on stores.vendor`);
  } else {
    console.log("No unique stores.vendor index found (already migrated)");
  }
  await Store.createIndexes();
  await Product.createIndexes();
  console.log("Store and Product indexes are up to date");

  const vendors = await Store.distinct("vendor");
  let flagged = 0;
  for (const vendor of vendors) {
    if (await Store.exists({ vendor, isPrimary: true })) continue;
    const oldest = await Store.findOne({ vendor }).sort({ createdAt: 1 });
    if (oldest) {
      await Store.updateOne({ _id: oldest._id }, { $set: { isPrimary: true } });
      flagged += 1;
    }
  }
  console.log(`Flagged ${flagged} primary store(s) across ${vendors.length} vendor(s)`);

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
