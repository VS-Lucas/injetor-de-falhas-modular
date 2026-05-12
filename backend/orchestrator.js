const utils = require('./utils');
const hw = require('./injectors/hardware');
const os = require('./injectors/os');

// ── Helpers de log no terminal ───────────────────────────────────────────────

const ts = () => utils.currentDateTimeFormated(null, true);

const clog = (cycle, tag, msg) => {
    const prefix = cycle != null ? `[CICLO #${cycle}]` : '[EXPERIMENTO]';
    const tagPart = tag ? ` [${tag}]` : '';
    console.log(`${ts()} ${prefix}${tagPart} ${msg}`);
};

const line = (char = '─', len = 64) => char.repeat(len);

const formatElapsed = (startMs) => {
    const totalSec = Math.floor((Date.now() - startMs) / 1000);
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    return `${hh}h ${mm}m ${ss}s`;
};

// ── Envio WebSocket (frontend) ───────────────────────────────────────────────

const log = (ws, attempt, message) =>
    ws.send(JSON.stringify({ status: 'ok', message: `[${attempt}] ${message}` }));

// ── Monitor via ping ─────────────────────────────────────────────────────────

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

// ── Ciclo de Hardware ────────────────────────────────────────────────────────

const runHwCycle = async (ws, req, networkInterfaceId, attempt, timers) => {
    const { timeToFail, timeToRepair } = timers;

    const faultAt  = utils.addMinuteToTimestamp(timeToFail, true);
    const repairAt = utils.addMinuteToTimestamp(timeToFail + timeToRepair, true);

    const faultAtStr  = utils.currentDateTimeFormated(faultAt, true);
    const repairAtStr = utils.currentDateTimeFormated(repairAt, true);

    clog(attempt, 'HW', `TTF: ${timeToFail.toFixed(2)} min  →  falha agendada para ${faultAtStr}`);
    clog(attempt, 'HW', `TTR: ${timeToRepair.toFixed(2)} min  →  reparo agendado para ${repairAtStr}`);

    log(ws, attempt, `[HW] Tempo de falha gerado: ${timeToFail.toFixed(2)} min → ${faultAtStr}`);
    log(ws, attempt, `[HW] Tempo de reparo gerado: ${timeToRepair.toFixed(2)} min`);

    hw.scheduleFault(req, networkInterfaceId, timeToFail);
    hw.scheduleRepair(req, networkInterfaceId, timeToFail + timeToRepair);

    clog(attempt, 'HW', `Comandos SSH enviados à VM. Aguardando falha...`);
    log(ws, attempt, '[HW] Comandos agendados. Aguardando início da falha...');

    await utils.waitForATime(faultAt);
    clog(attempt, 'HW', `Monitorando DOWN... (aguardando interface cair)`);
    log(ws, attempt, '[HW] Monitorando estado da interface (aguardando DOWN)...');
    const faultDetected = await monitorAndLog(ws, attempt, req.ip, 'down');

    if (faultDetected) {
        clog(attempt, 'HW', `✓ Sistema DOWN confirmado`);
        clog(attempt, 'HW', `Aguardando reparo em ${repairAtStr}...`);
        log(ws, attempt, '[HW] Sistema DOWN confirmado. Aguardando reparo...');
    } else {
        clog(attempt, 'HW', `⚠ AVISO: interface não ficou DOWN no tempo esperado`);
        log(ws, attempt, '[HW] AVISO: Interface não ficou DOWN no tempo esperado.');
    }

    await utils.waitForATime(repairAt);
    clog(attempt, 'HW', `Monitorando UP... (aguardando interface subir)`);
    log(ws, attempt, '[HW] Monitorando estado da interface (aguardando UP)...');
    const repairDetected = await monitorAndLog(ws, attempt, req.ip, 'up');

    if (repairDetected) {
        clog(attempt, 'HW', `✓ Sistema UP confirmado. Ciclo HW concluído.`);
        log(ws, attempt, '[HW] Sistema UP confirmado. Ciclo de Hardware concluído.');
    } else {
        clog(attempt, 'HW', `⚠ AVISO: sistema não retornou UP no tempo esperado`);
        log(ws, attempt, '[HW] AVISO: Sistema não retornou UP no tempo esperado.');
    }
};

