# Estacionamento Inteligente (Campus)

Este projeto implementa um MVP de estacionamento inteligente para um campus universitario. O sistema simula sensores instalados em vagas, recebe eventos em tempo real por MQTT, persiste historico em banco de dados e disponibiliza consultas operacionais por uma API HTTP REST.

A proposta e representar um estacionamento dividido em tres setores fixos: `A`, `B` e `C`. Cada setor possui 30 vagas, totalizando 90 vagas monitoradas. A IA ainda nao faz parte do MVP, mas a arquitetura deixa os dados historicos organizados para uso posterior em previsao de ocupacao, recomendacoes mais inteligentes e deteccao avancada de anomalias.

## Regras de negocio

### Layout do estacionamento

O layout e fixo e criado automaticamente quando a API inicializa:

- Setor `A`: vagas `A-01` ate `A-30`
- Setor `B`: vagas `B-01` ate `B-30`
- Setor `C`: vagas `C-01` ate `C-30`

Cada vaga possui um estado atual:

- `FREE`: vaga livre
- `OCCUPIED`: vaga ocupada

O estado atual fica armazenado na tabela `spots`, enquanto cada evento recebido fica registrado na tabela `spot_events`.

### Eventos de vaga

Cada sensor publica eventos via MQTT usando o topico:

```text
campus/parking/sectors/<sectorId>/spots/<spotId>/events
```

Exemplo de payload:

```json
{
  "eventId": "3bca7c93-bca6-4fd1-8f67-962e8c9a3e2f",
  "ts": "2026-04-29T10:15:30.000Z",
  "sectorId": "A",
  "spotId": "A-07",
  "state": "OCCUPIED",
  "source": "sensor"
}
```

O campo `eventId` e usado como chave de idempotencia. Isso significa que, se o mesmo evento for recebido mais de uma vez, ele nao sera duplicado no banco de dados.

Quando um evento novo chega, o backend executa as seguintes operacoes:

1. Valida o payload recebido.
2. Tenta gravar o evento em `spot_events`.
3. Se o `eventId` ja existir, interrompe o processamento sem duplicar dados.
4. Atualiza o estado atual da vaga em `spots`.
5. Mantem o `lastChangeTs` somente quando houve mudanca real de estado.
6. Executa as regras de deteccao de incidentes.
7. Verifica se ha recomendacao de setor alternativo.

### Status dos gateways

Cada setor possui um gateway simulado. Os gateways publicam mensagens de saude no topico:

```text
campus/parking/sectors/<sectorId>/gateway/status
```

Essas mensagens ajudam a demonstrar a presenca de equipamentos intermediarios entre sensores e backend.

### Simulacao de sensores

O simulador representa 90 sensores, um por vaga, e 3 gateways, um por setor.

Por padrao, o tempo simulado usa a escala:

```text
1 segundo real = 1 minuto simulado
```

Essa escala e controlada pela variavel `SIM_TIME_SCALE_MS`.

O simulador tenta produzir um comportamento realista:

- maior probabilidade de chegada pela manha;
- maior probabilidade de saida no fim da tarde;
- tempo de permanencia variavel entre 30 minutos e 6 horas simuladas;
- publicacao periodica do status dos gateways.

### Injecao de falhas

O simulador possui uma API propria para injecao de falhas. As falhas suportadas sao:

- `stuck_occupied`: sensor fica travado como ocupado;
- `stuck_free`: sensor fica travado como livre;
- `flapping`: sensor alterna rapido demais entre livre e ocupado.

Exemplo:

```bash
curl -X POST http://localhost:4000/faults \
  -H "Content-Type: application/json" \
  -d '{"spotId":"A-07","type":"flapping"}'
```

### Deteccao de incidentes

O backend registra incidentes na tabela `incidents` quando identifica comportamento suspeito.

Tipos de incidente:

- `STUCK_OCCUPIED`: vaga permanece ocupada por tempo suspeito;
- `STUCK_FREE`: vaga permanece livre por tempo suspeito;
- `FLAPPING`: vaga troca de estado muitas vezes em uma janela curta.

As regras sao configuradas por variaveis de ambiente:

