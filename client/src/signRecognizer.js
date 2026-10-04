import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { loadSignModel, predict, buildInput } from './signModel';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MAX_FRAMES = 45;
const MIN_FRAMES = 15;
const PREDICT_EVERY = 4;
const MIN_CONF = 0.6;          // below this, show nothing
const STABLE_NEEDED = 3;       // same word 3 times in a row before accepting
const HAND_LOST_MS = 500;
const SENTENCE_PAUSE_MS = 1800; // hand away this long = sentence finished

const SAY = { thankyou: 'thank you', haveto: 'have to', minemy: 'my' };

function toSentence(words) {
  const text = words.map((w) => SAY[w] || w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function startSignRecognition(videoEl, { onUpdate, onSentence }) {
  const names = await loadSignModel('/sign_model.json');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
  });

  let raf = 0, stopped = false, lastTime = -1;
  let buf = [], recent = [], count = 0, lastSeen = 0;
  let sentence = [], candidate = -1, candCount = 0, lastAdded = -1;

  const resetHand = () => {
    buf = []; recent = []; candidate = -1; candCount = 0; lastAdded = -1;
  };

  const finishSentence = () => {
    if (!sentence.length) return;
    const text = toSentence(sentence);
    sentence = [];
    onSentence(text);
  };

  const handlePrediction = () => {
    const probs = predict(buildInput(buf));
    recent.push(probs);
    if (recent.length > 5) recent.shift();
    const avg = new Float32Array(probs.length);
    recent.forEach((p) => p.forEach((v, i) => (avg[i] += v / recent.length)));
    let top = 0;
    for (let i = 1; i < avg.length; i++) if (avg[i] > avg[top]) top = i;

    if (avg[top] < MIN_CONF) { candidate = -1; candCount = 0; return; }
    if (top === candidate) candCount++;
    else { candidate = top; candCount = 1; }

    if (candCount >= STABLE_NEEDED && top !== lastAdded) {
      sentence.push(names[top]);
      lastAdded = top;
      onUpdate(toSentence(sentence));
    }
  };

  const loop = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2 && videoEl.currentTime !== lastTime) {
      lastTime = videoEl.currentTime;
      const res = landmarker.detectForVideo(videoEl, performance.now());
      const now = performance.now();

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
    }
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    landmarker.close();
  };
}