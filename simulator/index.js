const express = require("express");
const mqtt = require("mqtt");
const { v4: uuidv4 } = require("uuid");

const SECTORS = ["A", "B", "C"];
const SPOTS_PER_SECTOR = 30;
const mqttUrl = process.env.MQTT_URL || "mqtt://localhost:1883";
const port = Number(process.env.SIMULATOR_PORT || 4000);
const simMinuteMs = Number(process.env.SIM_TIME_SCALE_MS || 1000);

const client = mqtt.connect(mqttUrl, {
  clientId: `parking_simulator_${Math.random().toString(16).slice(2, 8)}`,
  clean: true,
});
const faults = new Map();
const spots = new Map();
const sensors = [];
let simulatedNow = new Date("2026-04-29T07:00:00.000Z");

const faultTypes = ["stuck_occupied", "stuck_free", "flapping"];
const autoFaultsEnabled = process.env.SIM_AUTO_FAULTS !== "false";
const maxAutoFaults = Number(process.env.SIM_MAX_AUTO_FAULTS || 4);
const faultChancePerMinute = Number(process.env.SIM_FAULT_CHANCE || 0.035);
const httpEnabled = process.env.SIMULATOR_HTTP !== "false";
const commandTopics = [
  "campus/parking/simulator/faults/cmd",
  "campus/parking/simulator/sectors/+/fill/cmd",
];

function spotIdFor(sectorId, index) {
  return `${sectorId}-${String(index).padStart(2, "0")}`;
}

function topicFor(spot) {
  return `campus/parking/sectors/${spot.sectorId}/spots/${spot.spotId}/events`;
}

function publishSpot(spot, source = "sensor") {
  const payload = {
    eventId: uuidv4(),
    ts: simulatedNow.toISOString(),
    sectorId: spot.sectorId,
    spotId: spot.spotId,
    state: spot.state,
    source,
  };
  client.publish(topicFor(spot), JSON.stringify(payload), { qos: 1 });
  return payload;
}

function logSensor(spot, state, source, previousState) {
  const transition =
    previousState && previousState !== state ? `${previousState} -> ${state}` : state;
  const fault = faultTypeFor(spot.spotId);
  const faultLabel = fault ? ` fault=${fault}` : "";
  console.log(
    `[simulator] ${simulatedNow.toISOString()} sensor ${spot.spotId} ${transition} source=${source}${faultLabel}`,
  );
}

function faultTypeFor(spotId) {
  const fault = faults.get(spotId);
  return typeof fault === "string" ? fault : fault?.type;
}

function faultResponse() {
  return Object.fromEntries(
    [...faults.entries()].map(([spotId, fault]) => [
      spotId,
      typeof fault === "string"
        ? { type: fault }
        : {
            type: fault.type,
            startedAt: fault.startedAt.toISOString(),
            endsAt: fault.endsAt?.toISOString() || null,
          },
    ]),
  );
}

function setSpotState(spot, state, source = "sensor") {
  const previousState = spot.state;
  const changed = previousState !== state;
  if (changed) spot.state = state;
  publishSpot(spot, source);
  if (changed || source !== "sensor") logSensor(spot, state, source, previousState);
}

function stayMinutes() {
  return 30 + Math.floor(Math.random() * 331);
}

function arrivalProbability(hour) {
  if (hour >= 7 && hour <= 9) return 0.18;
  if (hour >= 16 && hour <= 18) return 0.14;
  if (hour >= 10 && hour <= 15) return 0.06;
  return 0.02;
}

function departureProbability(hour) {
  if (hour >= 16 && hour <= 19) return 0.16;
  if (hour >= 11 && hour <= 14) return 0.08;
  return 0.03;
}

function faultDurationMinutes(type) {
  if (type === "flapping") return 8 + Math.floor(Math.random() * 12);
  return 190 + Math.floor(Math.random() * 80);
}

function normalizeFaultType(type) {
  if (!faultTypes.includes(type)) {
    throw new Error("faultType must be stuck_occupied, stuck_free or flapping");
  }
  return type;
}

function registerFault(spot, type, durationMinutes = faultDurationMinutes(type)) {
  normalizeFaultType(type);
  const state =
    type === "stuck_occupied" ? "OCCUPIED" : type === "stuck_free" ? "FREE" : spot.state;

  faults.set(spot.spotId, {
    type,
    startedAt: new Date(simulatedNow),
    endsAt: new Date(simulatedNow.getTime() + durationMinutes * 60_000),
  });

  console.log(
    `[simulator] ${simulatedNow.toISOString()} fault-start spot=${spot.spotId} type=${type} durationMinutes=${durationMinutes}`,
  );
  setSpotState(spot, state, "sensor");
  return faults.get(spot.spotId);
}

