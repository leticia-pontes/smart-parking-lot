const { DataTypes, Model } = require("sequelize");

class SectorSnapshot extends Model {}

function initSectorSnapshot(sequelize) {
  SectorSnapshot.init(
    {
      ts: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      sectorId: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      occupiedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      freeCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      occupancyRate: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "SectorSnapshot",
      tableName: "sector_snapshots",
      timestamps: false,
    },
  );
  SectorSnapshot.removeAttribute("id");

  return SectorSnapshot;
}

module.exports = {
  SectorSnapshot,
  initSectorSnapshot,
};
