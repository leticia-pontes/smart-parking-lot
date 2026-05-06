const { RecommendationLog } = require("./models");
const { getSectorStats } = require("./parkingService");

async function getRecommendation(fromSector, options = {}) {
  const shouldLog = options.log !== false;
  const stats = await getSectorStats();
  const source = stats.find((sector) => sector.sectorId === fromSector);

  if (!source) {
    const error = new Error("Sector not found");
    error.statusCode = 404;
    throw error;
  }

  const candidates = stats
    .filter((sector) => sector.sectorId !== fromSector)
    .sort((a, b) => b.freeCount - a.freeCount || a.occupancyRate - b.occupancyRate);

  const recommended = source.occupancyRate >= 0.9 ? candidates[0] : null;
  const ts = new Date();
  const response = {
    fromSector,
    recommendedSector: recommended?.sectorId || null,
    reason: recommended
      ? `Setor ${fromSector} está ${Math.round(source.occupancyRate * 100)}% ocupado; Setor ${recommended.sectorId} tem ${recommended.freeCount} vagas livres.`
      : `Setor ${fromSector} está abaixo de 90% de ocupação; nenhuma recomendação necessária.`,
    ts: ts.toISOString(),
  };

  if (shouldLog) {
    await RecommendationLog.create({
      ts,
      fromSector,
      recommendedSector: response.recommendedSector,
      reason: response.reason,
      dataJson: { source, candidates },
    });
  }

  return response;
}

module.exports = {
  getRecommendation,
};
