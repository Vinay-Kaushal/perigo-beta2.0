const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5434/perigo_test";
if (!/test/i.test(testDb)) throw new Error(`Refusing to run tests against non-test database: ${testDb}`);
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: testDb,
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6381",
});
