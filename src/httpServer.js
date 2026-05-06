const cors = require("cors");
const express = require("express");
const swaggerUi = require("swagger-ui-express");
const {
  getIncidents,
  getMap,
  getSectorStats,
  getSpot,
  getSpotsBySector,
  getTurnover,
  updateSpotFromFrontend,
} = require("./parkingService");
const { getRecommendation } = require("./recommendations");
const { swaggerSpec } = require("./swagger");

function createHttpServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/docs.json", (_req, res) => {
    res.json(swaggerSpec);
  });

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "Estacionamento Inteligente API",
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ts: new Date().toISOString() });
  });

  app.get("/api/v1/map", async (_req, res, next) => {
    try {
      res.json({ sectors: await getMap() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/sectors", async (_req, res, next) => {
    try {
      res.json({ sectors: await getSectorStats() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/sectors/:sectorId/spots", async (req, res, next) => {
    try {
      res.json({ spots: await getSpotsBySector(req.params.sectorId) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/sectors/:sectorId/free-spots", async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      res.json({ spots: await getSpotsBySector(req.params.sectorId, "FREE", limit) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/spots/:spotId", async (req, res, next) => {
    try {
      const spot = await getSpot(req.params.spotId);
      if (!spot) {
        res.status(404).json({ error: "Spot not found" });
        return;
      }
      res.json({ spot });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/v1/spots/:spotId", async (req, res, next) => {
    try {
      const result = await updateSpotFromFrontend(req.params.spotId, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/reports/turnover", async (req, res, next) => {
    try {
      const { sectorId, from, to } = req.query;
      if (!sectorId || !from || !to) {
        res.status(400).json({ error: "sectorId, from and to are required" });
        return;
      }
      res.json(await getTurnover({ sectorId, from, to }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/incidents", async (req, res, next) => {
    try {
      res.json({ incidents: await getIncidents(req.query.status) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/recommendation", async (req, res, next) => {
    try {
      if (!req.query.fromSector) {
        res.status(400).json({ error: "fromSector is required" });
        return;
      }
      res.json(await getRecommendation(req.query.fromSector));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error("[http]", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Internal error" });
  });

  return app;
}

module.exports = {
  createHttpServer,
};
