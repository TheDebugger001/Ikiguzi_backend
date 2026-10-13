// Demo seeders must never run against production by accident.
module.exports = function assertSeedingAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "true") {
    throw new Error("Refusing to seed demo data in production. Set SEED_ALLOW_PRODUCTION=true to override.");
  }
};
