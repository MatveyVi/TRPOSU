const path = require("path");

const rootPath = path.resolve(__dirname, "../../..");

const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "transport_rental",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres"
  },
  snapshotPath: path.resolve(rootPath, process.env.SNAPSHOT_PATH || "data/state.json"),
  frontendPath: path.resolve(rootPath, "apps/web/public")
};

module.exports = { config };
