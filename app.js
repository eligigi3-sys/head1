import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';

const statusEl = document.getElementById('status');
const installBtn = document.getElementById('installBtn');
const imageUpload = document.getElementById('imageUpload');
const goCameraBtn = document.getElementById('goCameraBtn');
const backToStartBtn = document.getElementById('backToStartBtn');
const captureAutoBtn = document.getElementById('captureAutoBtn');
const continueBtn = document.getElementById('continueBtn');
const restartBtn = document.getElementById('restartBtn');
const restartFromStylesBtn = document.getElementById('restartFromStylesBtn');
const restartFromResultBtn = document.getElementById('restartFromResultBtn');
const backToStylesBtn = document.getElementById('backToStylesBtn');
const exportBtn = document.getElementById('exportBtn');
const countdownEl = document.getElementById('countdown');
const chooseSoftBtn = document.getElementById('chooseSoftBtn');
const chooseBoldBtn = document.getElementById('chooseBoldBtn');
const rerenderStylesBtn = document.getElementById('rerenderStylesBtn');
const resultTitle = document.getElementById('resultTitle');
const resultSubtitle = document.getElementById('resultSubtitle');

const video = document.getElementById('video');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const cutoutCanvas = document.getElementById('cutoutCanvas');
const cutoutCtx = cutoutCanvas.getContext('2d', { willReadFrequently: true });
const styleSoftCanvas = document.getElementById('styleSoftCanvas');
const styleBoldCanvas = document.getElementById('styleBoldCanvas');
const resultCanvas = document.getElementById('resultCanvas');

const workingCanvas = document.createElement('canvas');
const workingCtx = workingCanvas.getContext('2d', { willReadFrequently: true });
const tempCanvas = document.createElement('canvas');
const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

const screens = {
  start: document.getElementById('screenStart'),
  camera: document.getElementById('screenCamera'),
  cutout: document.getElementById('screenCutout'),
  styles: document.getElementById('screenStyles'),
  result: document.getElementById('screenResult'),
};

let stream = null;
let imageSegmenter = null;
let deferredPrompt = null;
let countdownRunning = false;
let cachedCutoutDataUrl = null;
let renderedStyles = { soft: null, bold: null };
let selectedStyle = null;

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function fitCanvasToSource(canvas, width, height) {
  canvas.width = width;
  canvas.height = height;
}

function syncOverlaySize() {
  if (video.videoWidth && video.videoHeight) {
    fitCanvasToSource(overlayCanvas, video.videoWidth, video.videoHeight);
  }
}

