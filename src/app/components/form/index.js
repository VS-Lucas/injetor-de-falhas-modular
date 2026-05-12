"use client";
import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import injectorLogo from '../../../../public/fault_injector_logo.png';
import Loading from '../loading';
import CsvDownloadButton from 'react-json-to-csv';
import { LABELS } from '@/app/constants';

const Form = () => {
    // ── Conexão SSH ──────────────────────────────────────────────────────────
    const [ip, setIp] = useState('');
    const [sshUsername, setSshUsername] = useState('');
    const [sshPassword, setSshPassword] = useState('');

    // ── Tipos de falha ───────────────────────────────────────────────────────
    const [hwSelected, setHwSelected] = useState(false);
    const [osSelected, setOsSelected] = useState(false);

    // ── Campos de Hardware ───────────────────────────────────────────────────
    const [autoDetectNetworkInterfaceId, setAutoDetectNetworkInterfaceId] = useState(true);
    const [networkInterfaceId, setNetworkInterfaceId] = useState('');
    const [ttfHw, setTtfHw] = useState('');
    const [ttrHw, setTtrHw] = useState('');

    // ── Campos de S.O. ───────────────────────────────────────────────────────
    const [vmName, setVmName] = useState('');
    const [ttfOs, setTtfOs] = useState('');
    const [ttrOs, setTtrOs] = useState('');

    // ── Experimento ──────────────────────────────────────────────────────────
    const [experimentAttempts, setExperimentAttempts] = useState('');

    // ── UI ───────────────────────────────────────────────────────────────────
    const [logMsg, setLogMsg] = useState([]);
    const [errorText, setErrorText] = useState('');
    const [loading, setLoading] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const [toast, setToast] = useState(null);
    const pingRunningRef = useRef(false);
    const logContainerRef = useRef(null);

    const showToast = (msg, success = true) => {
        setToast({ msg, success });
        setTimeout(() => setToast(null), 2500);
    };

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logMsg, autoScroll]);

    const timestamp = () => {
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    };

    useEffect(() => {
        if (loading && ip) {
            pingRunningRef.current = true;
            const loop = async () => {
                if (!pingRunningRef.current) return;
                const start = Date.now();
                try {
                    const res = await fetch(`${process.env.NEXT_PUBLIC_PING_API_ROUTE}${ip}`);
                    const data = await res.json();
                    setLogMsg(prev => [...prev, `${timestamp()} ${data.server_status ? LABELS.status_up : LABELS.status_down}`]);
                } catch {
                    setLogMsg(prev => [...prev, `${timestamp()} ${LABELS.status_down}`]);
                }
                const elapsed = Date.now() - start;
                const delay = Math.max(0, 1000 - elapsed);
                if (pingRunningRef.current) setTimeout(loop, delay);
            };
            loop();
        } else {
            pingRunningRef.current = false;
        }
        return () => { pingRunningRef.current = false; };
    }, [loading, ip]);

    const isEmpty = (val) => val === '' || val == null || val == undefined;

    const showError = (msg) => {
        setErrorText(msg);
        setTimeout(() => setErrorText(''), 5000);
    };

    const buildPayload = () => ({
        ip,
        sshUsername,
        sshPassword,
        faultTypes: [hwSelected && 'hardware', osSelected && 'os'].filter(Boolean),
        autoDetectNetworkInterfaceId,
        networkInterfaceId,
        ttfHw,
        ttrHw,
        vmName,
        ttfOs,
        ttrOs,
        experimentAttempts,
    });

    const validate = () => {
        if (!hwSelected && !osSelected) return LABELS.form_error_select_fault;
        if (isEmpty(ip) || isEmpty(sshUsername) || isEmpty(sshPassword))
            return 'IP, usuário SSH e senha SSH são obrigatórios.';
        if (isEmpty(experimentAttempts) || parseInt(experimentAttempts) <= 0)
            return 'Número de tentativas deve ser maior que zero.';
        if (hwSelected) {
            if (isEmpty(ttfHw) || parseFloat(ttfHw) <= 0) return `${LABELS.form_ttf_hw} inválido.`;
            if (isEmpty(ttrHw) || parseFloat(ttrHw) <= 0) return `${LABELS.form_ttr_hw} inválido.`;
            if (!autoDetectNetworkInterfaceId && isEmpty(networkInterfaceId))
                return `${LABELS.form_network_interface_id} é obrigatório.`;
        }
        if (osSelected) {
            if (isEmpty(ttfOs) || parseFloat(ttfOs) <= 0) return `${LABELS.form_ttf_os} inválido.`;
            if (isEmpty(ttrOs) || parseFloat(ttrOs) <= 0) return `${LABELS.form_ttr_os} inválido.`;
            if (isEmpty(vmName)) return `${LABELS.form_vm_name} é obrigatório.`;
        }
        return null;
    };

    const handleOnSubmit = async () => {
        const validationError = validate();
        if (validationError) return showError(validationError);

        setLoading(true);
        try {
            const webSocket = new WebSocket(process.env.NEXT_PUBLIC_INJECTOR_API_WS_ROUTE);

            webSocket.onclose = () => setLoading(false);

            webSocket.onopen = () => webSocket.send(JSON.stringify(buildPayload()));

            webSocket.onmessage = (event) => {
                if (!event.data) return;
                const data = JSON.parse(event.data);
                if (data?.status === 'error') {
                    setLoading(false);
                    showError(data.message);
                } else if (data?.status === 'ok') {
                    setLogMsg((prev) => [...prev, data.message]);
                }
            };
        } catch (error) {
            console.error(error);
            setLoading(false);
            showError('Não foi possível completar a requisição.');
        }
    };

    const inputClass =
        'pt-3 pb-2 block w-full px-0 mt-0 bg-transparent border-0 border-b-2 appearance-none focus:outline-none focus:ring-0 focus:border-black border-gray-200';
    const labelClass = 'absolute duration-300 top-3 origin-0 text-gray-500 pointer-events-none';

    return (
        <div className="bg-gray-100 p-0 sm:p-12">
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm transition-all duration-300 ${toast.success ? 'bg-green-600' : 'bg-red-500'}`}>
                    {toast.msg}
                </div>
            )}
            <div className="mx-auto max-w-md px-6 py-2 bg-white border-0 shadow-lg rounded-3xl mb-2">

                {/* Cabeçalho */}
                <div className="flex flex-row mx-0 mb-4 mt-4">
                    <Image src={injectorLogo} height={120} alt="Fault Injector App Logo" />
                    <h1 className="text-2xl font-bold mb-8 text-center mt-4 text-black">
                        {LABELS.app_title}
                    </h1>
                </div>

                {/* Erro */}
                {errorText && (
                    <div className="bg-red-300 min-h-2 my-4 p-4 rounded-lg transition-all duration-150 ease-linear">
                        {errorText}
                    </div>
                )}

                {/* Monitor de eventos */}
                {(loading || logMsg.length > 0) && (
                    <div className="flex flex-col mx-0 mb-4">

                        {/* Linha acima do painel: label + botões */}
                        <div className="flex items-center justify-between mt-4 mb-1 px-1">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monitor</span>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAutoScroll(prev => !prev)}
                                    className={`text-xs transition-colors ${autoScroll ? 'text-green-600 hover:text-green-800' : 'text-gray-400 hover:text-gray-700'}`}
                                >
                                    {autoScroll ? '↓ Auto-scroll on' : '↓ Auto-scroll off'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const text = logMsg.join('\n');
                                        try {
                                            if (navigator.clipboard) {
                                                navigator.clipboard.writeText(text).then(
                                                    () => showToast('Copiado com sucesso!'),
                                                    () => showToast('Erro ao copiar.', false)
                                                );
                                            } else {
                                                const ta = document.createElement('textarea');
                                                ta.value = text;
                                                ta.style.position = 'fixed';
                                                ta.style.opacity = '0';
                                                document.body.appendChild(ta);
                                                ta.focus();
                                                ta.select();
                                                document.execCommand('copy');
                                                document.body.removeChild(ta);
                                                showToast('Copiado com sucesso!');
                                            }
                                        } catch {
                                            showToast('Erro ao copiar.', false);
                                        }
                                    }}
                                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                    {LABELS.form_copy_monitor}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLogMsg([])}
                                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                    {LABELS.form_clear_monitor}
                                </button>
                            </div>
                        </div>

                        {/* Painel de log */}
                        <div
                            ref={logContainerRef}
                            className="bg-black text-white rounded-lg p-4 flex flex-col max-h-48 overflow-y-auto"
                        >
                            {logMsg.map((msg, i) => <small key={i}>{msg}</small>)}
                        </div>

                        {logMsg.length > 0 && (
                            <CsvDownloadButton
                                data={[logMsg]}
                                filename="ttr_log.csv"
                                className="w-full px-6 py-3 mt-3 text-lg text-white transition-all duration-150 ease-linear rounded-lg shadow outline-none bg-neutral-400 hover:bg-neutral-600 hover:shadow-lg focus:outline-none"
                            >
                                {LABELS.form_download_log}
                            </CsvDownloadButton>
                        )}
                    </div>
                )}

                <form id="form" noValidate className="bg-gray-100 p-4 rounded-lg">

                    {/* IP */}
                    <div className="relative z-0 w-full mb-5">
                        <input type="text" id="ip" placeholder=" " required value={ip}
                            onChange={e => setIp(e.target.value)} className={inputClass} />
                        <label htmlFor="ip" className={labelClass}>{LABELS.form_ip}</label>
                    </div>

                    {/* SSH Username */}
                    <div className="relative z-0 w-full mb-5">
                        <input type="text" id="sshUsername" placeholder=" " required value={sshUsername}
                            onChange={e => setSshUsername(e.target.value)} className={inputClass} />
                        <label htmlFor="sshUsername" className={labelClass}>{LABELS.form_ssh_username}</label>
                    </div>

                    {/* SSH Password */}
                    <div className="relative z-0 w-full mb-5">
                        <input type="password" id="sshPassword" placeholder=" " value={sshPassword}
                            onChange={e => setSshPassword(e.target.value)} className={inputClass} />
                        <label htmlFor="sshPassword" className={labelClass}>{LABELS.form_ssh_password}</label>
                    </div>

                    {/* Tipos de falha */}
                    <fieldset className="relative z-0 w-full p-px mb-5">
                        <legend className="text-gray-600 text-sm mb-2">{LABELS.form_fault_types}</legend>
                        <div className="flex flex-row space-x-6 pt-1">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={hwSelected}
                                    onChange={e => setHwSelected(e.target.checked)}
                                    className="w-4 h-4 text-red-600 border-2 border-gray-300 rounded focus:ring-red-500" />
                                <span className="text-gray-700">{LABELS.form_hardware}</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input type="checkbox" checked={osSelected}
                                    onChange={e => setOsSelected(e.target.checked)}
                                    className="w-4 h-4 text-red-600 border-2 border-gray-300 rounded focus:ring-red-500" />
                                <span className="text-gray-700">{LABELS.form_os}</span>
                            </label>
                        </div>
                    </fieldset>

                    {/* ── Seção Hardware ─────────────────────────────────────── */}
                    {hwSelected && (
                        <div className="border border-gray-200 rounded-lg p-4 mb-5">
                            <p className="text-sm font-semibold text-gray-500 mb-3">{LABELS.form_hardware}</p>

                            <fieldset className="relative z-0 w-full p-px mb-4">
                                <legend className="absolute text-gray-600 transform scale-75 -top-3 origin-0">
                                    {LABELS.form_autodetect_network_interface}
                                </legend>
                                <div className="block pt-3 pb-2 space-x-4">
                                    <label>
                                        <input type="radio" name="autoDetect"
                                            onChange={() => setAutoDetectNetworkInterfaceId(true)}
                                            defaultChecked={autoDetectNetworkInterfaceId}
                                            className="mr-2 text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black" />
                                        {LABELS.form_yes}
                                    </label>
                                    <label>
                                        <input type="radio" name="autoDetect"
                                            onChange={() => setAutoDetectNetworkInterfaceId(false)}
                                            className="mr-2 text-black border-2 border-gray-300 focus:border-gray-300 focus:ring-black" />
                                        {LABELS.form_no}
                                    </label>
                                </div>
                            </fieldset>

                            {!autoDetectNetworkInterfaceId && (
                                <div className="relative z-0 w-full mb-4">
                                    <input type="text" id="networkInterfaceId" placeholder=" "
                                        value={networkInterfaceId}
                                        onChange={e => setNetworkInterfaceId(e.target.value)}
                                        className={inputClass} />
                                    <label htmlFor="networkInterfaceId" className={labelClass}>
                                        {LABELS.form_network_interface_id}
                                    </label>
                                </div>
                            )}

                            <div className="flex flex-row space-x-4">
                                <div className="relative z-0 w-full">
                                    <input type="number" id="ttfHw" placeholder=" " value={ttfHw}
                                        onChange={e => setTtfHw(e.target.value)} className={inputClass} />
                                    <div className="absolute top-0 right-0 mt-3 mr-1 text-gray-500 text-sm">min</div>
                                    <label htmlFor="ttfHw" className={labelClass}>{LABELS.form_ttf_hw}</label>
                                </div>
                                <div className="relative z-0 w-full">
                                    <input type="number" id="ttrHw" placeholder=" " value={ttrHw}
                                        onChange={e => setTtrHw(e.target.value)} className={inputClass} />
                                    <div className="absolute top-0 right-0 mt-3 mr-1 text-gray-500 text-sm">min</div>
                                    <label htmlFor="ttrHw" className={labelClass}>{LABELS.form_ttr_hw}</label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Seção S.O. ─────────────────────────────────────────── */}
                    {osSelected && (
                        <div className="border border-gray-200 rounded-lg p-4 mb-5">
                            <p className="text-sm font-semibold text-gray-500 mb-3">{LABELS.form_os}</p>

                            <div className="relative z-0 w-full mb-4">
                                <input type="text" id="vmName" placeholder=" " value={vmName}
                                    onChange={e => setVmName(e.target.value)} className={inputClass} />
                                <label htmlFor="vmName" className={labelClass}>{LABELS.form_vm_name}</label>
                            </div>

                            <div className="flex flex-row space-x-4">
                                <div className="relative z-0 w-full">
                                    <input type="number" id="ttfOs" placeholder=" " value={ttfOs}
                                        onChange={e => setTtfOs(e.target.value)} className={inputClass} />
                                    <div className="absolute top-0 right-0 mt-3 mr-1 text-gray-500 text-sm">min</div>
                                    <label htmlFor="ttfOs" className={labelClass}>{LABELS.form_ttf_os}</label>
                                </div>
                                <div className="relative z-0 w-full">
                                    <input type="number" id="ttrOs" placeholder=" " value={ttrOs}
                                        onChange={e => setTtrOs(e.target.value)} className={inputClass} />
                                    <div className="absolute top-0 right-0 mt-3 mr-1 text-gray-500 text-sm">min</div>
                                    <label htmlFor="ttrOs" className={labelClass}>{LABELS.form_ttr_os}</label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tentativas */}
                    <div className="relative z-0 w-full mb-5">
                        <input type="number" id="experimentAttempts" placeholder=" "
                            value={experimentAttempts}
                            onChange={e => setExperimentAttempts(e.target.value)}
                            className={`${inputClass} pl-5`} />
                        <div className="absolute top-0 right-0 mt-3 mr-4 text-gray-600">
                            {LABELS.form_attempts}
                        </div>
                        <label htmlFor="experimentAttempts"
                            className="absolute duration-300 top-3 left-5 -z-1 origin-0 text-gray-600">
                            {LABELS.form_experiment_attempts}
                        </label>
                    </div>

                    {/* Botão */}
                    <button
                        type="button"
                        onClick={handleOnSubmit}
                        className="w-full px-6 py-3 mt-3 text-lg text-white transition-all duration-150 ease-linear rounded-lg shadow outline-none bg-red-600 hover:bg-red-800 hover:shadow-lg focus:outline-none"
                    >
                        {loading ? <Loading /> : LABELS.form_inject}
                    </button>

                </form>
            </div>
        </div>
    );
};

export default Form;
