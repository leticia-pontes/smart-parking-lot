const { DataTypes, Model } = require("sequelize");

class Incident extends Model { }

function initIncident(sequelize) {
  Incident.init(
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      tsOpen: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      tsClose: {
        type: DataTypes.DATE,
      },
      type: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      severity: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      sectorId: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      spotId: {
        type: DataTypes.TEXT,
      },
      evidenceJson: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("open", "closed"),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "Incident",
      tableName: "incidents",
      timestamps: false,
      indexes: [{ fields: ["status"] }],
    },
  );

  return Incident;
}

module.exports = {
  Incident,
  initIncident,
};
