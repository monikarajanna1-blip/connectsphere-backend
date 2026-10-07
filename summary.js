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

const QUESTION_START = /^(what|why|how|when|where|who|can|could|will|would|do|does|did|is|are|should)\b/i;

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
        handled = true;
        break;
      }
      if (n.startsWith(pn)) {
        out[i] = l;
        handled = true;
        break;
      }
    }
    if (!handled) out.push(l);
  }
  return out;
}

// Trim filler words like "uh", "and", "that's it" from the start and end of a sentence
const FILLER_EDGE =
  /^(uh|um|er|ah|and|so|okay|ok|well)[,.\s]+|[,.\s]+(uh|um|er|ah|and|so|that's it|that is it|okay|ok)[.!?\s]*$/i;

function tidy(text) {
  let s = String(text || '').trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(FILLER_EDGE, '').trim();
    if (next === s) break;
    s = next;
  }
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += QUESTION_START.test(s) ? '?' : '.';
  return s;
}

function buildSummary(rawLines, startedAt, endedAt) {
  const lines = cleanLines(rawLines);

  // Give each participant a number so people can tell them apart
  const partIds = [];
  lines.forEach((l) => {
    if (l.role !== 'Host' && !partIds.includes(l.from)) partIds.push(l.from);
  });
  const shortOf = (l) =>
    l.role === 'Host'
      ? 'Host'
      : partIds.length <= 1
      ? 'Participant'
      : `Participant ${partIds.indexOf(l.from) + 1}`;
  const longOf = (l) =>
    l.role === 'Host'
      ? 'The host'
      : partIds.length <= 1
      ? 'A participant'
      : `Participant ${partIds.indexOf(l.from) + 1}`;

  // Split every line into tidy sentences
  const sentences = [];
  lines.forEach((l) => {
    String(l.text || '')
      .split(/(?<=[.!?])\s+/)
      .map(tidy)
      .filter(Boolean)
      .forEach((t) => {
        const isQ = t.endsWith('?') || QUESTION_START.test(t);
        sentences.push({
          short: shortOf(l),
          who: longOf(l),
          verb: l.kind === 'sign' ? 'signed' : isQ ? 'asked' : 'said',
          question: isQ,
          text: t,
        });
      });
  });

  // Word frequencies (ignoring filler words)
  const freq = {};
  sentences.forEach((s) =>
    words(s.text).forEach((w) => {
      if (w.length > 3 && !STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
    })
  );

  const topics = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  // Pick the most important sentences, in their original order
  const scored = sentences.map((s, i) => {
    const ws = words(s.text);
    const score = ws.reduce((sum, w) => sum + (freq[w] || 0), 0) / Math.sqrt(ws.length || 1);
    return { ...s, i, score, len: ws.length };
  });
  const candidates = scored.filter((s) => s.len >= 3);
  const pool = candidates.length >= 3 ? candidates : scored;
  const keep = new Set(
    [...pool]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.i)
  );
  const discussed = scored
    .filter((s) => keep.has(s.i))
    .map((s) => ({ who: s.who, verb: s.verb, text: s.text }));

  // Things to do: sentences that sound like a task or a promise (not questions)
  const seen = new Set();
  const actionItems = sentences
    .filter((s) => !s.question && ACTION_RE.test(s.text))
    .filter((s) => {
      const k = normText(s.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((s) => ({ who: s.short, text: s.text }));

  // How long the meeting ran
  const times = lines.map((l) => l.time).filter(Boolean);
  const start = startedAt ? new Date(startedAt).getTime() : times[0] || 0;
  const end = endedAt ? new Date(endedAt).getTime() : times[times.length - 1] || start;

  return {
    topics,
    discussed,
    actionItems,
    people: {
      hostSpoke: lines.some((l) => l.role === 'Host'),
      participants: partIds.length,
    },
    durationMs: Math.max(0, end - start),
    transcript: lines.map((l) => ({
      who: shortOf(l),
      kind: l.kind,
      text: l.text,
      time: l.time,
    })),
  };
}

module.exports = { buildSummary };