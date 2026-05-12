const { runCommand } = require('../utils');

const sshBase = (req) =>
    `sshpass -p '${req.sshPassword}' ssh -o StrictHostKeyChecking=no -o PasswordAuthentication=yes ${req.sshUsername}@${req.ip}`;

const ipCmd = (req, iface, action) =>
    `echo ${req.sshPassword} | sudo -S ip link set ${iface} ${action}`;

// Usa nohup+sleep para qualquer duração. O processo fica rodando na VM em background
// mesmo após o SSH encerrar, sem depender do daemon `at`.
const buildCommand = (req, iface, diffMinutes, action) => {
    const totalSeconds = Math.round(diffMinutes * 60);
    const sleepPrefix = totalSeconds > 0 ? `sleep ${totalSeconds} && ` : '';
    return `${sshBase(req)} "nohup bash -c '${sleepPrefix}${ipCmd(req, iface, action)}' > /dev/null 2>&1 &"`;
};

// diffMinutes: minutos a partir de agora até a falha (float)
exports.scheduleFault = (req, networkInterfaceId, diffMinutes) =>
    runCommand(buildCommand(req, networkInterfaceId, diffMinutes, 'down'));

// diffMinutes: deve ser timeToFail + timeToRepair para disparar após a falha
exports.scheduleRepair = (req, networkInterfaceId, diffMinutes) =>
    runCommand(buildCommand(req, networkInterfaceId, diffMinutes, 'up'));
