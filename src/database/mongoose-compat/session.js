// Mongoose ClientSession over Sequelize transactions.
// Queries that run inside an active session join its transaction even when
// the session isn't passed explicitly (AsyncLocalStorage), so MySQL row locks
// taken by the transaction can't block the same request.
const { AsyncLocalStorage } = require("async_hooks");
const { sequelize } = require("..");

const als = new AsyncLocalStorage();

class CompatSession {
  constructor() {
    this._txPromise = null;
    this._done = false;
    this.id = { id: Date.now() };
  }

  startTransaction() {
    if (this._txPromise && !this._done) return;
    this._done = false;
    this._txPromise = sequelize.transaction();
    this._txPromise.catch(() => {});
    als.enterWith({ session: this });
  }

  inTransaction() { return !!this._txPromise && !this._done; }

  async commitTransaction() {
    if (!this._txPromise || this._done) return;
    this._done = true;
    const t = await this._txPromise;
    await t.commit();
  }

  async abortTransaction() {
    if (!this._txPromise || this._done) return;
    this._done = true;
    const t = await this._txPromise;
    await t.rollback();
  }

  endSession() {}

  async withTransaction(fn) {
    this.startTransaction();
    try {
      const result = await fn(this);
      await this.commitTransaction();
      return result;
    } catch (err) {
      await this.abortTransaction();
      throw err;
    }
  }
}

// Transaction for a query: explicit session first, then the active one.
async function resolveTx(session) {
  const s = session || als.getStore()?.session;
  if (s && s._txPromise && !s._done) return s._txPromise;
  return undefined;
}

module.exports = { CompatSession, resolveTx, als };
