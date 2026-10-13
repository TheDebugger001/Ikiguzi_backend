# Affiliate flow: what the MySQL layer (mvec/mvec_backend @ de96107) still needs

The affiliate/commission code on this branch only uses Mongoose operators the
compatibility layer supports (no `$expr`, `$subtract`, `$cond`, dotted-path
array filters). It has **not** been run on MySQL: `sequelize`/`mysql2` are not
installed here and no migration may be run. The schema below does not exist yet
in `src/database/spec/*` or `migrations/`; without it these writes fail
(unknown columns are dropped, `REVERSED` is rejected by the ENUM).

| Table (spec model) | Add |
|---|---|
| `conversion_audits` | `orderItemId` CHAR(24); `settlement` ref; `buyer` ref; `quantity` int; `clickedAt` date; `reversedAmount` money default 0; `unrecoveredAmount` money default 0; `reversals` json default `[]`; `approvedAt` date; status ENUM += `REVERSED`; UNIQUE(`orderId`,`orderItemId`) |
| `affiliate_links` | `status` ENUM(ACTIVE,TERMINATED) default ACTIVE, index; `terminatedAt` date |
| `affiliate_clicks` | `product` ref; `visitorId` string(32), index |
| `affiliate_attributions` (new) | `visitorId` string(32); `product` ref; `link` ref; `affiliateUser` ref; `affiliateCode` string(60); `clickedAt` date; UNIQUE(`visitorId`,`productId`) |
| `settlements` | `orderItemId` CHAR(24); UNIQUE(`orderId`,`orderItemId`) |
| `order_items` | `affiliateUser` ref; `affiliateLink` ref; `affiliateCode` string; `affiliateClickedAt` date |
| `orders` | `paidAt`; `deliveryOtpAttempts`; `courier` ref; `deliveredVendors` json; `recipient.*`; `deliveryMethod`; `subtotal`; `shippingAddress.province/sector`; `paymentStatus` ENUM += `DISPUTED` |
| `disbursements` (new) | whole `Disbursement` model (REFUND / AFFILIATE_PAYOUT) is absent from the specs |

Non-schema notes
- `findOneAndUpdate`/`updateOne` filter on plain columns only, so the
  compare-and-set guards (`status`+`reversedAmount`, `availableBalance >= x`)
  translate to `UPDATE ... WHERE`; the compat layer's pre-`SELECT` is not
  locked, but the guarded `UPDATE` re-checks the filter atomically.
- `reversals` must be a JSON array field (the layer's `$push` only supports
  array fields, not child tables).
- `main` and `mvec` have two different order pipelines (`checkout.service.js`
  vs multi-store `priceShipping`, three separate DELIVERED paths in mvec).
  Attribution at order creation and `approveAffiliateCommissionsForOrder` on
  delivery must be wired into whichever pipeline survives; that is a decision
  for the owners, not something to guess.
