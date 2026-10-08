const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const Supplier = require("../src/models/Supplier");
const WholesaleOrder = require("../src/models/WholesaleOrder");
const WholesaleProduct = require("../src/models/WholesaleProduct");
const service = require("../src/services/wholesale.service");

const originals = {
  supplierFindOne: Supplier.findOne,
  productFindOne: WholesaleProduct.findOne,
  orderCreate: WholesaleOrder.create,
  orderFindOne: WholesaleOrder.findOne,
};

afterEach(() => {
  Supplier.findOne = originals.supplierFindOne;
  WholesaleProduct.findOne = originals.productFindOne;
  WholesaleOrder.create = originals.orderCreate;
  WholesaleOrder.findOne = originals.orderFindOne;
});

test("wholesale orders use supplier catalog price and enforce MOQ/stock", async () => {
  const supplierId = "65a1b2c3d4e5f67890123456";
  const vendorId = "65b1b2c3d4e5f67890123456";
  const productId = "65c1b2c3d4e5f67890123456";
  Supplier.findOne = async () => ({ _id: supplierId, user: vendorId });
  WholesaleProduct.findOne = async () => ({
    _id: productId,
    name: "Coffee",
    wholesalePrice: 100,
    bulkDiscount: 10,
    moq: 5,
    stockQuantity: 20,
  });
  WholesaleOrder.create = async (order) => order;

  const order = await service.createWholesaleOrder({
    vendorId,
    supplierId,
    items: [
      {
        productId,
        quantity: 5,
        unitPrice: 0.01,
        moq: 1,
        productName: "Forged name",
      },
    ],
  });

  assert.equal(order.items[0].productName, "Coffee");
  assert.equal(order.items[0].unitPrice, 90);
  assert.equal(order.items[0].moq, 5);
  assert.equal(order.totalAmount, 450);
});

test("supplier shipment updates are owner-scoped and only allow escrowed orders", async () => {
  const supplierUserId = "65b1b2c3d4e5f67890123456";
  let query;
  const order = {
    status: "ESCROW_HELD",
    save: async () => {},
  };
  WholesaleOrder.findOne = async (filter) => {
    query = filter;
    return order;
  };

  const updated = await service.markWholesaleOrderShipped(
    "65c1b2c3d4e5f67890123456",
    supplierUserId,
  );

  assert.deepEqual(query, {
    _id: "65c1b2c3d4e5f67890123456",
    supplier: supplierUserId,
  });
  assert.equal(updated.status, "SHIPPED");
  assert.ok(updated.shippedAt instanceof Date);
});
