import { useEffect, useRef, useState } from 'react';
import {
  Users,
  Paperclip,
  Mic,
  MicOff,
  X,
  Pencil,
  Download,
  MessageCircle,
  Send,
} from 'lucide-react';
import socket from './socket';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(pdf|docx?|pptx?|xlsx?|txt|csv|png|jpe?g)$/i;

const fmtSize = (n) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

const fmtTime = (t) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Lets MeetingRoom show real names on the video tiles: { [socketId]: name }
export function usePeopleNames() {
  const [names, setNames] = useState({});
  useEffect(() => {
    const onPeople = (list) =>
      setNames(Object.fromEntries((list || []).map((p) => [p.id, p.name])));
    socket.on('participants', onPeople);
    return () => socket.off('participants', onPeople);
  }, []);
  return names;
}

// Turns web addresses in a message into clickable links (http and https only)
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function Linkified({ text }) {
  const parts = String(text).split(URL_RE);
  return parts.map((p, i) => {
    if (i % 2 === 0) return <span key={i}>{p}</span>;
    const m = p.match(/^(.*?)([.,;:!?)]*)$/); // keep trailing punctuation out of the link
    return (
      <span key={i}>
        <a
          href={m[1]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#7dd3fc', wordBreak: 'break-all' }}
        >
          {m[1]}
        </a>
        {m[2]}
      </span>
    );
  });
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const iconBtn = {
  display: 'flex',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: 4,
  opacity: 0.8,
};

const chip = (active) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.15)',
  background: active ? '#6c5ce7' : 'rgba(255,255,255,0.06)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 14,
});

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

