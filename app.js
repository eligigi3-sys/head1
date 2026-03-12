import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const exportBtn = document.getElementById('exportBtn');
const installBtn = document.getElementById('installBtn');
const imageUpload = document.getElementById('imageUpload');
const cameraSelect = document.getElementById('cameraSelect');
const mirrorToggle = document.getElementById('mirrorToggle');
const accessoriesToggle = document.getElementById('accessoriesToggle');
const posterizeRange = document.getElementById('posterizeRange');
const edgeRange = document.getElementById('edgeRange');

const video = document.getElementById('video');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const cutoutCanvas = document.getElementById('cutoutCanvas');
const cutoutCtx = cutoutCanvas.getContext('2d', { willReadFrequently: true });
const cartoonCanvas = document.getElementById('cartoonCanvas');
const cartoonCtx = cartoonCanvas.getContext('2d', { willReadFrequently: true });

const workingCanvas = document.createElement('canvas');
const workingCtx = workingCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let imageSegmenter = null;
let deferredPrompt = null;
let lastExportDataUrl = null;
let cachedCutout = null;

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

async function initSegmenter() {
  try {
    setStatus('טוען מודל segmentation…');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    setStatus('המודל מוכן. אפשר להפעיל מצלמה או להעלות תמונה.', 'ok');
    startBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus(`טעינת המודל נכשלה: ${error.message}`, 'error');
  }
}

