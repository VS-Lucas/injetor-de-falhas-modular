const { runCommand } = require('../utils');

const sshBase = (req) =>
    `sshpass -p '${req.sshPassword}' ssh -tt ${req.sshUsername}@${req.ip} -o StrictHostKeyChecking=no -o PasswordAuthentication=yes`;

// Agenda via `at` o desligamento da interface de rede na VM alvo.
// faultTimestamp: string no formato YYYYMMDDHHmm.ss gerada por addMinuteToTimestamp
exports.scheduleFault = (req, networkInterfaceId, faultTimestamp) => {
    const cmd = `${sshBase(req)} 'at -t ${faultTimestamp} <<<"echo ${req.sshPassword} | sudo -S ip link set ${networkInterfaceId} down"'`;
    return runCommand(cmd);
};

// Agenda via `at` a restauração da interface de rede na VM alvo.
// repairTimestamp deve ser (agora + TTF + TTR) para garantir que dispara APÓS a falha.
exports.scheduleRepair = (req, networkInterfaceId, repairTimestamp) => {
    const cmd = `${sshBase(req)} 'at -t ${repairTimestamp} <<<"echo ${req.sshPassword} | sudo -S ip link set ${networkInterfaceId} up"'`;
    return runCommand(cmd);
};
