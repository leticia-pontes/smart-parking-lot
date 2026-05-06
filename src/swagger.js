const config = require("./config");

const apiServer = {
  url: `http://localhost:${config.port}`,
  description: "API principal",
};

const simulatorServer = {
  url: `http://localhost:${process.env.SIMULATOR_PORT || 4000}`,
  description: "API de controle do simulador",
};

const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Estacionamento Inteligente API",
    version: "1.0.0",
    description:
      "Documentacao HTTP do MVP de estacionamento inteligente. A API principal consulta e atualiza o estado do estacionamento, relatorios, incidentes e recomendacoes. A API do simulador expõe apenas diagnosticos da simulacao autonoma.",
  },
  servers: [apiServer],
  tags: [
    { name: "Health", description: "Verificacao de disponibilidade dos servicos" },
    { name: "Parking", description: "Consultas operacionais do estacionamento" },
    { name: "Reports", description: "Relatorios baseados no historico de eventos" },
    { name: "Incidents", description: "Incidentes detectados pelo backend" },
    { name: "Recommendations", description: "Recomendacoes de setor alternativo" },
    { name: "Simulator", description: "Diagnosticos da simulacao autonoma" },
  ],
  components: {
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string", example: "fromSector is required" },
        },
      },
      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          ts: { type: "string", format: "date-time" },
        },
      },
      SimulatorHealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          simulatedNow: {
            type: "string",
            format: "date-time",
            example: "2026-04-29T07:15:00.000Z",
          },
        },
      },
      Spot: {
        type: "object",
        properties: {
          spotId: { type: "string", example: "A-07" },
          sectorId: { type: "string", example: "A" },
          currentState: {
            type: "string",
            enum: ["FREE", "OCCUPIED"],
            example: "OCCUPIED",
          },
          lastChangeTs: { type: "string", format: "date-time" },
          lastEventId: {
            type: "string",
            nullable: true,
            example: "3bca7c93-bca6-4fd1-8f67-962e8c9a3e2f",
          },
        },
      },
      Sector: {
        type: "object",
        properties: {
          sectorId: { type: "string", example: "A" },
          occupiedCount: { type: "integer", example: 18 },
          freeCount: { type: "integer", example: 12 },
          occupancyRate: { type: "number", example: 0.6 },
          lastUpdateTs: { type: "string", format: "date-time" },
        },
      },
      SectorWithSpots: {
        allOf: [
          { $ref: "#/components/schemas/Sector" },
          {
            type: "object",
            properties: {
              spots: {
                type: "array",
                items: { $ref: "#/components/schemas/Spot" },
              },
            },
          },
        ],
      },
      Incident: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          tsOpen: { type: "string", format: "date-time" },
          tsClose: { type: "string", format: "date-time", nullable: true },
          type: {
            type: "string",
            enum: ["STUCK_OCCUPIED", "STUCK_FREE", "FLAPPING"],
            example: "FLAPPING",
          },
          severity: { type: "string", example: "high" },
          sectorId: { type: "string", example: "A" },
          spotId: { type: "string", nullable: true, example: "A-07" },
          evidenceJson: {
            type: "object",
            additionalProperties: true,
            example: { transitions: 6, windowMinutes: 10 },
          },
          status: { type: "string", enum: ["open", "closed"], example: "open" },
        },
      },
      Recommendation: {
        type: "object",
        properties: {
          fromSector: { type: "string", example: "A" },
          recommendedSector: { type: "string", nullable: true, example: "B" },
          reason: {
            type: "string",
            example: "Sector A at 93% occupancy; Sector B has 12 free spots",
          },
          ts: { type: "string", format: "date-time" },
        },
      },
      TurnoverReport: {
        type: "object",
        properties: {
          sectorId: { type: "string", example: "A" },
          from: { type: "string", format: "date-time" },
          to: { type: "string", format: "date-time" },
          turnover: { type: "integer", example: 14 },
        },
      },
      Fault: {
        type: "object",
        properties: {
          spotId: {
            type: "string",
            example: "A-07",
          },
          type: {
            type: "string",
            enum: ["stuck_occupied", "stuck_free", "flapping"],
            example: "flapping",
          },
          startedAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      SpotUpdateRequest: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["FREE", "OCCUPIED"],
            example: "OCCUPIED",
          },
          faultType: {
            type: "string",
            nullable: true,
            enum: ["stuck_occupied", "stuck_free", "flapping"],
            example: "stuck_occupied",
          },
          durationMinutes: {
            type: "integer",
            minimum: 1,
            example: 240,
          },
        },
      },
      SpotUpdateResponse: {
        type: "object",
        properties: {
          spot: { $ref: "#/components/schemas/Spot" },
          fault: {
            type: "string",
            nullable: true,
            enum: ["stuck_occupied", "stuck_free", "flapping"],
          },
          simulatorApplied: { type: "boolean", example: true },
        },
      },
      FillSectorRequest: {
        type: "object",
        properties: {
          target: {
            type: "integer",
            minimum: 0,
            maximum: 30,
            default: 28,
            example: 28,
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Verifica a saude da API principal",
        responses: {
          200: {
            description: "API disponivel",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/map": {
      get: {
        tags: ["Parking"],
        summary: "Consulta o mapa atual do estacionamento",
        responses: {
          200: {
            description: "Setores e vagas com estado atual",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sectors: {
                      type: "array",
                      items: { $ref: "#/components/schemas/SectorWithSpots" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/sectors": {
      get: {
        tags: ["Parking"],
        summary: "Consulta disponibilidade agregada por setor",
        responses: {
          200: {
            description: "Ocupacao por setor",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sectors: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Sector" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/sectors/{sectorId}/spots": {
      get: {
        tags: ["Parking"],
        summary: "Lista todas as vagas de um setor",
        parameters: [
          {
            name: "sectorId",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["A", "B", "C"] },
          },
        ],
        responses: {
          200: {
            description: "Vagas do setor",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    spots: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Spot" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/sectors/{sectorId}/free-spots": {
      get: {
        tags: ["Parking"],
        summary: "Lista vagas livres de um setor",
        parameters: [
          {
            name: "sectorId",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["A", "B", "C"] },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, example: 10 },
          },
        ],
        responses: {
          200: {
            description: "Vagas livres",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    spots: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Spot" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/spots/{spotId}": {
      get: {
        tags: ["Parking"],
        summary: "Consulta uma vaga pelo ID",
        parameters: [
          {
            name: "spotId",
            in: "path",
            required: true,
            schema: { type: "string", example: "A-07" },
          },
        ],
        responses: {
          200: {
            description: "Vaga encontrada",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    spot: { $ref: "#/components/schemas/Spot" },
                  },
                },
              },
            },
          },
          404: {
            description: "Vaga nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Parking"],
        summary: "Atualiza o estado de uma vaga a partir do frontend",
        description:
          "Use este endpoint no clique da vaga. Envie state para alternar livre/ocupada, faultType para simular sensor travado/flapping, ou faultType null para limpar a falha no simulador quando ele estiver ativo.",
        parameters: [
          {
            name: "spotId",
            in: "path",
            required: true,
            schema: { type: "string", example: "A-07" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SpotUpdateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Vaga atualizada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SpotUpdateResponse" },
              },
            },
          },
          400: {
            description: "Payload invalido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          404: {
            description: "Vaga nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/reports/turnover": {
      get: {
        tags: ["Reports"],
        summary: "Calcula rotatividade por setor no periodo",
        parameters: [
          {
            name: "sectorId",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["A", "B", "C"] },
          },
          {
            name: "from",
            in: "query",
            required: true,
            schema: {
              type: "string",
              format: "date-time",
              example: "2026-04-29T07:00:00.000Z",
            },
          },
          {
            name: "to",
            in: "query",
            required: true,
            schema: {
              type: "string",
              format: "date-time",
              example: "2026-04-29T12:00:00.000Z",
            },
          },
        ],
        responses: {
          200: {
            description: "Relatorio de rotatividade",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TurnoverReport" },
              },
            },
          },
          400: {
            description: "Parametros obrigatorios ausentes",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/incidents": {
      get: {
        tags: ["Incidents"],
        summary: "Lista incidentes detectados",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["open", "closed"], example: "open" },
          },
        ],
        responses: {
          200: {
            description: "Incidentes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    incidents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Incident" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/recommendation": {
      get: {
        tags: ["Recommendations"],
        summary: "Calcula recomendacao de setor alternativo",
        parameters: [
          {
            name: "fromSector",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["A", "B", "C"], example: "A" },
          },
        ],
        responses: {
          200: {
            description: "Recomendacao calculada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Recommendation" },
              },
            },
          },
          400: {
            description: "Parametro obrigatorio ausente",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/faults": {
      get: {
        servers: [simulatorServer],
        tags: ["Simulator"],
        summary: "Lista falhas ativas na simulacao autonoma",
        responses: {
          200: {
            description: "Falhas ativas por vaga",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    faults: {
                      type: "object",
                      additionalProperties: { $ref: "#/components/schemas/Fault" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        servers: [simulatorServer],
        tags: ["Simulator"],
        summary: "Injeta uma falha em uma vaga do simulador",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Fault" },
            },
          },
        },
        responses: {
          200: {
            description: "Falha registrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Fault" },
              },
            },
          },
          400: {
            description: "Payload invalido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/spots": {
      get: {
        servers: [simulatorServer],
        tags: ["Simulator"],
        summary: "Lista o estado interno atual do simulador",
        responses: {
          200: {
            description: "Relogio simulado e vagas em memoria",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    simulatedNow: { type: "string", format: "date-time" },
                    spots: {
                      type: "array",
                      items: {
                        allOf: [
                          { $ref: "#/components/schemas/Spot" },
                          {
                            type: "object",
                            properties: {
                              state: { type: "string", enum: ["FREE", "OCCUPIED"] },
                              fault: {
                                type: "string",
                                nullable: true,
                                enum: ["stuck_occupied", "stuck_free", "flapping"],
                              },
                              releaseAt: { type: "string", format: "date-time" },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/sectors/{sectorId}/fill": {
      post: {
        servers: [simulatorServer],
        tags: ["Simulator"],
        summary: "Forca a ocupacao de um setor no simulador para demonstrar recomendacao",
        parameters: [
          {
            name: "sectorId",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["A", "B", "C"] },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FillSectorRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Eventos MQTT publicados para o setor",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sectorId: { type: "string", example: "A" },
                    occupiedTarget: { type: "integer", example: 28 },
                    freeTarget: { type: "integer", example: 2 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

module.exports = {
  swaggerSpec,
};
