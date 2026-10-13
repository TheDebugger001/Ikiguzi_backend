// More end-to-end flows: wholesale, disputes, cancellations, delivery OTP,
// affiliates, abuse reports, commissions, ledger, subscriptions/ads, vendor
// profiles, addresses, search, reports, admin users, and edit/delete paths.

export async function runMoreFlows(base, { adminEmail, adminPassword }) {
  const transcript = [];
  const failures = [];
  const client = () => {
    let token = "";
    return {
      setToken: (t) => { token = t; },
      call: async (method, path, body) => {
        const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        let data = null;
        try { data = await res.json(); } catch {}
        return { status: res.status, data };
      },
    };
  };
  const rec = (step, res, pick = () => undefined) => {
    let picked;
    try { picked = pick(res.data); } catch (e) { picked = `pick failed: ${e.message}`; }
    transcript.push({ step, status: res.status, data: picked });
    return res;
  };
  const expect = (step, cond, info = "") => { if (!cond) failures.push(`${step}${info ? `: ${info}` : ""}`); };
  const msg = (d) => d?.message;
  const reg = async (c, step, body) => {
    const r = rec(step, await c.call("POST", "/auth/register", body), (d) => ({ role: d?.user?.role }));
    expect(step, r.status === 201, JSON.stringify(r.data));
    c.setToken(r.data?.token);
    return r.data?.user;
  };

  const V = client(), SUP = client(), BUY = client(), AFF = client(), ADM = client();
  const adm = await ADM.call("POST", "/auth/login", { identity: adminEmail, email: adminEmail, password: adminPassword });
  ADM.setToken(adm.data?.token);
  const vendor = await reg(V, "register vendor", { Fullname: "Vendor Gamma", email: "gamma@e2e.test", password: "Passw0rd!x", gender: "female", phone: "0788400001", role: "vendor", companyName: "Gamma Co" });
  await reg(SUP, "register supplier", { Fullname: "Supplier Delta", email: "delta@e2e.test", password: "Passw0rd!x", gender: "male", phone: "0788400002", role: "supplier", companyName: "Delta Supply" });
  const buyer = await reg(BUY, "register buyer", { Fullname: "Buyer Three", email: "buyer3@e2e.test", password: "Passw0rd!x", gender: "other", phone: "0788400009", role: "buyer" });
  await reg(AFF, "register affiliate", { Fullname: "Affiliate Echo", email: "echo@e2e.test", password: "Passw0rd!x", gender: "other", phone: "0788400003", role: "affiliate" });

  // ── Vendor profile, store, catalog ───────────────────────────────────────
  const st = rec("create store", await V.call("POST", "/stores", { storeName: "Gamma Store", contactEmail: "g@e2e.test", contactPhone: "0788400001" }), (d) => ({ isPrimary: d?.store?.isPrimary }));
  const st2 = rec("create second store", await V.call("POST", "/stores", { storeName: "Gamma Outlet", contactEmail: "g@e2e.test", contactPhone: "0788400001" }), (d) => ({ isPrimary: d?.store?.isPrimary }));
  rec("vendor profile", await V.call("GET", "/vendors/me/profile"), (d) => ({ name: d?.vendor?.businessName, status: d?.vendor?.status }));
  rec("vendor profile update", await V.call("PATCH", "/vendors/me/profile", { description: "We sell lamps" }), (d) => ({ description: d?.vendor?.description }));
  rec("public vendors", await BUY.call("GET", "/vendors"), (d) => ({ n: (d?.vendors || d?.data || []).length }));
  rec("set second store primary", await V.call("PATCH", `/stores/mine/${st2.data?.store?._id}/primary`), (d) => ({ isPrimary: d?.store?.isPrimary }));
  rec("delete old primary blocked? (now non-primary, allowed)", await V.call("DELETE", `/stores/mine/${st.data?.store?._id}`), msg);
  const cat = await V.call("POST", "/categories", { name: "Lighting" });
  const catId = cat.data?.category?.id;
  const mk = async (name, price, stock) => (await V.call("POST", "/products", { name, description: "d", price, stockQuantity: stock, categoryId: catId, mainImage: "http://x/y.jpg", status: "ACTIVE" })).data?.product;
  const lamp = await mk("Desk Lamp", 20000, 10);
  const bulb = await mk("LED Bulb", 2000, 50);
  const temp = await mk("Temp Item", 1000, 1);
  rec("delete product", await V.call("DELETE", `/products/${temp?.id}`), msg);
  rec("admin rename category", await ADM.call("PATCH", `/categories/${catId}`, { name: "Lighting & Lamps" }), (d) => ({ name: d?.category?.name, slug: d?.category?.slug }));

  // ── Addresses + cart edits ───────────────────────────────────────────────
  const a1 = rec("add address", await BUY.call("POST", "/auth/addresses", { country: "Rwanda", provinceState: "Kigali City", cityDistrict: "Gasabo", street: "KG 2", phone: "0788400009", isDefaultShipping: true }), (d) => ({ n: (d?.addresses || []).length }));
  const addrId = (a1.data?.addresses || [])[0]?._id;
  rec("list addresses", await BUY.call("GET", "/auth/addresses"), (d) => (d?.addresses || []).map((a) => [a.cityDistrict, a.isDefaultShipping]));
  rec("update address", await BUY.call("PUT", `/auth/addresses/${addrId}`, { street: "KG 3" }), (d) => (d?.addresses || []).map((a) => a.street));
  rec("delete address", await BUY.call("DELETE", `/auth/addresses/${addrId}`), (d) => ({ n: (d?.addresses || []).length }));
  await BUY.call("POST", "/cart", { productId: bulb?.id, quantity: 2 });
  rec("cart update qty", await BUY.call("PUT", `/cart/items/${bulb?.id}`, { quantity: 4 }), (d) => ({ qty: (d?.cart?.items || d?.items || [])[0]?.quantity, total: d?.cart?.totalAmount ?? d?.totalAmount }));
  rec("cart remove item", await BUY.call("DELETE", `/cart/items/${bulb?.id}`), (d) => ({ n: (d?.cart?.items || d?.items || []).length }));
  await BUY.call("POST", "/cart", { productId: bulb?.id, quantity: 1 });
  rec("cart clear", await BUY.call("DELETE", "/cart"), (d) => ({ n: (d?.cart?.items || d?.items || []).length }));

  // ── Orders: pay, cancel, deliver with OTP, dispute ───────────────────────
  const addr = { street: "KN 5", city: "Nyarugenge", state: "Kigali City", province: "Kigali City", district: "Nyarugenge", country: "Rwanda" };
  const order = async (step, items) => rec(step, await BUY.call("POST", "/orders/direct-checkout", { items, shippingAddress: addr, paymentMethod: "MOMO" }), (d) => ({ total: d?.order?.totalAmount, fee: d?.order?.shippingFee })).data?.order;
  const pay = async (step, o, tx) => rec(step, await BUY.call("POST", "/webhooks/momo", { status: "SUCCESSFUL", externalId: o?.id, financialTransactionId: tx, amount: o?.totalAmount, fee: 100 }), (d) => ({ status: d?.result?.status }));
  const o1 = await order("order to cancel", [{ productId: lamp?.id, qty: 1 }]);
  await pay("pay order to cancel", o1, "E2E2-TX-1");
  rec("buyer cancels paid order", await BUY.call("POST", `/orders/${o1?.id}/cancel`), (d) => ({ status: d?.order?.orderStatus, msg: d?.message }));
  rec("stock restored after cancel", await V.call("GET", "/products/vendor/me"), (d) => ({ lamp: d?.products?.find((p) => p.name === "Desk Lamp")?.stockQuantity }));
  const o2 = await order("order to deliver", [{ productId: lamp?.id, qty: 2 }]);
  await pay("pay order to deliver", o2, "E2E2-TX-2");
  const seen = await BUY.call("GET", `/orders/${o2?.id}`);
  rec("wrong OTP", await ADM.call("PATCH", `/orders/${o2?.id}/deliver`, { deliveryOtp: "000000" }), msg);
  rec("deliver with OTP", await ADM.call("PATCH", `/orders/${o2?.id}/deliver`, { deliveryOtp: seen.data?.order?.deliveryOtp }), (d) => ({ status: d?.order?.orderStatus, delivered: d?.order?.isDelivered }));
  rec("vendor balance after delivery", await V.call("GET", "/payouts/balance"), (d) => ({ available: d?.balance?.availableBalance, pending: d?.balance?.pendingBalance }));
  const o3 = await order("order to dispute", [{ productId: bulb?.id, qty: 3 }]);
  await pay("pay order to dispute", o3, "E2E2-TX-3");
  const dsp = rec("open dispute", await BUY.call("POST", "/disputes", { orderId: o3?.id, reason: "DAMAGED_GOODS", description: "Broken on arrival", disputedAmount: 6000 }), (d) => ({ status: (d?.dispute || d?.data)?.status, success: d?.success }));
  const disputeId = (dsp.data?.dispute || dsp.data?.data)?._id;
  rec("dispute evidence", await BUY.call("POST", `/disputes/${disputeId}/evidence`, { message: "Photo attached", attachments: [{ fileUrl: "http://x/p.jpg", fileType: "image" }] }), (d) => ({ success: d?.success }));
  rec("my disputes", await BUY.call("GET", "/disputes/mine"), (d) => ({ n: (d?.disputes || d?.data || []).length }));
  rec("admin arbitrates", await ADM.call("POST", `/disputes/${disputeId}/arbitrate`, { decision: "REFUND_BUYER", buyerRefundAmount: 6000, vendorReleaseAmount: 0, notes: "Refund" }), (d) => ({ success: d?.success, status: (d?.dispute || d?.data)?.status }));
  rec("admin disputes", await ADM.call("GET", "/disputes"), (d) => ({ n: (d?.disputes || d?.data || []).length }));
  rec("admin ledger", await ADM.call("GET", "/admin/ledger"), (d) => ({ n: (d?.entries || d?.data || d?.ledger || []).length }));

  // ── Wholesale ────────────────────────────────────────────────────────────
  const sup = rec("supplier onboard", await SUP.call("POST", "/suppliers/onboard", { businessName: "Delta Supply", phone: "0788400002", email: "delta@e2e.test" }), (d) => ({ status: (d?.supplier || d?.data)?.verificationStatus }));
  const supplierId = (sup.data?.supplier || sup.data?.data)?._id;
  rec("admin verifies supplier", await ADM.call("PATCH", `/admin/suppliers/${supplierId}/verify`, { decision: "VERIFIED" }), (d) => ({ status: d?.supplier?.verificationStatus }));
  const wp = rec("wholesale product", await SUP.call("POST", "/suppliers/me/products", { name: "Bulk Bulbs", wholesalePrice: 1000, moq: 5, stockQuantity: 50 }), (d) => ({ status: d?.product?.status, moq: d?.product?.moq }));
  rec("supplier products", await SUP.call("GET", "/suppliers/me/products"), (d) => ({ n: (d?.products || d?.data || []).length }));
  rec("public suppliers", await V.call("GET", "/suppliers"), (d) => ({ n: (d?.data || d?.suppliers || []).length }));
  rec("MOQ breach", await V.call("POST", "/wholesale/orders", { supplierId, items: [{ productId: wp.data?.product?._id, quantity: 2 }] }), msg);
  const wo = rec("wholesale order", await V.call("POST", "/wholesale/orders", { supplierId, items: [{ productId: wp.data?.product?._id, quantity: 10 }] }), (d) => ({ total: (d?.data || d?.order)?.totalAmount, status: (d?.data || d?.order)?.status }));
  const woId = (wo.data?.data || wo.data?.order)?._id;
  rec("hold escrow", await V.call("POST", `/wholesale/orders/${woId}/hold-escrow`), (d) => ({ success: d?.success, status: d?.data?.status }));
  rec("supplier ships", await SUP.call("POST", `/wholesale/orders/${woId}/ship`), (d) => ({ status: d?.data?.status }));
  rec("confirm with wrong OTP", await V.call("POST", `/wholesale/orders/${woId}/confirm-receipt`, { otp: "000000" }), msg);
  rec("wholesale orders (supplier)", await SUP.call("GET", "/wholesale/orders/mine"), (d) => (d?.data || d?.orders || []).map((o) => o.status));

  // ── Affiliates ───────────────────────────────────────────────────────────
  rec("affiliate profile", await AFF.call("GET", "/affiliates/profile"), (d) => ({ ok: !!d }));
  rec("affiliate profile update", await AFF.call("PATCH", "/affiliates/profile", { displayName: "Echo Deals", bio: "Best lamps" }), (d) => ({ ok: !!d }));
  const link = rec("affiliate link", await AFF.call("POST", "/affiliates/links", { productId: lamp?.id, label: "Lamp promo" }), (d) => ({ ok: !!(d?.link || d?.data) }));
  const code = (link.data?.link || link.data?.data)?.affiliateCode || (link.data?.link || link.data?.data)?.code;
  if (code) {
    rec("track click 1", await BUY.call("GET", `/affiliates/track/${code}`), (d) => ({ ok: true }));
    rec("track click 2", await BUY.call("GET", `/affiliates/track/${code}`), (d) => ({ ok: true }));
  }
  rec("affiliate links (aggregates)", await AFF.call("GET", "/affiliates/links"), (d) => (d?.links || d?.data || []).map((l) => [l.clicks ?? l.clickCount, l.conversions ?? l.conversionCount ?? 0]));
  rec("affiliate stats", await AFF.call("GET", "/affiliates/stats"), (d) => ({ ok: !!d }));
  rec("affiliate overview", await AFF.call("GET", "/affiliates/overview"), (d) => ({ ok: !!d }));
  rec("affiliate dashboard", await AFF.call("GET", "/affiliates/me/dashboard"), (d) => ({ ok: !!d }));
  rec("affiliate wallet", await AFF.call("GET", "/affiliates/wallet"), (d) => ({ ok: !!d }));
  rec("admin affiliates", await ADM.call("GET", "/affiliates"), (d) => ({ n: (d?.affiliates || d?.data || []).length }));

  // ── Abuse reports, commissions, monetization ─────────────────────────────
  const ar = rec("abuse report", await BUY.call("POST", "/abuse-reports", { targetUserId: vendor?.id || vendor?._id, reasonCategory: "FRAUDULENT_ACTIVITY", description: "Suspicious" }), (d) => ({ status: (d?.report || d?.data)?.status }));
  const reportId = (ar.data?.report || ar.data?.data)?._id || (ar.data?.report || ar.data?.data)?.id;
  rec("admin abuse list", await ADM.call("GET", "/abuse-reports"), (d) => ({ n: (d?.reports || d?.data || []).length }));
  rec("admin abuse resolve", await ADM.call("PATCH", `/abuse-reports/${reportId}`, { status: "RESOLVED", adminNotes: "ok" }), (d) => ({ status: (d?.report || d?.data)?.status }));
  const rule = rec("commission rule", await ADM.call("POST", "/admin/commissions", { name: "Global 7%", ruleType: "GLOBAL", rateType: "PERCENTAGE", rateValue: 7 }), (d) => ({ rate: d?.rule?.rateValue, active: d?.rule?.isActive }));
  rec("commission toggle", await ADM.call("PATCH", `/admin/commissions/${rule.data?.rule?._id}/toggle`), (d) => ({ active: d?.rule?.isActive }));
  rec("commission list", await ADM.call("GET", "/admin/commissions"), (d) => ({ count: d?.count }));
  rec("vendor premium", await V.call("POST", "/vendor/subscription", { plan: "PREMIUM" }), (d) => ({ plan: d?.subscription?.planKey, tiers: d?.tiers?.map((t) => t.status) }));
  const ad = rec("vendor ad", await V.call("POST", "/vendor/advertisements", { product: "Desk Lamp", productId: lamp?.id, placement: "FEATURED", budget: 5000 }), (d) => ({ status: d?.advertisement?.status }));
  rec("admin subscriptions", await ADM.call("GET", "/admin/subscriptions"), (d) => ({ n: (d?.data || d?.subscriptions || []).length }));
  rec("admin ads", await ADM.call("GET", "/admin/advertisements"), (d) => ({ n: (d?.data || d?.advertisements || []).length }));
  rec("admin approves ad", await ADM.call("PATCH", `/admin/advertisements/${ad.data?.advertisement?.id}/status`, { status: "ACTIVE" }), (d) => ({ status: d?.advertisement?.status }));
  rec("buyer subscription", await BUY.call("POST", "/buyer/subscription", { plan: "PREMIUM" }), (d) => ({ plan: d?.subscription?.planKey }));

  // ── Admin: become seller, vendors, users; search; reports ────────────────
  rec("admin become seller", await ADM.call("POST", "/vendors/become-seller", { businessName: "MVEC Official", phone: "0788400099", email: "official@e2e.test" }), (d) => ({ enabled: d?.isSellerEnabled, msg: !!d?.message }));
  rec("admin vendors", await ADM.call("GET", "/admin/vendors"), (d) => ({ n: (d?.data || d?.vendors || []).length }));
  rec("admin users", await ADM.call("GET", "/users"), (d) => ({ n: (d?.users || d?.data || []).length }));
  rec("admin suspend user", await ADM.call("PATCH", `/users/${buyer?.id || buyer?._id}`, { status: "SUSPEND" }), (d) => ({ status: (d?.user || d?.data)?.status }));
  rec("vendor customers", await V.call("GET", "/users/vendor/customers"), (d) => ({ n: (d?.customers || d?.data || []).length }));
  rec("search", await V.call("GET", "/search?q=lamp"), (d) => ({ ok: !!d }));
  rec("search suggestions", await V.call("GET", "/search/suggestions?q=desk"), (d) => ({ products: (d?.suggestions?.products || []).map((p) => p.name) }));
  rec("search home", await V.call("GET", "/search/home"), (d) => ({ ok: !!d }));
  rec("vendor report summary", await V.call("GET", "/reports/summary"), (d) => ({ orders: d?.metrics?.orders, lowStock: d?.metrics?.lowStockProducts }));
  rec("admin overview", await ADM.call("GET", "/admin/overview"), (d) => ({ keys: Object.keys(d || {}).sort() }));
  rec("admin products", await ADM.call("GET", "/admin/products"), (d) => ({ n: (d?.products || d?.data || []).length }));
  rec("languages", await BUY.call("GET", "/languages"), (d) => ({ ok: !!d }));

  return { transcript, failures };
}
