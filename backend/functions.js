const { execSync, execFileSync, spawn } = require('child_process');
const ping = require('ping');
const R = require('r-integration');

const isEmpty = (str) => (str === '' || str == undefined || str == null);

const maskText = (s) => (s ? '******' : s);

const safeArgsForLog = (args) => {
    const clone = [...args];
    for (let i = 0; i < clone.length; i++) {
        if ((clone[i] === '-p' || clone[i] === '--password') && i + 1 < clone.length) {
            clone[i + 1] = '******';
        }
    }
    return clone.join(' ');
};

const singleQuote = (s) => `'${String(s).replace(/'/g, `'\"'\"'`)}'`;

exports.currentDateTimeFormated = (nextDate, short) => {
    const zero2 = (n) => (String(n).length === 1 ? `0${n}` : String(n));
    const d = nextDate ? new Date(nextDate) : new Date();
    const day = zero2(d.getDate());
    const month = zero2(d.getMonth() + 1);
    const year = d.getFullYear();
    const hour = zero2(d.getHours());
    const minutes = zero2(d.getMinutes());
    const seconds = zero2(d.getSeconds());
    return !short
        ? `${day}/${month}/${year} ${hour}:${minutes}:${seconds}`
        : `${hour}:${minutes}:${seconds}`;
};

exports.addMinuteToTimestamp = (diffMinutes, timeOnly = false) => {
    const d = new Date(Date.now() + Number(diffMinutes) * 60000);
    if (timeOnly) return d;
    const yyyy = d.getFullYear();
    const MM = ('0' + (d.getMonth() + 1)).slice(-2);
    const dd = ('0' + d.getDate()).slice(-2);
    const HH = ('0' + d.getHours()).slice(-2);
    const mm = ('0' + d.getMinutes()).slice(-2);
    const ss = ('0' + d.getSeconds()).slice(-2);
    return `${yyyy}${MM}${dd}${HH}${mm}.${ss}`;
};

exports.runFileWithOutput = (cmd, args) => {
    try {
        const out = execFileSync(cmd, args, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.log('[ok][COMMAND_EXEC_FILE]', cmd, safeArgsForLog(args));
        if (out?.trim()) console.log(out.trim());
        return { ok: true, out };
    } catch (e) {
        const err = e?.stderr?.toString?.() || e.message;
        console.error('[err][COMMAND_EXEC_FILE]', cmd, err);
        return { ok: false, err };
    }
};

exports.pingLoop = async (hosts) => {
    let status = true;
    for (const host of hosts) {
        const res = await ping.promise.probe(host);
        if (!res.alive) status = false;
    }
    return status;
};

exports.computeDeterministicDelays = (req) => {
    const secsToFail = Math.max(1, Math.ceil(parseFloat(req.timeToFail) * 60));
    let secsToRepair = Math.max(1, Math.ceil(parseFloat(req.timeToRepair) * 60));
    if (secsToRepair <= secsToFail) secsToRepair = secsToFail + 1; // garante reparo > falha
    return { secsToFail, secsToRepair };
};

exports.generateTimers = async (req, mode = 'deterministic') => {
    if (mode === 'deterministic') {
        const ttf = Math.max(1e-6, parseFloat(req.timeToFail));
        let ttr = Math.max(1e-6, parseFloat(req.timeToRepair));
        if (ttr <= ttf) ttr = ttf + 1 / 60; // +1s
        return { timeToFail: ttf, timeToRepair: ttr };
    }

    const timeToFailRate = 1 / parseFloat(req.timeToFail);
    const timeToRepairRate = 1 / parseFloat(req.timeToRepair);

    let TTF, TTR;
    do {
        const expFail = R.executeRCommand(`rexp(1, rate=${timeToFailRate})`);
        const expRepr = R.executeRCommand(`rexp(1, rate=${timeToRepairRate})`);
        TTF = parseFloat(expFail[0]);
        TTR = parseFloat(expRepr[0]);
    } while (TTF <= 0 || TTR <= TTF);

    return { timeToFail: TTF, timeToRepair: TTR };
};

exports.validate = async (req) => {
    if (isEmpty(req?.ip) || isEmpty(req?.sshUsername) || isEmpty(req?.sshPassword)
        || isEmpty(req?.autoDetectNetworkInterfaceId) || isEmpty(req?.injectionType) || isEmpty(req?.timeToFail)
        || isEmpty(req?.timeToRepair) || isEmpty(req?.experimentAttempts)) {
        return { status: 'error', error: 'All fields is required' };
    }
    if (!req?.injectionType) return { status: 'error', error: 'injectionType cannot be empty' };
    if (req?.timeToFail <= 0) return { status: 'error', error: 'timeToFail cannot be less than or equal to zero' };
    if (req?.timeToRepair <= 0) return { status: 'error', error: 'timeToRepair cannot be less than or equal to zero' };
    if (!req?.autoDetectNetworkInterfaceId && isEmpty(req?.networkInterfaceId)) {
        return { status: 'error', error: 'networkInterfaceId cannot be empty' };
    }
    return { status: true, error: null };
};

exports.waitForSeconds = async (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000));

