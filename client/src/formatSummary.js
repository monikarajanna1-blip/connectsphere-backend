// Shared by the dashboard and the insights page

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

// Turn the report from the server into a readable text file
export function formatSummary(d) {
  const out = [];
  const start = new Date(d.startedAt);
  const mins = Math.round((d.durationMs || 0) / 60000);
  const duration = mins < 1 ? 'less than a minute' : `${mins} minute${mins === 1 ? '' : 's'}`;
  const date = start.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const people = [];
  if (d.people.hostSpoke) people.push('1 host');
  if (d.people.participants > 0) {
    people.push(`${d.people.participants} participant${d.people.participants === 1 ? '' : 's'}`);
  }

  out.push('MEETING SUMMARY');
  out.push(`Date: ${date}, ${time}`);
  out.push(`Length: ${duration}`);
  out.push(`People who spoke or signed: ${people.length ? people.join(', ') : 'nobody'}`);
  out.push('');
  out.push('MAIN TOPICS');
  out.push(d.topics.length ? d.topics.join(', ') : 'Not enough was said to pick topics.');
  out.push('');
  out.push('WHAT WAS DISCUSSED');
  if (d.discussed.length) {
    d.discussed.forEach((s) => out.push(`- ${s.who} ${s.verb}: "${s.text}"`));
  } else {
    out.push('Nothing was recorded.');
  }
  out.push('');
  out.push('THINGS TO DO');
  if (d.actionItems.length) {
    d.actionItems.forEach((a) => out.push(`- ${a.who}: ${a.text}`));
  } else {
    out.push('No tasks were mentioned.');
  }

  const e = d.engagement;
  out.push('');
  out.push('HOW ENGAGED EVERYONE WAS');
  if (e && e.people.length) {
    out.push(`Overall: average score ${e.averageScore} out of 100.`);
    if (e.mostActive) out.push(`Most active: ${e.mostActive}.`);
    if (e.quiet.length) out.push(`Quiet (low engagement): ${e.quiet.join(', ')}.`);
    out.push('');
    e.people.forEach((p) => {
      out.push(`${p.label}: ${p.level} engagement (${p.score}/100)`);
      out.push(
        `  Present for ${fmtDur(p.presenceMs)}, spoke or signed for about ${fmtDur(p.speakingMs)}, ` +
          `microphone on ${p.micOnPercent}% of the time, ${p.contributions} contribution${p.contributions === 1 ? '' : 's'}.`
      );
    });
    out.push('');
    out.push(
      'How the score works: out of 100 - 50 for how much the person spoke or signed, ' +
        '35 for how many times they contributed, 10 for keeping the microphone on, ' +
        '5 for staying in the meeting. The camera is not used.'
    );
  } else {
    out.push('No engagement data was recorded.');
  }

  out.push('');
  out.push('EVERYTHING THAT WAS SAID');
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