const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bp = require("body-parser");
const cors = require('cors');
const functions = require('./functions');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const allowedOrigins = ['http://localhost:3000'];

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

server.listen(3030, () =>
    console.log('[info][START_SERVER] Server start at port 3030')
);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
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
});

wss.on('connection', async (ws) => {
    console.log('[info][WEBSOCKET_CONNECTION] Client connected via WebSocket');

    ws.on('message', async (message) => {
        const req = JSON.parse(message);

        const mask = (s)=> s ? '******' : s;
        const rawTypes = Array.isArray(req?.injectionTypes) ? req.injectionTypes
            : (req?.injectionType ? [req.injectionType] : []);
        console.log('[debug] payload.types=', rawTypes, 'single=', req?.injectionType, {
            ip: req?.ip,
            sshUsername: req?.sshUsername,
            sshPassword: mask(req?.sshPassword),
            autoDetect: req?.autoDetectNetworkInterfaceId
        });

        const { error } = await functions.validate(req);
        let networkInterfaceId = req?.networkInterfaceId;

        if (error) {
            ws.send(JSON.stringify({ status: 'error', message: error }));
            return ws.close();
        }

        // reachability
        const serverIsReady = await functions.pingLoop([req?.ip]);
        if (!serverIsReady) {
            ws.send(JSON.stringify({ status: 'error', message: 'the server is not responding' }));
            return ws.close();
        }

        const types = rawTypes.filter(t => t === 'Hardware' || t === 'SO');
        if (types.length === 0) types.push('Hardware');
        console.log('[debug] resolved types=', types);

        if (types.includes('Hardware') && req?.autoDetectNetworkInterfaceId) {
            const ids = await functions.detectHardwareInterfaceId(req);
            if (ids.length > 0) networkInterfaceId = ids[0];
            else {
                ws.send(JSON.stringify({ status: 'error', message: 'can not detect hardware interface id' }));
                return ws.close();
            }
        }

        const runHardwareStep = async (attempt) => {
            const { secsToFail, secsToRepair } = functions.computeDeterministicDelays(req);

            const startMs = Date.now();
            const tFailMs = startMs + secsToFail * 1000;
            const tRepairMs = startMs + secsToRepair * 1000;

            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][HW] Tempo para falha` }));

            const schedFail = functions.scheduleAtOnVm({
                ip: req.ip,
                sshUsername: req.sshUsername,
                sshPassword: req.sshPassword,
                secondsAhead: secsToFail,
                iface: networkInterfaceId,
                action: 'down'
            });
            if (!schedFail.ok) throw new Error(`Falha ao agendar FALHA de hardware: ${schedFail.error}`);
            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][HW] ${schedFail.human}` }));

            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][HW] Tempo para reparo` }));
            const schedRepair = functions.scheduleAtOnVm({
                ip: req.ip,
                sshUsername: req.sshUsername,
                sshPassword: req.sshPassword,
                secondsAhead: secsToRepair,
                iface: networkInterfaceId,
                action: 'up'
            });
            if (!schedRepair.ok) throw new Error(`Falha ao agendar REPARO de hardware: ${schedRepair.error}`);
            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][HW] ${schedRepair.human}` }));

            const sleepUntil = async (ms) => {
                const d = ms - Date.now();
                if (d > 0) await new Promise(r => setTimeout(r, d));
            };

            await sleepUntil(tFailMs);

            const step = 5000;
            let nextTick = Date.now();
            while (nextTick < tRepairMs) {
                const up = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({
                    status: 'ok',
                    message: `[${attempt}][HW] ${functions.currentDateTimeFormated(false, true)} ${up ? 'ativo' : 'inativo'}`
                }));
                nextTick += step;
                await sleepUntil(Math.min(nextTick, tRepairMs));
            }

            for (let j = 0; j < 10; j++) {
                const up = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({
                    status: 'ok',
                    message: `[${attempt}][HW] ${functions.currentDateTimeFormated(false, true)} ${up ? 'ativo' : 'inativo'}`
                }));
                await new Promise(r => setTimeout(r, step));
            }
        };

        const runOsStep = async (attempt) => {
            const { secsToFail, secsToRepair } = functions.computeDeterministicDelays(req);

            const startMs = Date.now();
            const tFailMs = startMs + secsToFail * 1000;
            const tRepairMs = startMs + secsToRepair * 1000;

            const mode = req?.osRepair?.mode || 'hostStart';
            const provider = req?.osRepair?.provider || 'virtualbox';

            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] Tempo para falha` }));

            const failCmd = 'shutdown -P now';
            const schedFail = functions.scheduleAtOnVmCmd({
                ip: req.ip,
                sshUsername: req.sshUsername,
                sshPassword: req.sshPassword,
                secondsAhead: secsToFail,
                cmdLine: failCmd
            });
            if (!schedFail.ok) throw new Error(`Falha ao agendar shutdown do SO: ${schedFail.error}`);
            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] ${schedFail.human}` }));

            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] Tempo paro reparo` }));
            let schedRepair;
            if (mode === 'hostStart' && provider === 'virtualbox') {
                schedRepair = functions.scheduleAtOnHostVBox({
                    hostIp: req?.osRepair?.host?.ip,
                    hostUsername: req?.osRepair?.host?.sshUsername,
                    hostPassword: req?.osRepair?.host?.sshPassword,
                    secondsAhead: secsToRepair,
                    vmName: req?.osRepair?.vmName,
                    action: 'start'
                });
            } else {
                const rebootCmd = 'shutdown -r now';
                schedRepair = functions.scheduleAtOnVmCmd({
                    ip: req.ip,
                    sshUsername: req.sshUsername,
                    sshPassword: req.sshPassword,
                    secondsAhead: secsToRepair,
                    cmdLine: rebootCmd
                });
            }

            if (!schedRepair.ok) throw new Error(`Falha ao agendar reparo do SO: ${schedRepair.error}`);
            ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] ${schedRepair.human}` }));

            const sleepUntil = async (ms) => {
                const d = ms - Date.now();
                if (d > 0) await new Promise(r => setTimeout(r, d));
            };

            await sleepUntil(tFailMs);

            const step = 5000;
            let nextTick = Date.now();
            while (nextTick < tRepairMs) {
                const up = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({
                    status: 'ok',
                    message: `[${attempt}][SO] ${functions.currentDateTimeFormated(false, true)} ${up ? 'ativo' : 'inativo'}`
                }));
                nextTick += step;
                await sleepUntil(Math.min(nextTick, tRepairMs));
            }

            const extraMax = 36;
            let consecutiveUp = 0;
            for (let j = 0; j < extraMax; j++) {
                const up = await functions.pingLoop([req?.ip]);
                ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] ${functions.currentDateTimeFormated(false, true)} ${up ? 'ativo' : 'inativo'}` }));
                if (up) {
                    consecutiveUp++;
                    if (consecutiveUp >= 10) {
                        ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}][SO] estabilidade confirmada; encerrando observação` }));
                        break;
                    }
                } else {
                    consecutiveUp = 0;
                }
                await new Promise(r => setTimeout(r, step));
            }
        };

        let experimentCount = 0;
        const policy = req?.policy || 'chain';

        while (experimentCount < parseInt(req.experimentAttempts)) {
            experimentCount++;

            if (policy !== 'chain') {
                ws.send(JSON.stringify({ status: 'error', message: `policy '${policy}' ainda não suportada; use 'chain'` }));
                return ws.close();
            }

            for (const type of types) {
                if (type === 'Hardware') {
                    await runHardwareStep(experimentCount);
                } else if (type === 'SO') {
                    await runOsStep(experimentCount);
                } else {
                    ws.send(JSON.stringify({ status: 'error', message: `Tipo de falha não suportado: ${type}` }));
                    return ws.close();
                }
            }

            console.log(`[${experimentCount}] ciclo(s) finalizado(s)`);
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
    });
});
