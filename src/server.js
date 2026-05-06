const config = require("./config");
const { initDb } = require("./db");
const { createHttpServer } = require("./httpServer");
const { startMqtt } = require("./mqttClient");
const { saveSectorSnapshots } = require("./parkingService");

async function main() {
  await initDb();
  console.log("[db] schema ready and spots seeded");

  startMqtt();

  setInterval(() => {
    saveSectorSnapshots().catch((error) => {
      console.error("[snapshot] failed:", error.message);
    });
  }, config.snapshotIntervalMs);

  const app = createHttpServer();
  app.listen(config.port, () => {
    console.log(`[http] API listening on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
