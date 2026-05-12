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

    // Pré-computa os timestamps absolutos ANTES de qualquer await, garantindo que
    // ambos usam o mesmo instante T como base — o mesmo que hardware.js usa ao
    // montar os comandos `at` e `nohup+sleep`.
    const faultAt  = utils.addMinuteToTimestamp(timeToFail, true);
    const repairAt = utils.addMinuteToTimestamp(timeToFail + timeToRepair, true);

    log(ws, attempt, `[HW] Tempo de falha gerado: ${timeToFail.toFixed(2)} min → ${utils.currentDateTimeFormated(faultAt, true)}`);
    log(ws, attempt, `[HW] Tempo de reparo gerado: ${timeToRepair.toFixed(2)} min`);

    // Passa os tempos em minutos; hardware.js combina `at` + `sleep` para precisão de segundo.
    // Reparo agendado em (TTF + TTR) minutos para garantir disparo após a falha.
    hw.scheduleFault(req, networkInterfaceId, timeToFail);
    hw.scheduleRepair(req, networkInterfaceId, timeToFail + timeToRepair);

    log(ws, attempt, '[HW] Comandos agendados. Aguardando início da falha...');

    // Aguarda até o momento da falha e monitora até o sistema ficar DOWN.
    await utils.waitForATime(faultAt);
    log(ws, attempt, '[HW] Monitorando estado da interface (aguardando DOWN)...');
    const faultDetected = await monitorAndLog(ws, attempt, req.ip, 'down');

    if (faultDetected) {
        log(ws, attempt, '[HW] Sistema DOWN confirmado. Aguardando reparo...');
    } else {
        log(ws, attempt, '[HW] AVISO: Interface não ficou DOWN no tempo esperado. Verifique se o daemon `at` está ativo na VM.');
    }

    // Aguarda até o momento do reparo e monitora até o sistema voltar UP.
    await utils.waitForATime(repairAt);
    log(ws, attempt, '[HW] Monitorando estado da interface (aguardando UP)...');
    const repairDetected = await monitorAndLog(ws, attempt, req.ip, 'up');

    if (repairDetected) {
        log(ws, attempt, '[HW] Sistema UP confirmado. Ciclo de Hardware concluído.');
    } else {
        log(ws, attempt, '[HW] AVISO: Sistema não retornou UP no tempo esperado.');
    }
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
    const faultDetected = await monitorAndLog(ws, attempt, req.ip, 'down');
    if (faultDetected) {
        log(ws, attempt, '[SO] Sistema DOWN confirmado. Aguardando reparo...');
    } else {
        log(ws, attempt, '[SO] AVISO: Sistema não ficou DOWN após pausar a VM. Verifique o nome da VM e o VBoxManage.');
    }

    // Reparo é agendado APÓS confirmação da falha (satisfaz requisito do professor).
    await utils.waitForSeconds(timeToRepair * 60);
    os.resumeVm(req.vmName);
    log(ws, attempt, '[SO] VM retomada (reparo de S.O. executado). Monitorando...');

    const repairDetected = await monitorAndLog(ws, attempt, req.ip, 'up');
    if (repairDetected) {
        log(ws, attempt, '[SO] Sistema UP confirmado. Ciclo de S.O. concluído.');
    } else {
        log(ws, attempt, '[SO] AVISO: Sistema não retornou UP no tempo esperado.');
    }
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
