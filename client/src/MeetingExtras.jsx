import { useEffect, useRef, useState } from 'react';
import { Users, Paperclip, Mic, MicOff, X, Pencil, Download } from 'lucide-react';
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
  const [panel, setPanel] = useState(null); // null | 'people' | 'files'
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const fileInput = useRef(null);
  const panelRef = useRef(null);
  panelRef.current = panel;

  useEffect(() => {
    const onTitle = (t) => setTitle(t || 'Meeting');
    const onPeople = (list) => setPeople(list || []);
    const onFiles = (list) => setFiles(list || []);
    const onFile = (f) => {
      setFiles((prev) => (prev.some((x) => x.id === f.id) ? prev : [...prev, f]));
      if (panelRef.current !== 'files' && f.fromId !== socket.id) {
        setUnseen((n) => n + 1);
      }
    };
    const onFull = () => {
      alert('This meeting is full.');
      window.location.href = '/home';
    };

    socket.on('room-title', onTitle);
    socket.on('participants', onPeople);
    socket.on('shared-files', onFiles);
    socket.on('file-shared', onFile);
    socket.on('room-full', onFull);
    return () => {
      socket.off('room-title', onTitle);
      socket.off('participants', onPeople);
      socket.off('shared-files', onFiles);
      socket.off('file-shared', onFile);
      socket.off('room-full', onFull);
    };
  }, []);

  const open = (name) => {
    setPanel((p) => (p === name ? null : name));
    if (name === 'files') setUnseen(0);
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
          <button style={chip(panel === 'files')} onClick={() => open('files')}>
            <Paperclip size={16} /> Files
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
            width: 'min(340px, 100%)',
            background: '#12151f',
            color: '#f1f5f9',
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            zIndex: 150,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <strong>
              {panel === 'people' ? `Participants (${people.length})` : 'Shared files'}
            </strong>
            <button style={iconBtn} onClick={() => setPanel(null)} title="Close">
              <X size={18} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {panel === 'people' &&
              people.map((p) => (
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

            {panel === 'files' && (
              <>
                <div style={{ padding: 14 }}>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg"
                    onChange={handlePick}
                  />
                  <button
                    className="join-go"
                    style={{ width: '100%' }}
                    disabled={sending}
                    onClick={() => fileInput.current && fileInput.current.click()}
                  >
                    {sending ? 'Sending...' : 'Share a file'}
                  </button>
                  <p style={{ fontSize: 12, opacity: 0.6, margin: '8px 0 0' }}>
                    PDF, Word, PowerPoint, Excel, TXT, CSV, PNG or JPG, up to 10 MB.
                    Everyone in this meeting can download it.
                  </p>
                  {note && (
                    <p style={{ color: '#f87171', fontSize: 13, margin: '8px 0 0' }}>{note}</p>
                  )}
                </div>
                {files.length === 0 && (
                  <p style={{ padding: '0 14px', opacity: 0.6, fontSize: 14 }}>
                    No files shared yet.
                  </p>
                )}
                {files.map((f) => (
                  <div key={f.id} style={row}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={ellipsis} title={f.name}>
                        {f.name}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>
                        {f.fromId === socket.id ? 'You' : f.fromName} · {fmtSize(f.size)} ·{' '}
                        {fmtTime(f.time)}
                      </div>
                    </div>
                    <button style={iconBtn} onClick={() => handleDownload(f)} title="Download">
                      <Download size={18} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default MeetingExtras;
