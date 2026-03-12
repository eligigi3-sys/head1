import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const BACKEND_STORAGE_KEY = 'headCaricatureBackendUrl';
const DEFAULT_BACKEND_URL = localStorage.getItem(BACKEND_STORAGE_KEY) || 'http://127.0.0.1:7861';

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
const backendUrlInput = document.getElementById('backendUrlInput');
const saveBackendBtn = document.getElementById('saveBackendBtn');
const testBackendBtn = document.getElementById('testBackendBtn');

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

backendUrlInput.value = DEFAULT_BACKEND_URL;

function getBackendBaseUrl() {
  return (backendUrlInput.value || '').trim().replace(/\/$/, '');
}

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

async function pingBackend(showMessage = true) {
  const base = getBackendBaseUrl();
  if (!base) {
    if (showMessage) setStatus('הכנס כתובת שרת AI קודם.', 'error');
    return false;
  }
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error('שרת לא תקין');
    if (showMessage) setStatus(`שרת AI מחובר: ${base}`, 'ok');
    return true;
  } catch (error) {
    console.error(error);
    if (showMessage) setStatus(`אין חיבור לשרת AI: ${error.message}`, 'error');
    return false;
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

function drawDataUrlToCanvas(dataUrl, canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      fitCanvasToSource(canvas, img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function getCutoutBlob() {
  const dataUrl = cachedCutoutDataUrl;
  const response = await fetch(dataUrl);
  return response.blob();
}

async function generateStylesViaBackend() {
  const ok = await pingBackend(false);
  if (!ok) {
    setStatus('אין חיבור לשרת AI. בדוק את כתובת השרת והפעל אותו מחדש.', 'error');
    return false;
  }

  setStatus('יוצר 2 קריקטורות AI… זה לוקח כמה שניות.', 'ok');
  chooseSoftBtn.disabled = true;
  chooseBoldBtn.disabled = true;
  rerenderStylesBtn.disabled = true;
  continueBtn.disabled = true;

  try {
    const blob = await getCutoutBlob();
    const form = new FormData();
    form.append('image', blob, 'cutout.png');
    const base = getBackendBaseUrl();
    const res = await fetch(`${base}/caricature/options`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderedStyles.soft = data.soft;
    renderedStyles.bold = data.bold;
    await drawDataUrlToCanvas(renderedStyles.soft, styleSoftCanvas);
    await drawDataUrlToCanvas(renderedStyles.bold, styleBoldCanvas);
    chooseSoftBtn.disabled = false;
    chooseBoldBtn.disabled = false;
    rerenderStylesBtn.disabled = false;
    continueBtn.disabled = false;
    setStatus('2 הקריקטורות מוכנות. בחר את הסגנון המועדף.', 'ok');
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`קריקטורת AI נכשלה: ${error.message}`, 'error');
    rerenderStylesBtn.disabled = false;
    return false;
  }
}

async function renderStyleOptions() {
  if (!cachedCutoutDataUrl) return;
  await renderCutoutFromDataUrl();
  showScreen('styles');
  await generateStylesViaBackend();
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
      : 'גרסה עם יותר אופי והגזמה.';
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
  await processSource(sourceCanvas);
}

async function captureWithCountdown() {
  if (countdownRunning) return;
  countdownRunning = true;
  captureAutoBtn.disabled = true;
  countdownEl.classList.remove('hidden');

  for (const step of ['3', '2', '1']) {
    countdownEl.textContent = step;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  countdownEl.textContent = '✓';
  await new Promise((resolve) => setTimeout(resolve, 200));
  countdownEl.classList.add('hidden');
  countdownRunning = false;

  resetWorkflow();
  const sourceCanvas = getSourceImageFromVideo();
  await processSource(sourceCanvas);
  captureAutoBtn.disabled = false;
}

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

saveBackendBtn.addEventListener('click', () => {
  localStorage.setItem(BACKEND_STORAGE_KEY, getBackendBaseUrl());
  setStatus('כתובת שרת ה-AI נשמרה.', 'ok');
});

testBackendBtn.addEventListener('click', async () => {
  localStorage.setItem(BACKEND_STORAGE_KEY, getBackendBaseUrl());
  await pingBackend(true);
});

goCameraBtn.addEventListener('click', async () => {
  showScreen('camera');
  await startCamera();
});

backToStartBtn.addEventListener('click', () => {
  stopCamera();
  showScreen('start');
});

captureAutoBtn.addEventListener('click', captureWithCountdown);

imageUpload.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await processUploadedFile(file);
  imageUpload.value = '';
});

continueBtn.addEventListener('click', async () => {
  await renderStyleOptions();
});

restartBtn.addEventListener('click', async () => {
  resetWorkflow();
  showScreen('camera');
  await startCamera();
});

restartFromStylesBtn.addEventListener('click', async () => {
  resetWorkflow();
  showScreen('camera');
  await startCamera();
});

restartFromResultBtn.addEventListener('click', async () => {
  resetWorkflow();
  showScreen('camera');
  await startCamera();
});

rerenderStylesBtn.addEventListener('click', async () => {
  await generateStylesViaBackend();
});

chooseSoftBtn.addEventListener('click', async () => {
  await applySelectedStyle('soft');
});

chooseBoldBtn.addEventListener('click', async () => {
  await applySelectedStyle('bold');
});

backToStylesBtn.addEventListener('click', () => {
  showScreen('styles');
});

exportBtn.addEventListener('click', () => {
  triggerDownload(resultCanvas.toDataURL('image/png'), `caricature-${selectedStyle || 'final'}.png`);
});

window.addEventListener('resize', syncOverlaySize);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('SW registration failed', error));
  });
}

initSegmenter();
pingBackend(false);
