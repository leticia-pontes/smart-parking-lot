const { DataTypes, Model } = require("sequelize");

class Spot extends Model {}

function initSpot(sequelize) {
  Spot.init(
    {
      spotId: {
        type: DataTypes.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      sectorId: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      currentState: {
        type: DataTypes.ENUM("FREE", "OCCUPIED"),
        allowNull: false,
        defaultValue: "FREE",
      },
      lastChangeTs: {
        type: DataTypes.DATE,
      },
      lastEventId: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Spot",
      tableName: "spots",
      timestamps: false,
    },
  );

  return Spot;
}

module.exports = {
  Spot,
  initSpot,
};