function clearFault(spotId) {
  const deleted = faults.delete(spotId);
  if (deleted) {
    console.log(`[simulator] ${simulatedNow.toISOString()} fault-clear spot=${spotId}`);
  }
  return deleted;
}

function maybeUpdateFaults() {
  for (const [spotId, fault] of faults.entries()) {
    if (fault.endsAt && simulatedNow >= fault.endsAt) {
      faults.delete(spotId);
      const spot = spots.get(spotId);
      if (spot) {
        console.log(`[simulator] ${simulatedNow.toISOString()} fault-clear spot=${spotId}`);
        publishSpot(spot, "sensor");
      }
    }
  }

  if (!autoFaultsEnabled || faults.size >= maxAutoFaults) return;
  if (Math.random() >= faultChancePerMinute) return;

  const candidates = [...spots.values()].filter((spot) => !faults.has(spot.spotId));
  if (candidates.length === 0) return;

  const spot = candidates[Math.floor(Math.random() * candidates.length)];
  const type = faultTypes[Math.floor(Math.random() * faultTypes.length)];
  registerFault(spot, type);
}

function configureFault({ spotId, type, faultType, durationMinutes }) {
  const spot = spots.get(spotId);
  if (!spot) {
    throw new Error(`Spot ${spotId} not found`);
  }

  return registerFault(spot, normalizeFaultType(type || faultType), Number(durationMinutes) || undefined);
}

function loadConfiguredFaults() {
  if (!process.env.SIM_FAULTS) return;

  for (const item of process.env.SIM_FAULTS.split(",")) {
    const [spotId, type, durationMinutes] = item.split(":").map((part) => part.trim());
    if (!spotId || !type) continue;

    try {
      configureFault({ spotId, type, durationMinutes });
    } catch (error) {
      console.warn(`[simulator] ignored configured fault ${item}: ${error.message}`);
    }
  }
}

function fillSector(sectorId, target = Math.ceil(SPOTS_PER_SECTOR * 0.9)) {
  const sectorSpots = sensors
    .filter((sensor) => sensor.sectorId === sectorId)
    .map((sensor) => sensor.spot);

  if (sectorSpots.length === 0) {
    throw new Error(`Sector ${sectorId} not found`);
  }

  const normalizedTarget = Math.max(0, Math.min(SPOTS_PER_SECTOR, Number(target) || 0));
  sectorSpots.forEach((spot, index) => {
    const nextState = index < normalizedTarget ? "OCCUPIED" : "FREE";
    spot.releaseAt =
      nextState === "OCCUPIED"
        ? new Date(simulatedNow.getTime() + stayMinutes() * 60_000)
        : simulatedNow;
    setSpotState(spot, nextState, "gateway");
  });

  return {
    sectorId,
    occupiedTarget: normalizedTarget,
    freeTarget: SPOTS_PER_SECTOR - normalizedTarget,
  };
}

function tick() {
  simulatedNow = new Date(simulatedNow.getTime() + 60_000);
  const hour = simulatedNow.getUTCHours();
  maybeUpdateFaults();

  for (const sensor of sensors) {
    const spot = sensor.spot;
    const fault = faultTypeFor(spot.spotId);
    if (fault === "stuck_occupied") {
      setSpotState(spot, "OCCUPIED", "sensor");
      continue;
    }
    if (fault === "stuck_free") {
      setSpotState(spot, "FREE", "sensor");
      continue;
    }
    if (fault === "flapping") {
      setSpotState(spot, spot.state === "FREE" ? "OCCUPIED" : "FREE", "sensor");
      continue;
    }

    if (spot.state === "FREE" && Math.random() < arrivalProbability(hour)) {
      spot.releaseAt = new Date(simulatedNow.getTime() + stayMinutes() * 60_000);
      setSpotState(spot, "OCCUPIED");
      continue;
    }

    if (
      spot.state === "OCCUPIED" &&
      (simulatedNow >= spot.releaseAt || Math.random() < departureProbability(hour))
    ) {
      setSpotState(spot, "FREE");
    }
  }
}

function publishGatewayStatus() {
  for (const sectorId of SECTORS) {
    client.publish(
      `campus/parking/sectors/${sectorId}/gateway/status`,
      JSON.stringify({
        ts: simulatedNow.toISOString(),
        sectorId,
        status: "online",
        sensors: SPOTS_PER_SECTOR,
      }),
    );
  }
}

function seed() {
  for (const sectorId of SECTORS) {
    for (let index = 1; index <= SPOTS_PER_SECTOR; index += 1) {
      const spot = {
        sectorId,
        spotId: spotIdFor(sectorId, index),
        state: "FREE",
        releaseAt: simulatedNow,
      };
      spots.set(spot.spotId, spot);
      sensors.push({
        topic: topicFor(spot),
        sectorId,
        spotId: spot.spotId,
        type: "parking_spot",
        states: ["FREE", "OCCUPIED"],
        spot,
      });
    }
  }
}

