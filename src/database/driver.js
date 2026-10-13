// Which database the running app uses: "mongo" (default, current live data)
// or "mysql". Loads .env itself because models are required before server.js
// calls dotenv.config().
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env"), quiet: true });

const DB_DRIVER = String(process.env.DB_DRIVER || "mongo").toLowerCase();

module.exports = { DB_DRIVER, isMysql: DB_DRIVER === "mysql" };
