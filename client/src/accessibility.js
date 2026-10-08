import { meetingsApi } from './api';

export const DEFAULTS = {
  liveCaptions: false,
  speakSigns: true,
  autoSign: false,
  highContrast: false,
  captionSize: 'medium',
};

const KEY = 'a11y-settings';
const SIZES = { small: 16, medium: 22, large: 30 };

// Extra styling used when "High contrast" is on
const HC_CSS = `
html.hc .glass-card, html.hc .v3-card { border: 2px solid #fff !important; }
html.hc .subtitle, html.hc .card-sub, html.hc .primary-sub, html.hc .empty-state {
  color: #fff !important; opacity: 1 !important;
}
html.hc .control-btn { border: 2px solid #fff !important; }
html.hc .video-label { background: #000 !important; color: #fff !important; border: 1px solid #fff; }
`;

export function getCachedSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (err) {
    return { ...DEFAULTS };
  }
}

export function cacheSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (err) {
    // storage can be blocked; the settings still work for this visit
  }
}

// Turn the visual settings on or off for the whole app
export function applySettings(s) {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('hc-style')) {
    const el = document.createElement('style');
    el.id = 'hc-style';
    el.textContent = HC_CSS;
    document.head.appendChild(el);
  }
  document.documentElement.classList.toggle('hc', !!s.highContrast);
}

export async function fetchSettings() {
  const res = await meetingsApi.get('/settings');
  const s = { ...DEFAULTS, ...res.data };
  cacheSettings(s);
  applySettings(s);
  return s;
}

export async function saveSettings(s) {
  const res = await meetingsApi.put('/settings', s);
  const saved = { ...DEFAULTS, ...res.data };
  cacheSettings(saved);
  return saved;
}

// On logout, so the next person on this device does not inherit the settings
export function clearSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    // ignore
  }
  applySettings(DEFAULTS);
}

// Look of the caption boxes in a meeting
export function captionStyle(s) {
  return {
    fontSize: SIZES[s.captionSize] || SIZES.medium,
    background: s.highContrast ? '#000' : 'rgba(0,0,0,0.8)',
    color: s.highContrast ? '#ffe600' : '#fff',
    border: s.highContrast ? '2px solid #ffe600' : 'none',
    fontWeight: s.highContrast ? 700 : 400,
  };
}

// Apply the saved look as soon as this file is loaded
applySettings(getCachedSettings());