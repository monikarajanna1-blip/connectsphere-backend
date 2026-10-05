// Live speech-to-text using the browser's built-in recognition (Chrome / Edge)
export function startSpeechRecognition({ onFinal, onError, lang = 'en-IN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onError?.('Speech recognition is not supported in this browser. Use Chrome or Edge.');
    return () => {};
  }

  let active = true;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = lang;

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const text = e.results[i][0].transcript.trim();
        if (text) onFinal(text);
      }
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      active = false;
      onError?.('Microphone permission is blocked for speech recognition.');
    }
  };

  // The browser stops listening after a pause, so restart while still active
  rec.onend = () => {
    if (active) {
      try { rec.start(); } catch (e) { /* already started */ }
    }
  };

  try { rec.start(); } catch (e) { /* already started */ }

  return () => {
    active = false;
    try { rec.stop(); } catch (e) { /* ignore */ }
  };
}