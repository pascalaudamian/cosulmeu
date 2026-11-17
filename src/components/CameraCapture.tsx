import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { processReceiptDataUrl, type ProcessedReceiptImage, type ReceiptImageQualityReport } from '../utils/receiptImageProcessor.js';

interface CameraCaptureProps {
  onCapture: (image: ProcessedReceiptImage) => void;
  onCancel: () => void;
}

function describeQuality(quality: ReceiptImageQualityReport) {
  if (quality.status === 'ok') return 'Imaginea este suficient de clară pentru OCR.';
  if (quality.status === 'blocked') return 'Calitatea imaginii este prea slabă pentru OCR. Refa fotografia.';
  return 'Poți continua, dar o fotografie nouă poate îmbunătăți extragerea textului.';
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<ProcessedReceiptImage | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Acest browser nu oferă acces la cameră. Deschide pagina prin HTTPS sau încarcă o fotografie.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        setCameraError(name === 'NotAllowedError'
          ? 'Accesul la cameră a fost refuzat. Permite accesul din setările browserului sau încarcă o fotografie.'
          : name === 'NotFoundError'
            ? 'Nu a fost găsită nicio cameră disponibilă. Încarcă o fotografie pentru a continua.'
            : 'Camera nu a putut fi pornită. Verifică permisiunile browserului sau încarcă o fotografie.');
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  const handleTakePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Previzualizarea camerei nu este încă disponibilă. Încearcă din nou în câteva secunde.');
      return;
    }

    setIsProcessing(true);
    setCameraError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browserul nu poate procesa fotografia.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const processed = await processReceiptDataUrl(canvas.toDataURL('image/jpeg', 0.92), {
        fileName: 'bon-fiscal-camera.jpg',
        mimeType: 'image/jpeg',
        autoRotateLandscape: true
      });
      setCapturedImage(processed);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Fotografia nu a putut fi analizată.');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const quality = capturedImage?.quality;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-3 sm:p-6" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-capture-title"
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
          <div>
            <h2 id="camera-capture-title" className="text-lg font-bold text-slate-900 dark:text-white">Fotografiază bonul</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Ține bonul drept și bine luminat în cadru.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Închide camera" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="relative flex min-h-36 items-center justify-center overflow-hidden rounded-2xl bg-slate-950 sm:min-h-40">
            {capturedImage ? (
              <img src={capturedImage.originalDataUrl} alt="Previzualizarea fotografiei bonului" className="max-h-[35vh] w-full object-contain" />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Previzualizare live a camerei"
                onCanPlay={() => setCameraReady(true)}
                onError={() => setCameraError('Previzualizarea camerei nu este disponibilă. Încarcă o fotografie pentru a continua.')}
                className="max-h-[35vh] w-full object-contain"
              />
            )}
            {!capturedImage && !cameraError && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-[10%] rounded-xl border-2 border-dashed border-white/70" />
            )}
          </div>

          {quality && (
            <div className={`flex gap-3 rounded-2xl border p-4 ${quality.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : quality.status === 'blocked' ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100' : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'}`} role="status" aria-live="polite">
              {quality.status === 'ok' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
              <div className="min-w-0">
                <p className="text-sm font-bold">{describeQuality(quality)}</p>
                <p className="mt-1 text-xs opacity-80">Claritate {quality.blurScore}% · contrast {quality.contrastScore}% · luminozitate {quality.meanBrightness}/255</p>
                {quality.warnings.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                    {quality.warnings.map(warning => <li key={warning}>{warning}</li>)}
                  </ul>
                )}
              </div>
            </div>
          )}

          {cameraError && (
            <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />{cameraError}
            </div>
          )}

          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            {capturedImage ? (
              <>
                <button type="button" onClick={() => { setCapturedImage(null); setCameraError(null); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <RefreshCw className="h-4 w-4" />Refă fotografia
                </button>
                <button
                  type="button"
                  disabled={quality?.status === 'blocked'}
                  onClick={() => onCapture(capturedImage)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />Folosește fotografia
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void handleTakePhoto()} disabled={isProcessing || !!cameraError || !cameraReady} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
                <Camera className="h-4 w-4" />{isProcessing ? 'Se verifică imaginea…' : cameraError ? 'Camera indisponibilă' : cameraReady ? 'Fă fotografia' : 'Se pornește camera…'}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