async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === 'videoinput');
    cameraSelect.innerHTML = '';
    cameras.forEach((camera, idx) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `מצלמה ${idx + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('הדפדפן לא תומך בגישה למצלמה.', 'error');
    return;
  }

  try {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    const selectedDeviceId = cameraSelect.value;
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: selectedDeviceId ? undefined : 'user',
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    await listCameras();
    syncVideoStyle();
    captureBtn.disabled = false;
    setStatus('המצלמה פעילה. מקם את הראש בתוך המסגרת וצלם.', 'ok');
  } catch (error) {
    console.error(error);
    setStatus(`לא הצלחתי להפעיל מצלמה: ${error.message}`, 'error');
  }
}

function syncVideoStyle() {
  video.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
}

function fitCanvasToSource(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
}

function drawOverlayBox(bounds, sourceWidth, sourceHeight) {
  fitCanvasToSource(overlayCanvas, sourceWidth, sourceHeight);
  overlayCtx.clearRect(0, 0, sourceWidth, sourceHeight);
  if (!bounds) return;

  overlayCtx.lineWidth = 5;
  overlayCtx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
  overlayCtx.fillStyle = 'rgba(56, 189, 248, 0.12)';
  overlayCtx.beginPath();
  overlayCtx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 24);
  overlayCtx.fill();
  overlayCtx.stroke();
}

function getSourceImageFromVideo() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  fitCanvasToSource(workingCanvas, width, height);
  workingCtx.save();
  workingCtx.clearRect(0, 0, width, height);
  if (mirrorToggle.checked) {
    workingCtx.translate(width, 0);
    workingCtx.scale(-1, 1);
  }
  workingCtx.drawImage(video, 0, 0, width, height);
  workingCtx.restore();
  return workingCanvas;
}

function imageToCanvas(image) {
  fitCanvasToSource(workingCanvas, image.width, image.height);
  workingCtx.clearRect(0, 0, image.width, image.height);
  workingCtx.drawImage(image, 0, 0);
  return workingCanvas;
}

function dilateMask(mask, width, height, radius = 1) {
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx] > 0) {
            on = 255;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function erodeMask(mask, width, height, radius = 1) {
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 255;
      for (let dy = -radius; dy <= radius && on; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) {
            on = 0;
            break;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function smoothMask(mask, width, height) {
  const expanded = dilateMask(mask, width, height, 1);
  return erodeMask(expanded, width, height, 1);
}

function computeBounds(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) return null;

  const rawWidth = maxX - minX + 1;
  const rawHeight = maxY - minY + 1;
  const padX = Math.round(rawWidth * 0.18);
  const padTop = Math.round(rawHeight * 0.2);
  const padBottom = Math.round(rawHeight * 0.14);

  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padTop);
  maxX = Math.min(width - 1, maxX + padX);
  maxY = Math.min(height - 1, maxY + padBottom);

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function applyComicEffect(sourceCanvas, targetCanvas, levels, edgeThreshold) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  fitCanvasToSource(targetCanvas, w, h);
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sourceCanvas, 0, 0);

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const gray = new Float32Array(w * h);

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    r = Math.min(255, (r - 128) * 1.15 + 128);
    g = Math.min(255, (g - 128) * 1.15 + 128);
    b = Math.min(255, (b - 128) * 1.15 + 128);

    const step = 255 / Math.max(2, levels - 1);
    data[i] = Math.round(r / step) * step;
    data[i + 1] = Math.round(g / step) * step;
    data[i + 2] = Math.round(b / step) * step;

    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const alpha = data[idx * 4 + 3];
      if (!alpha) continue;

      const gx =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[y * w + (x - 1)] - gray[(y + 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] + 2 * gray[y * w + (x + 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > edgeThreshold) {
        const di = idx * 4;
        data[di] = 0;
        data[di + 1] = 0;
        data[di + 2] = 0;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

async function processSource(sourceCanvas) {
  if (!imageSegmenter) {
    setStatus('המודל עדיין לא מוכן.', 'error');
    return;
  }

  try {
    setStatus('מעבד תמונה…');
    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;

    const result = imageSegmenter.segment(sourceCanvas);
    const categoryMask = result.categoryMask.getAsUint8Array();

    const keptCategories = new Set([1, 3]);
    if (accessoriesToggle.checked) keptCategories.add(5);

    const binaryMask = new Uint8ClampedArray(categoryMask.length);
    for (let i = 0; i < categoryMask.length; i++) {
      binaryMask[i] = keptCategories.has(categoryMask[i]) ? 255 : 0;
    }

    const cleanMask = smoothMask(binaryMask, sourceWidth, sourceHeight);
    const bounds = computeBounds(cleanMask, sourceWidth, sourceHeight);

    if (!bounds) {
      drawOverlayBox(null, sourceWidth, sourceHeight);
      setStatus('לא זוהה ראש בצורה מספקת. נסה תאורה חזקה יותר או רקע נקי יותר.', 'error');
      return;
    }

    drawOverlayBox(bounds, sourceWidth, sourceHeight);

    fitCanvasToSource(cutoutCanvas, bounds.width, bounds.height);
    cutoutCtx.clearRect(0, 0, bounds.width, bounds.height);

    const srcImg = workingCtx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    const outImg = cutoutCtx.createImageData(bounds.width, bounds.height);

    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const srcIndex = (y * bounds.width + x) * 4;
        const maskIndex = (bounds.y + y) * sourceWidth + (bounds.x + x);
        if (cleanMask[maskIndex]) {
          outImg.data[srcIndex] = srcImg.data[srcIndex];
          outImg.data[srcIndex + 1] = srcImg.data[srcIndex + 1];
          outImg.data[srcIndex + 2] = srcImg.data[srcIndex + 2];
          outImg.data[srcIndex + 3] = 255;
        }
      }
    }

    cutoutCtx.putImageData(outImg, 0, 0);
    applyComicEffect(cutoutCanvas, cartoonCanvas, Number(posterizeRange.value), Number(edgeRange.value));

    cachedCutout = cutoutCanvas.toDataURL('image/png');
    lastExportDataUrl = cachedCutout;
    exportBtn.disabled = false;
    setStatus('מוכן. אפשר לייצא PNG או לשחק עם הסליידרים.', 'ok');
  } catch (error) {
    console.error(error);
    setStatus(`העיבוד נכשל: ${error.message}`, 'error');
  }
}

function triggerDownload(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function processUploadedFile(file) {
  const bitmap = await createImageBitmap(file);
  const sourceCanvas = imageToCanvas(bitmap);
  drawOverlayBox(null, sourceCanvas.width, sourceCanvas.height);
  await processSource(sourceCanvas);
}

captureBtn.addEventListener('click', async () => {
  if (!video.videoWidth || !video.videoHeight) {
    setStatus('אין פריים תקין מהמצלמה.', 'error');
    return;
  }
  const source = getSourceImageFromVideo();
  await processSource(source);
});

startBtn.addEventListener('click', startCamera);
cameraSelect.addEventListener('change', startCamera);
mirrorToggle.addEventListener('change', syncVideoStyle);

[posterizeRange, edgeRange].forEach((input) => {
  input.addEventListener('input', () => {
    if (!cachedCutout) return;
    const img = new Image();
    img.onload = () => {
      fitCanvasToSource(cutoutCanvas, img.width, img.height);
      cutoutCtx.clearRect(0, 0, img.width, img.height);
      cutoutCtx.drawImage(img, 0, 0);
      applyComicEffect(cutoutCanvas, cartoonCanvas, Number(posterizeRange.value), Number(edgeRange.value));
    };
    img.src = cachedCutout;
  });
});

imageUpload.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  await processUploadedFile(file);
  imageUpload.value = '';
});

exportBtn.addEventListener('click', () => {
  if (!lastExportDataUrl) return;
  triggerDownload(lastExportDataUrl, `head-cutout-${Date.now()}.png`);
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

window.addEventListener('resize', () => {
  if (video.videoWidth && video.videoHeight) {
    fitCanvasToSource(overlayCanvas, video.videoWidth, video.videoHeight);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('SW registration failed', error));
  });
}

await initSegmenter();
await listCameras();
