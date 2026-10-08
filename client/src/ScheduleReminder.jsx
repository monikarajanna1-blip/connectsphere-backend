import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { meetingsApi } from './api';

const REMIND_BEFORE_MS = 5 * 60 * 1000; // heads-up this long before the start time

const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Shows the "your meeting is about to start" banner on every screen except
// Home (which has its own), the meeting room, and the logged-out screens.
function ScheduleReminder() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [schedules, setSchedules] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [dismissed, setDismissed] = useState({});

  const hidden =
    !localStorage.getItem('token') ||
    pathname === '/' ||
    pathname === '/home' ||
    pathname.startsWith('/meeting');

  // Load the schedules when the page changes, then refresh every 30 seconds
  useEffect(() => {
    if (hidden) return;
    const load = () =>
      meetingsApi
        .get('/schedules')
        .then((res) => setSchedules(res.data.schedules))
        .catch(() => {});
    load();
    const refresh = setInterval(load, 30000);
    return () => clearInterval(refresh);
  }, [hidden, pathname]);

  // Clock for the live countdown
  useEffect(() => {
    if (hidden) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [hidden]);

  const soon = hidden
    ? null
    : schedules.find((s) => {
        const t = new Date(s.startsAt).getTime();
        return (
          t - now <= REMIND_BEFORE_MS &&
          now - t < 10 * 60 * 1000 &&
          !dismissed[s.id] &&
          !sessionStorage.getItem(`as-${s.id}`)
        );
      });

  // Browser notification, once per meeting (same key Home uses, so never twice)
  useEffect(() => {
    if (!soon || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (sessionStorage.getItem(`nn-${soon.id}`)) return;
    sessionStorage.setItem(`nn-${soon.id}`, '1');
    try {
      new Notification('Your meeting is about to start', {
        body: `"${soon.title}" starts at ${new Date(soon.startsAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
      });
    } catch (err) {
      // some phone browsers do not allow this; the banner still shows
    }
  }, [soon]);

  if (!soon) return null;

  const msLeft = new Date(soon.startsAt).getTime() - now;

  const handleStart = () => {
    sessionStorage.setItem(`as-${soon.id}`, '1');
    navigate(`/meeting/${soon.roomId}`, { state: { isHost: true } });
  };

  return (
    <div
      className="glass-card"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(560px, 92%)',
        zIndex: 200,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 16px',
        color: '#f1f5f9',
        background: 'rgba(16, 20, 32, 0.96)',
        border: '1px solid rgba(125, 211, 252, 0.5)',
        boxSizing: 'border-box',
      }}
    >
      <div>
        <strong>"{soon.title}"</strong>
        <div style={{ opacity: 0.8, fontSize: 13, marginTop: 3 }}>
          {msLeft > 0 ? `Starts in ${fmtCountdown(msLeft)}` : 'It is time to start'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="join-go" onClick={handleStart}>
          Start now
        </button>
        <button
          className="join-go"
          onClick={() => setDismissed((d) => ({ ...d, [soon.id]: true }))}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default ScheduleReminder;
