const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { config } = require("../config");

const pool = new Pool(config.db);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(maxAttempts = 30, delayMs = 1500) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      console.log(`DB is not ready yet (${attempt}/${maxAttempts})...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function runSchema() {
  const schemaPath = path.resolve(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  connectWithRetry,
  runSchema,
  withTransaction,
  closePool
};
