import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Copy, Check } from 'lucide-react';
import socket from '../socket';
import '../App.css';

// Free public STUN server from Google — helps discover your public IP
const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isHost = location.state?.isHost || false;

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remotePeerIdRef = useRef(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const createPeerConnection = (remoteId) => {
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

      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(() => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.muted = true;
              remoteVideoRef.current.play();
            }
            setNeedsUnmute(true);
          });
        }
        setRemoteConnected(true);
      };

      peerConnectionRef.current = pc;
      return pc;
    };

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

        socket.emit('join-room', roomId);

        socket.on('user-joined', async (remoteId) => {
          remotePeerIdRef.current = remoteId;
          const pc = createPeerConnection(remoteId);

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket.emit('offer', { to: remoteId, offer });
        });

        socket.on('offer', async ({ from, offer }) => {
          remotePeerIdRef.current = from;
          const pc = createPeerConnection(from);

          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit('answer', { to: from, answer });
        });

        socket.on('answer', async ({ answer }) => {
          if (peerConnectionRef.current) {
            await peerConnectionRef.current.setRemoteDescription(
              new RTCSessionDescription(answer)
            );
          }
        });

        socket.on('ice-candidate', async ({ candidate }) => {
          if (peerConnectionRef.current && candidate) {
            try {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(candidate)
              );
            } catch (err) {
              console.error('Error adding ICE candidate:', err);
            }
          }
        });

        socket.on('user-left', () => {
          setRemoteConnected(false);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
          }
        });
      } catch (err) {
        console.error(err);
        setError(
          'Could not access camera/microphone. Please allow permission and reload.'
        );
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      socket.off('user-joined');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
      socket.off('user-left');
      socket.disconnect();

      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    socket.disconnect();
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
                    remoteVideoRef.current.play();
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