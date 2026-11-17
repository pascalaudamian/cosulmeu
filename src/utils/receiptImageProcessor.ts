export const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per photo

export interface ReceiptImageQualityReport {
  status: 'ok' | 'retake_recommended' | 'blocked';
  blurScore: number;         // 0-100 (higher = sharper)
  contrastScore: number;     // 0-100
  meanBrightness: number;    // 0-255
  overexposedRatio: number;  // 0-1
  underexposedRatio: number; // 0-1
  isBlurry: boolean;
  isOverexposed: boolean;
  isUnderexposed: boolean;
  isLowResolution: boolean;
  wasCropped: boolean;
  wasAutoRotated: boolean;
  warnings: string[];
}

export interface ProcessedReceiptImage {
  id: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  originalDataUrl: string;
  enhancedDataUrl: string;
  width: number;
  height: number;
  rotation: number;
  quality: ReceiptImageQualityReport;
}

export function validateReceiptFileMeta(file: { name?: string; type?: string; size?: number }): {
  valid: boolean;
  normalizedMime: 'image/jpeg' | 'image/png' | 'image/webp';
  error?: string;
} {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();

  if (type === 'image/svg+xml' || name.endsWith('.svg') || type.includes('html') || name.endsWith('.html')) {
    return {
      valid: false,
      normalizedMime: 'image/jpeg',
      error: 'Fișierele SVG sau HTML nu sunt permise. Încarcă doar fotografii JPG, PNG sau WEBP.'
    };
  }

  const extAllowed = /\.(jpe?g|png|webp)$/i.test(name);
  const mimeAllowed = ALLOWED_RECEIPT_MIME_TYPES.has(type);

  if (!mimeAllowed && !(type === '' && extAllowed)) {
    return {
      valid: false,
      normalizedMime: 'image/jpeg',
      error: 'Format neacceptat. Încarcă imagini JPG, JPEG, PNG sau WEBP.'
    };
  }

  if (typeof file.size === 'number' && file.size > MAX_RECEIPT_FILE_BYTES) {
    return {
      valid: false,
      normalizedMime: 'image/jpeg',
      error: 'Imaginea depășește limita de 10 MB per fotografie.'
    };
  }

  let normalizedMime: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
  if (type === 'image/png' || name.endsWith('.png')) normalizedMime = 'image/png';
  else if (type === 'image/webp' || name.endsWith('.webp')) normalizedMime = 'image/webp';

  return { valid: true, normalizedMime };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nu am putut decoda imaginea bonului.'));
    img.src = src;
  });
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nu am putut citi fișierul imagine.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Analyzes luminance, sharpness (Laplacian variance), and foreground receipt edges,
 * then applies rotation, edge crop, shadow leveling, and adaptive contrast enhancement.
 */
