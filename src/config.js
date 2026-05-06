require("dotenv").config();

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

module.exports = {
  port: numberFromEnv("PORT", 3000),
  databaseUrl:
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/smart_parking_lot",
  mqttUrl: process.env.MQTT_URL || "mqtt://localhost:1883",
  snapshotIntervalMs: numberFromEnv("SNAPSHOT_INTERVAL_MS", 60_000),
  stuckThresholdMinutes: numberFromEnv("STUCK_THRESHOLD_MINUTES", 180),
  flappingWindowMinutes: numberFromEnv("FLAPPING_WINDOW_MINUTES", 10),
  flappingTransitionsThreshold: numberFromEnv("FLAPPING_TRANSITIONS_THRESHOLD", 6),
};