function MeetingExtras({ isHost }) {
  const [title, setTitle] = useState('Meeting');
  const [people, setPeople] = useState([]);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [panel, setPanel] = useState(null); // null | 'people' | 'chat'
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const fileInput = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  panelRef.current = panel;

  useEffect(() => {
    const onTitle = (t) => setTitle(t || 'Meeting');
    const onPeople = (list) => setPeople(list || []);
    const onFiles = (list) => setFiles(list || []);
    const onHistory = (list) => setMessages(list || []);
    const onMessage = (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (panelRef.current !== 'chat' && m.fromId !== socket.id) setUnseen((n) => n + 1);
    };
    const onFile = (f) => {
      setFiles((prev) => (prev.some((x) => x.id === f.id) ? prev : [...prev, f]));
      if (panelRef.current !== 'chat' && f.fromId !== socket.id) setUnseen((n) => n + 1);
    };
    const onFull = () => {
      alert('This meeting is full.');
      window.location.href = '/home';
    };

    socket.on('room-title', onTitle);
    socket.on('participants', onPeople);
    socket.on('shared-files', onFiles);
    socket.on('file-shared', onFile);
    socket.on('chat-history', onHistory);
    socket.on('chat-message', onMessage);
    socket.on('room-full', onFull);
    return () => {
      socket.off('room-title', onTitle);
      socket.off('participants', onPeople);
      socket.off('shared-files', onFiles);
      socket.off('file-shared', onFile);
      socket.off('chat-history', onHistory);
      socket.off('chat-message', onMessage);
      socket.off('room-full', onFull);
    };
  }, []);

  // Messages and files together, oldest first
  const timeline = [
    ...messages.map((m) => ({ ...m, type: 'msg' })),
    ...files.map((f) => ({ ...f, type: 'file' })),
  ].sort((a, b) => a.time - b.time);

  // Keep the newest message in view
  useEffect(() => {
    if (panel === 'chat' && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [timeline.length, panel]);

  const open = (name) => {
    setPanel((p) => (p === name ? null : name));
    if (name === 'chat') setUnseen(0);
  };

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };

  const saveTitle = () => {
    const t = draft.trim();
    if (t && t !== title) socket.emit('set-title', t);
    setEditing(false);
  };

  const sendText = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setNote('');
    socket.emit('chat-message', { text: t }, (res) => {
      if (res && res.error) setNote(res.error);
    });
    setText('');
  };

  const handlePick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setNote('');
    if (!ALLOWED.test(file.name)) {
      setNote('Allowed types: PDF, Word, PowerPoint, Excel, TXT, CSV, PNG, JPG.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setNote('That file is larger than 10 MB.');
      return;
    }
    setSending(true);
    try {
      const data = await file.arrayBuffer();
      socket.emit('share-file', { name: file.name, data }, (res) => {
        setSending(false);
        if (res && res.error) setNote(res.error);
      });
      setTimeout(() => setSending(false), 60000); // safety if no answer arrives
    } catch (err) {
      setSending(false);
      setNote('Could not read that file.');
    }
  };

  const handleDownload = (f) => {
    setNote('');
    socket.emit('get-file', f.id, (res) => {
      if (!res || res.error) {
        setNote((res && res.error) || 'Could not download this file.');
        return;
      }
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          color: '#f1f5f9',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
              }}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                color: 'inherit',
                padding: '4px 8px',
                fontSize: 15,
                minWidth: 0,
                width: 'min(320px, 50vw)',
              }}
            />
          ) : (
            <strong title={title} style={{ fontSize: 15, ...ellipsis }}>
              {title}
            </strong>
          )}
          {isHost && !editing && (
            <button style={iconBtn} onClick={startEdit} title="Rename meeting">
              <Pencil size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button style={chip(panel === 'people')} onClick={() => open('people')}>
            <Users size={16} /> {people.length}
          </button>
          <button style={chip(panel === 'chat')} onClick={() => open('chat')}>
            <MessageCircle size={16} /> Chat
            {unseen > 0 && (
              <span
                style={{
                  background: '#ef4444',
                  borderRadius: 999,
                  fontSize: 11,
                  padding: '1px 6px',
                }}
              >
                {unseen}
              </span>
            )}
          </button>
        </div>
      </div>

      {panel && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: 'min(360px, 100%)',
            background: '#12151f',
            color: '#f1f5f9',
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            zIndex: 150,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <strong>{panel === 'people' ? `Participants (${people.length})` : 'Chat'}</strong>
            <button style={iconBtn} onClick={() => setPanel(null)} title="Close">
              <X size={18} />
            </button>
          </div>

          {/* PEOPLE */}
          {panel === 'people' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {people.map((p) => (
                <div key={p.id} style={row}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: '#6c5ce7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {(p.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={ellipsis}>
                      {p.name}
                      {p.id === socket.id ? ' (You)' : ''}
                    </div>
                    {p.isHost && <div style={{ fontSize: 12, opacity: 0.7 }}>Host</div>}
                  </div>
                  {p.micOn ? <Mic size={16} /> : <MicOff size={16} color="#f87171" />}
                </div>
              ))}
            </div>
          )}

          {/* CHAT */}
          {panel === 'chat' && (
            <>
              <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                {timeline.length === 0 && (
                  <p style={{ padding: '10px 14px', opacity: 0.6, fontSize: 14 }}>
                    No messages yet. Say hello, paste a link, or share a file.
                  </p>
                )}
                {timeline.map((m) => {
                  const mine = m.fromId === socket.id;
                  return (
                    <div
                      key={`${m.type}-${m.id}`}
                      style={{
                        display: 'flex',
                        justifyContent: mine ? 'flex-end' : 'flex-start',
                        padding: '4px 12px',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '85%',
                          background: mine ? '#6c5ce7' : 'rgba(255,255,255,0.08)',
                          borderRadius: 12,
                          padding: '8px 12px',
                        }}
                      >
                        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 3 }}>
                          {mine ? 'You' : m.fromName} · {fmtTime(m.time)}
                        </div>
                        {m.type === 'msg' ? (
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            <Linkified text={m.text} />
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Paperclip size={16} style={{ flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ wordBreak: 'break-word' }}>{m.name}</div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>{fmtSize(m.size)}</div>
                            </div>
                            <button
                              style={iconBtn}
                              onClick={() => handleDownload(m)}
                              title="Download"
                            >
                              <Download size={18} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {note && (
                <p style={{ color: '#f87171', fontSize: 13, margin: '0 14px 6px' }}>{note}</p>
              )}
              <p style={{ fontSize: 11, opacity: 0.5, margin: '0 14px 6px' }}>
                Files: PDF, Word, PowerPoint, Excel, TXT, CSV, PNG or JPG, up to 10 MB.
              </p>

              <form
                onSubmit={sendText}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 12px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg"
                  onChange={handlePick}
                />
                <button
                  type="button"
                  style={iconBtn}
                  disabled={sending}
                  onClick={() => fileInput.current && fileInput.current.click()}
                  title="Share a file"
                >
                  <Paperclip size={20} />
                </button>
                <input
                  value={text}
                  maxLength={1000}
                  placeholder={sending ? 'Sending file...' : 'Type a message'}
                  onChange={(e) => setText(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 999,
                    color: 'inherit',
                    padding: '8px 14px',
                    fontSize: 14,
                  }}
                />
                <button type="submit" style={iconBtn} title="Send">
                  <Send size={20} />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default MeetingExtras;