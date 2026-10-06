import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { loadSignModel, predict, buildInput } from './signModel';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const BASE_INTERVAL_MS = 45;     // fast devices: about 20 frames per second
const MAX_INTERVAL_MS = 220;     // slow devices never go below about 4 per second
const MAX_FRAMES = 32;
const MIN_FRAMES = 10;
const SCALES = [18, 32];         // short and long windows
const PREDICT_EVERY = 3;
const AVG_WINDOW = 2;
const MIN_CONF = 0.55;
const STABLE_NEEDED = 2;
const HAND_LOST_MS = 400;
const SENTENCE_PAUSE_MS = 700;

const SAY = { thankyou: 'thank you', haveto: 'have to', minemy: 'my' };
const spoken = (w) => SAY[w] || w;

function toSentence(words) {
  const text = words.map(spoken).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ----- Load everything once, ahead of time -----
let resourcesPromise = null;

async function createLandmarker(fileset, delegate) {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
  });
}

export function preloadSignRecognition() {
  if (!resourcesPromise) {
    resourcesPromise = (async () => {
      const names = await loadSignModel('/sign_model.json');
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      let landmarker;
      try {
        landmarker = await createLandmarker(fileset, 'GPU');
      } catch (e) {
        console.warn('GPU mode failed, using CPU', e);
        landmarker = await createLandmarker(fileset, 'CPU');
      }
      return { names, landmarker };
    })().catch((err) => {
      resourcesPromise = null;
      throw err;
    });
  }
  return resourcesPromise;
}

export function disposeSignRecognition() {
  const p = resourcesPromise;
  resourcesPromise = null;
  if (p) p.then((r) => r.landmarker.close()).catch(() => {});
}

// ----- Run recognition on a video element -----
export async function startSignRecognition(videoEl, { onUpdate, onSentence }) {
  const { names, landmarker } = await preloadSignRecognition();

  let raf = 0,
    stopped = false,
    lastTime = -1,
    lastProc = 0;
  let interval = BASE_INTERVAL_MS; // adjusts itself to the device
  let avgCost = 0;                 // average milliseconds spent per frame
  let buf = [],
    recent = [],
    count = 0,
    lastSeen = 0;
  let sentence = [],
    candidate = -1,
    candCount = 0,
    lastAdded = -1;

  const resetHand = () => {
    buf = [];
    recent = [];
    candidate = -1;
    candCount = 0;
    lastAdded = -1;
  };

  const finishSentence = () => {
    if (!sentence.length) return;
    const text = toSentence(sentence);
    sentence = [];
    onSentence(text);
  };

  const argmax = (a) => {
    let t = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[t]) t = i;
    return t;
  };

  const handlePrediction = () => {
    // On a slow device use only the long window, to save work
    const scales = interval > 90 ? [SCALES[1]] : SCALES;
    let bestProbs = null,
      bestConf = 0;
    for (const len of scales) {
      const frames = buf.slice(-len);
      if (frames.length < MIN_FRAMES) continue;
      for (const invert of [false, true]) {
        const p = predict(buildInput(frames, invert));
        const c = p[argmax(p)];
        if (c > bestConf) {
          bestConf = c;
          bestProbs = p;
        }
      }
    }
    if (!bestProbs) return;

    recent.push(bestProbs);
    if (recent.length > AVG_WINDOW) recent.shift();
    const avg = new Float32Array(bestProbs.length);
    recent.forEach((p) => p.forEach((v, i) => (avg[i] += v / recent.length)));
    const top = argmax(avg);

    if (avg[top] < MIN_CONF) {
      candidate = -1;
      candCount = 0;
      return;
    }
    if (top === candidate) candCount++;
    else {
      candidate = top;
      candCount = 1;
    }

    if (candCount >= STABLE_NEEDED && top !== lastAdded) {
      sentence.push(names[top]);
      lastAdded = top;
      buf = [];
      recent = [];
      candCount = 0;
      onUpdate(toSentence(sentence), spoken(names[top]));
    }
  };

  const loop = () => {
    if (stopped) return;
    const now = performance.now();
    if (
      videoEl.readyState >= 2 &&
      videoEl.currentTime !== lastTime &&
      now - lastProc >= interval
    ) {
      lastTime = videoEl.currentTime;
      lastProc = now;
      const res = landmarker.detectForVideo(videoEl, now);

      if (res.landmarks.length > 0) {
        const left = res.handedness?.[0]?.[0]?.categoryName === 'Left';
        buf.push({ pts: res.landmarks[0].map((p) => [p.x, p.y, p.z]), left });
        if (buf.length > MAX_FRAMES) buf.shift();
        lastSeen = now;
        count++;
        if (buf.length >= MIN_FRAMES && count % PREDICT_EVERY === 0) handlePrediction();
      } else {
        if (buf.length && now - lastSeen > HAND_LOST_MS) resetHand();
        if (sentence.length && now - lastSeen > SENTENCE_PAUSE_MS) finishSentence();
      }

      // Measure how long this frame took and adapt: slow device = fewer frames
      const cost = performance.now() - now;
      avgCost = avgCost ? avgCost * 0.8 + cost * 0.2 : cost;
      interval = Math.min(MAX_INTERVAL_MS, Math.max(BASE_INTERVAL_MS, avgCost * 3));
    }
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}