exports.waitForATime = (horario) => {
    const target = (horario instanceof Date) ? horario : new Date(horario);
    const ms = target.getTime() - Date.now();
    if (ms <= 0) return Promise.resolve('O horário especificado já passou.');
    return new Promise((resolve) => setTimeout(() => resolve(`Esperou até ${target.toLocaleTimeString()}`), ms));
};


exports.scheduleAtOnVm = ({ ip, sshUsername, sshPassword, secondsAhead, iface, action }) => {
    const secs = Math.max(1, Number(secondsAhead) | 0);
    const passQ = singleQuote(sshPassword);

    const quoteForRemoteSingle = (s) => `'${String(s).replace(/'/g, `'"'"'`)}'`;

    // script que roda NA VM (bash -lc)
    // 1) Calcula o alvo em epoch (segundos)
    // 2) Arredonda para o início do minuto
    // 3) REM = segundos restantes dentro do minuto
    // 4) Agenda no minuto (TS_MIN) e, no conteúdo do job, faz: sleep REM; echo 'senha' | sudo -S ip link set ...
    const innerScript = [
        'set -euo pipefail;',
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin;',
        'AT=$(command -v at || echo /usr/bin/at);',
        'DATE=$(command -v date || echo /bin/date);',
        'SED=$(command -v sed || echo /usr/bin/sed);',
        'IPBIN=$(command -v ip || echo /usr/sbin/ip);',

        // alvo (em segundos) e "minute boundary"
        `TARGET_EPOCH=$($DATE -d "+${secs} seconds" +%s);`,
        `MINUTE_EPOCH=$(( TARGET_EPOCH - (TARGET_EPOCH % 60) ));`,
        `REM=$(( TARGET_EPOCH - MINUTE_EPOCH ));`,

        // timestamp humano do alvo real (com segundos)
        `HUMAN=$($DATE -d "@$TARGET_EPOCH" +"%d/%m/%Y %H:%M:%S");`,

        // timestamp do início do minuto (sem segundos)
        `TS_MIN=$($DATE -d "@$MINUTE_EPOCH" +%Y%m%d%H%M);`,

        // conteúdo do job: sleep REM; (depois executa o comando)secs
        // atenção: tudo numa única linha passada ao 'at' via stdin
        `JOB_LINE="sleep $REM; echo ${passQ} | sudo -S $IPBIN link set ${iface} ${action}";`,

        // agenda e guarda saída
        `RES=$(printf '%s\n' "$JOB_LINE" | $AT -t "$TS_MIN" 2>&1);`,

        // imprime bruto + parseável
        'echo "$RES";',
        `echo "$RES" | $SED -n 's/^.*job \\([0-9]\\+\\) at \\(.*\\)$/JOB:\\1;WHEN:\\2/p';`,
        'echo "HUMAN:$HUMAN";',
        'echo "REM:$REM";',
        'echo "TS_MIN:$TS_MIN";'
    ].join(' ');

    const innerQuoted = quoteForRemoteSingle(innerScript);

    // executa via sshpass/ssh com vetor de args (sem shell local bagunçando aspas)
    const args = [
        '-p', sshPassword,
        'ssh',
        '-tt',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'PasswordAuthentication=yes',
        `${sshUsername}@${ip}`,
        'bash', '-lc', innerQuoted
    ];

    const { ok, out, err } = exports.runFileWithOutput('sshpass', args);
    if (!ok) return { ok: false, error: err };

    // Extrai JOB/HUMAN/REM/TS_MIN (úteis para mostrar no front e validar)
    const jobMatch   = out.match(/JOB:(\d+);WHEN:(.*)/);
    const humanMatch = out.match(/HUMAN:(.*)/);
    const remMatch   = out.match(/REM:(\d+)/);
    const tsminMatch = out.match(/TS_MIN:(\d+)/);

    if (!jobMatch) {
        return { ok: false, error: out || 'no at job created (empty output)' };
    }

    return {
        ok: true,
        jobId: jobMatch[1],
        whenStr: jobMatch[2].trim(),                   // ex.: "Wed Nov  5 01:07:00 2025" (minuto)
        human: humanMatch ? humanMatch[1].trim() : null, // "05/11/2025 01:07:39" (alvo real)
        rem: remMatch ? Number(remMatch[1]) : null,    // segundos de sleep dentro do job
        tsMin: tsminMatch ? tsminMatch[1] : null,      // YYYYMMDDHHMM
        raw: out
    };
};

