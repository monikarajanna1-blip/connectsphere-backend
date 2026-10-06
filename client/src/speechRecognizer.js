// Live speech-to-text using the browser's built-in recognition (Chrome / Edge)
export function startSpeechRecognition({ onFinal, onError, lang = 'en-IN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge.');
    return () => {};
  }

  let active = true;
  let failures = 0;
  let restartTimer = null;
  let flushTimer = null;
  let rec = null;
  let pending = ''; // what the browser has heard but not yet finalised

  const send = (text) => {
    const clean = text.trim();
    if (!clean) return;
    console.log('Heard:', clean);
    onFinal(clean);
  };

  // Send whatever is pending, then restart so the next sentence starts clean
  const flush = () => {
    if (pending) {
      send(pending);
      pending = '';
      try {
        rec?.stop(); // onend will restart listening
      } catch (e) {
        /* ignore */
      }
    }
  };

  const begin = () => {
    if (!active) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (e) => {
      failures = 0;
      clearTimeout(flushTimer);
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          pending = '';
          send(r[0].transcript);
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) {
        pending = interim;
        // if the browser does not finalise soon, send it ourselves
        flushTimer = setTimeout(flush, 1500);
      }
    };

    rec.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        active = false;
        onError?.('Microphone permission is blocked for speech recognition.');
        return;
      }
      if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
      if (failures >= 5) {
        active = false;
        onError?.(`Speech recognition keeps failing (${e.error}). Try Chrome.`);
      }
    };

    rec.onend = () => {
      clearTimeout(flushTimer);
      if (pending) {
        send(pending);
        pending = '';
      }
      if (!active) return;
      const delay = failures ? Math.min(5000, 400 + failures * 800) : 100;
      restartTimer = setTimeout(begin, delay);
    };

    try {
      rec.start();
    } catch (err) {
      restartTimer = setTimeout(begin, 1000);
    }
  };

  begin();

  return () => {
    active = false;
    clearTimeout(restartTimer);
    clearTimeout(flushTimer);
    try {
      rec?.stop();
    } catch (err) {
      /* ignore */
    }
  };
}