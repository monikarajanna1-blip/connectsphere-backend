import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check } from 'lucide-react';
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
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [roomCount, setRoomCount] = useState(0);
  const [iceState, setIceState] = useState('none');
  const [signalingState, setSignalingState] = useState('none');

  // Attach the remote stream AFTER the <video> element exists
  useEffect(() => {
    if (remoteConnected && remoteVideoRef.current && remoteStreamRef.current) {
      const el = remoteVideoRef.current;
      el.srcObject = remoteStreamRef.current;
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
        setNeedsUnmute(true);
      });
    }
  }, [remoteConnected]);

  useEffect(() => {
    let cancelled = false;
    const pendingCandidates = [];

    const flushCandidates = async () => {
      const pc = peerConnectionRef.current;
      if (!pc || !pc.remoteDescription) return;
      while (pendingCandidates.length) {
        const c = pendingCandidates.shift();
        try {
          await pc.addIceCandidate(c);
        } catch (err) {
          console.error('addIceCandidate failed:', err);
        }
      }
    };

    const createPeerConnection = (remoteId) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      const pc = new RTCPeerConnection(ICE_SERVERS);

      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', {
            to: remoteId,
            candidate: event.candidate,
          });
        }
      };

      pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);
      pc.onsignalingstatechange = () => setSignalingState(pc.signalingState);

      pc.ontrack = (event) => {
        remoteStreamRef.current = event.streams[0];
        setRemoteConnected(true);
      };

      peerConnectionRef.current = pc;
      setIceState(pc.iceConnectionState);
      setSignalingState(pc.signalingState);
      return pc;
    };

    const onConnect = () => {
      setSocketStatus('connected');
      if (streamRef.current) socket.emit('join-room', roomId);
    };
    const onDisconnect = () => setSocketStatus('disconnected');
    const onRoomCount = (n) => setRoomCount(n);

    const onUserJoined = async (remoteId) => {
      const pc = createPeerConnection(remoteId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: remoteId, offer });
    };

    const onOffer = async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    };

    const onAnswer = async ({ answer }) => {
      const pc = peerConnectionRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushCandidates();
    };

    const onIceCandidate = async ({ candidate }) => {
      if (!candidate) return;
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.error('addIceCandidate failed:', err);
        }
      } else {
        pendingCandidates.push(candidate);
      }
    };

    const onUserLeft = () => {
      remoteStreamRef.current = null;
      setRemoteConnected(false);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      setIceState('none');
      setSignalingState('none');
    };

    // Status listeners first, so the status line is accurate right away
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room-count', onRoomCount);
    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);

    if (socket.connected) {
      setSocketStatus('connected');
    } else {
      socket.connect();
    }

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

        if (socket.connected) socket.emit('join-room', roomId);
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
      socket.off('disconnect', onDisconnect);
      socket.off('room-count', onRoomCount);
      socket.off('user-joined', onUserJoined);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.disconnect();

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
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

  const handleLeave = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    } catch (err) {
      console.error(err);
    }
    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    } catch (err) {
      console.error(err);
    }
    try {
      socket.disconnect();
    } catch (err) {
      console.error(err);
    }
    navigate('/home');
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

      <div className="debug-strip">
        Socket: {socketStatus} · In room: {roomCount} · Signaling: {signalingState} · ICE: {iceState}
      </div>

      {error && <p className="v3-error room-error">{error}</p>}

      <div className="room-video-grid">
        <div className="video-tile">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">You</div>
        </div>

        {remoteConnected && (
          <div className="video-tile">
            <video ref={remoteVideoRef} autoPlay playsInline />
            <div className="video-label">Participant</div>
            {needsUnmute && (
              <button
                className="unmute-btn"
                onClick={() => {
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.muted = false;
                    remoteVideoRef.current.play().catch(() => {});
                  }
                  setNeedsUnmute(false);
                }}
              >
                Tap to unmute
              </button>
            )}
          </div>
        )}
      </div>

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
        <button className="control-btn leave-btn" onClick={handleLeave}>
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
}

export default MeetingRoom;