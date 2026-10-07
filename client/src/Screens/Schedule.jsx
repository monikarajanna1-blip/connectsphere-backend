import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Copy, Check, Trash2 } from 'lucide-react';
import { meetingsApi } from '../api';
import '../App.css';

// "2026-10-14T10:30" in the user's own time zone
const toLocalInput = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const whenText = (d) =>
  new Date(d).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function Schedule() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(
    toLocalInput(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const load = () =>
    meetingsApi
      .get('/schedules')
      .then((res) => setList(res.data.schedules))
      .catch(() => setError('Could not load your scheduled meetings.'))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      navigate('/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    if (!startsAt) {
      setError('Please pick a date and time.');
      return;
    }
    setBusy(true);
    try {
      await meetingsApi.post('/schedules', {
        title,
        startsAt: new Date(startsAt).toISOString(),
      });
      setTitle('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not schedule the meeting.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await meetingsApi.delete(`/schedules/${id}`);
      setList((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError('Could not delete this meeting.');
    }
  };

  const handleCopy = (s) => {
    const text =
      `${s.title}\n` +
      `When: ${whenText(s.startsAt)}\n` +
      `Meeting code: ${s.roomId}\n` +
      `Join: ${window.location.origin}/meeting/${s.roomId}\n` +
      `(Log in to ConnectSphere first. The meeting opens when the host starts it.)`;
    navigator.clipboard.writeText(text);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const handleStart = (s) => {
    // the dashboard countdown should not appear again for this meeting
    sessionStorage.setItem(`as-${s.id}`, '1');
    navigate(`/meeting/${s.roomId}`, { state: { isHost: true } });
  };
  const card = { padding: 18, marginBottom: 14, cursor: 'default' };
  const field = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    color: 'inherit',
    marginBottom: 10,
    boxSizing: 'border-box',
    colorScheme: 'dark',
  };

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
        <h1 className="welcome">Schedule a Meeting</h1>

        <form className="glass-card" style={card} onSubmit={handleCreate}>
          <input
            style={field}
            placeholder="Meeting title (optional)"
            value={title}
            maxLength={80}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            style={field}
            type="datetime-local"
            value={startsAt}
            min={toLocalInput(new Date())}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          {error && <p style={{ color: '#f87171', margin: '0 0 10px' }}>{error}</p>}
          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? 'Scheduling...' : 'Schedule'}
          </button>
        </form>

        <div className="section-title">Upcoming</div>
        {loading && <p>Loading...</p>}
        {!loading && list.length === 0 && (
          <div className="empty-state">No scheduled meetings yet.</div>
        )}
        {list.map((s) => (
          <div key={s.id} className="glass-card" style={card}>
            <strong style={{ fontSize: 17 }}>{s.title}</strong>
            <div style={{ opacity: 0.7, fontSize: 13, margin: '4px 0 12px' }}>
              {whenText(s.startsAt)} · Code {s.roomId}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="join-go"
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                onClick={() => handleStart(s)}
              >
                <Play size={14} /> Start
              </button>
              <button
                className="join-go"
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                onClick={() => handleCopy(s)}
              >
                {copiedId === s.id ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === s.id ? 'Copied' : 'Copy invite'}
              </button>
              <button
                className="join-go"
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                onClick={() => handleDelete(s.id)}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        ))}
        <p style={{ fontSize: 12, opacity: 0.5 }}>
          People can join with the code only after you press Start.
        </p>
      </div>
    </div>
  );
}

export default Schedule;