// ── Ciclo de S.O. ────────────────────────────────────────────────────────────

const runOsCycle = async (ws, req, attempt, timers) => {
    const { timeToFail, timeToRepair } = timers;

    const faultInSec  = Math.round(timeToFail * 60);
    const repairInSec = Math.round(timeToRepair * 60);

    clog(attempt, 'SO', `TTF: ${timeToFail.toFixed(2)} min  (${faultInSec}s)`);
    clog(attempt, 'SO', `TTR: ${timeToRepair.toFixed(2)} min  (${repairInSec}s)`);
    clog(attempt, 'SO', `Aguardando TTF para pausar a VM...`);

    log(ws, attempt, `[SO] Tempo de falha gerado: ${timeToFail.toFixed(2)} min`);
    log(ws, attempt, `[SO] Tempo de reparo gerado: ${timeToRepair.toFixed(2)} min`);
    log(ws, attempt, '[SO] Aguardando início da falha de S.O...');

    await utils.waitForSeconds(timeToFail * 60);

    clog(attempt, 'SO', `Pausando VM "${req.vmName}"...`);
    os.pauseVm(req.vmName);
    clog(attempt, 'SO', `VM pausada. Monitorando DOWN...`);
    log(ws, attempt, '[SO] VM pausada (falha de S.O. injetada). Monitorando...');

    const faultDetected = await monitorAndLog(ws, attempt, req.ip, 'down');
    if (faultDetected) {
        clog(attempt, 'SO', `✓ Sistema DOWN confirmado. Aguardando TTR (${repairInSec}s)...`);
        log(ws, attempt, '[SO] Sistema DOWN confirmado. Aguardando reparo...');
    } else {
        clog(attempt, 'SO', `⚠ AVISO: sistema não ficou DOWN após pausar a VM`);
        log(ws, attempt, '[SO] AVISO: Sistema não ficou DOWN após pausar a VM.');
    }

    await utils.waitForSeconds(timeToRepair * 60);

    clog(attempt, 'SO', `Retomando VM "${req.vmName}"...`);
    os.resumeVm(req.vmName);
    clog(attempt, 'SO', `VM retomada. Monitorando UP...`);
    log(ws, attempt, '[SO] VM retomada (reparo de S.O. executado). Monitorando...');

    const repairDetected = await monitorAndLog(ws, attempt, req.ip, 'up');
    if (repairDetected) {
        clog(attempt, 'SO', `✓ Sistema UP confirmado. Ciclo SO concluído.`);
        log(ws, attempt, '[SO] Sistema UP confirmado. Ciclo de S.O. concluído.');
    } else {
        clog(attempt, 'SO', `⚠ AVISO: sistema não retornou UP no tempo esperado`);
        log(ws, attempt, '[SO] AVISO: Sistema não retornou UP no tempo esperado.');
    }
};

// ── Ciclo com ambas as falhas ─────────────────────────────────────────────────

const runBothCycles = async (ws, req, networkInterfaceId, attempt) => {
    const hwTimers = await utils.generateTimers(req.ttfHw, req.ttrHw);
    const osTimers = await utils.generateTimers(req.ttfOs, req.ttrOs);

    if (!hwTimers || !osTimers) {
        console.error(`${ts()} [CICLO #${attempt}] [ERRO] Falha ao gerar timers`);
        ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
        return false;
    }

    const hwFirst = hwTimers.timeToFail <= osTimers.timeToFail;

    if (hwFirst) {
        clog(attempt, 'AMBOS', `HW falha primeiro — TTF_HW ${hwTimers.timeToFail.toFixed(2)} min ≤ TTF_SO ${osTimers.timeToFail.toFixed(2)} min`);
        log(ws, attempt, `[AMBOS] HW falha primeiro (${hwTimers.timeToFail.toFixed(2)} min < ${osTimers.timeToFail.toFixed(2)} min)`);

        await runHwCycle(ws, req, networkInterfaceId, attempt, hwTimers);

        clog(attempt, 'AMBOS', `Gerando novos timers de SO (timers anteriores foram consumidos pelo ciclo HW)...`);
        log(ws, attempt, '[AMBOS] Gerando novos tempos para S.O. após reparo de HW...');

        const freshOsTimers = await utils.generateTimers(req.ttfOs, req.ttrOs);
        if (!freshOsTimers) {
            console.error(`${ts()} [CICLO #${attempt}] [ERRO] Falha ao gerar timers de SO`);
            ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar timers de S.O.' }));
            return false;
        }

        await runOsCycle(ws, req, attempt, freshOsTimers);
    } else {
        clog(attempt, 'AMBOS', `SO falha primeiro — TTF_SO ${osTimers.timeToFail.toFixed(2)} min < TTF_HW ${hwTimers.timeToFail.toFixed(2)} min`);
        log(ws, attempt, `[AMBOS] S.O. falha primeiro (${osTimers.timeToFail.toFixed(2)} min < ${hwTimers.timeToFail.toFixed(2)} min)`);

        await runOsCycle(ws, req, attempt, osTimers);
        await runHwCycle(ws, req, networkInterfaceId, attempt, hwTimers);
    }

    return true;
};

