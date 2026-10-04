import { useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";
import { loadSignModel, predict, buildInput } from "../signModel";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MAX_FRAMES = 45;      // about 1.5 seconds of hand movement
const MIN_FRAMES = 15;      // need at least this much before predicting
const PREDICT_EVERY = 4;    // run the model every 4 hand frames
const MIN_CONF = 0.6;       // below this we show nothing

export default function SignTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const bufRef = useRef([]);
  const lastSeenRef = useRef(0);
  const countRef = useRef(0);
  const recentRef = useRef([]);
  const wordsRef = useRef([]);
  const invertRef = useRef(false);

  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState("");
  const [result, setResult] = useState({ word: "", conf: 0, top: [] });
  const [invert, setInvert] = useState(false);

  useEffect(() => { invertRef.current = invert; }, [invert]);

  useEffect(() => {
    let cancelled = false, raf, stream, landmarker, lastTime = -1;

    function handlePrediction() {
      const x = buildInput(bufRef.current, invertRef.current);
      const probs = predict(x);
      recentRef.current.push(probs);
      if (recentRef.current.length > 5) recentRef.current.shift();
      const avg = new Float32Array(probs.length);
      recentRef.current.forEach((p) => p.forEach((v, i) => (avg[i] += v / recentRef.current.length)));
      const order = [...avg.keys()].sort((a, b) => avg[b] - avg[a]);
      const words = wordsRef.current;
      setResult({
        word: avg[order[0]] >= MIN_CONF ? words[order[0]] : "",
        conf: avg[order[0]],
        top: order.slice(0, 3).map((i) => `${words[i]} ${(avg[i] * 100).toFixed(0)}%`),
      });
    }

    function loop() {
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || cancelled) return;
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const res = landmarker.detectForVideo(video, performance.now());
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const now = performance.now();

        if (res.landmarks.length > 0) {
          const lm = res.landmarks[0];
          const drawer = new DrawingUtils(ctx);
          drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: "#00e5ff", lineWidth: 3 });
          drawer.drawLandmarks(lm, { color: "#ff4081", radius: 3 });

          const left = res.handedness?.[0]?.[0]?.categoryName === "Left";
          bufRef.current.push({ pts: lm.map((p) => [p.x, p.y, p.z]), left });
          if (bufRef.current.length > MAX_FRAMES) bufRef.current.shift();
          lastSeenRef.current = now;
          countRef.current++;

          if (bufRef.current.length >= MIN_FRAMES && countRef.current % PREDICT_EVERY === 0) {
            handlePrediction();
          }
        } else if (now - lastSeenRef.current > 500 && bufRef.current.length > 0) {
          bufRef.current = [];
          recentRef.current = [];
          setResult({ word: "", conf: 0, top: [] });
        }
      }
      raf = requestAnimationFrame(loop);
    }

    async function init() {
      try {
        wordsRef.current = await loadSignModel("/sign_model.json");
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("Ready. Do a sign with one hand in front of the camera.");
        loop();
      } catch (e) {
        setError(`${e.name}: ${e.message}`);
        setStatus("");
      }
    }
    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, []);

  const mirror = { transform: "scaleX(-1)" };
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: 20, color: "#eee", background: "#111", minHeight: "100vh" }}>
      <h2>Live sign test</h2>
      {status && <p>{status}</p>}
      {error && <p style={{ color: "#ff5252" }}>Error: {error}</p>}
      <div style={{ position: "relative", width: 640, height: 480 }}>
        <video ref={videoRef} playsInline muted style={{ position: "absolute", width: 640, height: 480, ...mirror }} />
        <canvas ref={canvasRef} style={{ position: "absolute", width: 640, height: 480, ...mirror }} />
      </div>
      <div style={{ fontSize: 48, fontWeight: 700, minHeight: 64, marginTop: 12 }}>{result.word || "..."}</div>
      <div>Confidence: {(result.conf * 100).toFixed(0)}%</div>
      <div>Top 3: {result.top.join("  |  ")}</div>
      <label style={{ display: "block", marginTop: 12 }}>
        <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> Invert hand mirroring
        (tick this only if predictions look wrong)
      </label>
    </div>
  );
}