const { DataTypes, Model } = require("sequelize");

class SpotEvent extends Model {}

function initSpotEvent(sequelize) {
  SpotEvent.init(
    {
      eventId: {
        type: DataTypes.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      ts: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      sectorId: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      spotId: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      state: {
        type: DataTypes.ENUM("FREE", "OCCUPIED"),
        allowNull: false,
      },
      rawPayloadJson: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SpotEvent",
      tableName: "spot_events",
      timestamps: false,
      indexes: [
        { fields: ["spotId", "ts"] },
        { fields: ["sectorId", "ts"] },
      ],
    },
  );

  return SpotEvent;
}

module.exports = {
  SpotEvent,
  initSpotEvent,
};
