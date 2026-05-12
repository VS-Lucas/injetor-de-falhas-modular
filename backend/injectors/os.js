const { execCommand } = require('../utils');

// Pausa a VM, simulando uma falha de Sistema Operacional.
// VirtualBox 7.x usa `controlvm pause` em vez do antigo `pausevm`.
exports.pauseVm = (vmName) => {
    execCommand(`VBoxManage controlvm "${vmName}" pause`);
};

// Retoma a VM, simulando o reparo do Sistema Operacional.
exports.resumeVm = (vmName) => {
    execCommand(`VBoxManage controlvm "${vmName}" resume`);
};
