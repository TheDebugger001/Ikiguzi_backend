// MySQL connection settings for Sequelize and sequelize-cli, read from .env.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

// Accepts DB_* (DB_HOST, DB_USERNAME, …) or MYSQL_* names.
const env = (...keys) => keys.map((k) => process.env[k]).find((v) => v !== undefined && v !== "");

const base = {
  dialect: "mysql",
  host: env("DB_HOST", "MYSQL_HOST") || "127.0.0.1",
  port: Number(env("DB_PORT", "MYSQL_PORT")) || 3306,
  username: env("DB_USERNAME", "MYSQL_USER") || "root",
  password: env("DB_PASSWORD", "MYSQL_PASSWORD") || null,
  database: env("DB_DATABASE", "MYSQL_DATABASE") || "mvec",
  logging: env("DB_LOGGING", "MYSQL_LOGGING") === "true" ? console.log : false,
  define: { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
  dialectOptions: { charset: "utf8mb4", dateStrings: false },
  timezone: "+00:00",
  pool: { max: Number(env("DB_POOL_MAX")) || 10, min: 0, idle: 10000 },
  // Seeders that touch sequelize-cli's own bookkeeping table.
  seederStorage: "sequelize",
  seederStorageTableName: "SequelizeData",
};

module.exports = {
  development: base,
  test: { ...base, database: env("DB_TEST_DATABASE", "MYSQL_TEST_DATABASE") || `${base.database}_test` },
  production: { ...base, logging: false },
};
