const STOP = new Set(
  ('the a an and or but if then so of to in on at for from with about as by is are was were be been being ' +
    'i you he she it we they me my your our their this that these those there here what which who whom ' +
    'do does did done have has had will would can could should must may might shall not no yes ok okay ' +
    'just very really also than too up down out over again more most some any all each other such ' +
    'am im ill ive well like get got going gonna one two hello hi thanks thank please ' +
    "we'll i'll you'll that's it's what's here's let's don't can't guys tell show going")
    .split(' ')
);

const ACTION_RE =
  /\b(i will|i'll|we will|we'll|need to|needs to|have to|has to|must|should|let's|remind|assign|deadline|follow up|send|finish|complete|submit|prepare|schedule|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|next week|end of))\b/i;

const words = (s) =>
  s.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);

const normText = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Remove duplicate and "growing" lines from the same speaker within a few seconds
function cleanLines(lines) {
  const out = [];
  for (const l of lines) {
    const n = normText(l.text);
    if (!n) continue;
    let handled = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 6; i--) {
      const p = out[i];
      if (p.from !== l.from || p.kind !== l.kind) continue;
      if (Math.abs((l.time || 0) - (p.time || 0)) > 8000) continue;
      const pn = normText(p.text);
      if (n === pn || pn.startsWith(n)) {
        handled = true; // same sentence, or a shorter copy of it: skip
        break;
      }
      if (n.startsWith(pn)) {
        out[i] = l; // longer version of the earlier line: replace it
        handled = true;
        break;
      }
    }
    if (!handled) out.push(l);
  }
  return out;
}

function buildSummary(rawLines) {
  const lines = cleanLines(rawLines);

  // 1. Split every line into sentences, remembering who said it
  const sentences = [];
  lines.forEach((l) => {
    String(l.text || '')
      .split(/(?<=[.!?])\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => sentences.push({ role: l.role, kind: l.kind, text: t }));
  });

  // 2. Word frequencies (ignoring filler words)
  const freq = {};
  sentences.forEach((s) =>
    words(s.text).forEach((w) => {
      if (w.length > 3 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
    })
  );

  // 3. Keywords = most frequent useful words
  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  // 4. Score each sentence and keep the best ones, in their original order
  const scored = sentences.map((s, i) => {
    const ws = words(s.text);
    const score = ws.reduce((sum, w) => sum + (freq[w] || 0), 0) / Math.sqrt(ws.length || 1);
    return { ...s, i, score };
  });
  const keep = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.i)
  );
  const summary = scored
    .filter((s) => keep.has(s.i))
    .map((s) => `${s.role}${s.kind === 'sign' ? ' (sign)' : ''}: ${s.text}`);

  // 5. Action items = sentences that sound like a task or a promise
  const actionItems = sentences
    .filter((s) => ACTION_RE.test(s.text))
    .map((s) => ({ who: s.role, text: s.text }));

  return {
    keywords,
    summary,
    actionItems,
    transcript: lines.map((l) => ({
      role: l.role,
      kind: l.kind,
      text: l.text,
      time: l.time,
    })),
  };
}

module.exports = { buildSummary };