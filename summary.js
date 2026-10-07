const STOP = new Set(
  ('the a an and or but if then so of to in on at for from with about as by is are was were be been being ' +
    'i you he she it we they me my your our their this that these those there here what which who whom ' +
    'do does did done have has had will would can could should must may might shall not no yes ok okay ' +
    'just very really also than too up down out over again more most some any all each other such ' +
    'am im ill ive well like get got going gonna one two hello hi thanks thank please ' +
        "we'll i'll you'll that's it's what's here's let's don't can't guys tell show going yeah note")
    .split(' ')
);

const ACTION_RE =
  /\b(i will|i'll|we will|we'll|need to|needs to|have to|has to|must|should|remind|assign|deadline|follow up|send|finish|complete|submit|prepare|schedule|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|next week|end of))\b/i;

const QUESTION_START = /^(what|why|how|when|where|who|can|could|will|would|do|does|did|is|are|should|have|has|had)\b/i;
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

// Engagement score out of 100, using only things that work with the camera off:
//   40 = how much the person spoke or signed
//   30 = how many times they contributed
//   20 = how long their microphone was on
//   10 = how much of the meeting they stayed for
function buildEngagement(stats, labelOf, endMs, meetingMs) {
  const people = stats.map((s) => {
    const presence = Math.max(1000, (s.leftAt || endMs) - s.joinedAt);
    const minutes = presence / 60000;
    const talkRatio = (s.speakingMs || 0) / presence;
    const micRatio = Math.min(1, (s.micOnMs || 0) / presence);
    const contributions = (s.speechLines || 0) + (s.signLines || 0);

    const talkPts = Math.min(1, talkRatio / 0.15) * 50;
    const contribPts = Math.min(1, contributions / Math.max(2, minutes)) * 35;
    const micPts = micRatio * 10;
    const stayPts = Math.min(1, presence / Math.max(1000, meetingMs)) * 5;
    const score = Math.round(talkPts + contribPts + micPts + stayPts);

    return {
      label: labelOf(s.sid, s.role),
      role: s.role,
      presenceMs: presence,
      speakingMs: s.speakingMs || 0,
      micOnPercent: Math.round(micRatio * 100),
      micToggles: s.micToggles || 0,
      contributions,
      score,
      level: score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low',
    };
  });

  people.sort((a, b) => (a.role === 'Host' ? -1 : b.role === 'Host' ? 1 : a.label.localeCompare(b.label)));

  const avg = people.length
    ? Math.round(people.reduce((sum, p) => sum + p.score, 0) / people.length)
    : 0;
  const top = [...people].sort((a, b) => b.score - a.score)[0];
  return {
    people,
    averageScore: avg,
    mostActive: top ? top.label : null,
    quiet: people.filter((p) => p.level === 'Low').map((p) => p.label),
  };
}

function buildSummary(rawLines, startedAt, endedAt, stats = [], nowMs = Date.now()) {
  const lines = cleanLines(rawLines);

  // Number the participants in the order they joined
  const partIds = [...stats]
    .filter((s) => s.role !== 'Host')
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((s) => s.sid);
  lines.forEach((l) => {
    if (l.role !== 'Host' && !partIds.includes(l.from)) partIds.push(l.from);
  });

  const labelOf = (sid, role) =>
    role === 'Host'
      ? 'Host'
      : partIds.length <= 1
      ? 'Participant'
      : `Participant ${partIds.indexOf(sid) + 1}`;
  const shortOf = (l) => labelOf(l.from, l.role);
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

  // When the meeting started and ended
  const times = lines.map((l) => l.time).filter(Boolean);
  const start = startedAt ? new Date(startedAt).getTime() : times[0] || 0;
  const stillIn = stats.some((s) => !s.leftAt);
  const endMs = endedAt
    ? new Date(endedAt).getTime()
    : stillIn
    ? nowMs
    : Math.max(start, ...times, ...stats.map((s) => s.leftAt || 0));
  const meetingMs = Math.max(0, endMs - start);

  return {
    topics,
    discussed,
    actionItems,
    people: {
      hostSpoke: lines.some((l) => l.role === 'Host'),
      participants: partIds.length,
    },
    durationMs: meetingMs,
    engagement: buildEngagement(stats, labelOf, endMs, meetingMs),
    transcript: lines.map((l) => ({
      who: shortOf(l),
      kind: l.kind,
      text: l.text,
      time: l.time,
    })),
  };
}

module.exports = { buildSummary };