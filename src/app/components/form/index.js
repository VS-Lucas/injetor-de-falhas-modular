"use client";
import React, { useState } from 'react';
import injectorLogo from '../../../../public/fault_injector_logo.png';
import Image from 'next/image';
import Loading from '../loading';
import CsvDownloadButton from 'react-json-to-csv';
import { LABELS } from '@/app/constants';

const Form = () => {
    const [ip, setIp] = useState('');
    const [sshUsername, setSshUsername] = useState('');
    const [sshPassword, setSshPassword] = useState('');
    const [networkInterfaceId, setNetworkInterfaceId] = useState('');
    const [autoDetectNetworkInterfaceId, setAutoDetectNetworkInterfaceId] = useState(true);

    const [injectionTypes, setInjectionTypes] = useState(['Hardware']);
    const [policy] = useState('chain');

    const [hostIp, setHostIp] = useState('');
    const [hostUsername, setHostUsername] = useState('');
    const [hostPassword, setHostPassword] = useState('');
    const [vmName, setVmName] = useState('UbuntuServer');

    const [timeToFail, setTimeToFail] = useState('');
    const [timeToRepair, setTimeToRepair] = useState('');
    const [experimentAttempts, setExperimentAttempts] = useState('');
    const [logMsg, setLogMsg] = useState([]);
    const [showError, setShowError] = useState(false);
    const [showErrorText, setShowErrorText] = useState('');
    const [loading, setLoading] = useState(false);

    const isEmpty = (str) => (str === '' || str == null || str === undefined);

    const showErrorMsg = (msg) => {
        setShowError(true);
        setShowErrorText(msg);
        setTimeout(() => {
            setShowError(false);
            setShowErrorText('');
        }, 5000);
    };

    const toggleInjectionType = (type) => {
        setInjectionTypes(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const handleOnSubmit = async () => {
        if (isEmpty(ip) || isEmpty(sshUsername) || isEmpty(sshPassword)
            || isEmpty(timeToFail) || isEmpty(timeToRepair) || isEmpty(experimentAttempts)) {
            return showErrorMsg('All fields required.');
        }

        if (!Array.isArray(injectionTypes) || injectionTypes.length === 0) {
            return showErrorMsg('Selecione pelo menos um tipo de injeção.');
        }

        if (injectionTypes.includes('SO')) {
            if (isEmpty(hostIp) || isEmpty(hostUsername) || isEmpty(hostPassword) || isEmpty(vmName)) {
                return showErrorMsg('Para falha de SO: host, usuário, senha e nome da VM são obrigatórios.');
            }
        }

        setLoading(true);
        try {
            const webSocket = new WebSocket(process.env.NEXT_PUBLIC_INJECTOR_API_WS_ROUTE);

            webSocket.onclose = () => setLoading(false);

            webSocket.onopen = () => {
                const compatSingleType = injectionTypes[0] || 'Hardware';

                const payload = {
                    ip,
                    sshPassword,
                    sshUsername,
                    experimentAttempts,
                    timeToFail,
                    timeToRepair,
                    autoDetectNetworkInterfaceId,
                    networkInterfaceId,
                    policy,
                    injectionTypes,
                    injectionType: compatSingleType
                };

                if (injectionTypes.includes('SO')) {
                    payload.osRepair = {
                        mode: 'hostStart',
                        provider: 'virtualbox',
                        host: { ip: hostIp, sshUsername: hostUsername, sshPassword: hostPassword },
                        vmName
                    };
                }

                webSocket.send(JSON.stringify(payload));
            };

            webSocket.onmessage = async (event) => {
                if (!event.data) return;
                const data = JSON.parse(event.data);
                if (data?.status === 'error') {
                    setLoading(false);
                    return showErrorMsg(data.message);
                }
                if (data?.status === 'ok') {
                    setLogMsg((prev) => [...prev, data.message]);
                }
            };
        } catch (error) {
            console.log(error);
            setLoading(false);
            return showErrorMsg('Unable to complete request');
        }
    };

    return (
        <div className="bg-gray-100 p-0 sm:p-12">
            <div className="mx-auto max-w-md px-6 py-2 bg-white border-0 shadow-lg rounded-3xl mb-2">
                <div className="flex flex-row mx-0 mb-4 mt-4">
                    <Image src={injectorLogo} height={120} alt="Fault Injector App Logo" />
                    <h1 className="text-2xl font-bold mb-8 text-center mt-4 text-black">{LABELS.app_title}</h1>
                </div>

                {showError && (
                    <div className="bg-red-300 min-h-2 my-4 p-4 rounded-lg transition-all duration-150 ease-linear">
                        {showErrorText}
                    </div>
                )}

                {logMsg.length > 0 && (
                    <div className="flex flex-col mx-0 mb-4">
                        <div className="bg-black text-white min-h-2 my-4 p-4 rounded-lg transition-all duration-150 ease-linear flex flex-col h-full max-h-48 overflow-y-auto overflow-anchor-auto">
                            {logMsg.map((log, idx) => (<small key={idx}>{log}</small>))}
                        </div>
                        <CsvDownloadButton
                            data={[logMsg]}
                            filename="ttr_log.csv"
                            className="w-full px-6 py-3 mt-3 text-lg text-white transition-all duration-150 ease-linear rounded-lg shadow outline-none bg-neutral-400 hover:bg-neutral-600 hover:shadow-lg focus:outline-none"
                        >
                            {LABELS.form_download_log}
                        </CsvDownloadButton>
                    </div>
                )}

                <form id="form" noValidate className="bg-gray-100 p-4 rounded-lg">
                    <div className="relative z-0 w-full mb-5">
                        <input
                            type="text"
                            name="ip"
                            id="ip"
                            placeholder=" "
                            required
                            value={ip}
                            onChange={e => setIp(e.target.value)}
                            className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                        />
                        <label htmlFor="ip" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                            {LABELS.form_ip}
                        </label>
                    </div>

                    <div className="relative z-0 w-full mb-5">
                        <input
                            required
                            value={sshUsername}
                            onChange={e => setSshUsername(e.target.value)}
                            type="text"
                            name="sshUsername"
                            id="sshUsername"
                            placeholder=" "
                            className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                        />
                        <label htmlFor="sshUsername" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                            {LABELS.form_ssh_username}
                        </label>
                    </div>

                    <div className="relative z-0 w-full mb-5">
                        <input
                            value={sshPassword}
                            onChange={e => setSshPassword(e.target.value)}
                            type="password"
                            name="sshPassword"
                            id="sshPassword"
                            placeholder=" "
                            className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                        />
                        <label htmlFor="sshPassword" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                            {LABELS.form_ssh_password}
                        </label>
                    </div>

                    <fieldset className="relative z-0 w-full p-px mb-5">
                        <legend className="absolute text-gray-600 transform scale-75 -top-3 origin-0">
                            {LABELS.form_autodetect_network_interface}
                        </legend>
                        <div className="block pt-3 pb-2 space-x-4">
                            <label>
                                <input
                                    type="radio"
                                    name="autoDetectNetworkInterfaceId"
                                    onChange={() => setAutoDetectNetworkInterfaceId(true)}
                                    defaultValue={true}
                                    defaultChecked={autoDetectNetworkInterfaceId}
                                    className="mr-2 text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black"
                                />
                                {LABELS.form_yes}
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="autoDetectNetworkInterfaceId"
                                    onChange={() => setAutoDetectNetworkInterfaceId(false)}
                                    defaultValue={false}
                                    className="mr-2 text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black"
                                />
                                {LABELS.form_no}
                            </label>
                        </div>
                    </fieldset>

                    {!autoDetectNetworkInterfaceId && (
                        <div className="relative z-0 w-full mb-5">
                            <input
                                type="text"
                                name="networkInterfaceId"
                                id="networkInterfaceId"
                                value={networkInterfaceId}
                                onChange={e => setNetworkInterfaceId(e.target.value)}
                                placeholder=" "
                                className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                            />
                            <label htmlFor="networkInterfaceId" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                {LABELS.form_network_interface_id}
                            </label>
                        </div>
                    )}

                    <fieldset className="relative z-0 w-full p-px mb-5">
                        <legend className="absolute text-gray-600 transform scale-75 -top-3 origin-0">
                            {LABELS.form_injection_type}
                        </legend>
                        <div className="block pt-4 pb-2 space-y-3">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={injectionTypes.includes('Hardware')}
                                    onChange={() => toggleInjectionType('Hardware')}
                                    className="text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black"
                                />
                                {LABELS.form_injection_option_hw}
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={injectionTypes.includes('SO')}
                                    onChange={() => toggleInjectionType('SO')}
                                    className="text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black"
                                />
                                {LABELS.form_injection_option_os}
                            </label>
                        </div>
                    </fieldset>

                    {injectionTypes.includes('SO') && (
                        <>
                            <div className="relative z-0 w-full mb-5">
                                <input
                                    type="text"
                                    name="hostIp"
                                    id="hostIp"
                                    value={hostIp}
                                    onChange={e => setHostIp(e.target.value)}
                                    placeholder=" "
                                    className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                                />
                                <label htmlFor="hostIp" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                    {LABELS.form_os_host_ip}
                                </label>
                            </div>

                            <div className="relative z-0 w-full mb-5">
                                <input
                                    type="text"
                                    name="hostUsername"
                                    id="hostUsername"
                                    value={hostUsername}
                                    onChange={e => setHostUsername(e.target.value)}
                                    placeholder=" "
                                    className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                                />
                                <label htmlFor="hostUsername" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                    {LABELS.form_os_host_ssh_username}
                                </label>
                            </div>

                            <div className="relative z-0 w-full mb-5">
                                <input
                                    type="password"
                                    name="hostPassword"
                                    id="hostPassword"
                                    value={hostPassword}
                                    onChange={e => setHostPassword(e.target.value)}
                                    placeholder=" "
                                    className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                                />
                                <label htmlFor="hostPassword" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                    {LABELS.form_os_host_ssh_password}
                                </label>
                            </div>

                            <div className="relative z-0 w-full mb-5">
                                <input
                                    type="text"
                                    name="vmName"
                                    id="vmName"
                                    value={vmName}
                                    onChange={e => setVmName(e.target.value)}
                                    placeholder=" "
                                    className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                                />
                                <label htmlFor="vmName" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                    {LABELS.form_os_vm_name}
                                </label>
                            </div>
                        </>
                    )}

                    <div className="flex flex-row space-x-4">
                        <div className="relative z-0 w-full mb-5">
                            <input
                                value={timeToFail}
                                onChange={e => setTimeToFail(e.target.value)}
                                type="text"
                                name="timeToFail"
                                id="timeToFail"
                                placeholder=" "
                                className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                            />
                            <div className="absolute top-0 right-0 mt-3 mr-4 text-gray-600">min</div>
                            <label htmlFor="timeToFail" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                {LABELS.form_time_to_failure}
                            </label>
                        </div>
                        <div className="relative z-0 w-full">
                            <input
                                value={timeToRepair}
                                onChange={e => setTimeToRepair(e.target.value)}
                                type="text"
                                name="timeToRepair"
                                id="timeToRepair"
                                placeholder=" "
                                className="pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                            />
                            <div className="absolute top-0 right-0 mt-3 mr-4 text-gray-600">min</div>
                            <label htmlFor="timeToRepair" className="absolute duration-300 top-3 -z-1 origin-0 text-gray-600">
                                {LABELS.form_time_to_repair}
                            </label>
                        </div>
                    </div>

                    <div className="relative z-0 w-full mb-5">
                        <input
                            value={experimentAttempts}
                            onChange={e => setExperimentAttempts(e.target.value)}
                            type="number"
                            name="experimentAttempts"
                            id="experimentAttempts"
                            placeholder=" "
                            className="pt-3 pb-2 pl-5 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200"
                        />
                        <div className="absolute top-0 right-0 mt-3 mr-4 text-gray-600">{LABELS.form_attempts}</div>
                        <label htmlFor="experimentAttempts" className="absolute duration-300 top-3 left-5 -z-1 origin-0 text-gray-600">
                            {LABELS.form_experiment_attempts}
                        </label>
                    </div>

                    <button
                        id="button"
                        type="button"
                        className="w-full px-6 py-3 mt-3 text-lg text-white transition-all duration-150 ease-linear rounded-lg shadow outline-none bg-red-600 hover:bg-red-800 hover:shadow-lg focus:outline-none"
                        onClick={handleOnSubmit}
                    >
                        {loading ? <Loading /> : LABELS.form_inject}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Form;