// ── Ponto de entrada ─────────────────────────────────────────────────────────

exports.runExperiment = async (ws, req, networkInterfaceId) => {
    const hasHw = req.faultTypes.includes('hardware');
    const hasOs = req.faultTypes.includes('os');

    const DURATION_MS = 3 * 24 * 60 * 60 * 1000;
    const startTime = Date.now();
    const endTime   = startTime + DURATION_MS;
    const endStr    = utils.currentDateTimeFormated(new Date(endTime), false);

    const faultLabel = hasHw && hasOs ? 'HW + SO' : hasHw ? 'HW' : 'SO';

    console.log(`\n${line('═')}`);
    console.log(`  EXPERIMENTO INICIADO — ${utils.currentDateTimeFormated(null, false)}`);
    console.log(`  Falhas   : ${faultLabel}`);
    console.log(`  Alvo     : ${req.ip}  |  Interface: ${networkInterfaceId || 'N/A'}`);
    if (hasOs) console.log(`  VM       : ${req.vmName}`);
    if (hasHw) console.log(`  HW       : TTF médio ${req.ttfHw} min  |  TTR médio ${req.ttrHw} min`);
    if (hasOs) console.log(`  SO       : TTF médio ${req.ttfOs} min  |  TTR médio ${req.ttrOs} min`);
    console.log(`  Duração  : 3 dias  →  término previsto em ${endStr}`);
    console.log(`${line('═')}\n`);

    let attempt = 1;

    while (Date.now() < endTime) {
        const cycleStart = Date.now();

        console.log(`${ts()} ${line()}`);
        console.log(`${ts()} [CICLO #${attempt}] Iniciando`);
        console.log(`${ts()} ${line()}`);

        log(ws, attempt, `Iniciando ciclo ${attempt}`);

        if (hasHw && hasOs) {
            const ok = await runBothCycles(ws, req, networkInterfaceId, attempt);
            if (!ok) return;
        } else if (hasHw) {
            const timers = await utils.generateTimers(req.ttfHw, req.ttrHw);
            if (!timers) {
                console.error(`${ts()} [CICLO #${attempt}] [ERRO] Falha ao gerar timers de HW`);
                ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
                return;
            }
            await runHwCycle(ws, req, networkInterfaceId, attempt, timers);
        } else {
            const timers = await utils.generateTimers(req.ttfOs, req.ttrOs);
            if (!timers) {
                console.error(`${ts()} [CICLO #${attempt}] [ERRO] Falha ao gerar timers de SO`);
                ws.send(JSON.stringify({ status: 'error', message: 'Não foi possível gerar os timers.' }));
                return;
            }
            await runOsCycle(ws, req, attempt, timers);
        }

        const elapsed = formatElapsed(cycleStart);
        console.log(`${ts()} [CICLO #${attempt}] Concluído — duração: ${elapsed}\n`);
        log(ws, attempt, `Ciclo ${attempt} concluído.`);
        attempt++;
    }

    const totalElapsed = formatElapsed(startTime);
    console.log(`\n${line('═')}`);
    console.log(`  EXPERIMENTO CONCLUÍDO — ${utils.currentDateTimeFormated(null, false)}`);
    console.log(`  Ciclos executados : ${attempt - 1}`);
    console.log(`  Duração total     : ${totalElapsed}`);
    console.log(`${line('═')}\n`);
};
