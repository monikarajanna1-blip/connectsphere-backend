import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check, X, Hand } from 'lucide-react';
import socket from '../socket';
import { startSpeechRecognition } from '../speechRecognizer';
import {
  startSignRecognition,
  preloadSignRecognition,
  disposeSignRecognition,
} from '../signRecognizer';
import '../App.css';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isHost = location.state?.isHost || false;

  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const leavingRef = useRef(false);

  // One RTCPeerConnection per other participant, keyed by their socket id
  const peerConnectionsRef = useRef({});

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [hostEndedPopup, setHostEndedPopup] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [showStartPopup, setShowStartPopup] = useState(isHost);
  const [hostLeftBanner, setHostLeftBanner] = useState(false);
  const [hostId, setHostId] = useState(null);
  // peers: { [socketId]: MediaStream }
  const [peers, setPeers] = useState({});

  // ===== Sign-language captions (shown live) =====
  const [signOn, setSignOn] = useState(false);
  const [signLoading, setSignLoading] = useState(false);
  const [signError, setSignError] = useState('');
  const [caption, setCaption] = useState(null); // { fromId, text }  fromId = 'me' or a socket id
  const captionTimerRef = useRef(null);

  // ===== Silent speech transcription (saved for the summary, not shown) =====
  const [speechOn, setSpeechOn] = useState(true);

  const showCaption = (fromId, text, final) => {
    clearTimeout(captionTimerRef.current);
    if (!text) {
      setCaption(null);
      return;
    }
    setCaption({ fromId, text });
    if (final) {
      captionTimerRef.current = setTimeout(() => setCaption(null), 6000);
    }
  };

  const labelFor = (id) => {
    if (id === 'me') return 'You';
    return id === hostId ? 'Host' : 'Participant';
  };

  const stopMedia = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    } catch (err) {
      console.error(err);
    }
    streamRef.current = null;

    Object.values(peerConnectionsRef.current).forEach((pc) => {
      try {
        pc.close();
      } catch (err) {
        console.error(err);
      }
    });
    peerConnectionsRef.current = {};
  };

  useEffect(() => {
    let cancelled = false;
    const pendingCandidates = {}; // remoteId -> [candidate, ...]

    const flushCandidates = async (remoteId) => {
      const pc = peerConnectionsRef.current[remoteId];
      if (!pc || !pc.remoteDescription) return;
      const queue = pendingCandidates[remoteId] || [];
      pendingCandidates[remoteId] = [];
      for (const c of queue) {
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          console.error('addIceCandidate failed:', err);
        }
      }
    };

    const createPeerConnection = (remoteId) => {
      if (peerConnectionsRef.current[remoteId]) {
        peerConnectionsRef.current[remoteId].close();
      }
      const pc = new RTCPeerConnection(ICE_SERVERS);

      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        setPeers((prev) => ({ ...prev, [remoteId]: event.streams[0] }));
      };

      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          setPeers((prev) => {
            const next = { ...prev };
            delete next[remoteId];
            return next;
          });
        }
      };

      peerConnectionsRef.current[remoteId] = pc;
      return pc;
    };

    const connectToNewPeer = async (remoteId) => {
      const pc = createPeerConnection(remoteId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: remoteId, offer });
    };

    // The token tells the server which account this is, so the meeting
    // shows up in that user's Recent Meetings
    const joinRoom = () =>
      socket.emit('join-room', {
        roomId,
        isHost,
        token: localStorage.getItem('token'),
      });

    const onConnect = () => {
      if (streamRef.current) joinRoom();
    };

    const onRoomNotFound = () => {
      stopMedia();
      setRoomNotFound(true);
      socket.disconnect();
    };

    const onUserJoined = (remoteId) => {
      connectToNewPeer(remoteId);
    };

    const onOffer = async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushCandidates(from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    };

    const onAnswer = async ({ from, answer }) => {
      const pc = peerConnectionsRef.current[from];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushCandidates(from);
    };

    const onIceCandidate = async ({ from, candidate }) => {
      if (!candidate) return;
      const pc = peerConnectionsRef.current[from];
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.error('addIceCandidate failed:', err);
        }
      } else {
        if (!pendingCandidates[from]) pendingCandidates[from] = [];
        pendingCandidates[from].push(candidate);
      }
    };

    const onUserLeft = (remoteId) => {
      const pc = peerConnectionsRef.current[remoteId];
      if (pc) {
        pc.close();
        delete peerConnectionsRef.current[remoteId];
      }
      setPeers((prev) => {
        const next = { ...prev };
        delete next[remoteId];
        return next;
      });
    };

    // Host pressed End Call: ask the others whether to continue or leave
    const onHostEnded = () => {
      setHostEndedPopup(true);
    };

    // Host closed the tab without pressing End Call
    const onHostLeft = () => {
      setHostLeftBanner(true);
    };

    const onHostId = (id) => {
      setHostId(id);
    };

    // A caption arrived from another participant who is signing.
    // Each new word is spoken right away.
    const onSignCaption = ({ from, text, final, word }) => {
      showCaption(from, text, final);
      if (word && 'speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
      }
    };

    socket.on('connect', onConnect);
    socket.on('room-not-found', onRoomNotFound);
    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('host-ended', onHostEnded);
    socket.on('host-left', onHostLeft);
    socket.on('host-id', onHostId);
    socket.on('sign-caption', onSignCaption);

    if (!socket.connected) socket.connect();

    const startCamera = async () => {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24 },
          },
          audio: true,
        });

        if (cancelled) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        if (socket.connected) joinRoom();
      } catch (err) {
        console.error(err);
        setError(
          `Could not access camera/microphone (${err.name}). Please allow permission and reload.`
        );
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      socket.off('connect', onConnect);
      socket.off('room-not-found', onRoomNotFound);
      socket.off('user-joined', onUserJoined);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.off('host-ended', onHostEnded);
      socket.off('host-left', onHostLeft);
      socket.off('host-id', onHostId);
      socket.off('sign-caption', onSignCaption);
      socket.disconnect();
      stopMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Load the sign model in the background a few seconds after the room opens
  // (skipped in Firefox, where it is heavy; it loads when the hand button is pressed)
  useEffect(() => {
    const isFirefox = navigator.userAgent.includes('Firefox');
    const timer = isFirefox
      ? null
      : setTimeout(() => {
          preloadSignRecognition().catch((err) =>
            console.error('Sign preload failed:', err)
          );
        }, 5000);
    return () => {
      clearTimeout(timer);
      disposeSignRecognition();
    };
  }, []);

  // Silently listen to my voice and send each sentence to the server.
  // It only listens while my mic is on, so muting also pauses it.
  useEffect(() => {
    if (!speechOn || !micOn) return;
    const stop = startSpeechRecognition({
      onFinal: (text) => socket.emit('transcript-line', { text, kind: 'speech' }),
      onError: (msg) => {
        console.warn('Speech recognition:', msg);
        setSpeechOn(false);
      },
    });
    return stop;
  }, [speechOn, micOn]);

  // Measure how long I actually make sound (works with the camera off)
  useEffect(() => {
    let ctx = null;
    let analyser = null;
    let data = null;
    let acc = 0;
    let ticks = 0;

    const timer = setInterval(() => {
      if (!analyser && streamRef.current && streamRef.current.getAudioTracks().length) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          const src = ctx.createMediaStreamSource(streamRef.current);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          src.connect(analyser);
          data = new Uint8Array(analyser.fftSize);
        } catch (e) {
          return;
        }
      }
      if (!analyser) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms > 0.03) acc += 250; // louder than background noise = speaking

      ticks++;
      if (ticks % 20 === 0) {
        // every 5 seconds, tell the server
        if (acc > 0) socket.emit('engagement-tick', { speakingMs: acc });
        acc = 0;
      }
    }, 250);

    return () => {
      clearInterval(timer);
      if (ctx) ctx.close().catch(() => {});
    };
  }, []);

  // Start / stop sign recognition when the hand button is toggled
  useEffect(() => {
    if (!signOn) {
      setCaption(null);
      return;
    }
    let cancelled = false;
    let stop = null;
    setSignLoading(true);
    setSignError('');

    startSignRecognition(localVideoRef.current, {
      onUpdate: (text, word) => {
        showCaption('me', text, false);
        socket.emit('sign-caption', { text, final: false, word });
      },
      onSentence: (text) => {
        showCaption('me', text, true);
        socket.emit('sign-caption', { text, final: true });
      },
    })
      .then((s) => {
        if (cancelled) s();
        else {
          stop = s;
          setSignLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        setSignError(`Sign recognition failed (${err.message})`);
        setSignLoading(false);
        setSignOn(false);
      });

    return () => {
      cancelled = true;
      if (stop) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signOn]);

  const toggleMic = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      socket.emit('mic-state', { on: !micOn });
      setMicOn(!micOn);
    }
  };

  const toggleCam = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setCamOn(!camOn);
    }
  };

  // Leave and go home. Speech and sign recognition stop first, so the
  // last sentence is sent; the connection closes a moment later.
  const finishLeave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setSpeechOn(false);
    setSignOn(false);
    setHostEndedPopup(false);
    setShowStartPopup(false);
    stopMedia();
    setTimeout(() => {
      try {
        socket.disconnect();
      } catch (err) {
        console.error(err);
      }
      navigate('/home');
    }, 1200);
  };

  const handleLeave = () => {
    if (isHost && socket.connected) {
      let done = false;
      const go = () => {
        if (!done) {
          done = true;
          finishLeave();
        }
      };
      socket.emit('end-call', go);
      setTimeout(go, 800);
    } else {
      finishLeave();
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Actually unmute the other people's videos (needed after autoplay was blocked)
  const handleUnmute = () => {
    document.querySelectorAll('video.remote-video').forEach((v) => {
      v.muted = false;
      v.play().catch(() => {});
    });
    setNeedsUnmute(false);
  };

  if (roomNotFound) {
    return (
      <div className="room-container">
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card ended-card">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="ended-title">Meeting not found</p>
              <p className="code-modal-text">
                No host has started a meeting with this code. Check the code
                and try again.
              </p>
              <button
                className="v3-btn"
                style={{ width: '100%' }}
                onClick={() => navigate('/home')}
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const peerIds = Object.keys(peers);
  const othersRemain = peerIds.filter((id) => id !== hostId).length > 0;

  return (
    <div className="room-container">
      <div className="room-header">
        <div className="dash-logo">
          Connect<span>Sphere</span>
        </div>
        {isHost && (
          <button className="room-code-chip" onClick={handleCopyCode}>
            Room: {roomId}
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>
      {error && <p className="v3-error room-error">{error}</p>}

      {hostLeftBanner && (
        <div className="host-left-banner">
          <span>The host has left the meeting. You can keep talking with others here.</span>
          <button onClick={() => setHostLeftBanner(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 12, opacity: 0.6, margin: '4px 0' }}>
        This meeting is being transcribed to create a summary.
      </p>

      <div className="room-video-grid">
        <div className="video-tile">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">{isHost ? 'You (Host)' : 'You'}</div>
        </div>

        {peerIds.map((id) => (
          <RemoteVideo
            key={id}
            stream={peers[id]}
            label={id === hostId ? 'Host' : 'Participant'}
            onNeedsUnmute={() => setNeedsUnmute(true)}
          />
        ))}
      </div>

      {needsUnmute && (
        <button className="unmute-btn-floating" onClick={handleUnmute}>
          Tap to unmute
        </button>
      )}

      {signLoading && (
        <p style={{ textAlign: 'center' }}>Loading sign recognition...</p>
      )}
      {signError && <p className="v3-error room-error">{signError}</p>}
      {caption && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 110,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 12,
            fontSize: 22,
            maxWidth: '90%',
            zIndex: 50,
          }}
        >
          <strong>{labelFor(caption.fromId)}:</strong> {caption.text}
        </div>
      )}

      <div className="room-controls" style={{ zIndex: 100 }}>
        <button
          className={`control-btn ${!micOn ? 'off' : ''}`}
          onClick={toggleMic}
        >
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
        <button
          className={`control-btn ${!camOn ? 'off' : ''}`}
          onClick={toggleCam}
        >
          {camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        <button
          className="control-btn"
          style={signOn ? { background: '#6c5ce7' } : undefined}
          onClick={() => setSignOn((v) => !v)}
          title="Sign language captions"
        >
          <Hand size={20} />
        </button>
        <button
          className="control-btn leave-btn"
          onClick={handleLeave}
          title={isHost ? 'End call for everyone' : 'Leave call'}
        >
          <PhoneOff size={20} />
        </button>
      </div>

      {showStartPopup && isHost && (
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card code-modal">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="code-modal-text">Share this code to invite others</p>
              <div className="code-display">
                <span>{roomId}</span>
                <button onClick={handleCopyCode} className="code-copy-btn">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button className="v3-btn" onClick={() => setShowStartPopup(false)}>
                OK, Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {hostEndedPopup && (
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card ended-card">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="ended-title">The host ended the meeting</p>
              <p className="code-modal-text">
                {othersRemain
                  ? 'You can keep talking with the other participants, or leave now.'
                  : 'There is no one else in the meeting.'}
              </p>
              {othersRemain && (
                <button
                  className="v3-btn"
                  style={{ width: '100%', marginBottom: 10 }}
                  onClick={() => setHostEndedPopup(false)}
                >
                  Continue
                </button>
              )}
              <button
                className="v3-btn"
                style={{ width: '100%' }}
                onClick={finishLeave}
              >
                Leave meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A small dedicated component per remote participant, so each one
// gets its own <video> element and its own play()/unmute handling.
function RemoteVideo({ stream, label, onNeedsUnmute }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {
      el.muted = true;
      el.play().catch(() => {});
      onNeedsUnmute();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  return (
    <div className="video-tile">
      <video ref={videoRef} className="remote-video" autoPlay playsInline />
      <div className="video-label">{label}</div>
    </div>
  );
}

export default MeetingRoom;