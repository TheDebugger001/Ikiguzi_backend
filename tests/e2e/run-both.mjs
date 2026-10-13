// Runs tests/e2e/flows.mjs against the backend on MongoDB and on MySQL (each on
// a throwaway database) and compares the two transcripts step by step.
// Usage: node tests/e2e/run-both.mjs [mongo|mysql|both]
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFlows } from "./flows.mjs";
import { runMoreFlows } from "./flows2.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
require("dotenv").config({ quiet: true });

const which = process.argv[2] || "both";
const ADMIN = { E2E_ADMIN_EMAIL: "admin@e2e.test", E2E_ADMIN_PASSWORD: "AdminPassw0rd!" };
const MONGO_DB = "MVEC_e2e";
const MYSQL_DB = "mvec_e2e_test";
const mongoUri = (process.env.MONGO_URI || "").replace(/\/([^/?]+)(\?|$)/, `/${MONGO_DB}$2`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mysqlAdmin(sql) {
  const mysql = require("mysql2/promise");
  const c = require(path.join(root, "src/database/config")).development;
  const conn = await mysql.createConnection({ host: c.host, port: c.port, user: c.username, password: c.password });
  await conn.query(sql);
  await conn.end();
}
async function dropMongo() {
  const mongoose = require("mongoose");
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  if (conn.db.databaseName !== MONGO_DB) throw new Error("refusing to drop " + conn.db.databaseName);
  await conn.dropDatabase();
  await conn.close();
}

async function startServer(env, port) {
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, ...env, PORT: String(port), NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${port}/api/categories`); if (r.ok) return { child, getLog: () => log }; } catch {}
    await sleep(500);
  }
  child.kill();
  throw new Error(`server on ${port} did not start:\n${log}`);
}

async function runDriver(driver) {
  const port = driver === "mongo" ? 4111 : 4112;
  const env = driver === "mongo"
    ? { DB_DRIVER: "mongo", MONGO_URI: mongoUri }
    : { DB_DRIVER: "mysql", DB_DATABASE: MYSQL_DB };
  if (driver === "mongo") await dropMongo();
  else {
    await mysqlAdmin(`DROP DATABASE IF EXISTS \`${MYSQL_DB}\``);
    await mysqlAdmin(`CREATE DATABASE \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    execFileSync("npx", ["sequelize-cli", "db:migrate"], { cwd: root, env: { ...process.env, DB_DATABASE: MYSQL_DB }, stdio: "ignore" });
  }
  const server = await startServer(env, port);
  try {
    execFileSync(process.execPath, ["tests/e2e/make-admin.cjs"], { cwd: root, env: { ...process.env, ...env, ...ADMIN }, stdio: "inherit" });
    const ctx = { adminEmail: ADMIN.E2E_ADMIN_EMAIL, adminPassword: ADMIN.E2E_ADMIN_PASSWORD };
    const result = await runFlows(`http://localhost:${port}/api`, ctx);
    const more = await runMoreFlows(`http://localhost:${port}/api`, ctx);
    result.transcript.push(...more.transcript);
    result.failures.push(...more.failures);
    result.log = server.getLog();
    return result;
  } finally {
    server.child.kill();
    await sleep(300);
    if (process.env.KEEP_DB) console.log(`  kept ${driver} database for inspection`);
    else if (driver === "mongo") await dropMongo().catch(() => {});
    else await mysqlAdmin(`DROP DATABASE IF EXISTS \`${MYSQL_DB}\``).catch(() => {});
  }
}

const show = (v) => JSON.stringify(v);
const results = {};
for (const d of which === "both" ? ["mongo", "mysql"] : [which]) {
  console.log(`\n▶ ${d}`);
  results[d] = await runDriver(d);
  console.log(`  ${results[d].transcript.length} steps, ${results[d].failures.length} expectation failures`);
  results[d].failures.forEach((f) => console.log("  ✗", f));
  const errors = (results[d].log.match(/^.*(Error|error:|TypeError|ReferenceError|mysql-compat).*$/gm) || []).filter((l) => !/Error connecting/.test(l));
  if (errors.length) { console.log("  server errors:"); [...new Set(errors)].slice(0, 15).forEach((l) => console.log("   ", l.slice(0, 220))); }
}

if (results.mongo && results.mysql) {
  const a = results.mongo.transcript, b = results.mysql.transcript;
  let diffs = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!x || !y || x.step !== y.step || x.status !== y.status || show(x.data) !== show(y.data)) {
      diffs++;
      console.log(`\n≠ ${x?.step || y?.step}\n  mongo: ${x?.status} ${show(x?.data)}\n  mysql: ${y?.status} ${show(y?.data)}`);
    }
  }
  console.log(`\n${diffs ? "✗" : "✓"} ${a.length} steps compared, ${diffs} difference(s) between MongoDB and MySQL`);
  process.exitCode = diffs || results.mongo.failures.length || results.mysql.failures.length ? 1 : 0;
} else {
  const r = Object.values(results)[0];
  r.transcript.forEach((t) => console.log(`  ${t.status} ${t.step} ${show(t.data)}`));
}
