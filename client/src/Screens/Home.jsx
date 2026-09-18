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
} from 'lucide-react';
import '../App.css';

function Home() {
  const [user, setUser] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      navigate('/login');
      return;
    }
    setUser(JSON.parse(storedUser));
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleStartMeeting = () => {
    const roomId = Math.random().toString(36).substring(2, 9);
    navigate(`/meeting/${roomId}`);
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    if (joinCode.trim()) {
      navigate(`/meeting/${joinCode.trim()}`);
    }
  };

  const handleSchedule = () => alert('Schedule Meeting — coming soon');
  const handleInsights = () => alert('Meeting Insights — coming soon');
  const handleAccessibility = () => alert('Accessibility Settings — coming soon');

  if (!user) return null;

  const initial = user.name.charAt(0).toUpperCase();

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

        <div className="section-title">Recent Meetings</div>
        <div className="empty-state">
          No meetings yet. Start your first meeting above.
        </div>
      </div>
    </div>
  );
}

export default Home;