// helper interno para rodar um comando na VM e devolver stdout (ou null)
const sshRun = (sshUsername, sshPassword, ip, remoteCmd) => {
    const { execFileSync } = require('child_process');
    try {
        const out = execFileSync('sshpass', [
            '-p', sshPassword,
            'ssh',
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'PasswordAuthentication=yes',
            `${sshUsername}@${ip}`,
            'bash', '-lc', remoteCmd
        ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
        return out.trim();
    } catch {
        return null;
    }
};

// tenta descobrir a iface "principal" pela rota default (mais confiável)
const detectDefaultRouteIface = (sshUsername, sshPassword, ip) => {
    const cmd = `
    PATH=/usr/sbin:/usr/bin:/sbin:/bin;
    ip -o route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'
  `;
    const out = sshRun(sshUsername, sshPassword, ip, cmd);
    return out && out !== 'lo' ? out : null;
};

// lista ifaces com 'ip' e filtra nomes "reais"
const listIfacesViaIp = (sshUsername, sshPassword, ip) => {
    const cmd = `
    PATH=/usr/sbin:/usr/bin:/sbin:/bin;
    ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | sed 's/@.*//' |
      grep -E -v '^(lo|docker.*|veth.*|br-.*|virbr.*|tun.*|tap.*|wg.*)$' | sort -u
  `;
    const out = sshRun(sshUsername, sshPassword, ip, cmd);
    return out ? out.split('\n').filter(Boolean) : [];
};

// lista ifaces pelo /sys/class/net
const listIfacesViaSys = (sshUsername, sshPassword, ip) => {
    const cmd = `
    ls -1 /sys/class/net 2>/dev/null |
      grep -E -v '^(lo|docker.*|veth.*|br-.*|virbr.*|tun.*|tap.*|wg.*)$' | sort -u
  `;
    const out = sshRun(sshUsername, sshPassword, ip, cmd);
    return out ? out.split('\n').filter(Boolean) : [];
};

// ordena priorizando interfaces com operstate=up
const sortByOperstate = (sshUsername, sshPassword, ip, ifaces) => {
    const states = new Map();
    ifaces.forEach((iface) => {
        const st = sshRun(sshUsername, sshPassword, ip, `cat /sys/class/net/${iface}/operstate 2>/dev/null`);
        states.set(iface, (st || '').trim());
    });
    return [...ifaces].sort((a, b) => {
        const sa = states.get(a) === 'up' ? 0 : 1;
        const sb = states.get(b) === 'up' ? 0 : 1;
        return sa - sb || a.localeCompare(b);
    });
};

exports.autoDetectNetworkInterfaceNames = async (sshUsername, sshPassword, ip) => {
    // 1) default route
    const primary = detectDefaultRouteIface(sshUsername, sshPassword, ip);
    if (primary) {
        // ainda assim retorna lista (coloca a principal primeiro)
        const others = listIfacesViaIp(sshUsername, sshPassword, ip);
        const combined = [primary, ...others.filter((n) => n !== primary)];
        return { status: 'success', data: sortByOperstate(sshUsername, sshPassword, ip, combined) };
    }

    // 2) ip -o link
    const viaIp = listIfacesViaIp(sshUsername, sshPassword, ip);
    if (viaIp.length > 0) {
        return { status: 'success', data: sortByOperstate(sshUsername, sshPassword, ip, viaIp) };
    }

    // 3) /sys/class/net
    const viaSys = listIfacesViaSys(sshUsername, sshPassword, ip);
    if (viaSys.length > 0) {
        return { status: 'success', data: sortByOperstate(sshUsername, sshPassword, ip, viaSys) };
    }

    // 4) nada encontrado
    return { status: 'fail', data: { error: 'no interface could be detected (ip/ifconfig/sys all failed)' } };
};

exports.detectHardwareInterfaceId = async (req) => {
    console.log('[info][START_SERVER] Trying to detect network interfaces');
    const resp = await this.autoDetectNetworkInterfaceNames(req?.sshUsername, req?.sshPassword, req?.ip);
    return (resp.status === 'success') ? resp.data : [];
};

