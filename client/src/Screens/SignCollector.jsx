import { useEffect, useRef, useState } from "react";
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Make landmarks independent of hand position and size
export function normalise(landmarks) {
  const w = landmarks[0];
  const pts = landmarks.map((p) => [p.x - w.x, p.y - w.y, p.z - w.z]);
  const scale = Math.max(...pts.map((p) => Math.hypot(p[0], p[1], p[2]))) || 1;
  return pts.flat().map((v) => v / scale); // 63 numbers
}

export default function SignCollector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const lastTimeRef = useRef(-1);
  const recordingRef = useRef(false);
  const labelRef = useRef("hello");
  const samplesRef = useRef([]);

  const [status, setStatus] = useState("Loading model...");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("hello");
  const [recording, setRecording] = useState(false);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    labelRef.current = label;
  }, [label]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) return landmarker.close();
        landmarkerRef.current = landmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setStatus("Ready. Show your hand to the camera.");
        loop();
      } catch (e) {
        setError(`${e.name}: ${e.message}`);
        setStatus("");
      }
    }

    function loop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !canvas || !landmarker) return;

      if (video.readyState >= 2 && video.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (result.landmarks.length > 0) {
          const lm = result.landmarks[0];
          const drawer = new DrawingUtils(ctx);
          drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, {
            color: "#00e5ff",
            lineWidth: 3,
          });
          drawer.drawLandmarks(lm, { color: "#ff4081", radius: 3 });

          if (recordingRef.current) {
            const l = labelRef.current;
            samplesRef.current.push({ label: l, features: normalise(lm) });
            setCounts((c) => ({ ...c, [l]: (c[l] || 0) + 1 }));
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  function toggleRecording() {
    recordingRef.current = !recordingRef.current;
    setRecording(recordingRef.current);
  }

  function downloadData() {
    const blob = new Blob([JSON.stringify(samplesRef.current)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sign_samples.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearData() {
    samplesRef.current = [];
    setCounts({});
  }

  const mirror = { transform: "scaleX(-1)" };

  return (
    <div style={{ maxWidth: 680, margin: "20px auto", color: "#eee" }}>
      <h2>Sign data collector</h2>
      {status && <p>{status}</p>}
      {error && <p style={{ color: "#ff5252" }}>Error: {error}</p>}

      <div style={{ position: "relative", width: 640, height: 480 }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ position: "absolute", width: 640, height: 480, ...mirror }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", width: 640, height: 480, ...mirror }}
        />
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.trim())}
          placeholder="sign name"
        />
        <button onClick={toggleRecording}>
          {recording ? "Stop recording" : "Start recording"}
        </button>
        <button onClick={downloadData}>Download JSON</button>
        <button onClick={clearData}>Clear</button>
      </div>

      <h4>Samples collected</h4>
      <ul>
        {Object.entries(counts).map(([k, v]) => (
          <li key={k}>
            {k}: {v}
          </li>
        ))}
      </ul>
    </div>
  );
}