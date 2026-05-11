const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bp = require('body-parser');
const cors = require('cors');
const utils = require('./utils');
const orchestrator = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const allowedOrigins = ['http://localhost:3000'];

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origem não permitida pela política CORS.'), false);
    },
}));

server.listen(3030, () => console.log('[INFO] Servidor iniciado na porta 3030'));

// ─── WebSocket ────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
    console.log('[INFO] Cliente conectado via WebSocket');

    ws.on('message', async (message) => {
        const req = JSON.parse(message);

        const { error } = await utils.validate(req);
        if (error) {
            ws.send(JSON.stringify({ status: 'error', message: error }));
            return ws.close();
        }

        const serverOnline = await utils.pingLoop([req.ip]);
        if (!serverOnline) {
            ws.send(JSON.stringify({ status: 'error', message: 'O servidor alvo não está respondendo.' }));
            return ws.close();
        }

        let networkInterfaceId = req.networkInterfaceId;

        if (req.faultTypes.includes('hardware') && req.autoDetectNetworkInterfaceId) {
            const interfaces = await utils.detectHardwareInterfaceId(req);
            if (interfaces.length === 0) {
                ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível detectar a interface de rede.' }));
                return ws.close();
            }
            networkInterfaceId = interfaces[0];
            ws.send(JSON.stringify({ status: 'ok', message: `Interface detectada: ${networkInterfaceId}` }));
        }

        await orchestrator.runExperiment(ws, req, networkInterfaceId);
        ws.close();
    });

    ws.on('close', () => console.log('[INFO] Cliente desconectado via WebSocket'));
});

// ─── REST ─────────────────────────────────────────────────────────────────────

app.get('/api/ping/:ip', async (req, res) => {
    if (!req.params.ip) {
        return res.status(400).json({ status: 'error', error: 'IP não informado.' });
    }
    const alive = await utils.pingLoop([req.params.ip]);
    res.status(200).json({ status: 200, server_status: alive });
});
