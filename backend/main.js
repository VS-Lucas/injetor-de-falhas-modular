const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bp = require("body-parser")
const cors = require('cors')
const functions = require('./functions')

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const allowedOrigins = ['http://localhost:3000'];

app.use(bp.json())
app.use(bp.urlencoded({ extended: true }))
server.listen(3030, () => console.log('[info][START_SERVER] Server start at port 3030'))

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); if (allowedOrigins.indexOf(origin) === -1) {
      var msg = 'The CORS policy for this site does not ' +
        'allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }

    return callback(null, true);
  }
}));

app.get('/', (req, res) => {
  if (!req?.body?.name) {
    return res.status(400).json({
      status: 'error',
      error: 'req body cannot be empty',
    });
  }
  res.status(200).json({
    status: 'success',
    data: req.body,
  });
})

wss.on('connection', async (ws) => {
    console.log('[info][WEBSOCKET_CONNECTION] Client connected via WebSocket');

    ws.on('message', async (message) => {
        const req = JSON.parse(message);
        const { error } = await functions.validate(req);
        let networkInterfaceId = req?.networkInterfaceId;

        if (error) {
            ws.send(JSON.stringify({ status: 'error', message: error }));
            return ws.close();
        }

        const serverIsReady = await functions.pingLoop([req?.ip]);
        if (!serverIsReady) {
            ws.send(JSON.stringify({ status: 'error', message: 'the server is not responding' }));
            return ws.close();
        }

        if (req?.autoDetectNetworkInterfaceId) {
            const ids = await functions.detectHardwareInterfaceId(req);
            if (ids.length > 0) networkInterfaceId = ids[0];
            else {
                ws.send(JSON.stringify({ status: 'error', message: 'can not detect hardware interface id' }));
                return ws.close();
            }
        }

        const sleepUntil = async (targetMs) => {
            const now = Date.now();
            const ms = targetMs - now;
            if (ms <= 0) return;
            await new Promise(r => setTimeout(r, ms));
        };

        let experimentCount = 0;

        while (experimentCount < parseInt(req.experimentAttempts)) {
            experimentCount++;

            const { secsToFail, secsToRepair } = functions.computeDeterministicDelays(req);
            const startMs   = Date.now();
            const tFailMs   = startMs + secsToFail   * 1000;
            const tRepairMs = startMs + secsToRepair * 1000;

            // Agenda FALHA e REPARO (na VM) e pega horários "human" (com segundos)
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] Tempo de falha` }));
            const schedFail = functions.scheduleAtOnVm({
                ip: req.ip, sshUsername: req.sshUsername, sshPassword: req.sshPassword,
                secondsAhead: secsToFail, iface: networkInterfaceId, action: 'down'
            });
            if (!schedFail.ok) {
                ws.send(JSON.stringify({ status: 'error', message: `Falha ao agendar FALHA: ${schedFail.error}` }));
                return ws.close();
            }
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] ${schedFail.human}` }));
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] Falha injetada (agendada)` }));

            const schedRepair = functions.scheduleAtOnVm({
                ip: req.ip, sshUsername: req.sshUsername, sshPassword: req.sshPassword,
                secondsAhead: secsToRepair, iface: networkInterfaceId, action: 'up'
            });
            if (!schedRepair.ok) {
                ws.send(JSON.stringify({ status: 'error', message: `Falha ao agendar REPARO: ${schedRepair.error}` }));
                return ws.close();
            }

            // já informa o horário do reparo (da VM) ANTES de esperar
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] Tempo para reparo` }));
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] ${schedRepair.human}` }));
            ws.send(JSON.stringify({ status: 'ok', message: `[${experimentCount}] Reparo injetado (agendado)` }));

            await sleepUntil(tFailMs);

            const step = 5000;
            let nextTick = Date.now();
            while (nextTick < tRepairMs) {
                const pingStatus = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({
                    status: 'ok',
                    message: `[${experimentCount}] ${functions.currentDateTimeFormated(false, true)} ${pingStatus ? 'ativo' : 'inativo'}`
                }));
                nextTick += step;
                await sleepUntil(Math.min(nextTick, tRepairMs));
            }

            for (let j = 0; j < 9; j++) {
                const pingStatus = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({
                    status: 'ok',
                    message: `[${experimentCount}] ${functions.currentDateTimeFormated(false, true)} ${pingStatus ? 'ativo' : 'inativo'}`
                }));
                await new Promise(r => setTimeout(r, step));
            }

            console.log(`[${experimentCount}]: Fim do script de injeção`);
        }

        return ws.close();
    });

    ws.on('close', () => {
        console.log('[info][WEBSOCKET_CONNECTION] Client disconnected via WebSocket');
    });
});

app.get('/api/ping/:ip', async (req, res) => {
  if (!req?.params?.ip) {
    return res.status(400).json({
      status: 'error',
      error: 'ip cannot be empty',
    });
  }

  const status = await functions.pingLoop([req?.params?.ip]);

  res.status(200).json({
    status: 200,
    server_status: status
  })

})
