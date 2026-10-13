Written for: an engineer picking up this branch to continue the MySQL integration.

Handoff: Ikiguzi MySQL persistence and affiliate integration
1. Where things are
Item	Value
Repo	/home/debugger/Documents/Huska/Work_/try_push/Test/Ikiguzi_backend
Working branch	feature/mysql-persistence (HEAD 64b4d19, tree clean, not pushed)
Parent commits	4df7156 (affiliate fixes, also on feature/affiliate-mysql-integration), then 589e4b0 (= main)
main	Untouched
Throwaway MySQL	Still running: mysqld on 127.0.0.1:3307, db mvec_ikiguzi_test, root with empty password, datadir in the session scratchpad. Your :3306 server was never used.
Stop the throwaway server with mysqladmin -uroot -h127.0.0.1 -P3307 --protocol=TCP shutdown.

2. What was done
A. Affiliate and finance fixes (commit 4df7156)

reverseOrderCommission picks the wallet bucket from the commission's own status.
It joins the caller's transaction and claims the row with a compare-and-set.
It keeps the AFFILIATE_COMMISSION ledger in step.
refundHeldEscrowForOrder no longer debits the affiliate wallet (this was a double debit).
Repeat clicks inside the debounce window still refresh last-click attribution.
Payout debit and credit are guarded atomic increments.
In-flight payouts are included in totalEarned.
Dashboard aggregates are computed in JS (no $subtract, $cond or $expr).
B. Merge of mvec/mvec_backend (commit 64b4d19)

This repo had no MySQL layer. It existed only on mvec (src/database, specs, migrations, scripts).
I merged it and resolved 36 conflicted files. Per-file winners:
mvec wins: multi-store (store.controller, store/shipping routes, getPrimaryStore), inventory (adjustStock route), shipping zones, standalone mobile-money payments (settlePaypackPayment), monetization publicId lookup.
main wins: affiliate.controller and affiliate.service, staff.controller (invitations, adapted to getPrimaryStore), auth, order.controller and checkout.service, finance, dispute, and the public product listing (ACTIVE only, no vendor email).
Hand-merged unions:
Order model: both pipelines' fields.
product.controller: upload-path normalization plus the store check.
payment.controller: order payments plus standalone amount payments.
checkout.service: now prices delivery through shipping.service.quoteShipping. The default zones equal config/delivery.js, so fees are unchanged.
package-lock.json was regenerated with npm install. swagger.yaml kept both sides of every hunk and parses as YAML.
C. MySQL schema

New migration: 20261013000100-affiliate-checkout-vendor-columns.js. It is additive and idempotent (guarded addColumn and addIndex).
New tables (7): affiliate_attributions, disbursements, supplier_reviews, supplier_supply_requests, supplier_supply_request_lines, supplier_supply_request_events, supplier_team_members.
New columns:
users: businessName, description, logoUrl, category, location, avatarUrl, isOnboarded, verificationStatus, wishlist, resetPasswordCode/CodeExpires/Attempts, isSupplierStaff.
user_addresses: sector. vendors: category. suppliers: category. products: discount.
staff: email, invitationTokenHash, invitationExpiresAt.
orders: deliveryOtpAttempts, recipientName/Phone/Email, deliveryMethod, paidAt, shippedAt, paymentReminderSentAt, courierId, deliveredVendors.
order_items: affiliateUserId, affiliateLinkId, affiliateCode, affiliateClickedAt.
settlements: orderItemId. notifications: link.
affiliate_clicks: productId, visitorId. affiliate_links: status, terminatedAt.
conversion_audits: orderItemId, settlementId, buyerId, quantity, clickedAt, reversedAmount, unrecoveredAmount, reversals (JSON), approvedAt.
ENUMs extended: users.role += delivery, orders.paymentStatus += DISPUTED, conversion_audits.status += REVERSED.
Nullability: orders.shippingAddressState is now NULL-able.
Unique indexes: (orderId, orderItemId) on settlements and conversion_audits; (visitorId, productId) on attributions.
Backfill: role-aware isOnboarded and verificationStatus for existing vendors and suppliers.
Specs and models updated: spec/commerce.js, spec/platform.js, src/database/models/{User,UserAddress,Vendor,Staff,Product}.js, and the LEGACY map in mongoose-compat/registry.js.
Shims added: to the 5 models that lacked one (AffiliateAttribution, Disbursement, SupplierReview, SupplierSupplyRequest, SupplierTeamMember).
Verification: migrations applied to the throwaway DB (64 tables). A models-versus-DB delta check now reports nothing missing.
D. Compat-layer fixes found by running on MySQL

