const { Op, UniqueConstraintError } = require("sequelize");
const config = require("./config");
const { Incident, SectorSnapshot, sequelize, Spot, SpotEvent } = require("./models");
const { v4: uuidv4 } = require("uuid");

const validStates = ["FREE", "OCCUPIED"];
const validFaultTypes = ["stuck_occupied", "stuck_free", "flapping"];

function toPlain(model) {
  return model.get({ plain: true });
}

async function getSectorStats() {
  const spots = await Spot.findAll({
    order: [
      ["sectorId", "ASC"],
      ["spotId", "ASC"],
    ],
  });

  const sectors = new Map();
  for (const spotModel of spots) {
    const spot = toPlain(spotModel);
    const sector = sectors.get(spot.sectorId) || {
      sectorId: spot.sectorId,
      occupiedCount: 0,
      freeCount: 0,
      occupancyRate: 0,
      lastUpdateTs: null,
    };

    if (spot.currentState === "OCCUPIED") {
      sector.occupiedCount += 1;
    } else {
      sector.freeCount += 1;
    }

    if (!sector.lastUpdateTs || new Date(spot.lastChangeTs) > new Date(sector.lastUpdateTs)) {
      sector.lastUpdateTs = spot.lastChangeTs;
    }

    sectors.set(spot.sectorId, sector);
  }

  return [...sectors.values()]
    .map((sector) => {
      const total = sector.occupiedCount + sector.freeCount;
      return {
        ...sector,
        occupancyRate: total === 0 ? 0 : Number((sector.occupiedCount / total).toFixed(4)),
      };
    })
    .sort((a, b) => a.sectorId.localeCompare(b.sectorId));
}

async function getMap() {
  const sectors = await getSectorStats();
  const spots = await Spot.findAll({
    order: [
      ["sectorId", "ASC"],
      ["spotId", "ASC"],
    ],
  });
  const plainSpots = spots.map(toPlain);

  return sectors.map((sector) => ({
    ...sector,
    spots: plainSpots.filter((spot) => spot.sectorId === sector.sectorId),
  }));
}

async function getSpotsBySector(sectorId, state, limit) {
  const where = { sectorId };
  if (state) {
    where.currentState = state;
  }

  const spots = await Spot.findAll({
    where,
    order: [["spotId", "ASC"]],
    limit,
  });

  return spots.map(toPlain);
}

async function getSpot(spotId, transaction) {
  const spot = await Spot.findByPk(spotId, { transaction });
  return spot ? toPlain(spot) : null;
}

function stateForFaultType(faultType, currentState = "FREE") {
  if (faultType === "stuck_occupied") return "OCCUPIED";
  if (faultType === "stuck_free") return "FREE";
  return currentState === "FREE" ? "OCCUPIED" : "FREE";
}

