import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  getCachedSettings,
  fetchSettings,
  saveSettings,
  applySettings,
  cacheSettings,
  captionStyle,
} from '../accessibility';
import '../App.css';

function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 46,
        height: 26,
        borderRadius: 13,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        background: on ? '#6c5ce7' : 'rgba(255,255,255,0.2)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

const ROWS = [
  {
    key: 'liveCaptions',
    title: 'Live captions for spoken English',
    desc: 'Show what other people say as text during a meeting. You can also switch this on inside a meeting.',
  },
  {
    key: 'speakSigns',
    title: 'Read signed words aloud',
    desc: 'When someone signs, you hear each word as it is recognised.',
  },
  {
    key: 'autoSign',
    title: 'Start sign recognition automatically',
    desc: 'Turns on hand tracking when you join, so you do not need to press the hand button. Keep your hands in view of the camera.',
  },
  {
    key: 'highContrast',
    title: 'High contrast',
    desc: 'Brighter borders and text, and yellow-on-black captions.',
  },
];

function Accessibility() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(getCachedSettings());
  const [status, setStatus] = useState('');
  const latest = useRef(settings);

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      navigate('/login');
      return;
    }
    fetchSettings()
      .then((s) => {
        latest.current = s;
        setSettings(s);
      })
      .catch(() => setStatus('Could not load your saved settings.'));
  }, [navigate]);

  // Save every change straight away
  const change = (patch) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setSettings(next);
    cacheSettings(next);
    applySettings(next);
    setStatus('Saving...');
    saveSettings(next)
      .then(() => setStatus('Saved'))
      .catch(() => setStatus('Could not save. Check your connection.'));
  };

  const card = { padding: 18, marginBottom: 14, cursor: 'default' };

  return (
    <div className="dash-container">
      <div className="dash-topbar">
        <div className="dash-logo">
          Connect<span>Sphere</span>
        </div>
        <button
          className="logout-btn"
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onClick={() => navigate('/home')}
        >
          <ArrowLeft size={15} /> Back
        </button>
      </div>

      <div className="dash-main" style={{ maxWidth: 700 }}>
        <h1 className="welcome">Accessibility Settings</h1>
        <p style={{ opacity: 0.7, marginTop: 0 }}>
          These are saved to your account and used in every meeting.{' '}
          <span style={{ opacity: 0.8 }}>{status}</span>
        </p>

        {ROWS.map((r) => (
          <div
            key={r.key}
            className="glass-card"
            style={{
              ...card,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div>
              <strong>{r.title}</strong>
              <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>{r.desc}</div>
            </div>
            <Switch
              on={!!settings[r.key]}
              label={r.title}
              onChange={(v) => change({ [r.key]: v })}
            />
          </div>
        ))}

        <div className="glass-card" style={card}>
          <strong>Caption size</strong>
          <div style={{ display: 'flex', gap: 10, margin: '12px 0' }}>
            {['small', 'medium', 'large'].map((size) => (
              <button
                key={size}
                className="join-go"
                style={{
                  textTransform: 'capitalize',
                  outline: settings.captionSize === size ? '2px solid #6c5ce7' : 'none',
                }}
                onClick={() => change({ captionSize: size })}
              >
                {size}
              </button>
            ))}
          </div>
          <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 8 }}>Preview</div>
          <div
            style={{
              ...captionStyle(settings),
              padding: '10px 18px',
              borderRadius: 12,
              display: 'inline-block',
            }}
          >
            <strong>Host:</strong> Hello everyone, let's begin.
          </div>
        </div>
      </div>
    </div>
  );
}

export default Accessibility;