- `STUCK_THRESHOLD_MINUTES`: tempo minimo para considerar sensor travado;
- `FLAPPING_WINDOW_MINUTES`: janela de tempo usada para analisar trocas rapidas;
- `FLAPPING_TRANSITIONS_THRESHOLD`: quantidade de transicoes que caracteriza flapping.

Os incidentes podem ser consultados pela API:

```bash
curl http://localhost:3000/api/v1/incidents?status=open
```

### Recomendacao de setor

Quando um setor atinge ocupacao maior ou igual a 90%, o sistema recomenda outro setor com mais vagas livres.

Exemplo:

```bash
curl http://localhost:3000/api/v1/recommendation?fromSector=A
```

Resposta esperada:

```json
{
  "fromSector": "A",
  "recommendedSector": "B",
  "reason": "Sector A at 93% occupancy; Sector B has 12 free spots",
  "ts": "2026-04-29T10:20:00.000Z"
}
```

Toda recomendacao solicitada por HTTP e registrada na tabela `recommendations_log`. Quando uma recomendacao e gerada automaticamente durante o processamento MQTT, ela tambem pode ser publicada no topico:

```text
campus/parking/recommendations
```

### Relatorio de rotatividade

A rotatividade considera transicoes de `FREE` para `OCCUPIED` dentro de um periodo. Na pratica, essa contagem representa a quantidade de veiculos atendidos no intervalo informado.

Exemplo:

```bash
curl "http://localhost:3000/api/v1/reports/turnover?sectorId=A&from=2026-04-29T07:00:00.000Z&to=2026-04-29T12:00:00.000Z"
```

## Arquitetura e tecnologias

### Visao geral

O projeto e composto por quatro servicos principais:

- `api`: backend Node.js responsavel por HTTP, MQTT, regras de negocio e persistencia;
- `simulator`: simulador Node.js que publica eventos MQTT e expoe endpoints de controle;
- `mosquitto`: broker MQTT usado para comunicacao em tempo real;
- `db`: banco Postgres usado para persistencia.

Fluxo principal:

```text
simulator -> MQTT Mosquitto -> api -> Postgres
                                |
                                +-> HTTP REST
```

O simulador publica eventos no Mosquitto. A API assina os topicos MQTT, processa os eventos, atualiza o banco e expoe os dados por endpoints HTTP.

### Tecnologias escolhidas

#### Node.js

Foi escolhido por ser simples para executar tanto a API quanto o simulador no mesmo repositorio. O projeto usa CommonJS, mantendo uma estrutura direta para fins didaticos.

#### Express

O Express e usado na API HTTP principal e tambem na API de controle do simulador. Ele foi escolhido por ser leve, conhecido e suficiente para expor os endpoints REST exigidos no MVP.

#### MQTT.js

O pacote `mqtt` e usado tanto para publicar eventos no simulador quanto para assinar eventos no backend. Ele se integra facilmente com o Mosquitto e com Node.js.

#### Mosquitto

O Eclipse Mosquitto e o broker MQTT usado no ambiente local. Ele recebe os eventos dos sensores/gateways simulados e entrega esses eventos para a API.

#### Postgres

O Postgres e usado como banco relacional para persistir:

- estado atual das vagas;
- historico de eventos;
- snapshots por setor;
- incidentes;
- logs de recomendacao.

#### Sequelize

O Sequelize foi escolhido como ORM do projeto. Entre TypeORM, Prisma e Sequelize, ele se encaixa melhor na base atual porque:

- funciona bem com CommonJS;
- permite criar classes que representam tabelas;
- nao exige etapa de geracao de client;
- facilita transacoes, criacao de registros, consultas e sincronizacao do schema;
- mantem o projeto simples para um MVP academico.

As classes de modelo ficam em `src/models/`.

#### Swagger UI

O Swagger UI foi adicionado para documentar e testar a API pelo navegador. A documentacao e servida pela propria API principal em:

```text
http://localhost:3000/docs
```

A especificacao OpenAPI em JSON fica disponivel em:

```text
http://localhost:3000/docs.json
```

O Swagger inclui os endpoints da API principal e tambem os endpoints de controle do simulador. Os endpoints do simulador aparecem com o servidor `http://localhost:4000`, entao o simulador tambem precisa estar rodando para que esses testes funcionem pela interface.

