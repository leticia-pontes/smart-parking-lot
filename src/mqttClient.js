const mqtt = require("mqtt");
const config = require("./config");
const { ingestSpotEvent } = require("./parkingService");
const { getRecommendation } = require("./recommendations");

function startMqtt() {
  const client = mqtt.connect(config.mqttUrl);

  client.on("connect", () => {
    console.log(`[mqtt] connected to ${config.mqttUrl}`);
    client.subscribe("campus/parking/sectors/+/spots/+/events");
    client.subscribe("campus/parking/sectors/+/gateway/status");
  });

  client.on("message", async (topic, buffer) => {
    try {
      const payload = JSON.parse(buffer.toString());
      if (topic.includes("/spots/") && topic.endsWith("/events")) {
        const result = await ingestSpotEvent(payload);
        if (result.inserted) {
          await maybePublishRecommendation(client, payload.sectorId);
        }
      }

      if (topic.endsWith("/gateway/status")) {
        console.log(`[mqtt] gateway status ${topic}: ${buffer.toString()}`);
      }
    } catch (error) {
      console.error(`[mqtt] failed to process ${topic}:`, error.message);
    }
  });

  return client;
}

async function maybePublishRecommendation(client, sectorId) {
  const recommendation = await getRecommendation(sectorId, { log: false });
  if (recommendation.recommendedSector) {
    client.publish("campus/parking/recommendations", JSON.stringify(recommendation));
  }
}

module.exports = {
  startMqtt,
};
