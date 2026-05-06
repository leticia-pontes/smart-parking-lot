const SECTORS = ["A", "B", "C"];
const SPOTS_PER_SECTOR = 30;

function spotIdFor(sectorId, index) {
  return `${sectorId}-${String(index).padStart(2, "0")}`;
}

function buildSpots() {
  return SECTORS.flatMap((sectorId) =>
    Array.from({ length: SPOTS_PER_SECTOR }, (_, index) => ({
      sectorId,
      spotId: spotIdFor(sectorId, index + 1),
    })),
  );
}

module.exports = {
  SECTORS,
  SPOTS_PER_SECTOR,
  buildSpots,
  spotIdFor,
};
