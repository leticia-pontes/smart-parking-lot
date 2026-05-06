const { Sequelize } = require("sequelize");
const config = require("../config");
const { initIncident, Incident } = require("./Incident");
const { initRecommendationLog, RecommendationLog } = require("./RecommendationLog");
const { initSectorSnapshot, SectorSnapshot } = require("./SectorSnapshot");
const { initSpot, Spot } = require("./Spot");
const { initSpotEvent, SpotEvent } = require("./SpotEvent");

const sequelize = new Sequelize(config.databaseUrl, {
  dialect: "postgres",
  logging: false,
});

initSpot(sequelize);
initSpotEvent(sequelize);
initSectorSnapshot(sequelize);
initIncident(sequelize);
initRecommendationLog(sequelize);

Spot.hasMany(SpotEvent, { foreignKey: "spotId", sourceKey: "spotId" });
SpotEvent.belongsTo(Spot, { foreignKey: "spotId", targetKey: "spotId" });

module.exports = {
  Incident,
  RecommendationLog,
  SectorSnapshot,
  Sequelize,
  sequelize,
  Spot,
  SpotEvent,
};
