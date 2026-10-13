# MySQL

The backend runs on **MongoDB or MySQL** with the same code. `DB_DRIVER` in `.env`
chooses which one; every route, controller, service and worker behaves the same.

```
DB_DRIVER=mysql          # or mongo
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=mvec
DB_USERNAME=root
DB_PASSWORD="..."        # quote it if it contains # or spaces
```

Create the database once: `CREATE DATABASE mvec CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`

## How it works

- **Tables** – Sequelize migrations in `migrations/` (57 tables). Phase 1–2 tables have
  hand-written models in `models/`; the rest are declared once as specs in `spec/`
  (`commerce.js`, `platform.js`) and built by `spec/define.js`.
- **Same API, no controller changes** – with `DB_DRIVER=mysql`, each `src/models/*.js`
  exports a model from `mongoose-compat/` instead of Mongoose. It implements the Mongoose
  API the app uses: `find/findOne/findById` with `populate/sort/select/limit/skip/lean/session`,
  `doc.save()` (with model hooks), `create`/`new Model()`, `findOneAndUpdate`
  (`$set $inc $addToSet $push $pull`, upserts), `updateMany`, `deleteOne/Many`, `countDocuments`,
  `exists`, `distinct`, `aggregate`, sessions/transactions, embedded arrays (`.id()`,
  sub-document `deleteOne()`), duplicate-key errors (`code 11000`), `CastError`, `ValidationError`.
- **Ids** – primary keys are `CHAR(24)` MongoDB ObjectIds, so `_id`, links and the frontend
  are unchanged and copied rows keep their ids.
- **Dates** – `DATETIME(3)` in UTC (millisecond precision, like MongoDB).
- **Embedded data** – sub-document arrays are child tables (`order_items`, `order_parcels`,
  `cart_items`, …); nested objects are flattened columns; lists and `Mixed` are `JSON`.

## Commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create / update tables |
| `npm run db:migrate:status` | Applied and pending migrations |
| `npm run db:migrate:undo` | Roll back the last migration |
| `npm run db:copy-from-mongo` | Copy all MongoDB data into MySQL (read-only on MongoDB, re-runnable; add table names to copy only some) |
| `npm run db:seed` | Super admin + demo vendors, stores, staff, buyer and catalog |
| `npm run db:seed:undo` | Remove the demo data (a copied admin is kept) |
| `npm run test:e2e` | Run the API flows on MongoDB and on MySQL (throwaway databases) and diff them |

Order for a fresh database: **migrate → copy-from-mongo → seed**.

Demo logins (passwords `SEED_VENDOR_PASSWORD` / `SEED_BUYER_PASSWORD`, defaults `Vendor@12345` /
`Buyer@12345`): `vendor.kigalitech@mvec.test`, `vendor.urbancloset@mvec.test`,
`vendor.homestyle@mvec.test`, `staff.kigalitech@mvec.test`, `buyer@mvec.test`.
Demo seeders refuse to run when `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`.

## Switching a server to MySQL

1. `npm run db:migrate`
2. Stop the app (no more writes to MongoDB), then `npm run db:copy-from-mongo` for a final sync.
3. Set `DB_DRIVER=mysql` and start the app.

**Rollback:** set `DB_DRIVER=mongo` and restart. Data written while on MySQL is not copied
back to MongoDB.

## Verification

- `npm run test:e2e` – 165 API steps (auth, multi-store, catalog, inventory, shipping, cart,
  checkout, manual orders, MoMo payment + escrow, fulfilment, payouts, cancellations, OTP
  delivery, disputes, wholesale, affiliates, abuse reports, commissions, subscriptions/ads,
  messaging, notifications, support, admin): identical results on both databases.
- Unit tests give the same results with `DB_DRIVER=mongo` and `DB_DRIVER=mysql`
  (use a `*_test` database for the latter).
- Live data: public, vendor, buyer and admin endpoints return the same JSON from MongoDB and
  from a fresh MySQL copy.

## Differences to know

- **Text comparison**: equality and unique indexes are case-insensitive in MySQL
  (`utf8mb4_unicode_ci`); MongoDB is case-sensitive. Sorting is case-sensitive to match MongoDB.
- **Missing vs null**: a field never set in MongoDB is absent from JSON; MySQL returns `null`.
- **Aggregations** run their first `$match` in SQL and the remaining stages in Node — fine at
  the dashboards' data sizes; move hot ones to SQL if they grow large.
- `[mysql-compat] query on unknown path …` warnings mean code queries a field the model
  doesn't have (it matches nothing on MongoDB either).

Never run `DB_DRIVER=mysql npm test` against the real database: set `DB_DATABASE` to a `*_test`
database. Unit tests that stub only part of a model can write rows.