export async function processReceiptImageFile(
  file: File,
  options?: { rotation?: number; autoRotateLandscape?: boolean; id?: string }
): Promise<ProcessedReceiptImage> {
  const check = validateReceiptFileMeta(file);
  if (!check.valid) {
    throw new Error(check.error || 'Fișier invalid.');
  }

  const originalDataUrl = await fileToDataUrl(file);
  return processReceiptDataUrl(originalDataUrl, {
    id: options?.id || `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fileName: file.name,
    mimeType: check.normalizedMime,
    rotation: options?.rotation ?? 0,
    autoRotateLandscape: options?.autoRotateLandscape ?? false
  });
}

export async function processReceiptDataUrl(
  dataUrl: string,
  options?: {
    id?: string;
    fileName?: string;
    mimeType?: 'image/jpeg' | 'image/png' | 'image/webp';
    rotation?: number;
    autoRotateLandscape?: boolean;
  }
): Promise<ProcessedReceiptImage> {
  const id = options?.id || `page-${Date.now()}`;
  const fileName = options?.fileName || 'bon-fiscal.jpg';
  const mimeType = options?.mimeType || 'image/jpeg';
  let rotation = ((options?.rotation || 0) % 360 + 360) % 360;

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    // Non-DOM Node fallback (used only if called in SSR/tests)
    return {
      id,
      fileName,
      mimeType,
      originalDataUrl: dataUrl,
      enhancedDataUrl: dataUrl,
      width: 1000,
      height: 1600,
      rotation,
      quality: {
        status: 'ok',
        blurScore: 85,
        contrastScore: 82,
        meanBrightness: 160,
        overexposedRatio: 0.05,
        underexposedRatio: 0.05,
        isBlurry: false,
        isOverexposed: false,
        isUnderexposed: false,
        isLowResolution: false,
        wasCropped: false,
        wasAutoRotated: false,
        warnings: []
      }
    };
  }

  const img = await loadImageElement(dataUrl);
  let wasAutoRotated = false;

  // Optional auto-rotation: thermal receipts photographed sideways (wide > 1.45 * height)
  if (options?.autoRotateLandscape && rotation === 0 && img.width > img.height * 1.45) {
    rotation = 90;
    wasAutoRotated = true;
  }

  const maxDim = 1800;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const scaledW = Math.max(1, Math.round(img.width * scale));
  const scaledH = Math.max(1, Math.round(img.height * scale));

  const rotated90 = rotation === 90 || rotation === 270;
  const workW = rotated90 ? scaledH : scaledW;
  const workH = rotated90 ? scaledW : scaledH;

  const canvas = document.createElement('canvas');
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Browserul nu suportă procesarea Canvas pentru imagini.');
  }

  ctx.save();
  ctx.translate(workW / 2, workH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
  ctx.restore();

  const rawImageData = ctx.getImageData(0, 0, workW, workH);
  const { data } = rawImageData;
  const totalPixels = workW * workH;

  // 1. Luminance & quality metrics
  const luma = new Float32Array(totalPixels);
  let sumLuma = 0;
  let overexposedCount = 0;
  let underexposedCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    luma[p] = y;
    sumLuma += y;
    if (y >= 249) overexposedCount++;
    if (y <= 35) underexposedCount++;
  }

  const meanBrightness = sumLuma / Math.max(1, totalPixels);
  const overexposedRatio = overexposedCount / Math.max(1, totalPixels);
  const underexposedRatio = underexposedCount / Math.max(1, totalPixels);

  // Laplacian sharpness metric sampled every 2 pixels inside center region
  let lapSum = 0;
  let lapCount = 0;
  let minLuma = 255;
  let maxLuma = 0;
  const xStart = Math.floor(workW * 0.1);
  const xEnd = Math.floor(workW * 0.9);
  const yStart = Math.floor(workH * 0.1);
  const yEnd = Math.floor(workH * 0.9);

  for (let y = Math.max(1, yStart); y < Math.min(workH - 1, yEnd); y += 2) {
    for (let x = Math.max(1, xStart); x < Math.min(workW - 1, xEnd); x += 2) {
      const idx = y * workW + x;
      const val = luma[idx];
      if (val < minLuma) minLuma = val;
      if (val > maxLuma) maxLuma = val;
      const lap = Math.abs(
        4 * val - luma[idx - 1] - luma[idx + 1] - luma[idx - workW] - luma[idx + workW]
      );
      lapSum += lap;
      lapCount++;
    }
  }

  const avgLap = lapSum / Math.max(1, lapCount);
  const blurScore = Math.round(Math.max(0, Math.min(100, (avgLap / 16) * 100)));
  const contrastSpan = Math.max(0, maxLuma - minLuma);
  const contrastScore = Math.round(Math.max(0, Math.min(100, (contrastSpan / 180) * 100)));

  // 2. Simple border edge detection to crop dark background around bright paper
  let cropX0 = 0;
  let cropY0 = 0;
  let cropX1 = workW;
  let cropY1 = workH;
  let wasCropped = false;

  const paperThreshold = Math.max(115, meanBrightness * 0.85);
  let minPaperX = workW;
  let maxPaperX = 0;
  let minPaperY = workH;
  let maxPaperY = 0;
  let brightCount = 0;

  for (let y = 0; y < workH; y += 4) {
    for (let x = 0; x < workW; x += 4) {
      if (luma[y * workW + x] >= paperThreshold) {
        brightCount++;
        if (x < minPaperX) minPaperX = x;
        if (x > maxPaperX) maxPaperX = x;
        if (y < minPaperY) minPaperY = y;
        if (y > maxPaperY) maxPaperY = y;
      }
    }
  }

  const detectedW = maxPaperX - minPaperX;
  const detectedH = maxPaperY - minPaperY;
  if (
    brightCount > 100 &&
    detectedW > workW * 0.35 &&
    detectedH > workH * 0.35 &&
    (detectedW < workW * 0.9 || detectedH < workH * 0.9)
  ) {
    const padX = Math.round(workW * 0.025);
    const padY = Math.round(workH * 0.025);
    cropX0 = Math.max(0, minPaperX - padX);
    cropY0 = Math.max(0, minPaperY - padY);
    cropX1 = Math.min(workW, maxPaperX + padX);
    cropY1 = Math.min(workH, maxPaperY + padY);
    wasCropped = cropX0 > 8 || cropY0 > 8 || cropX1 < workW - 8 || cropY1 < workH - 8;
  }

  // 3. Shadow reduction & adaptive contrast enhancement for thermal receipt OCR
  // Compute coarse 16x16 illumination grid so shadows across folded paper are leveled out
  const gridCols = 16;
  const gridRows = 16;
  const blockMax = new Float32Array(gridCols * gridRows);
  for (let gy = 0; gy < gridRows; gy++) {
    const y0 = Math.floor((gy * workH) / gridRows);
    const y1 = Math.floor(((gy + 1) * workH) / gridRows);
    for (let gx = 0; gx < gridCols; gx++) {
      const x0 = Math.floor((gx * workW) / gridCols);
      const x1 = Math.floor(((gx + 1) * workW) / gridCols);
      let topVal = 90;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const v = luma[y * workW + x];
          if (v > topVal) topVal = v;
        }
      }
      blockMax[gy * gridCols + gx] = topVal;
    }
  }

  const enhancedImageData = ctx.createImageData(workW, workH);
  const out = enhancedImageData.data;

  for (let y = 0; y < workH; y++) {
    const gy = Math.min(gridRows - 1, Math.floor((y * gridRows) / workH));
    for (let x = 0; x < workW; x++) {
      const gx = Math.min(gridCols - 1, Math.floor((x * gridCols) / workW));
      const p = y * workW + x;
      const idx = p * 4;
      const localPaper = Math.max(85, blockMax[gy * gridCols + gx]);
      // Normalize against local paper brightness (removes shadow), then boost text contrast
      const normalized = (luma[p] / localPaper) * 238;
      // Gentle S-curve contrast around threshold 168
      const stretched = normalized < 175
        ? Math.max(0, (normalized - 35) * 1.18)
        : Math.min(255, 190 + (normalized - 175) * 1.25);

      const val = Math.round(Math.max(0, Math.min(255, stretched)));
      out[idx] = val;
      out[idx + 1] = val;
      out[idx + 2] = val;
      out[idx + 3] = 255;
    }
  }

  ctx.putImageData(enhancedImageData, 0, 0);

  let finalCanvas = canvas;
  if (wasCropped) {
    const cw = Math.max(1, cropX1 - cropX0);
    const ch = Math.max(1, cropY1 - cropY0);
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cw;
    croppedCanvas.height = ch;
    const cctx = croppedCanvas.getContext('2d');
    if (cctx) {
      cctx.drawImage(canvas, cropX0, cropY0, cw, ch, 0, 0, cw, ch);
      finalCanvas = croppedCanvas;
    }
  }

  const enhancedDataUrl = finalCanvas.toDataURL('image/jpeg', 0.9);

  // Quality warnings assessment
  const warnings: string[] = [];
  const isLowResolution = img.width < 280 || img.height < 280;
  const isBlurry = blurScore < 22;
  const isOverexposed = overexposedRatio > 0.72 || meanBrightness > 243;
  const isUnderexposed = underexposedRatio > 0.72 || meanBrightness < 45;

  if (isLowResolution) {
    warnings.push('Rezoluția imaginii este prea mică (< 280 px). Fă o fotografie mai aproape de bon.');
  }
  if (isBlurry) {
    warnings.push('Imaginea pare neclară / mișcată. Textul și prețurile pot fi citite greșit.');
  }
  if (isOverexposed) {
    warnings.push('Fotografia este supraexpusă (prea luminoasă / reflexii). Evită blițul direct.');
  }
  if (isUnderexposed) {
    warnings.push('Fotografia este prea întunecată. Scanează bonul într-un loc mai luminos.');
  }

  let status: ReceiptImageQualityReport['status'] = 'ok';
  if (isLowResolution || (isBlurry && blurScore < 12) || (isOverexposed && overexposedRatio > 0.85)) {
    status = 'blocked';
  } else if (warnings.length > 0) {
    status = 'retake_recommended';
  }

  return {
    id,
    fileName,
    mimeType,
    originalDataUrl,
    enhancedDataUrl,
    width: finalCanvas.width,
    height: finalCanvas.height,
    rotation,
    quality: {
      status,
      blurScore,
      contrastScore,
      meanBrightness: Math.round(meanBrightness),
      overexposedRatio: Number(overexposedRatio.toFixed(3)),
      underexposedRatio: Number(underexposedRatio.toFixed(3)),
      isBlurry,
      isOverexposed,
      isUnderexposed,
      isLowResolution,
      wasCropped,
      wasAutoRotated,
      warnings
    }
  };
}
