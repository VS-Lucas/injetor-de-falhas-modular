const { execCommand } = require('../utils');

// Pausa a VM, simulando uma falha de Sistema Operacional.
exports.pauseVm = (vmName) => {
    execCommand(`VBoxManage pausevm "${vmName}"`);
};

// Retoma a VM, simulando o reparo do Sistema Operacional.
exports.resumeVm = (vmName) => {
    execCommand(`VBoxManage resumevm "${vmName}"`);
};
