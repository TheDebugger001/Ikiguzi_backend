// End-to-end API flows. Each step records its HTTP status and the fields that
// matter, so a MongoDB run and a MySQL run can be compared line by line
// (tests/e2e/run-both.mjs). Generated values (ids, codes, timestamps) are left out.

export async function runFlows(base, { adminEmail, adminPassword }) {
  const transcript = [];
  const failures = [];

  const client = () => {
    let token = "";
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { status: res.status, data };
    };
    return { call, setToken: (t) => { token = t; } };
  };
  const rec = (step, res, pick = () => undefined) => {
    let picked;
    try { picked = pick(res.data); } catch (e) { picked = `pick failed: ${e.message}`; }
    transcript.push({ step, status: res.status, data: picked });
    return res;
  };
  const expect = (step, cond, info = "") => { if (!cond) failures.push(`${step}${info ? `: ${info}` : ""}`); };
  const msg = (d) => d?.message;

  const A = client(), B = client(), BUY = client(), ADM = client(), BUY2 = client();
  const reg = async (c, step, body) => {
    const r = rec(step, await c.call("POST", "/auth/register", body), (d) => ({ role: d?.user?.role, hasToken: !!d?.token }));
    expect(step, r.status === 201, JSON.stringify(r.data));
    c.setToken(r.data?.token);
    return r.data?.user;
  };

  // ── Auth ───────────────────────────────────────────────────────────────
  const vendorA = await reg(A, "register vendor A", { Fullname: "Vendor Alpha", email: "alpha@e2e.test", password: "Passw0rd!x", gender: "female", phone: "0788300001", role: "vendor", companyName: "Alpha Co" });
  await reg(B, "register vendor B", { Fullname: "Vendor Beta", email: "beta@e2e.test", password: "Passw0rd!x", gender: "male", phone: "0788300002", role: "vendor", companyName: "Beta Co" });
  const buyer = await reg(BUY, "register buyer", { Fullname: "Buyer One", email: "buyer1@e2e.test", password: "Passw0rd!x", gender: "other", phone: "0788300009", role: "buyer" });
  await reg(BUY2, "register buyer 2", { Fullname: "Buyer Two", email: "buyer2@e2e.test", password: "Passw0rd!x", gender: "other", phone: "0788300008", role: "buyer" });
  rec("duplicate email -> error", await A.call("POST", "/auth/register", { Fullname: "Dup", email: "alpha@e2e.test", password: "Passw0rd!x", gender: "female", phone: "0788300003", role: "buyer" }), msg);
  const login = rec("login", await BUY.call("POST", "/auth/login", { identity: "buyer1@e2e.test", email: "buyer1@e2e.test", password: "Passw0rd!x" }), (d) => ({ role: d?.user?.role, name: d?.user?.fullName || d?.user?.Fullname }));
  expect("login", login.status === 200, JSON.stringify(login.data));
  rec("wrong password", await BUY.call("POST", "/auth/login", { identity: "buyer1@e2e.test", email: "buyer1@e2e.test", password: "nope" }), msg);
  rec("me", await A.call("GET", "/auth/me"), (d) => ({ role: (d?.user || d)?.role, email: (d?.user || d)?.email }));
  const adm = await ADM.call("POST", "/auth/login", { identity: adminEmail, email: adminEmail, password: adminPassword });
  rec("admin login", adm, (d) => ({ role: d?.user?.role }));
  ADM.setToken(adm.data?.token);

  // ── Stores (multi-store) ─────────────────────────────────────────────────
  rec("no store yet", await A.call("GET", "/stores/mine"), (d) => ({ stores: d?.stores?.length }));
  const s1 = rec("create store 1", await A.call("POST", "/stores", { storeName: "Alpha Main", contactEmail: "a@e2e.test", contactPhone: "0788300001", city: "Kigali" }), (d) => ({ isPrimary: d?.store?.isPrimary, city: d?.store?.address?.city }));
  const s2 = rec("create store 2", await A.call("POST", "/stores", { storeName: "Alpha Branch", contactEmail: "a@e2e.test", contactPhone: "0788300001", city: "Musanze" }), (d) => ({ isPrimary: d?.store?.isPrimary }));
  rec("duplicate store name", await A.call("POST", "/stores", { storeName: "Alpha Branch", contactEmail: "a@e2e.test", contactPhone: "0788300001" }), msg);
  await B.call("POST", "/stores", { storeName: "Beta Shop", contactEmail: "b@e2e.test", contactPhone: "0788300002" });
  const store1 = s1.data?.store?._id, store2 = s2.data?.store?._id;
  rec("update store 2", await A.call("PUT", `/stores/mine/${store2}`, { description: "Branch", city: "Huye" }), (d) => ({ city: d?.store?.address?.city, description: d?.store?.description }));
  rec("list stores", await A.call("GET", "/stores/mine"), (d) => ({ n: d?.stores?.length, primary: d?.store?.storeName, names: d?.stores?.map((s) => s.storeName) }));

  // ── Categories ───────────────────────────────────────────────────────────
  const phones = rec("create category", await A.call("POST", "/categories", { name: "Phones" }), (d) => ({ name: d?.category?.name, slug: d?.category?.slug }));
  const catId = phones.data?.category?.id || phones.data?.category?._id;
  rec("create subcategory", await A.call("POST", "/categories", { name: "Accessories", parentId: catId }), (d) => ({ slug: d?.category?.slug }));
  rec("duplicate category", await A.call("POST", "/categories", { name: "phones" }), (d) => ({ alreadyExisted: d?.alreadyExisted }));

  // ── Products ─────────────────────────────────────────────────────────────
  const base0 = { description: "desc", categoryId: catId, mainImage: "http://x/y.jpg", status: "ACTIVE" };
  const p1r = rec("create product (15% off)", await A.call("POST", "/products", { ...base0, name: "Phone X", price: 50000, stockQuantity: 10, discountType: "PERCENT", discountValue: 15, color: "Black" }),
    (d) => ({ price: d?.product?.price, discountPrice: d?.product?.discountPrice, color: d?.product?.attributes?.color, status: d?.product?.status }));
  const p1 = p1r.data?.product;
  const p2 = rec("create product in store 2", await A.call("POST", "/products", { ...base0, name: "Case", price: 5000, stockQuantity: 3, storeId: store2 }), (d) => ({ store: d?.product?.store === store2 })).data?.product;
  const pB = (await B.call("POST", "/products", { ...base0, name: "Beta Lamp", price: 8000, stockQuantity: 5 })).data?.product;
  rec("invalid discount", await A.call("PUT", `/products/${p1?.id}`, { discountType: "PERCENT", discountValue: 120 }), msg);
  rec("update price keeps 15%", await A.call("PUT", `/products/${p1?.id}`, { price: 40000 }), (d) => ({ price: d?.product?.price, discountPrice: d?.product?.discountPrice }));
  rec("get product by publicId", await BUY.call("GET", `/products/${p1?.publicId}`), (d) => ({ name: d?.product?.name, vendor: !!d?.product?.vendor }));
  rec("vendor product list", await A.call("GET", "/products/vendor/me"), (d) => ({ count: d?.count, names: d?.products?.map((p) => p.name).sort(), category: d?.products?.[0]?.category?.name }));
  rec("filter by store", await A.call("GET", `/products/vendor/me?store=${store2}`), (d) => ({ count: d?.count }));
  rec("public listing", await BUY.call("GET", "/products"), (d) => ({ n: (d?.products || d?.data || []).length }));
  rec("categories withCounts", await BUY.call("GET", "/categories?withCounts=true"), (d) => d?.categories?.map((c) => [c.name, c.productCount]).sort());

  // ── Inventory ────────────────────────────────────────────────────────────
  rec("restock +5", await A.call("PATCH", `/products/${p1?.id}/stock`, { mode: "add", quantity: 5, reason: "Restock" }), (d) => ({ after: d?.movement?.after, before: d?.movement?.before }));
  rec("remove too many", await A.call("PATCH", `/products/${p1?.id}/stock`, { mode: "remove", quantity: 999 }), msg);
  await Promise.all(Array.from({ length: 8 }, () => A.call("PATCH", `/products/${p2?.id}/stock`, { mode: "add", quantity: 1 })));
  rec("parallel restocks counted", await A.call("GET", "/products/vendor/me"), (d) => ({ case: d?.products?.find((p) => p.name === "Case")?.stockQuantity }));
  rec("move to store 1", await A.call("POST", "/products/vendor/move-store", { productIds: [p2?.id], storeId: store1 }), (d) => ({ moved: d?.moved }));
  rec("stock history", await A.call("GET", "/products/vendor/stock-movements"), (d) => ({ n: d?.movements?.length, types: [...new Set(d?.movements?.map((m) => m.type))].sort() }));

  // ── Shipping ─────────────────────────────────────────────────────────────
  rec("zone Kigali", await A.call("POST", "/shipping/zones", { name: "Kigali", provinces: ["Kigali City"], fee: 1500, methods: ["STANDARD", "EXPRESS"], expressFee: 3000, freeOverAmount: 100000, storeId: store1 }), (d) => ({ coverage: d?.zone?.coverage }));
  rec("zone Gasabo", await A.call("POST", "/shipping/zones", { name: "Gasabo", districts: ["Gasabo"], fee: 800, storeId: store1 }), (d) => ({ coverage: d?.zone?.coverage }));
  rec("zones list", await A.call("GET", "/shipping/zones/mine"), (d) => d?.data?.map((z) => [z.name, z.fee]).sort());
  rec("preview Gasabo", await A.call("POST", "/shipping/preview", { province: "Kigali City", district: "Gasabo", subtotal: 20000, storeId: store1 }), (d) => ({ fee: d?.fee, zone: d?.zoneName }));
  rec("preview Huye (not covered)", await A.call("POST", "/shipping/preview", { province: "Southern Province", district: "Huye", storeId: store1 }), (d) => ({ deliverable: d?.deliverable }));
  rec("quote multi-seller", await BUY.call("POST", "/shipping/quote", { address: { province: "Kigali City", district: "Kicukiro" }, method: "EXPRESS", items: [{ productId: p1?.id, qty: 1 }, { productId: pB?.id, qty: 1 }] }),
    (d) => ({ deliverable: d?.deliverable, fee: d?.shippingFee, subtotal: d?.subtotal, groups: d?.groups?.map((g) => [g.storeName, g.fee, g.method]).sort() }));

  // ── Cart + checkout ──────────────────────────────────────────────────────
  rec("add to cart", await BUY.call("POST", "/cart", { productId: p1?.id, quantity: 1 }), (d) => ({ items: (d?.cart?.items || d?.items || []).length }));
  rec("add again", await BUY.call("POST", "/cart", { productId: p1?.id, quantity: 1 }), (d) => ({ qty: (d?.cart?.items || d?.items || [])[0]?.quantity }));
  rec("get cart", await BUY.call("GET", "/cart"), (d) => ({ n: (d?.cart?.items || d?.items || []).length, total: d?.cart?.totalAmount ?? d?.totalAmount, productName: (d?.cart?.items || d?.items || [])[0]?.product?.name }));
  rec("own product to cart blocked", await A.call("POST", "/cart", { productId: p1?.id, quantity: 1 }), msg);
  const addr = { street: "KG 1", city: "Gasabo", state: "Kigali City", province: "Kigali City", district: "Gasabo", sector: "Remera", country: "Rwanda" };
  const cartOrder = rec("cart checkout", await BUY.call("POST", "/orders/checkout", { shippingAddress: addr, paymentMethod: "MOMO", shippingMethod: "STANDARD" }),
    (d) => ({ subtotal: d?.order?.subtotal, fee: d?.order?.shippingFee, total: d?.order?.totalAmount, items: d?.order?.items?.length, hasId: !!d?.order?.id }));
  rec("cart emptied", await BUY.call("GET", "/cart"), (d) => ({ n: (d?.cart?.items || d?.items || []).length }));
  rec("undeliverable checkout", await BUY.call("POST", "/orders/direct-checkout", { items: [{ productId: p1?.id, qty: 1 }], shippingAddress: { ...addr, province: "Southern Province", district: "Huye", city: "Huye" }, shippingMethod: "STANDARD" }), msg);
  const direct = rec("direct checkout 2 sellers", await BUY.call("POST", "/orders/direct-checkout", { items: [{ productId: p1?.id, qty: 1 }, { productId: pB?.id, qty: 2 }], shippingAddress: addr, paymentMethod: "MOMO", shippingMethod: "EXPRESS" }),
    (d) => ({ subtotal: d?.order?.subtotal, fee: d?.order?.shippingFee, total: d?.order?.totalAmount, parcels: d?.order?.shippingBreakdown?.map((p) => [p.storeName, p.fee]).sort() }));
  const order1 = direct.data?.order;
  rec("my orders", await BUY.call("GET", "/orders/my-orders"), (d) => ({ n: d?.orders?.length, totals: d?.orders?.map((o) => o.totalAmount) }));
  rec("vendor A orders", await A.call("GET", "/orders/vendor/orders"), (d) => d?.orders?.map((o) => [o.vendorSubtotal, o.vendorShippingFee, o.items.length]));
  rec("buyer opens order", await BUY.call("GET", `/orders/${order1?.id}`), (d) => ({ items: d?.order?.items?.length, buyer: d?.order?.user?.Fullname }));
  rec("other buyer blocked", await BUY2.call("GET", `/orders/${order1?.id}`), msg);

  // ── Payment (MoMo webhook, dev mode) → escrow ────────────────────────────
  rec("momo webhook", await BUY.call("POST", "/webhooks/momo", { status: "SUCCESSFUL", externalId: order1?.id, financialTransactionId: "E2E-TX-1", amount: order1?.totalAmount, fee: 0 }), (d) => ({ status: d?.result?.status }));
  rec("momo webhook replay", await BUY.call("POST", "/webhooks/momo", { status: "SUCCESSFUL", externalId: order1?.id, financialTransactionId: "E2E-TX-1", amount: order1?.totalAmount, fee: 0 }), (d) => ({ status: d?.result?.status }));
  rec("order paid", await BUY.call("GET", `/orders/${order1?.id}`), (d) => ({ payment: d?.order?.paymentStatus, status: d?.order?.orderStatus }));

  // ── Vendor fulfilment + payouts ──────────────────────────────────────────
  for (const s of ["SHIPPED", "DELIVERED"]) rec(`vendor A -> ${s}`, await A.call("PATCH", "/orders/vendor/status", { orderId: order1?.id, status: s }), (d) => ({ status: d?.order?.orderStatus }));
  rec("vendor A balance", await A.call("GET", "/payouts/balance"), (d) => ({ available: d?.balance?.availableBalance, rate: d?.commissionRate }));
  rec("payout request", await A.call("POST", "/payouts/request", { amount: 1000, payoutDetails: { accountName: "Alpha", accountNumber: "0788300001" } }), (d) => ({ msg: !!d?.message, status: d?.payout?.status }));
  rec("payout history", await A.call("GET", "/payouts/history"), (d) => ({ n: d?.payouts?.length, bank: d?.payouts?.[0]?.payoutDetails?.bankName }));

  // ── Manual orders ────────────────────────────────────────────────────────
  rec("manual guest COD", await A.call("POST", "/orders/vendor/manual", { customer: { name: "Walk In", phone: "0788999111" }, items: [{ productId: p1?.id, qty: 1 }], shippingAddress: { province: "Kigali City", district: "Kicukiro", street: "KK 1" }, payment: "COD" }),
    (d) => ({ total: d?.order?.totalAmount, fee: d?.order?.shippingFee, user: d?.order?.user ?? null, source: d?.order?.source }));
  rec("manual link for account", await A.call("POST", "/orders/vendor/manual", { customer: { name: "Linked", phone: "+250 788 300 009" }, items: [{ productId: p1?.id, qty: 1 }], shippingMethod: "PICKUP", payment: "LINK" }), (d) => ({ linked: d?.linkedAccount, link: !!d?.paymentLink }));
  rec("manual oversell", await A.call("POST", "/orders/vendor/manual", { customer: { name: "Y", phone: "0788999555" }, items: [{ productId: p2?.id, qty: 999 }], shippingMethod: "PICKUP", payment: "COD" }), msg);
  rec("vendor orders sources", await A.call("GET", "/orders/vendor/orders"), (d) => d?.orders?.map((o) => o.source).sort());

  // ── Promotions, staff, reviews ───────────────────────────────────────────
  const promo = rec("promotion create", await A.call("POST", "/promotions", { name: "Launch", code: "launch10", type: "PERCENT", value: 10, storeId: store2 }), (d) => ({ code: d?.promotion?.code, discount: d?.promotion?.discount }));
  rec("promotion update by publicId", await A.call("PATCH", `/promotions/${promo.data?.promotion?.id}`, { status: "ACTIVE" }), (d) => ({ status: d?.promotion?.status }));
  rec("promotion list", await A.call("GET", "/promotions"), (d) => d?.data?.map((p) => [p.code, p.status]));
  const staff = rec("staff add", await A.call("POST", "/staff", { name: "Staffer", email: "staff@e2e.test", password: "Passw0rd!x", role: "ORDER_MANAGER" }), (d) => ({ role: d?.staff?.role, perms: d?.staff?.permissions }));
  rec("staff role change", await A.call("PUT", `/staff/${staff.data?.staff?._id}`, { role: "STORE_MANAGER" }), (d) => ({ role: d?.staff?.role }));
  rec("staff list", await A.call("GET", "/staff"), (d) => d?.staff?.map((s) => s.role));
  rec("review create", await BUY.call("POST", "/reviews", { product: p1?.id, productId: p1?.id, rating: 5, reviewText: "Great" }), (d) => ({ rating: d?.review?.rating, msg: d?.message }));
  rec("vendor reviews", await A.call("GET", "/reviews/vendor/mine"), (d) => d?.data?.map((r) => [r.rating, r.comment]));

  // ── Messaging + notifications + support ──────────────────────────────────
  const conv = rec("start conversation", await BUY.call("POST", "/conversations", { recipientId: vendorA?.id || vendorA?._id }), (d) => ({ participants: (d?.conversation || d)?.participants?.length }));
  const convId = (conv.data?.conversation || conv.data)?._id;
  rec("send message", await BUY.call("POST", `/conversations/${convId}/messages`, { content: "Hello seller" }), (d) => ({ content: (d?.message || d)?.content }));
  rec("vendor conversations (unread)", await A.call("GET", "/conversations"), (d) => (d?.conversations || d || []).map?.((c) => [c.unreadCount ?? c.unread, c.lastMessage]));
  rec("read conversation", await A.call("PATCH", `/conversations/${convId}/read`), (d) => ({ ok: true }));
  rec("messages", await A.call("GET", `/conversations/${convId}/messages`), (d) => (d?.messages || d || []).map?.((m) => m.content));
  rec("notifications", await A.call("GET", "/notifications/mine"), (d) => ({ hasList: Array.isArray(d?.notifications || d?.data) }));
  rec("support case", await BUY.call("POST", "/support/cases", { subject: "Help", description: "Need help", category: "ORDER" }), (d) => ({ status: (d?.case || d?.supportCase || d)?.status }));
  rec("support list", await BUY.call("GET", "/support/cases"), (d) => ({ n: (d?.cases || d?.data || d || []).length }));

  // ── Admin ────────────────────────────────────────────────────────────────
  rec("admin overview", await ADM.call("GET", "/admin/overview"), (d) => ({ ok: !!d }));
  rec("admin orders", await ADM.call("GET", "/orders"), (d) => ({ n: (d?.orders || d?.data || []).length }));
  rec("admin user search", await ADM.call("GET", "/users/search?q=alpha"), (d) => ({ users: (d?.users || d?.results?.users || []).length }));
  rec("non-admin blocked", await A.call("GET", "/orders"), msg);

  return { transcript, failures };
}
