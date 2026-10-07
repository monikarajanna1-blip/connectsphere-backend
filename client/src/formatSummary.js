// Shared by the dashboard (Recent Meetings) and the Insights page

export function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} sec` : `${m} min`;
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Plain words instead of High / Moderate / Low
export const levelWord = (level) =>
  level === 'High' ? 'Very active' : level === 'Moderate' ? 'Active' : 'Quiet';

export function peopleLine(d) {
  const people = [];
  if (d.people.hostSpoke) people.push('1 host');
  if (d.people.participants > 0) {
    people.push(`${d.people.participants} participant${d.people.participants === 1 ? '' : 's'}`);
  }
  return people.length ? people.join(', ') : 'nobody spoke or signed';
}

export function dateLine(d) {
  const start = new Date(d.startedAt);
  const date = start.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export function lengthLine(d) {
  const mins = Math.round((d.durationMs || 0) / 60000);
  return mins < 1 ? 'less than a minute' : `${mins} minute${mins === 1 ? '' : 's'}`;
}

// The downloadable text file. Same order as the Insights page.
export function formatSummary(d) {
  const out = [];
  out.push('MEETING SUMMARY');
  out.push(`Date: ${dateLine(d)}`);
  out.push(`Length: ${lengthLine(d)}`);
  out.push(`Who took part: ${peopleLine(d)}`);
  out.push('');

  out.push('KEY POINTS');
  if (d.discussed.length) {
    d.discussed.forEach((s) => out.push(`- ${s.who} ${s.verb}: "${s.text}"`));
  } else {
    out.push('Nothing was recorded.');
  }

  // only shown when something was found
  if (d.actionItems.length) {
    out.push('');
    out.push('THINGS TO DO');
    d.actionItems.forEach((a) => out.push(`- ${a.who}: ${a.text}`));
  }

  const e = d.engagement;
  if (e && e.people.length) {
    out.push('');
    out.push('HOW EVERYONE TOOK PART');
    e.people.forEach((p) =>
      out.push(`${p.label}: ${levelWord(p.level)} (spoke or signed for about ${fmtDur(p.speakingMs)})`)
    );
  }

  out.push('');
  out.push('FULL TRANSCRIPT');
  if (d.transcript.length) {
    d.transcript.forEach((t) => {
      const when = t.time
        ? new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      out.push(`${when}  ${t.who}${t.kind === 'sign' ? ' (sign)' : ''}: ${t.text}`);
    });
  } else {
    out.push('Nothing was recorded.');
  }
  return out.join('\n');
}