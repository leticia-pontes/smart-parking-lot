const { buildSpots } = require("./layout");
const { sequelize, Spot } = require("./models");

async function initDb() {
  await sequelize.sync();

  const spots = buildSpots().map((spot) => ({
    ...spot,
    currentState: "FREE",
    lastChangeTs: new Date(),
  }));

  await Spot.bulkCreate(spots, {
    ignoreDuplicates: true,
  });
}

async function closeDb() {
  await sequelize.close();
}

module.exports = {
  closeDb,
  initDb,
  sequelize,
};
