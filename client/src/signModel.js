let M = null;

export async function loadSignModel(url = "/sign_model.json") {
  const j = await (await fetch(url)).json();
  M = {
    words: j.words,
    c1: { k: Float32Array.from(j.conv1.k.flat(2)), b: Float32Array.from(j.conv1.b) },
    c2: { k: Float32Array.from(j.conv2.k.flat(2)), b: Float32Array.from(j.conv2.b) },
    d: { k: Float32Array.from(j.dense.k.flat()), b: Float32Array.from(j.dense.b) },
    o: { k: Float32Array.from(j.out.k.flat()), b: Float32Array.from(j.out.b) },
  };
  return M.words;
}

function conv1d(x, T, cin, k, K, cout, b) {
  const out = new Float32Array(T * cout);
  const pad = K >> 1;
  for (let t = 0; t < T; t++) {
    for (let o = 0; o < cout; o++) out[t * cout + o] = b[o];
    for (let kk = 0; kk < K; kk++) {
      const tt = t + kk - pad;
      if (tt < 0 || tt >= T) continue;
      for (let i = 0; i < cin; i++) {
        const xv = x[tt * cin + i];
        const base = (kk * cin + i) * cout;
        for (let o = 0; o < cout; o++) out[t * cout + o] += xv * k[base + o];
      }
    }
  }
  return out;
}

function relu(a) {
  for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0;
  return a;
}

function pool2(x, T, C) {
  const Tn = Math.floor(T / 2);
  const out = new Float32Array(Tn * C);
  for (let t = 0; t < Tn; t++)
    for (let c = 0; c < C; c++)
      out[t * C + c] = Math.max(x[2 * t * C + c], x[(2 * t + 1) * C + c]);
  return out;
}

function dense(x, k, b, nin, nout) {
  const out = new Float32Array(nout);
  for (let o = 0; o < nout; o++) out[o] = b[o];
  for (let i = 0; i < nin; i++) {
    const xv = x[i];
    if (xv === 0) continue;
    for (let o = 0; o < nout; o++) out[o] += xv * k[i * nout + o];
  }
  return out;
}

// Returns probabilities for each word
export function predict(x) {
  const n = M.words.length;
  let h = relu(conv1d(x, 30, 65, M.c1.k, 5, 64, M.c1.b));
  h = pool2(h, 30, 64); // 15 x 64
  h = relu(conv1d(h, 15, 64, M.c2.k, 3, 128, M.c2.b));
  h = pool2(h, 15, 128); // 7 x 128 = 896
  h = relu(dense(h, M.d.k, M.d.b, 896, 128));
  const z = dense(h, M.o.k, M.o.b, 128, n);
  const mx = Math.max(...z);
  let sum = 0;
  for (let i = 0; i < n; i++) { z[i] = Math.exp(z[i] - mx); sum += z[i]; }
  for (let i = 0; i < n; i++) z[i] /= sum;
  return z;
}

// frames: [{ pts: [[x,y,z] x 21], left: boolean }]  (oldest first)
// Same preprocessing as the Python training code.
export function buildInput(frames, invert = false) {
  const T = 30, n = frames.length;
  const leftVotes = frames.filter((f) => f.left).length;
  const mirror = (leftVotes > n / 2) !== invert;
  const x = new Float32Array(T * 65);
  for (let t = 0; t < T; t++) {
    const f = frames[Math.round((t * (n - 1)) / (T - 1))];
    const pts = f.pts.map((p) => [mirror ? 1 - p[0] : p[0], p[1], p[2]]);
    const w = pts[0];
    let scale = 0;
    const rel = pts.map((p) => {
      const r = [p[0] - w[0], p[1] - w[1], p[2] - w[2]];
      scale = Math.max(scale, Math.hypot(r[0], r[1], r[2]));
      return r;
    });
    if (!scale) scale = 1;
    rel.forEach((r, i) => {
      for (let c = 0; c < 3; c++) x[t * 65 + i * 3 + c] = r[c] / scale;
    });
    x[t * 65 + 63] = w[0];
    x[t * 65 + 64] = w[1];
  }
  return x;
}