Double-spend race in mongoose-compat/model.js:
After a guarded UPDATE matched 0 rows, the fallback re-check read the transaction's old snapshot, so a lost race was reported as success.
It now re-checks with a locking current read.
convert.js did not export toJsonValue, so any $push/$addToSet crashed.
E. Fix from regression testing

Main's "gender optional" rule had been silently reverted by the auto-merge.
It is restored in both the Mongoose schema and the MySQL model validation.
3. Verification actually run
Run	Result
Affiliate flow on Mongo (22 tests: 17 existing + 5 new)	22/22 pass
Full suite on Mongo, serial, merged tree	128 tests: 113 pass, 15 fail. This is the identical failure set to untouched main (staff invitation, OTP, manualEscrowRelease). Zero new failures.
affiliate.mysql.test.js on MySQL	5/5. Covers link/click/attribution, payment to pending, delivery to available exactly once, refund reversal once, cancel via the refund transaction, concurrent payout guard, dashboard totals equal to SQL sums.
vendor.mysql.test.js on MySQL	1/1. Covers vendor/store/staff-invitation/product create and read-back, hidden token field, guarded stock decrement.
Persistence	Rows seen from an independent mysql client (9 audits, 16 attributions, 16 clicks, 1 vendor, 1 store, 1 staff, 5 products).
4. Not done / remaining blockers
MySQL coverage is narrow. Only the two suites above ran on MySQL. These are untested there:
HTTP-level order, checkout, cart and webhook routes
disputes and returns
notifications
auth and OTP
wholesale and suppliers
npm run test:e2e (mvec's Mongo-vs-MySQL diff runner)
the existing tests/*.js suites
Mongo-to-MySQL copy script not verified. I did not read or run scripts/mongo-to-mysql.js against the new tables and columns. Check that it picks up the new models and the users.isOnboarded-style defaults. It was deliberately not run.
Seeders not run. Seed data was not exercised against the new schema.
Swagger. Both sides were kept per hunk, so duplicate or conflicting paths are possible. Review before publishing.
Unlocked pre-SELECT. updateOneImpl does an unlocked SELECT before the guarded UPDATE. The guard is enforced by the UPDATE's WHERE, and I verified the payout race. Other guarded updates were not individually stress-tested.
modifiedCount semantics. MySQL reports changed rows only, whereas Mongo reports matched or modified. Check any caller that depends on it.
Migration down() is destructive. It drops the new tables and columns. Never run it on real data.
Items out of the compat layer's reach:
Aggregation operators: $subtract, $cond and $expr are unsupported, so I avoided them rather than adding them.
Child-table arrays: $push on child-table arrays is unsupported, so reversals is a JSON array.
Order-less standalone payments: $push plus the sandbox auto-success path is untested.
Business decisions (not changed):
releaseEscrowToVendor credits PLATFORM_REVENUE with the full 5% fee and also credits the dev/admin/affiliate accounts, so the memo accounts double count.
Partial refunds prorate by refund ÷ order total, which includes shipping.
Supervisor handover. The supervisor's branch (mvec/mvec_backend) lacks my affiliate fixes. Merging feature/mysql-persistence back is a decision for you and them.
5. Commands

cd /home/debugger/Documents/Huska/Work_/try_push/Test/Ikiguzi_backend
git switch feature/mysql-persistence

# Mongo-mode tests (system mongod 8.0 fails under memory-server here; use the cached 7.0.0):
mkdir -p /tmp/mbin && ln -sf ~/.cache/mongodb-binaries/mongod-x64-ubuntu-7.0.0 /tmp/mbin/mongod
PATH=/tmp/mbin:$PATH node --test --test-concurrency=1

# MySQL (ONLY a *_test database; the tests refuse anything else):
export DB_DRIVER=mysql DB_HOST=127.0.0.1 DB_PORT=3307 DB_DATABASE=mvec_ikiguzi_test DB_USERNAME=root DB_PASSWORD=
npx sequelize-cli db:migrate:status
npx sequelize-cli db:migrate
node --test tests/integration/affiliate.mysql.test.js tests/integration/vendor.mysql.test.js
Do not run any of the DB_* commands without setting those variables first. .env has no DB_* values, so src/database/config.js would otherwise default to 127.0.0.1:3306 and database mvec.