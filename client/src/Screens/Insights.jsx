import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { meetingsApi } from '../api';
import { formatSummary, downloadText, fmtDur } from '../formatSummary';
import '../App.css';

const LEVEL_COLOR = { High: '#4ade80', Moderate: '#facc15', Low: '#f87171' };

const when = (d) =>
  new Date(d).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function Insights() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      navigate('/login');
      return;
    }
    setLoading(true);
    setError('');
    setReport(null);
    const request = id ? `/my-meetings/${id}` : '/my-meetings';
    meetingsApi
      .get(request)
      .then((res) => (id ? setReport(res.data) : setList(res.data.meetings)))
      .catch(() => setError('Could not load this. Please try again.'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const card = { padding: 18, marginBottom: 14, cursor: 'default' };
  const h = { fontSize: 13, letterSpacing: 1, opacity: 0.6, margin: '0 0 8px' };

  return (
    <div className="dash-container">
      <div className="dash-topbar">
        <div className="dash-logo">
          Connect<span>Sphere</span>
        </div>
        <button
          className="logout-btn"
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onClick={() => navigate(id ? '/insights' : '/home')}
        >
          <ArrowLeft size={15} /> Back
        </button>
      </div>

      <div className="dash-main" style={{ maxWidth: 800 }}>
        <h1 className="welcome">Meeting Insights</h1>
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: '#f87171' }}>{error}</p>}

        {/* LIST OF MEETINGS */}
        {!id && !loading && !error && (
          <>
            {list.length === 0 && (
              <div className="empty-state">
                No meetings yet. Meetings you host or join will appear here.
              </div>
            )}
            {list.map((m) => (
              <div
                key={m.id}
                className="glass-card"
                style={{ ...card, cursor: 'pointer' }}
                onClick={() => navigate(`/insights/${m.id}`)}
              >
                <strong>{when(m.startedAt)}</strong>
                <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                  {m.wasHost ? 'You hosted' : 'You joined'} · Code {m.roomId}
                  {m.endedAt ? ` · ${fmtDur(new Date(m.endedAt) - new Date(m.startedAt))}` : ''}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ONE MEETING */}
        {id && report && (
          <>
            <p style={{ opacity: 0.7 }}>
              {when(report.startedAt)} · {fmtDur(report.durationMs)}
            </p>
            <button
              className="primary-btn"
              style={{ marginBottom: 16, display: 'flex', gap: 8, justifyContent: 'center' }}
              onClick={() =>
                downloadText(`meeting-summary-${report.roomId}.txt`, formatSummary(report))
              }
            >
              <Download size={16} /> Download summary
            </button>

            <div className="glass-card" style={card}>
              <p style={h}>MAIN TOPICS</p>
              {report.topics.length ? report.topics.join(', ') : 'Not enough was said to pick topics.'}
            </div>

            <div className="glass-card" style={card}>
              <p style={h}>WHAT WAS DISCUSSED</p>
              {report.discussed.length === 0 && <p>Nothing was recorded.</p>}
              {report.discussed.map((s, i) => (
                <p key={i} style={{ margin: '6px 0' }}>
                  {s.who} {s.verb}: "{s.text}"
                </p>
              ))}
            </div>

            <div className="glass-card" style={card}>
              <p style={h}>THINGS TO DO</p>
              {report.actionItems.length === 0 && <p>No tasks were mentioned.</p>}
              {report.actionItems.map((a, i) => (
                <p key={i} style={{ margin: '6px 0' }}>
                  {a.who}: {a.text}
                </p>
              ))}
            </div>

            <div className="glass-card" style={card}>
              <p style={h}>HOW ENGAGED EVERYONE WAS</p>
              {report.engagement.people.length === 0 && <p>No engagement data was recorded.</p>}
              {report.engagement.people.length > 0 && (
                <p style={{ opacity: 0.8 }}>
                  Average score {report.engagement.averageScore}/100
                  {report.engagement.mostActive ? ` · Most active: ${report.engagement.mostActive}` : ''}
                </p>
              )}
              {report.engagement.people.map((p, i) => (
                <div key={i} style={{ margin: '12px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{p.label}</strong>
                    <span style={{ color: LEVEL_COLOR[p.level] }}>
                      {p.level} · {p.score}/100
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.1)',
                      margin: '6px 0',
                    }}
                  >
                    <div
                      style={{
                        width: `${p.score}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: LEVEL_COLOR[p.level],
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>
                    Present {fmtDur(p.presenceMs)} · spoke or signed about {fmtDur(p.speakingMs)} ·
                    mic on {p.micOnPercent}% · {p.contributions} contribution
                    {p.contributions === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
              <p style={{ fontSize: 12, opacity: 0.5 }}>
                Score out of 100: 50 speaking or signing, 35 contributions, 10 microphone, 5 staying
                in the meeting. The camera is not used.
              </p>
            </div>

            <div className="glass-card" style={card}>
              <p style={h}>EVERYTHING THAT WAS SAID</p>
              {report.transcript.length === 0 && <p>Nothing was recorded.</p>}
              {report.transcript.map((t, i) => (
                <p key={i} style={{ margin: '6px 0', fontSize: 14 }}>
                  <span style={{ opacity: 0.5 }}>
                    {t.time
                      ? new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>{' '}
                  <strong>
                    {t.who}
                    {t.kind === 'sign' ? ' (sign)' : ''}:
                  </strong>{' '}
                  {t.text}
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Insights;