### Modelos de dados

#### `spots`

Armazena o estado atual de cada vaga.

Campos principais:

- `spotId`: identificador da vaga, como `A-07`;
- `sectorId`: setor da vaga, como `A`;
- `currentState`: estado atual, `FREE` ou `OCCUPIED`;
- `lastChangeTs`: data/hora da ultima mudanca real de estado;
- `lastEventId`: ultimo evento aplicado na vaga.

Model Sequelize: `src/models/Spot.js`.

#### `spot_events`

Armazena o historico de eventos recebidos via MQTT.

Campos principais:

- `eventId`: identificador unico do evento;
- `ts`: timestamp do evento;
- `sectorId`: setor;
- `spotId`: vaga;
- `state`: estado informado;
- `rawPayloadJson`: payload original recebido.

Model Sequelize: `src/models/SpotEvent.js`.

#### `sector_snapshots`

Armazena fotografias periodicas da ocupacao dos setores.

Campos principais:

- `ts`: momento do snapshot;
- `sectorId`: setor;
- `occupiedCount`: quantidade de vagas ocupadas;
- `freeCount`: quantidade de vagas livres;
- `occupancyRate`: taxa de ocupacao.

Model Sequelize: `src/models/SectorSnapshot.js`.

#### `incidents`

Armazena inconsistencias detectadas pelo backend.

Campos principais:

- `id`: identificador do incidente;
- `tsOpen`: abertura;
- `tsClose`: fechamento, quando existir;
- `type`: tipo do incidente;
- `severity`: severidade;
- `sectorId`: setor relacionado;
- `spotId`: vaga relacionada;
- `evidenceJson`: evidencias usadas na deteccao;
- `status`: `open` ou `closed`.

Model Sequelize: `src/models/Incident.js`.

#### `recommendations_log`

Armazena recomendacoes calculadas pelo backend.

Campos principais:

- `ts`: momento da recomendacao;
- `fromSector`: setor de origem;
- `recommendedSector`: setor recomendado;
- `reason`: justificativa textual;
- `dataJson`: dados usados no calculo.

Model Sequelize: `src/models/RecommendationLog.js`.

## Estrutura do projeto

```text
.
├── docker-compose.yml
├── Dockerfile
├── README.md
├── package.json
├── .env.example
├── mosquitto/
│   └── mosquitto.conf
├── simulator/
│   └── index.js
└── src/
    ├── config.js
    ├── db.js
    ├── httpServer.js
    ├── layout.js
    ├── mqttClient.js
    ├── parkingService.js
    ├── recommendations.js
    ├── server.js
    └── models/
        ├── Incident.js
        ├── RecommendationLog.js
        ├── SectorSnapshot.js
        ├── Spot.js
        ├── SpotEvent.js
        └── index.js
```

## Configuracao do projeto

### Requisitos

Para executar com Docker:

- Docker;
- Docker Compose.

Para executar diretamente com Node.js:

- Node.js compativel com a versao indicada em `.nvmrc`;
- npm;
- Postgres;
- Mosquitto.

O caminho recomendado para a demo e usar Docker Compose, pois ele sobe todos os servicos necessarios.

### Variaveis de ambiente

Crie o arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

Variaveis disponiveis:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=smart_parking_lot
POSTGRES_PORT=5432

PORT=3000
SNAPSHOT_INTERVAL_MS=60000
STUCK_THRESHOLD_MINUTES=180
FLAPPING_WINDOW_MINUTES=10
FLAPPING_TRANSITIONS_THRESHOLD=6

MQTT_PORT=1883
MQTT_WS_PORT=9001