function drawOverlayBox(bounds, sourceWidth, sourceHeight) {
  if (!sourceWidth || !sourceHeight) return;
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

async function initSegmenter() {
  try {
    setStatus('טוען מודל חיתוך ראש…');
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

    setStatus('המערכת מוכנה. אפשר להעלות תמונה או לצלם עכשיו.', 'ok');
    goCameraBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus(`טעינת המודל נכשלה: ${error.message}`, 'error');
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('הדפדפן לא תומך בגישה למצלמה.', 'error');
    return false;
  }

  try {
    if (stream) stream.getTracks().forEach((track) => track.stop());

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    video.style.transform = 'scaleX(-1)';
    syncOverlaySize();
    captureAutoBtn.disabled = false;
    setStatus('המצלמה מוכנה. לחץ על "צלם אוטומטית".', 'ok');
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`לא הצלחתי להפעיל מצלמה: ${error.message}`, 'error');
    return false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

function resetWorkflow() {
  cachedCutoutDataUrl = null;
  renderedStyles = { soft: null, bold: null };
  selectedStyle = null;
  continueBtn.disabled = true;
  exportBtn.disabled = true;
  [styleSoftCanvas, styleBoldCanvas, resultCanvas, cutoutCanvas].forEach((canvas) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

function getSourceImageFromVideo() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  fitCanvasToSource(workingCanvas, width, height);
  workingCtx.save();
  workingCtx.clearRect(0, 0, width, height);
  workingCtx.translate(width, 0);
  workingCtx.scale(-1, 1);
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
  const padTop = Math.round(rawHeight * 0.18);
  const padBottom = Math.round(rawHeight * 0.12);

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

function quantize(value, levels) {
  const step = 255 / Math.max(2, levels - 1);
  return Math.round(value / step) * step;
}

function blurAlphaMask(ctx, width, height, alphaStrength = 10) {
  const img = ctx.getImageData(0, 0, width, height);
  const src = img.data;
  const out = new Uint8ClampedArray(src);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let alphaSum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4 + 3;
          alphaSum += src[idx];
          count++;
        }
      }
      const i = (y * width + x) * 4 + 3;
      out[i] = Math.min(255, Math.round((src[i] * (100 - alphaStrength) + (alphaSum / count) * alphaStrength) / 100));
    }
  }

  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

function stylizeCanvas(sourceCanvas, targetCanvas, preset = 'soft', seedJitter = 0) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  fitCanvasToSource(targetCanvas, width, height);
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(sourceCanvas, 0, 0);

  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const gray = new Float32Array(width * height);

  const levels = preset === 'soft' ? 7 : 5;
  const contrast = preset === 'soft' ? 1.08 : 1.22;
  const saturationBoost = preset === 'soft' ? 1.08 : 1.22;
  const edgeThreshold = preset === 'soft' ? 105 : 74;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha === 0) continue;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    r = Math.min(255, Math.max(0, (r - 128) * contrast + 128));
    g = Math.min(255, Math.max(0, (g - 128) * contrast + 128));
    b = Math.min(255, Math.max(0, (b - 128) * contrast + 128));

    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * saturationBoost;
    g = avg + (g - avg) * saturationBoost;
    b = avg + (b - avg) * saturationBoost;

    if (preset === 'bold') {
      r += 10;
      b -= 4;
    } else {
      g += 4;
      b += 8;
    }

    const jitter = (seedJitter % 3) * (preset === 'soft' ? 3 : 5);
    data[i] = quantize(Math.min(255, Math.max(0, r + jitter)), levels);
    data[i + 1] = quantize(Math.min(255, Math.max(0, g + jitter / 2)), levels);
    data[i + 2] = quantize(Math.min(255, Math.max(0, b - jitter / 2)), levels);
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const alpha = data[idx * 4 + 3];
      if (!alpha) continue;

      const gx =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[y * width + (x - 1)] - gray[(y + 1) * width + (x - 1)] +
        gray[(y - 1) * width + (x + 1)] + 2 * gray[y * width + (x + 1)] + gray[(y + 1) * width + (x + 1)];
      const gy =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + (x + 1)] +
        gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + (x + 1)];
      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > edgeThreshold) {
        const di = idx * 4;
        const ink = preset === 'soft' ? 22 : 0;
        data[di] = ink;
        data[di + 1] = ink;
        data[di + 2] = ink;
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (preset === 'soft') {
    grad.addColorStop(0, '#f5f3ff');
    grad.addColorStop(1, '#dbeafe');
  } else {
    grad.addColorStop(0, '#fef3c7');
    grad.addColorStop(1, '#fde68a');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  blurAlphaMask(ctx, width, height, preset === 'soft' ? 12 : 8);
}

function renderCutoutFromDataUrl() {
  return new Promise((resolve, reject) => {
    if (!cachedCutoutDataUrl) return reject(new Error('No cutout in cache'));
    const img = new Image();
    img.onload = () => {
      fitCanvasToSource(cutoutCanvas, img.width, img.height);
      cutoutCtx.clearRect(0, 0, img.width, img.height);
      cutoutCtx.drawImage(img, 0, 0);
      resolve(img);
    };
    img.onerror = reject;
    img.src = cachedCutoutDataUrl;
  });
}

async function renderStyleOptions() {
  if (!cachedCutoutDataUrl) return;
  await renderCutoutFromDataUrl();

  const seedBase = Date.now() % 7;
  stylizeCanvas(cutoutCanvas, styleSoftCanvas, 'soft', seedBase);
  stylizeCanvas(cutoutCanvas, styleBoldCanvas, 'bold', seedBase + 3);
  renderedStyles.soft = styleSoftCanvas.toDataURL('image/png');
  renderedStyles.bold = styleBoldCanvas.toDataURL('image/png');

  setStatus('2 האופציות מוכנות. בחר את הסגנון המועדף.', 'ok');
}

async function applySelectedStyle(name) {
  const selectedDataUrl = renderedStyles[name];
  if (!selectedDataUrl) return;
  selectedStyle = name;
  const img = new Image();
  img.onload = () => {
    fitCanvasToSource(resultCanvas, img.width, img.height);
    const ctx = resultCanvas.getContext('2d');
    ctx.clearRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    exportBtn.disabled = false;
    resultTitle.textContent = name === 'soft' ? 'הקריקטורה שלך — עדין' : 'הקריקטורה שלך — מודגש';
    resultSubtitle.textContent = name === 'soft'
      ? 'גרסה עדינה יותר, נקייה ומחמיאה.'
      : 'גרסה עם קווים חזקים יותר ומראה קריקטוריסטי מודגש.';
    showScreen('result');
  };
  img.src = selectedDataUrl;
}

async function processSource(sourceCanvas) {
  if (!imageSegmenter) {
    setStatus('המודל עדיין לא מוכן.', 'error');
    return false;
  }

  try {
    setStatus('מעבד תמונה…');
    const sourceWidth = sourceCanvas.width;
    const sourceHeight = sourceCanvas.height;

    const result = imageSegmenter.segment(sourceCanvas);
    const categoryMask = result.categoryMask.getAsUint8Array();

    const keptCategories = new Set([1, 3]); // hair + face skin
    const binaryMask = new Uint8ClampedArray(categoryMask.length);
    for (let i = 0; i < categoryMask.length; i++) {
      binaryMask[i] = keptCategories.has(categoryMask[i]) ? 255 : 0;
    }

    const cleanMask = smoothMask(binaryMask, sourceWidth, sourceHeight);
    const bounds = computeBounds(cleanMask, sourceWidth, sourceHeight);

    if (!bounds) {
      drawOverlayBox(null, sourceWidth, sourceHeight);
      setStatus('לא זוהה ראש בצורה מספקת. נסה שוב עם תאורה חזקה יותר.', 'error');
      return false;
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
    blurAlphaMask(cutoutCtx, bounds.width, bounds.height, 14);
    cachedCutoutDataUrl = cutoutCanvas.toDataURL('image/png');
    continueBtn.disabled = false;

    showScreen('cutout');
    setStatus('חיתוך הראש מוכן.', 'ok');
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`העיבוד נכשל: ${error.message}`, 'error');
    return false;
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
  resetWorkflow();
  const sourceCanvas = imageToCanvas(bitmap);
  drawOverlayBox(null, sourceCanvas.width, sourceCanvas.height);
  await processSource(sourceCanvas);
}

async function runCountdownCapture() {
  if (countdownRunning || !video.videoWidth || !video.videoHeight) return;
  countdownRunning = true;
  captureAutoBtn.disabled = true;
  countdownEl.classList.remove('hidden');

  for (const value of ['3', '2', '1']) {
    countdownEl.textContent = value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  countdownEl.textContent = '📸';
  await new Promise((resolve) => setTimeout(resolve, 350));
  countdownEl.classList.add('hidden');

  const source = getSourceImageFromVideo();
  resetWorkflow();
  await processSource(source);
  countdownRunning = false;
  captureAutoBtn.disabled = false;
}

async function openCameraScreen() {
  showScreen('camera');
  const started = await startCamera();
  if (!started) showScreen('start');
}

function resetToCamera() {
  resetWorkflow();
  showScreen('camera');
  if (!stream) startCamera();
}

goCameraBtn.addEventListener('click', openCameraScreen);
backToStartBtn.addEventListener('click', () => {
  stopCamera();
  drawOverlayBox(null, overlayCanvas.width || 0, overlayCanvas.height || 0);
  resetWorkflow();
  showScreen('start');
});

captureAutoBtn.addEventListener('click', runCountdownCapture);
continueBtn.addEventListener('click', async () => {
  showScreen('styles');
  await renderStyleOptions();
});
restartBtn.addEventListener('click', resetToCamera);
restartFromStylesBtn.addEventListener('click', resetToCamera);
restartFromResultBtn.addEventListener('click', resetToCamera);
backToStylesBtn.addEventListener('click', () => showScreen('styles'));
rerenderStylesBtn.addEventListener('click', renderStyleOptions);
chooseSoftBtn.addEventListener('click', () => applySelectedStyle('soft'));
chooseBoldBtn.addEventListener('click', () => applySelectedStyle('bold'));

imageUpload.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  stopCamera();
  await processUploadedFile(file);
  imageUpload.value = '';
});

exportBtn.addEventListener('click', () => {
  if (!selectedStyle || !renderedStyles[selectedStyle]) return;
  triggerDownload(renderedStyles[selectedStyle], `head-caricature-${selectedStyle}-${Date.now()}.png`);
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

window.addEventListener('resize', syncOverlaySize);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('SW registration failed', error));
  });
}

await initSegmenter();
showScreen('start');
