import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check, X } from 'lucide-react';
import socket from '../socket';
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

  // One RTCPeerConnection per other participant, keyed by their socket id
  const peerConnectionsRef = useRef({});

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [showStartPopup, setShowStartPopup] = useState(isHost);
  const [hostLeftBanner, setHostLeftBanner] = useState(false);
  // peers: { [socketId]: MediaStream }
  const [peers, setPeers] = useState({});

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

    const joinRoom = () => socket.emit('join-room', { roomId, isHost });

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

    const onCallEnded = () => {
      stopMedia();
      setPeers({});
      setCallEnded(true);
      socket.disconnect();
    };
    const onHostLeft = () => {
      setHostLeftBanner(true);
   };

    socket.on('connect', onConnect);
    socket.on('room-not-found', onRoomNotFound);
    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('call-ended', onCallEnded);
    socket.on('host-left', onHostLeft);

    if (!socket.connected) socket.connect();

    const startCamera = async () => {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
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
      socket.off('call-ended', onCallEnded);
      socket.off('host-left', onHostLeft);
      socket.disconnect();
      stopMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const toggleMic = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
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

  const finishLeave = () => {
    stopMedia();
    try {
      socket.disconnect();
    } catch (err) {
      console.error(err);
    }
    navigate('/home');
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

      <div className="room-video-grid">
        <div className="video-tile">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">You</div>
        </div>

        {peerIds.map((id) => (
          <RemoteVideo
            key={id}
            stream={peers[id]}
            onNeedsUnmute={() => setNeedsUnmute(true)}
          />
        ))}
      </div>

      {needsUnmute && (
        <button
          className="unmute-btn-floating"
          onClick={() => setNeedsUnmute(false)}
        >
          Tap to unmute
        </button>
      )}

      <div className="room-controls">
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

      {callEnded && (
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card ended-card">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="ended-title">The call has been ended</p>
              <p className="code-modal-text">The host ended this meeting.</p>
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
      )}
    </div>
  );
}

// A small dedicated component per remote participant, so each one
// gets its own <video> element and its own play()/unmute handling.
function RemoteVideo({ stream, onNeedsUnmute }) {
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
      <video ref={videoRef} autoPlay playsInline />
      <div className="video-label">Participant</div>
    </div>
  );
}

export default MeetingRoom;