SIMULATOR_PORT=4000
SIM_TIME_SCALE_MS=1000
```

Descricao das variaveis:

- `POSTGRES_USER`: usuario do banco Postgres.
- `POSTGRES_PASSWORD`: senha do banco Postgres.
- `POSTGRES_DB`: nome do banco usado pela aplicacao.
- `POSTGRES_PORT`: porta exposta do Postgres no host.
- `PORT`: porta da API HTTP principal.
- `SNAPSHOT_INTERVAL_MS`: intervalo de geracao dos snapshots de setor.
- `STUCK_THRESHOLD_MINUTES`: tempo, em minutos simulados, para detectar sensor travado.
- `FLAPPING_WINDOW_MINUTES`: janela, em minutos simulados, para detectar flapping.
- `FLAPPING_TRANSITIONS_THRESHOLD`: numero minimo de transicoes dentro da janela de flapping.
- `MQTT_PORT`: porta MQTT exposta pelo Mosquitto.
- `MQTT_WS_PORT`: porta WebSocket exposta pelo Mosquitto.
- `SIMULATOR_PORT`: porta da API de controle do simulador.
- `SIM_TIME_SCALE_MS`: duracao real de um minuto simulado.

No Docker Compose, a `DATABASE_URL` da API e montada automaticamente a partir de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`.

Se for executar a API fora do Docker, defina tambem:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/smart_parking_lot
MQTT_URL=mqtt://localhost:1883
```

## Como rodar o projeto

### Rodando com Docker Compose

1. Crie o `.env`:

```bash
cp .env.example .env
```

2. Suba os servicos:

```bash
docker compose up --build
```

3. Verifique se a API esta respondendo:

```bash
curl http://localhost:3000/health
```

4. Verifique se o simulador esta respondendo:

```bash
curl http://localhost:4000/health
```

Servicos expostos por padrao:

- API HTTP: `http://localhost:3000`
- Swagger UI da API: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs.json`
- API do simulador: `http://localhost:4000`
- MQTT: `localhost:1883`
- MQTT WebSocket: `localhost:9001`
- Postgres: `localhost:5432`

Para ver os dois projetos rodando:

1. Abra `http://localhost:3000/docs` no navegador para testar a API principal e a API do simulador via Swagger.
2. Abra `http://localhost:3000/health` para conferir a API principal.
3. Abra `http://localhost:4000/health` para conferir o simulador.
4. Use `http://localhost:3000/api/v1/sectors` para ver a ocupacao calculada pelo backend.
5. Use `http://localhost:4000/faults` para ver as falhas ativas no simulador.

### Rodando localmente sem Docker

Este modo exige que Postgres e Mosquitto ja estejam rodando na maquina.

1. Instale as dependencias:

```bash
npm install
```

2. Crie o `.env`:

```bash
cp .env.example .env
```

3. Adicione ao `.env` as URLs locais:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/smart_parking_lot
MQTT_URL=mqtt://localhost:1883
```

4. Inicie a API:

```bash
npm run dev
```

5. Em outro terminal, inicie o simulador:

```bash
npm run simulator
```

Tambem existe o script:

```bash
npm run demo
```

Esse script inicia API e simulador juntos, mas ainda exige Postgres e Mosquitto rodando separadamente.

Depois de iniciar os processos localmente, acesse:

- Swagger UI: `http://localhost:3000/docs`
- API principal: `http://localhost:3000/health`
- Simulador: `http://localhost:4000/health`

No Swagger, os endpoints marcados como `Simulator` chamam `http://localhost:4000`. Por isso, para testar injecao de falhas e lotacao artificial pelo Swagger, mantenha o processo do simulador ativo.

## Endpoints HTTP

Os endpoints abaixo tambem podem ser testados pela interface Swagger:

```text
http://localhost:3000/docs
```

### Saude da API

```http
GET /health
```

Exemplo:

```bash
curl http://localhost:3000/health
```

### Mapa atual

```http
GET /api/v1/map
```

Retorna os setores, suas estatisticas e as vagas com estado atual.

Exemplo:

```bash
curl http://localhost:3000/api/v1/map
```

### Disponibilidade por setor

```http
GET /api/v1/sectors
```

Retorna `occupiedCount`, `freeCount`, `occupancyRate` e `lastUpdateTs` por setor.

Exemplo:

```bash
curl http://localhost:3000/api/v1/sectors
```

### Vagas de um setor

```http
GET /api/v1/sectors/:sectorId/spots
```

Exemplo:

```bash
curl http://localhost:3000/api/v1/sectors/A/spots
```

### Vagas livres por setor

