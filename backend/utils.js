const { execSync, spawn } = require('child_process');
const ping = require('ping');
const R = require('r-integration');

const isEmpty = (val) => val === '' || val == undefined || val == null;

// Oculta a senha nos logs: mascara `-p 'senha'` e `echo senha | sudo -S`
const maskSensitive = (cmd) => cmd
    .replace(/(sshpass\s+-p\s+')([^']+)(')/g, "$1***$3")
    .replace(/(echo\s+)(\S+)(\s+\|\s+sudo\s+-S)/g, '$1***$3');

exports.currentDateTimeFormated = (nextDate, short) => {
    const checkZero = (data) => data.length == 1 ? '0' + data : data;

    const today = nextDate ? new Date(nextDate) : new Date();
    const day   = checkZero(String(today.getDate()));
    const month = checkZero(String(today.getMonth() + 1));
    const year  = String(today.getFullYear());
    const hour  = checkZero(String(today.getHours()));
    const min   = checkZero(String(today.getMinutes()));
    const sec   = checkZero(String(today.getSeconds()));

    return short
        ? `${hour}:${min}:${sec}`
        : `${day}/${month}/${year} ${hour}:${min}:${sec}`;
};

exports.runCommand = (command) => {
    console.log(`[COMMAND] ${maskSensitive(command)}`);
    return spawn(command, [], { shell: true, detached: true, stdio: 'ignore' });
};

exports.execCommand = (command) => {
    console.log(`[COMMAND] ${maskSensitive(command)}`);
    return execSync(command, { encoding: 'utf-8' });
};

// Retorna timestamp no formato exigido pelo `at -t`: YYYYMMDDHHmm.ss
// diff = minutos a adicionar a partir de agora
exports.addMinuteToTimestamp = (diff, timeOnly = false) => {
    const now = new Date();
    const future = new Date(now.getTime() + diff * 60000);
    if (timeOnly) return future;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${future.getFullYear()}${pad(future.getMonth() + 1)}${pad(future.getDate())}${pad(future.getHours())}${pad(future.getMinutes())}.${pad(future.getSeconds())}`;
};

exports.pingLoop = async (hosts) => {
    for (const host of hosts) {
        const res = await ping.promise.probe(host);
        if (!res.alive) return false;
    }
    return true;
};

// Monitora com ping até que o estado desejado seja atingido.
// state: 'down' | 'up'
// maxChecks: número máximo de verificações (intervalo de 5s cada)
exports.monitorUntil = async (host, state, maxChecks = 36) => {
    for (let i = 0; i < maxChecks; i++) {
        const alive = await exports.pingLoop([host]);
        const reached = state === 'down' ? !alive : alive;
        if (reached) return true;
        await exports.waitForSeconds(5);
    }
    return false;
};

// ttf e ttr são as médias (sementes) para a distribuição exponencial, em minutos.
exports.generateTimers = async (ttf, ttr, minMinutes = 0.01) => {
    const rateFailure = 1 / parseFloat(ttf);
    const rateRepair  = 1 / parseFloat(ttr);

    let timeToFail, timeToRepair;

    do {
        timeToFail   = parseFloat(R.executeRCommand(`rexp(1, rate=${rateFailure})`)[0]).toFixed(2);
        timeToRepair = parseFloat(R.executeRCommand(`rexp(1, rate=${rateRepair})`)[0]).toFixed(2);
    } while (timeToFail < minMinutes || timeToRepair < minMinutes);

    if (isNaN(timeToFail) || isNaN(timeToRepair)) return null;

    return { timeToFail: parseFloat(timeToFail), timeToRepair: parseFloat(timeToRepair) };
};

exports.autoDetectNetworkInterfaceNames = async (sshUsername, sshPassword, ip) => {
    // Encontra a interface que possui exatamente o IP `ip` — garante que a falha
    // derruba a interface usada pelo host para pingar e fazer SSH na VM.
    const command = `sshpass -p '${sshPassword}' ssh -o StrictHostKeyChecking=no ${sshUsername}@${ip} "ip -o addr show | awk '/inet ${ip}\\//{ print \\$2 }'"`;
    try {
        const output = execSync(command, { encoding: 'utf-8' }).toString().trim();
        const ifaces = output.split('\n').map(s => s.trim()).filter(Boolean);
        if (ifaces.length === 0)
            return { status: 'fail', data: { error: `Nenhuma interface encontrada com o IP ${ip}` } };
        return { status: 'success', data: ifaces };
    } catch (error) {
        return { status: 'fail', data: { error: error?.stderr } };
    }
};

exports.detectHardwareInterfaceId = async (req) => {
    console.log('[INFO] Detectando interfaces de rede...');
    const result = await exports.autoDetectNetworkInterfaceNames(req.sshUsername, req.sshPassword, req.ip);
    return result.status === 'success' ? result.data : [];
};

exports.validate = async (req) => {
    if (!req.faultTypes || !Array.isArray(req.faultTypes) || req.faultTypes.length === 0) {
        return { status: 'error', error: 'Selecione pelo menos um tipo de falha.' };
    }

    if (isEmpty(req.ip) || isEmpty(req.sshUsername) || isEmpty(req.sshPassword)) {
        return { status: 'error', error: 'IP, usuário SSH e senha SSH são obrigatórios.' };
    }

    const hasHw = req.faultTypes.includes('hardware');
    const hasOs = req.faultTypes.includes('os');

    if (hasHw) {
        if (isEmpty(req.ttfHw) || parseFloat(req.ttfHw) <= 0)
            return { status: 'error', error: 'TDF de Hardware deve ser maior que zero.' };
        if (isEmpty(req.ttrHw) || parseFloat(req.ttrHw) <= 0)
            return { status: 'error', error: 'TDR de Hardware deve ser maior que zero.' };
        if (req.autoDetectNetworkInterfaceId == null)
            return { status: 'error', error: 'Configuração de auto-detecção de interface é obrigatória.' };
        if (!req.autoDetectNetworkInterfaceId && isEmpty(req.networkInterfaceId))
            return { status: 'error', error: 'Identificador da interface de rede é obrigatório.' };
    }

    if (hasOs) {
        if (isEmpty(req.ttfOs) || parseFloat(req.ttfOs) <= 0)
            return { status: 'error', error: 'TDF de S.O. deve ser maior que zero.' };
        if (isEmpty(req.ttrOs) || parseFloat(req.ttrOs) <= 0)
            return { status: 'error', error: 'TDR de S.O. deve ser maior que zero.' };
        if (isEmpty(req.vmName))
            return { status: 'error', error: 'Nome da VM é obrigatório para falha de S.O.' };
    }

    return { status: true, error: null };
};

exports.waitForSeconds = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000));

exports.waitForATime = (futureDate) => {
    const diff = new Date(futureDate).getTime() - Date.now();
    if (diff <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, diff));
};
