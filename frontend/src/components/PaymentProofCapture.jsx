import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const MAX_PROOF_BYTES = 1_800_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function dataUrlBytes(value) {
    const encoded = value.split(',')[1] || '';
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    return Math.floor(encoded.length * 3 / 4) - padding;
}

function stopTracks(stream) {
    stream?.getTracks().forEach((track) => track.stop());
}

export default function PaymentProofCapture({ proof, onProof, disabled = false, active = true }) {
    const fileRef = useRef(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const mountedRef = useRef(false);
    const activeRef = useRef(active);
    activeRef.current = active;
    const [cameraOn, setCameraOn] = useState(false);
    const [cameraLoading, setCameraLoading] = useState(false);
    const [message, setMessage] = useState('');

    const closeCamera = () => {
        stopTracks(streamRef.current);
        streamRef.current = null;
        setCameraOn(false);
    };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopTracks(streamRef.current);
            streamRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (active) return;
        stopTracks(streamRef.current);
        streamRef.current = null;
        setCameraOn(false);
    }, [active]);

    useEffect(() => {
        if (cameraOn && videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current;
        }
    }, [cameraOn]);

    const acceptFile = (file) => {
        if (!file) return;
        if (!IMAGE_TYPES.has(file.type)) {
            setMessage('Selecciona una imagen PNG, JPEG o WebP.');
            return;
        }
        if (file.size > MAX_PROOF_BYTES) {
            setMessage('La imagen supera el tamaño permitido de 1,8 MB.');
            return;
        }
        setMessage('');
        const reader = new FileReader();
        reader.onload = () => {
            if (!mountedRef.current || !activeRef.current) return;
            const value = String(reader.result || '');
            if (!value.startsWith(`data:${file.type};base64,`) || dataUrlBytes(value) > MAX_PROOF_BYTES) {
                setMessage('No se pudo validar la imagen seleccionada.');
                return;
            }
            onProof(value);
        };
        reader.onerror = () => {
            if (mountedRef.current && activeRef.current) setMessage('No se pudo leer la imagen. Inténtalo de nuevo.');
        };
        reader.readAsDataURL(file);
    };

    const openCamera = async () => {
        if (cameraOn || cameraLoading || !mountedRef.current || !activeRef.current) return;
        setMessage('');
        const getUserMedia = navigator.mediaDevices?.getUserMedia;
        if (!getUserMedia) {
            setMessage('La cámara no está disponible. Adjunta una imagen.');
            return;
        }
        setCameraLoading(true);
        try {
            const stream = await getUserMedia.call(navigator.mediaDevices, {
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
            if (!mountedRef.current || !activeRef.current) {
                stopTracks(stream);
                return;
            }
            streamRef.current = stream;
            setCameraOn(true);
        } catch {
            if (mountedRef.current) setMessage('No se pudo abrir la cámara. Adjunta una imagen.');
        } finally {
            if (mountedRef.current) setCameraLoading(false);
        }
    };

    const capture = () => {
        const video = videoRef.current;
        if (!video) return;
        const sourceWidth = video.videoWidth || 1280;
        const sourceHeight = video.videoHeight || 720;
        const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sourceWidth * scale);
        canvas.height = Math.round(sourceHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) {
            setMessage('No se pudo procesar la foto. Adjunta una imagen.');
            return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        let value = '';
        for (const quality of [0.82, 0.7, 0.58, 0.48]) {
            value = canvas.toDataURL('image/jpeg', quality);
            if (dataUrlBytes(value) <= MAX_PROOF_BYTES) break;
        }
        if (!value.startsWith('data:image/jpeg;base64,') || dataUrlBytes(value) > MAX_PROOF_BYTES) {
            setMessage('La foto supera el tamaño permitido. Adjunta una imagen más pequeña.');
            return;
        }
        onProof(value);
        closeCamera();
    };

    return (
        <div className="space-y-2" data-testid="comprobante-captura">
            <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-11" disabled={disabled} onClick={() => fileRef.current?.click()} data-testid="comprobante-subir">
                    Adjuntar imagen
                </Button>
                <Button type="button" variant="outline" className="h-11" disabled={disabled || cameraLoading || cameraOn} onClick={openCamera} data-testid="comprobante-tomar">
                    {cameraLoading ? 'Abriendo cámara…' : 'Tomar foto'}
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG o WebP; máximo 1,8 MB. Si la cámara no está disponible, use Adjuntar imagen.</p>
            <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                className="sr-only"
                data-testid="comprobante-archivo"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    acceptFile(file);
                }}
            />
            {cameraOn && (
                <div className="space-y-2">
                    <video ref={videoRef} autoPlay playsInline muted className="max-h-64 w-full rounded-xl bg-black object-contain" data-testid="comprobante-camara" />
                    <Button type="button" className="h-11 w-full" disabled={disabled} onClick={capture} data-testid="comprobante-capturar">Usar esta foto</Button>
                    {/* Sin altura propia: el primitivo ya da 44 px en móvil. */}
                    <Button type="button" variant="outline" className="w-full" onClick={closeCamera}>Cerrar cámara</Button>
                </div>
            )}
            {message && <p role="status" className="text-sm text-destructive" data-testid="comprobante-captura-error">{message}</p>}
            {proof && <img src={proof} alt="Vista previa del comprobante" className="max-h-40 rounded-xl border object-contain" data-testid="comprobante-preview" />}
        </div>
    );
}