```http
GET /api/v1/sectors/:sectorId/free-spots?limit=10
```

Exemplo:

```bash
curl "http://localhost:3000/api/v1/sectors/A/free-spots?limit=10"
```

### Relatorio de rotatividade

```http
GET /api/v1/reports/turnover?sectorId=A&from=...&to=...
```

Exemplo:

```bash
curl "http://localhost:3000/api/v1/reports/turnover?sectorId=A&from=2026-04-29T07:00:00.000Z&to=2026-04-29T12:00:00.000Z"
```

### Incidentes

```http
GET /api/v1/incidents?status=open
```

Exemplo:

```bash
curl http://localhost:3000/api/v1/incidents?status=open
```

### Recomendacao

```http
GET /api/v1/recommendation?fromSector=A
```

Exemplo:

```bash
curl http://localhost:3000/api/v1/recommendation?fromSector=A
```

## API de controle do simulador

### Saude do simulador

```http
GET /health
```

Exemplo:

```bash
curl http://localhost:4000/health
```

### Listar falhas ativas

```http
GET /faults
```

Exemplo:

```bash
curl http://localhost:4000/faults
```

### Injetar falha

```http
POST /faults
```

Payload:

```json
{
  "spotId": "A-07",
  "type": "flapping"
}
```

Exemplo:

```bash
curl -X POST http://localhost:4000/faults \
  -H "Content-Type: application/json" \
  -d '{"spotId":"A-07","type":"flapping"}'
```

### Remover falha

```http
DELETE /faults/:spotId
```

Exemplo:

```bash
curl -X DELETE http://localhost:4000/faults/A-07
```

### Lotar setor para demonstracao

```http
POST /fill-sector/:sectorId
```

Payload:

```json
{
  "target": 28
}
```

Exemplo:

```bash
curl -X POST http://localhost:4000/fill-sector/A \
  -H "Content-Type: application/json" \
  -d '{"target":28}'
```

Como cada setor possui 30 vagas, ocupar 28 vagas produz uma taxa de ocupacao de aproximadamente 93%, suficiente para acionar recomendacao.

## Roteiro de demonstracao

1. Subir a infraestrutura:

```bash
docker compose up --build
```

2. Confirmar que a API esta no ar:

```bash
curl http://localhost:3000/health
```

3. Confirmar que o simulador esta no ar:

```bash
curl http://localhost:4000/health
```

4. Ver setores atualizando:

```bash
curl http://localhost:3000/api/v1/sectors
```

5. Ver mapa completo:

```bash
curl http://localhost:3000/api/v1/map
```

6. Injetar falha de flapping:

```bash
curl -X POST http://localhost:4000/faults \
  -H "Content-Type: application/json" \
  -d '{"spotId":"A-07","type":"flapping"}'
```

7. Consultar incidentes:

```bash
curl http://localhost:3000/api/v1/incidents?status=open
```

8. Forcar setor lotado:

```bash
curl -X POST http://localhost:4000/fill-sector/A \
  -H "Content-Type: application/json" \
  -d '{"target":28}'
```

9. Consultar recomendacao:

```bash
curl http://localhost:3000/api/v1/recommendation?fromSector=A
```

## Scripts npm

```bash
npm start
```

Inicia a API com `node src/server.js`.

```bash
npm run dev
```

Inicia a API com `nodemon`.

```bash
npm run simulator
```

Inicia o simulador.

```bash
npm run demo
```

Inicia API e simulador em paralelo. Requer Postgres e Mosquitto rodando.

```bash
npm test
```

Executa verificacoes de sintaxe nos arquivos principais.

## Observacoes para desenvolvimento

O Sequelize cria as tabelas automaticamente durante a inicializacao da API usando `sequelize.sync()`. Em um ambiente de producao, o ideal seria substituir esse fluxo por migrations versionadas.

O projeto foi estruturado para ser um MVP didatico. Algumas decisoes priorizam clareza e demonstracao, como a sincronizacao automatica do schema e a API de controle do simulador.

O modulo de IA ainda nao esta implementado. A base de dados historica, especialmente `spot_events`, `sector_snapshots`, `incidents` e `recommendations_log`, foi pensada para permitir essa evolucao posteriormente.
