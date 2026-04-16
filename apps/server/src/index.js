const express = require("express");
const path = require("path");
const { config } = require("./config");
const { connectWithRetry, runSchema, closePool } = require("./db");
const { bootstrapState } = require("./services/snapshot-service");
const { apiRouter } = require("./routes/api");
const { AppError } = require("./utils/app-error");

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    function cleanup() {
      server.off("error", handleError);
      server.off("listening", handleListening);
    }

    function handleError(error) {
      cleanup();
      reject(error);
    }

    function handleListening() {
      cleanup();
      resolve(server);
    }

    server.once("error", handleError);
    server.once("listening", handleListening);
  });
}

async function startServer() {
  await connectWithRetry();
  await runSchema();
  await bootstrapState();

  const app = express();

  app.use(express.json());
  app.use("/api", apiRouter);
  app.use(express.static(config.frontendPath));

  app.get("/", (request, response) => {
    response.sendFile(path.resolve(config.frontendPath, "index.html"));
  });

  app.get("/status", (request, response) => {
    response.sendFile(path.resolve(config.frontendPath, "status.html"));
  });

  app.get("/about", (request, response) => {
    response.sendFile(path.resolve(config.frontendPath, "about.html"));
  });

  app.get("*", (request, response) => {
    response.sendFile(path.resolve(config.frontendPath, "index.html"));
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof AppError) {
      response.status(error.status).json({ error: error.message });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "Внутренняя ошибка сервера." });
  });

  const server = await listen(app, config.port);
  console.log(`Transport rental app started on http://localhost:${config.port}`);

  async function shutdown() {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch(async (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(
      `Failed to start application: port ${config.port} is already in use. Stop the process using it or run the server with PORT=<free-port>.`
    );
  } else {
    console.error("Failed to start application:", error);
  }

  await closePool();
  process.exit(1);
});
