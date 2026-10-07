import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video,
  Users,
  Calendar,
  BarChart3,
  ShieldCheck,
  LogOut,
  Sparkles,
  Download,
  Play,
} from 'lucide-react';
import { meetingsApi } from '../api';
import { formatSummary, downloadText, fmtDur } from '../formatSummary';
import '../App.css';

function Home() {
  const [user, setUser] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [schedules, setSchedules] = useState([]);
  const [auto, setAuto] = useState(null); // { id, title, roomId, seconds } while the countdown runs
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      navigate('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
  }, [navigate]);

  // Load the user's latest meetings and scheduled ones
  useEffect(() => {
    if (!user) return;
    meetingsApi
      .get('/my-meetings')
      .then((res) => setRecent(res.data.meetings.slice(0, 5)))
      .catch(() => {})
      .finally(() => setRecentLoading(false));
    meetingsApi
      .get('/schedules')
      .then((res) => setSchedules(res.data.schedules))
      .catch(() => {});
  }, [user]);

  // When a scheduled time arrives (and it was started less than 10 minutes ago),
  // show the countdown once for that meeting
  useEffect(() => {
    if (!user || auto) return;
    const check = () => {
      const now = Date.now();
      const due = schedules.find((s) => {
        const t = new Date(s.startsAt).getTime();
        return t <= now && now - t < 10 * 60 * 1000 && !sessionStorage.getItem(`as-${s.id}`);
      });
      if (due) {
        sessionStorage.setItem(`as-${due.id}`, '1');
        setAuto({ id: due.id, title: due.title, roomId: due.roomId, seconds: 10 });
      }
    };
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [user, schedules, auto]);

  // Count down, then open the meeting as host
  useEffect(() => {
    if (!auto) return;
    if (auto.seconds <= 0) {
      navigate(`/meeting/${auto.roomId}`, { state: { isHost: true } });
      return;
    }
    const t = setTimeout(
      () => setAuto((a) => (a ? { ...a, seconds: a.seconds - 1 } : a)),
      1000
    );
    return () => clearTimeout(t);
  }, [auto, navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleStartMeeting = () => {
    const roomId = Math.random().toString(36).substring(2, 9);
    navigate(`/meeting/${roomId}`, { state: { isHost: true } });
  };

  const startScheduled = (s) => {
    // the countdown should not appear again for a meeting that was started by hand
    sessionStorage.setItem(`as-${s.id}`, '1');
    navigate(`/meeting/${s.roomId}`, { state: { isHost: true } });
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    if (joinCode.trim()) {
      navigate(`/meeting/${joinCode.trim()}`);
    }
  };

  const handleDownload = async (m) => {
    try {
      const res = await meetingsApi.get(`/my-meetings/${m.id}`);
      downloadText(`meeting-summary-${m.roomId}.txt`, formatSummary(res.data));
    } catch (err) {
      alert('Could not download this summary. Please try again.');
    }
  };

  const handleSchedule = () => navigate('/schedule');
  const handleInsights = () => navigate('/insights');
  const handleAccessibility = () => alert('Accessibility Settings — coming soon');

  if (!user) return null;

  const initial = user.name.charAt(0).toUpperCase();
  const upcoming = schedules.slice(0, 3);

  return (
    <div className="dash-container">
      <div className="dash-topbar">
        <div className="dash-logo">
          Connect<span>Sphere</span>
        </div>
        <div className="user-chip">
          <div className="avatar">{initial}</div>
          {user.name}
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <div className="dash-main">
        <h1 className="welcome">Welcome back, {user.name.split(' ')[0]}</h1>
        <p className="subtitle">
          <Sparkles size={13} />
          Sign language support & live captions enabled
        </p>

        <div className="dash-layout">
          <div className="glass-card primary-vertical">
            <div className="primary-icon-wrap">
              <Video size={26} color="#10101a" />
            </div>
            <div className="primary-title">Start a Meeting</div>
            <div className="primary-sub">
              Launch an instant inclusive video call
            </div>
            <button className="primary-btn" onClick={handleStartMeeting}>
              Start Now
            </button>
          </div>

          <div className="secondary-grid">
            <div className="glass-card">
              <div className="card-icon-wrap">
                <Users size={17} />
              </div>
              <div className="card-title">Join a Meeting</div>
              <div className="card-sub">Enter a code to join an existing call</div>
              <form className="join-row" onSubmit={handleJoinMeeting}>
                <input
                  className="join-input"
                  placeholder="Meeting code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                />
                <button type="submit" className="join-go">
                  Go
                </button>
              </form>
            </div>

            <div className="glass-card" onClick={handleSchedule}>
              <div className="card-icon-wrap">
                <Calendar size={17} />
              </div>
              <div className="card-title">Schedule a Meeting</div>
              <div className="card-sub">Plan and share an upcoming session</div>
            </div>

            <div className="glass-card" onClick={handleInsights}>
              <div className="card-icon-wrap">
                <BarChart3 size={17} />
              </div>
              <div className="card-title">Meeting Insights</div>
              <div className="card-sub">Engagement & transcript reports</div>
            </div>

            <div className="glass-card" onClick={handleAccessibility}>
              <div className="card-icon-wrap">
                <ShieldCheck size={17} />
              </div>
              <div className="card-title">Accessibility Settings</div>
              <div className="card-sub">
                Captions, sign language & audio preferences
              </div>
            </div>
          </div>
        </div>

        {upcoming.length > 0 && (
          <>
            <div className="section-title">Upcoming Meetings</div>
            {upcoming.map((s) => (
              <div
                key={s.id}
                className="glass-card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                  padding: '14px 18px',
                  cursor: 'pointer',
                }}
                onClick={() => navigate('/schedule')}
              >
                <div>
                  <strong>{s.title}</strong>
                  <div style={{ opacity: 0.7, fontSize: 13, marginTop: 3 }}>
                    {new Date(s.startsAt).toLocaleString([], {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · Code {s.roomId}
                  </div>
                </div>
                <button
                  className="join-go"
                  style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    startScheduled(s);
                  }}
                >
                  <Play size={14} /> Start
                </button>
              </div>
            ))}
          </>
        )}

        <div className="section-title">Recent Meetings</div>
        {recentLoading && <div className="empty-state">Loading...</div>}
        {!recentLoading && recent.length === 0 && (
          <div className="empty-state">
            No meetings yet. Start your first meeting above.
          </div>
        )}
        {recent.map((m) => (
          <div
            key={m.id}
            className="glass-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
              padding: '14px 18px',
              cursor: 'pointer',
            }}
            onClick={() => navigate(`/insights/${m.id}`)}
          >
            <div>
              <strong>
                {new Date(m.startedAt).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </strong>
              <div style={{ opacity: 0.7, fontSize: 13, marginTop: 3 }}>
                {m.wasHost ? 'You hosted' : 'You joined'} · Code {m.roomId}
                {m.endedAt
                  ? ` · ${fmtDur(new Date(m.endedAt) - new Date(m.startedAt))}`
                  : ''}
              </div>
            </div>
            <button
              className="logout-btn"
              title="Download summary"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(m);
              }}
            >
              <Download size={16} />
            </button>
          </div>
        ))}
      </div>

      {auto && (
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card ended-card">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="ended-title">Your meeting is starting</p>
              <p className="code-modal-text">
                "{auto.title}" starts in {auto.seconds} second
                {auto.seconds === 1 ? '' : 's'}. Your camera and microphone will turn on.
              </p>
              <button
                className="v3-btn"
                style={{ width: '100%', marginBottom: 10 }}
                onClick={() =>
                  navigate(`/meeting/${auto.roomId}`, { state: { isHost: true } })
                }
              >
                Start now
              </button>
              <button
                className="v3-btn"
                style={{ width: '100%' }}
                onClick={() => setAuto(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Home;