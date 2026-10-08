// Live speech-to-text using the browser's built-in recognition (Chrome / Edge / Android Chrome)
const norm = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function startSpeechRecognition({ onFinal, onInterim, onError, lang = 'en-IN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge.');
    return () => {};
  }

  let active = true;
  let failures = 0;
  let restartTimer = null;
  let sendTimer = null;
  let rec = null;
  let buffer = ''; // the sentence being heard right now
  let lastSent = '';

  // Send the buffered sentence once (this is what gets saved in the transcript)
  const sendBuffer = () => {
    clearTimeout(sendTimer);
    const text = buffer.trim();
    buffer = '';
    if (!text) return;
    const n = norm(text);
    if (!n || n === lastSent) return;
    lastSent = n;
    console.log('Heard:', text);
    onFinal(text);
  };

  // Merge new text into the buffer: a longer version replaces a shorter one
  const addText = (t) => {
    const text = t.trim();
    if (!text) return;
    if (buffer) {
      const nb = norm(buffer);
      const nt = norm(text);
      if (nt.startsWith(nb)) buffer = text; // same sentence, now longer
      else if (nb.startsWith(nt)) {
        /* older, shorter version: ignore */
      } else {
        sendBuffer(); // a different sentence started
        buffer = text;
      }
    } else {
      buffer = text;
    }
    clearTimeout(sendTimer);
    sendTimer = setTimeout(sendBuffer, 1200); // quiet for 1.2 s = sentence done
  };

  const begin = () => {
    if (!active) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (e) => {
      failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        addText(e.results[i][0].transcript);
      }
      // show the words right away, while the person is still talking
      if (buffer) onInterim?.(buffer);
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
      sendBuffer();
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
    sendBuffer(); // send the last sentence before stopping
    try {
      rec?.stop();
    } catch (err) {
      /* ignore */
    }
  };
}