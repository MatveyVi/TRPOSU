const { spawn } = require("child_process");
const path = require("path");
const { readdir, stat } = require("fs/promises");

const watchRoot = path.resolve(__dirname, "../src");
const entryPoint = path.resolve(watchRoot, "index.js");
const defaultPort = process.env.PORT || "3001";
const pollIntervalMs = 700;

let childProcess = null;
let snapshot = "";
let shuttingDown = false;
let restarting = false;
let restartQueued = false;
let checkInFlight = false;
let pollTimer = null;

async function listFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

async function buildSnapshot() {
  const files = (await listFiles(watchRoot)).sort();
  const fileStates = await Promise.all(
    files.map(async (filePath) => {
      const fileStat = await stat(filePath);
      return `${filePath}:${fileStat.size}:${fileStat.mtimeMs}`;
    })
  );

  return fileStates.join("|");
}

function startServer() {
  childProcess = spawn(process.execPath, [entryPoint], {
    env: {
      ...process.env,
      PORT: defaultPort
    },
    stdio: "inherit"
  });

  childProcess.on("exit", (code, signal) => {
    const wasRestarting = restarting;
    childProcess = null;

    if (shuttingDown) {
      process.exit(code === null ? 0 : code);
      return;
    }

    if (!wasRestarting) {
      const status = code !== null ? `code ${code}` : `signal ${signal}`;
      console.log(`Server exited with ${status}. Waiting for file changes...`);
    }

    if (restartQueued) {
      restartQueued = false;
      void restartServer();
    }
  });
}

async function restartServer() {
  if (shuttingDown) {
    return;
  }

  if (!childProcess) {
    startServer();
    return;
  }

  if (restarting) {
    restartQueued = true;
    return;
  }

  restarting = true;
  console.log("Restarting server...");

  childProcess.once("exit", () => {
    restarting = false;

    if (!shuttingDown) {
      startServer();
    }
  });

  childProcess.kill("SIGTERM");
}

async function checkForChanges() {
  if (shuttingDown || checkInFlight) {
    return;
  }

  checkInFlight = true;

  try {
    const nextSnapshot = await buildSnapshot();

    if (nextSnapshot !== snapshot) {
      snapshot = nextSnapshot;
      await restartServer();
    }
  } catch (error) {
    console.error("Watcher error:", error);
  } finally {
    checkInFlight = false;
  }
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (pollTimer) {
    clearInterval(pollTimer);
  }

  if (!childProcess) {
    process.exit(0);
    return;
  }

  childProcess.once("exit", () => {
    process.exit(0);
  });

  childProcess.kill(signal);
}

async function main() {
  snapshot = await buildSnapshot();
  startServer();
  pollTimer = setInterval(() => {
    void checkForChanges();
  }, pollIntervalMs);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("Failed to start dev runner:", error);
  process.exit(1);
});