async function sendSimulatorControl(spotId, body) {
  const baseUrl = process.env.SIMULATOR_CONTROL_URL;
  if (!baseUrl) return null;
  if (typeof fetch !== "function") return null;

  const response = await fetch(`${baseUrl}/spots/${encodeURIComponent(spotId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Simulator control failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function updateSpotFromFrontend(spotId, { state, faultType, durationMinutes } = {}) {
  if (state && !validStates.includes(state)) {
    const error = new Error("state must be FREE or OCCUPIED");
    error.statusCode = 400;
    throw error;
  }

  if (faultType !== undefined && faultType !== null && !validFaultTypes.includes(faultType)) {
    const error = new Error("faultType must be stuck_occupied, stuck_free, flapping or null");
    error.statusCode = 400;
    throw error;
  }

  const currentSpot = await getSpot(spotId);
  if (!currentSpot) {
    const error = new Error("Spot not found");
    error.statusCode = 404;
    throw error;
  }

  const nextState = state || (faultType ? stateForFaultType(faultType, currentSpot.currentState) : null);
  let simulator = null;

  if (faultType !== undefined || durationMinutes !== undefined) {
    try {
      simulator = await sendSimulatorControl(spotId, {
        state: nextState || currentSpot.currentState,
        faultType,
        durationMinutes,
      });
    } catch (error) {
      console.warn("[simulator-control]", error.message);
    }
  }

  if (nextState) {
    await ingestSpotEvent({
      eventId: uuidv4(),
      ts: new Date().toISOString(),
      sectorId: currentSpot.sectorId,
      spotId,
      state: nextState,
      source: "frontend",
      faultType: faultType || undefined,
    });
  }

  if (faultType) {
    await openIncident({
      type:
        faultType === "stuck_occupied"
          ? "STUCK_OCCUPIED"
          : faultType === "stuck_free"
            ? "STUCK_FREE"
            : "FLAPPING",
      severity: faultType === "flapping" ? "high" : "medium",
      sectorId: currentSpot.sectorId,
      spotId,
      evidenceJson: { source: "frontend", faultType, simulatorApplied: Boolean(simulator) },
      tsOpen: new Date(),
    });
  }

  return {
    spot: await getSpot(spotId),
    fault: faultType === undefined ? undefined : faultType,
    simulatorApplied: Boolean(simulator),
  };
}

async function saveSectorSnapshots(ts = new Date()) {
  const stats = await getSectorStats();
  await SectorSnapshot.bulkCreate(
    stats.map((sector) => ({
      ts,
      sectorId: sector.sectorId,
      occupiedCount: sector.occupiedCount,
      freeCount: sector.freeCount,
      occupancyRate: sector.occupancyRate,
    })),
  );
  return stats;
}

async function ingestSpotEvent(payload) {
  const event = {
    eventId: payload.eventId,
    ts: new Date(payload.ts),
    sectorId: payload.sectorId,
    spotId: payload.spotId,
    state: payload.state,
    rawPayloadJson: payload,
  };

  if (
    !event.eventId ||
    !event.sectorId ||
    !event.spotId ||
    Number.isNaN(event.ts.getTime()) ||
    !["FREE", "OCCUPIED"].includes(event.state)
  ) {
    throw new Error("Invalid spot event payload");
  }

  let inserted = false;

  await sequelize.transaction(async (transaction) => {
    try {
      await SpotEvent.create(event, { transaction });
      inserted = true;
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        inserted = false;
        return;
      }
      throw error;
    }

    const spot = await Spot.findByPk(event.spotId, { transaction });
    if (!spot) {
      throw new Error(`Spot ${event.spotId} not found`);
    }

    const stateChanged = spot.currentState !== event.state;
    await spot.update(
      {
        currentState: event.state,
        lastChangeTs: stateChanged ? event.ts : spot.lastChangeTs,
        lastEventId: event.eventId,
      },
      { transaction },
    );
  });

  if (!inserted) {
    return { inserted: false };
  }

  await detectIncidentsForEvent(event);
  return { inserted: true };
}

async function detectIncidentsForEvent(event) {
  const windowStart = new Date(
    event.ts.getTime() - config.flappingWindowMinutes * 60_000,
  );
  const recent = await SpotEvent.findAll({
    where: {
      spotId: event.spotId,
      ts: { [Op.gte]: windowStart },
    },
    order: [["ts", "ASC"]],
  });

  let transitions = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].state !== recent[index - 1].state) {
      transitions += 1;
    }
  }

  if (transitions >= config.flappingTransitionsThreshold) {
    await openIncident({
      type: "FLAPPING",
      severity: "high",
      sectorId: event.sectorId,
      spotId: event.spotId,
      evidenceJson: { transitions, windowMinutes: config.flappingWindowMinutes },
      tsOpen: event.ts,
    });
  }

  const latestOpposite = await SpotEvent.findOne({
    where: {
      spotId: event.spotId,
      state: { [Op.ne]: event.state },
    },
    order: [["ts", "DESC"]],
  });

  const stateWhere = {
    spotId: event.spotId,
    state: event.state,
  };
  if (latestOpposite) {
    stateWhere.ts = { [Op.gt]: latestOpposite.ts };
  }

  const firstSameState = await SpotEvent.findOne({
    where: stateWhere,
    order: [["ts", "ASC"]],
  });

  if (!firstSameState) return;

  const firstSeen = firstSameState.ts;
  const ageMinutes = (event.ts.getTime() - new Date(firstSeen).getTime()) / 60000;
  if (ageMinutes >= config.stuckThresholdMinutes) {
    await openIncident({
      type: event.state === "OCCUPIED" ? "STUCK_OCCUPIED" : "STUCK_FREE",
      severity: "medium",
      sectorId: event.sectorId,
      spotId: event.spotId,
      evidenceJson: {
        state: event.state,
        firstSeen,
        ageMinutes: Math.round(ageMinutes),
        thresholdMinutes: config.stuckThresholdMinutes,
      },
      tsOpen: event.ts,
    });
  }
}

async function openIncident({ type, severity, sectorId, spotId, evidenceJson, tsOpen }) {
  const existing = await Incident.findOne({
    where: {
      status: "open",
      type,
      sectorId,
      spotId: spotId || null,
    },
  });

  if (existing) return toPlain(existing);

  const created = await Incident.create({
    tsOpen,
    type,
    severity,
    sectorId,
    spotId,
    evidenceJson,
    status: "open",
  });
  return toPlain(created);
}

async function getIncidents(status) {
  const where = status ? { status } : undefined;
  const incidents = await Incident.findAll({
    where,
    order: [["tsOpen", "DESC"]],
  });
  return incidents.map(toPlain);
}

async function getTurnover({ sectorId, from, to }) {
  const events = await SpotEvent.findAll({
    where: {
      sectorId,
      ts: {
        [Op.between]: [new Date(from), new Date(to)],
      },
    },
    order: [
      ["spotId", "ASC"],
      ["ts", "ASC"],
    ],
  });

  let turnover = 0;
  let previousBySpot = new Map();
  for (const eventModel of events) {
    const event = toPlain(eventModel);
    const previous = previousBySpot.get(event.spotId);
    if (previous === "FREE" && event.state === "OCCUPIED") {
      turnover += 1;
    }
    previousBySpot.set(event.spotId, event.state);
  }

  return {
    sectorId,
    from,
    to,
    turnover,
  };
}

module.exports = {
  getIncidents,
  getMap,
  getSectorStats,
  getSpot,
  getSpotsBySector,
  getTurnover,
  ingestSpotEvent,
  saveSectorSnapshots,
  updateSpotFromFrontend,
};
