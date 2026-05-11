const utils = require('./utils');
const hw = require('./injectors/hardware');
const os = require('./injectors/os');

// Envia uma mensagem de log para o cliente via WebSocket.
const log = (ws, attempt, message) =>
    ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}] ${message}` }));

// Monitora via ping e envia o estado a cada 5 segundos.
// Retorna quando o estado alvo ('up' ou 'down') é atingido ou o tempo máximo é esgotado.
const monitorAndLog = async (ws, attempt, ip, targetState, maxChecks = 36) => {
    for (let i = 0; i < maxChecks; i++) {
        const alive = await utils.pingLoop([ip]);
        const status = alive ? 'ativo' : 'inativo';
        log(ws, attempt, `${utils.currentDateTimeFormated(null, true)} ${status}`);

        const reached = targetState === 'down' ? !alive : alive;
        if (reached) return true;
        await utils.waitForSeconds(5);
    }
    return false;
};

// ─────────────────────────────────────────────
// Ciclo completo de falha de Hardware
// ─────────────────────────────────────────────
const runHwCycle = async (ws, req, networkInterfaceId, attempt, timers) => {
    const { timeToFail, timeToRepair } = timers;

    // Reparo agendado em (agora + TTF + TTR) para garantir que dispara APÓS a falha.
    const faultTimestamp  = utils.addMinuteToTimestamp(timeToFail);
    const repairTimestamp = utils.addMinuteToTimestamp(timeToFail + timeToRepair);

    log(ws, attempt, `[HW] Tempo de falha gerado: ${timeToFail.toFixed(2)} min → ${utils.currentDateTimeFormated(utils.addMinuteToTimestamp(timeToFail, true), true)}`);
    log(ws, attempt, `[HW] Tempo de reparo gerado: ${timeToRepair.toFixed(2)} min`);

    hw.scheduleFault(req, networkInterfaceId, faultTimestamp);
    hw.scheduleRepair(req, networkInterfaceId, repairTimestamp);

    log(ws, attempt, '[HW] Comandos agendados. Aguardando início da falha...');

    // Aguarda até o momento da falha e monitora até o sistema ficar DOWN.
    await utils.waitForATime(utils.addMinuteToTimestamp(timeToFail, true));
    log(ws, attempt, '[HW] Falha de Hardware iniciada. Monitorando...');
    await monitorAndLog(ws, attempt, req.ip, 'down');

    log(ws, attempt, '[HW] Sistema DOWN confirmado. Aguardando reparo...');

    // Aguarda até o momento do reparo e monitora até o sistema voltar UP.
    await utils.waitForATime(utils.addMinuteToTimestamp(timeToFail + timeToRepair, true));
    log(ws, attempt, '[HW] Reparo de Hardware iniciado. Monitorando...');
    await monitorAndLog(ws, attempt, req.ip, 'up');

    log(ws, attempt, '[HW] Sistema UP confirmado. Ciclo de Hardware concluído.');
};

// ─────────────────────────────────────────────
// Ciclo completo de falha de S.O.
// ─────────────────────────────────────────────
const runOsCycle = async (ws, req, attempt, timers) => {
    const { timeToFail, timeToRepair } = timers;

    log(ws, attempt, `[SO] Tempo de falha gerado: ${timeToFail.toFixed(2)} min`);
    log(ws, attempt, `[SO] Tempo de reparo gerado: ${timeToRepair.toFixed(2)} min`);
    log(ws, attempt, '[SO] Aguardando início da falha de S.O...');

    // Aguarda o TTF e então pausa a VM.
    await utils.waitForSeconds(timeToFail * 60);
    os.pauseVm(req.vmName);
    log(ws, attempt, '[SO] VM pausada (falha de S.O. injetada). Monitorando...');

    // Aguarda confirmação de DOWN via ping.
    await monitorAndLog(ws, attempt, req.ip, 'down');
    log(ws, attempt, '[SO] Sistema DOWN confirmado. Aguardando reparo...');

    // Reparo é agendado APÓS confirmação da falha (satisfaz requisito do professor).
    await utils.waitForSeconds(timeToRepair * 60);
    os.resumeVm(req.vmName);
    log(ws, attempt, '[SO] VM retomada (reparo de S.O. executado). Monitorando...');

    await monitorAndLog(ws, attempt, req.ip, 'up');
    log(ws, attempt, '[SO] Sistema UP confirmado. Ciclo de S.O. concluído.');
};

// ─────────────────────────────────────────────
// Ciclo com ambas as falhas
// ─────────────────────────────────────────────
const runBothCycles = async (ws, req, networkInterfaceId, attempt) => {
    const hwTimers = await utils.generateTimers(req.ttfHw, req.ttrHw);
    const osTimers = await utils.generateTimers(req.ttfOs, req.ttrOs);

    if (!hwTimers || !osTimers) {
        ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
        return false;
    }

    const hwFirst = hwTimers.timeToFail <= osTimers.timeToFail;

    if (hwFirst) {
        log(ws, attempt, `[AMBOS] HW falha primeiro (${hwTimers.timeToFail.toFixed(2)} min < ${osTimers.timeToFail.toFixed(2)} min)`);
        await runHwCycle(ws, req, networkInterfaceId, attempt, hwTimers);

        // Timer de SO foi perdido durante a falha de HW. Gerar novos tempos.
        log(ws, attempt, '[AMBOS] Gerando novos tempos para S.O. após reparo de HW...');
        const freshOsTimers = await utils.generateTimers(req.ttfOs, req.ttrOs);
        if (!freshOsTimers) {
            ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar timers de S.O.' }));
            return false;
        }
        await runOsCycle(ws, req, attempt, freshOsTimers);
    } else {
        log(ws, attempt, `[AMBOS] S.O. falha primeiro (${osTimers.timeToFail.toFixed(2)} min < ${hwTimers.timeToFail.toFixed(2)} min)`);
        await runOsCycle(ws, req, attempt, osTimers);
        await runHwCycle(ws, req, networkInterfaceId, attempt, hwTimers);
    }

    return true;
};

// ─────────────────────────────────────────────
// Ponto de entrada principal
// ─────────────────────────────────────────────
exports.runExperiment = async (ws, req, networkInterfaceId) => {
    const hasHw = req.faultTypes.includes('hardware');
    const hasOs = req.faultTypes.includes('os');
    const total = parseInt(req.experimentAttempts);

    for (let attempt = 1; attempt <= total; attempt++) {
        log(ws, attempt, `Iniciando tentativa ${attempt} de ${total}`);

        if (hasHw && hasOs) {
            const ok = await runBothCycles(ws, req, networkInterfaceId, attempt);
            if (!ok) return;
        } else if (hasHw) {
            const timers = await utils.generateTimers(req.ttfHw, req.ttrHw);
            if (!timers) {
                ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
                return;
            }
            await runHwCycle(ws, req, networkInterfaceId, attempt, timers);
        } else {
            const timers = await utils.generateTimers(req.ttfOs, req.ttrOs);
            if (!timers) {
                ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
                return;
            }
            await runOsCycle(ws, req, attempt, timers);
        }

        log(ws, attempt, `Tentativa ${attempt} concluída.`);
    }
};
