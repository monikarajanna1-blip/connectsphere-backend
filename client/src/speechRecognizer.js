// Live speech-to-text using the browser's built-in recognition (Chrome / Edge)
export function startSpeechRecognition({ onFinal, onError, lang = 'en-IN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge.');
    return () => {};
  }

  let active = true;
  let failures = 0; // errors in a row without any recognised speech
  let restartTimer = null;
  let rec = null;

  const begin = () => {
    if (!active) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang;

    rec.onresult = (e) => {
      failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const text = e.results[i][0].transcript.trim();
          if (text) onFinal(text);
        }
      }
    };

    rec.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        active = false;
        onError?.('Microphone permission is blocked for speech recognition.');
        return;
      }
      // "no-speech" and "aborted" are normal; anything else counts as a failure
      if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
      if (failures >= 5) {
        active = false;
        onError?.(`Speech recognition keeps failing (${e.error}). Try Chrome.`);
      }
    };

    // The browser stops listening after a pause, so restart, but with a delay
    rec.onend = () => {
      if (!active) return;
      const delay = Math.min(5000, 400 + failures * 800);
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
    try {
      rec?.stop();
    } catch (err) {
      /* ignore */
    }
  };
}