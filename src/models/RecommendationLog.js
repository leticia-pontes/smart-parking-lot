const { DataTypes, Model } = require("sequelize");

class RecommendationLog extends Model { }

function initRecommendationLog(sequelize) {
  RecommendationLog.init(
    {
      ts: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      fromSector: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      recommendedSector: {
        type: DataTypes.TEXT,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      dataJson: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "RecommendationLog",
      tableName: "recommendations_log",
      timestamps: false,
    },
  );
  RecommendationLog.removeAttribute("id");

  return RecommendationLog;
}

module.exports = {
  RecommendationLog,
  initRecommendationLog,
};