function handleFaultCommand(payload) {
  if (payload.action === "clear") {
    clearFault(payload.spotId);
    return { spotId: payload.spotId, cleared: true };
  }

  const fault = configureFault(payload);
  return {
    spotId: payload.spotId,
    type: fault.type,
    startedAt: fault.startedAt.toISOString(),
    endsAt: fault.endsAt?.toISOString() || null,
  };
}

function handleMqttCommand(topic, buffer) {
  try {
    const payload = JSON.parse(buffer.toString());

    if (topic === "campus/parking/simulator/faults/cmd") {
      const result = handleFaultCommand(payload);
      client.publish("campus/parking/simulator/faults/ack", JSON.stringify(result), { qos: 1 });
      console.log(`[cmd] ${topic} -> ${JSON.stringify(result)}`);
      return;
    }

    const fillMatch = topic.match(/^campus\/parking\/simulator\/sectors\/([^/]+)\/fill\/cmd$/);
    if (fillMatch) {
      const result = fillSector(fillMatch[1], payload.target);
      client.publish("campus/parking/simulator/fill/ack", JSON.stringify(result), { qos: 1 });
      console.log(`[cmd] ${topic} -> ${JSON.stringify(result)}`);
    }
  } catch (error) {
    console.error(`[cmd] failed to process ${topic}: ${error.message}`);
  }
}

function startHttp() {
  if (!httpEnabled) {
    console.log("[simulator] HTTP diagnostics disabled");
    return;
  }

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", simulatedNow: simulatedNow.toISOString() });
  });

  app.get("/faults", (_req, res) => {
    res.json({ faults: faultResponse() });
  });

  app.post("/faults", (req, res) => {
    try {
      const result = handleFaultCommand(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/spots", (_req, res) => {
    res.json({
      simulatedNow: simulatedNow.toISOString(),
      spots: [...spots.values()].map((spot) => ({
        ...spot,
        fault: faultTypeFor(spot.spotId) || null,
        releaseAt: spot.releaseAt.toISOString(),
      })),
    });
  });

  app.patch("/spots/:spotId", (req, res) => {
    const spot = spots.get(req.params.spotId);
    if (!spot) {
      res.status(404).json({ error: "Spot not found" });
      return;
    }

    const { state, faultType, durationMinutes } = req.body || {};
    if (state && !["FREE", "OCCUPIED"].includes(state)) {
      res.status(400).json({ error: "state must be FREE or OCCUPIED" });
      return;
    }

    if (faultType !== undefined && faultType !== null && !faultTypes.includes(faultType)) {
      res.status(400).json({ error: "faultType must be stuck_occupied, stuck_free, flapping or null" });
      return;
    }

    if (faultType === null) {
      clearFault(spot.spotId);
    }

    if (state) {
      setSpotState(spot, state, "gateway");
    }

    if (faultType) {
      registerFault(spot, faultType, Number(durationMinutes) || faultDurationMinutes(faultType));
    }

    res.json({
      spot: {
        ...spot,
        fault: faultTypeFor(spot.spotId) || null,
        releaseAt: spot.releaseAt.toISOString(),
      },
    });
  });

  app.post("/sectors/:sectorId/fill", (req, res) => {
    try {
      res.json(fillSector(req.params.sectorId, req.body?.target ?? 28));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.listen(port, () => {
    console.log(`[simulator] diagnostics API listening on http://localhost:${port}`);
  });
}

seed();
client.on("connect", () => {
  console.log(`[simulator] connected to ${mqttUrl}`);
  console.log(
    `[simulator] running autonomous MQTT sensor simulation: sectors=${SECTORS.join(",")} sensors=${sensors.length} gateways=${SECTORS.length} simulatedMinuteMs=${simMinuteMs}`,
  );
  client.subscribe(commandTopics, (error) => {
    if (error) {
      console.error(`[simulator] command subscription failed: ${error.message}`);
      return;
    }
    console.log(`[simulator] subscribed to commands: ${commandTopics.join(", ")}`);
  });
  loadConfiguredFaults();
  for (const sensor of sensors) publishSpot(sensor.spot);
  publishGatewayStatus();
  setInterval(tick, simMinuteMs);
  setInterval(publishGatewayStatus, simMinuteMs * 5);
});

client.on("message", handleMqttCommand);
client.on("error", (error) => {
  console.error(`[mqtt] ${error.message}`);
});
client.on("disconnect", () => {
  console.log("[simulator] disconnected from broker");
});

startHttp();
