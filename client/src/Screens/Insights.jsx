import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { meetingsApi } from '../api';
import {
  formatSummary,
  downloadText,
  fmtDur,
  levelWord,
  peopleLine,
  dateLine,
  lengthLine,
} from '../formatSummary';
import '../App.css';

const LEVEL_COLOR = { High: '#4ade80', Moderate: '#facc15', Low: '#94a3b8' };

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
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('user')) {
      navigate('/login');
      return;
    }
    setLoading(true);
    setError('');
    setReport(null);
    setShowTranscript(false);
    const request = id ? `/my-meetings/${id}` : '/my-meetings';
    meetingsApi
      .get(request)
      .then((res) => (id ? setReport(res.data) : setList(res.data.meetings)))
      .catch(() => setError('Could not load this. Please try again.'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const card = { padding: 18, marginBottom: 14, cursor: 'default' };
  const heading = { fontSize: 13, letterSpacing: 1, opacity: 0.6, margin: '0 0 10px' };

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
                <strong>{m.title || when(m.startedAt)}</strong>
                <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                  {m.wasHost ? 'You hosted' : 'You joined'}
                  {m.endedAt
                    ? ` · ${fmtDur(new Date(m.endedAt) - new Date(m.startedAt))}`
                    : ''}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ONE MEETING */}
        {id && report && (
          <>
            <div className="glass-card" style={card}>
              <strong style={{ fontSize: 18 }}>{dateLine(report)}</strong>
              <div style={{ opacity: 0.7, marginTop: 6 }}>
                {lengthLine(report)} · {peopleLine(report)}
              </div>
              <button
                className="primary-btn"
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                onClick={() =>
                  downloadText(`meeting-summary-${report.roomId}.txt`, formatSummary(report))
                }
              >
                <Download size={16} /> Download summary
              </button>
            </div>

            <div className="glass-card" style={card}>
              <p style={heading}>KEY POINTS</p>
              {report.discussed.length === 0 && <p>Nothing was recorded.</p>}
              {report.discussed.map((s, i) => (
                <p key={i} style={{ margin: '8px 0' }}>
                  {s.who} {s.verb}: "{s.text}"
                </p>
              ))}
            </div>

            {report.actionItems.length > 0 && (
              <div className="glass-card" style={card}>
                <p style={heading}>THINGS TO DO</p>
                {report.actionItems.map((a, i) => (
                  <p key={i} style={{ margin: '8px 0' }}>
                    {a.who}: {a.text}
                  </p>
                ))}
              </div>
            )}

            {report.engagement.people.length > 0 && (
              <div className="glass-card" style={card}>
                <p style={heading}>HOW EVERYONE TOOK PART</p>
                {report.engagement.people.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      margin: '10px 0',
                    }}
                  >
                    <strong>{p.label}</strong>
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ color: LEVEL_COLOR[p.level], fontWeight: 600 }}>
                        {levelWord(p.level)}
                      </span>
                      <span style={{ opacity: 0.6, fontSize: 13 }}>
                        {' '}
                        · spoke or signed for about {fmtDur(p.speakingMs)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="glass-card" style={card}>
              <button
                className="logout-btn"
                style={{ width: '100%', textAlign: 'left', padding: 0 }}
                onClick={() => setShowTranscript((v) => !v)}
              >
                {showTranscript ? 'Hide full transcript' : 'Show full transcript'}
              </button>
              {showTranscript && (
                <div style={{ marginTop: 12 }}>
                  {report.transcript.length === 0 && <p>Nothing was recorded.</p>}
                  {report.transcript.map((t, i) => (
                    <p key={i} style={{ margin: '6px 0', fontSize: 14 }}>
                      <span style={{ opacity: 0.5 }}>
                        {t.time
                          ? new Date(t.time).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
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
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Insights;