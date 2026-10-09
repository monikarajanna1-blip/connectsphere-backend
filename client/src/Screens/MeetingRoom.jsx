import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Copy,
  Check,
  X,
  Hand,
  ScreenShare,
  ScreenShareOff,
} from 'lucide-react';
import socket from '../socket';
import { startSpeechRecognition } from '../speechRecognizer';
import {
  startSignRecognition,
  preloadSignRecognition,
  disposeSignRecognition,
} from '../signRecognizer';
import { getCachedSettings, fetchSettings, captionStyle } from '../accessibility';
import '../App.css';
import MeetingExtras, { usePeopleNames } from '../MeetingExtras';

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

const myName = () => {
  try {
    return JSON.parse(localStorage.getItem('user'))?.name || 'Guest';
  } catch (err) {
    return 'Guest';
  }
};

function MeetingRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isHost = location.state?.isHost || false;

  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const leavingRef = useRef(false);
  const screenTrackRef = useRef(null); // the screen-share video track while sharing

  // One RTCPeerConnection per other participant, keyed by their socket id
  const peerConnectionsRef = useRef({});

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [camReady, setCamReady] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [hostEndedPopup, setHostEndedPopup] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [waiting, setWaiting] = useState(null); // { title, startsAt } while waiting for the host
  const [nowTick, setNowTick] = useState(Date.now());
  const [showStartPopup, setShowStartPopup] = useState(isHost);
  const [hostLeftBanner, setHostLeftBanner] = useState(false);
  const [hostId, setHostId] = useState(null);
  // peers: { [socketId]: MediaStream }
  const [peers, setPeers] = useState({});
  const names = usePeopleNames();

  // ===== Meeting name (the host can set it when starting) =====
  const [meetingName, setMeetingName] = useState('');
  const nameTouched = useRef(false);
  const pendingTitleRef = useRef('');

  // ===== Screen sharing =====
  const [sharing, setSharing] = useState(false);
  const [sharerId, setSharerId] = useState(null); // socket id of whoever is sharing
  const [shareNote, setShareNote] = useState('');
  // phones cannot share their screen, so the button is hidden there
  const canShare =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  // ===== Accessibility preferences (saved on the user's account) =====
  const [prefs, setPrefs] = useState(getCachedSettings());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [captionsOn, setCaptionsOn] = useState(() => getCachedSettings().liveCaptions);
  const captionsRef = useRef(getCachedSettings().liveCaptions);
  const autoSignDone = useRef(false);

  // ===== Sign-language captions (shown live) =====
  const [signOn, setSignOn] = useState(false);
  const [signLoading, setSignLoading] = useState(false);
  const [signError, setSignError] = useState('');
  const [caption, setCaption] = useState(null); // { fromId, text }  fromId = 'me' or a socket id
  const captionTimerRef = useRef(null);

  // ===== Live captions of spoken English (only if the user turned them on) =====
  const [speechCaption, setSpeechCaption] = useState(null); // { fromId, text }
  const speechTimerRef = useRef(null);

  // ===== Silent speech transcription (saved for the summary) =====
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

  const showSpeechCaption = (fromId, text) => {
    clearTimeout(speechTimerRef.current);
    setSpeechCaption({ fromId, text });
    speechTimerRef.current = setTimeout(() => setSpeechCaption(null), 4000);
  };

  const labelFor = (id) => {
    if (id === 'me') return 'You';
    return names[id] || (id === hostId ? 'Host' : 'Participant');
  };

  const stopMedia = () => {
    try {
      if (screenTrackRef.current) {
        screenTrackRef.current.onended = null;
        screenTrackRef.current.stop();
      }
    } catch (err) {
      console.error(err);
    }
    screenTrackRef.current = null;

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

      // a person who joins while I am sharing gets my screen instead of my camera
      streamRef.current.getTracks().forEach((track) => {
        const useScreen =
          track.kind === 'video' &&
          screenTrackRef.current &&
          screenTrackRef.current.readyState === 'live';
        pc.addTrack(useScreen ? screenTrackRef.current : track, streamRef.current);
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
    // shows up in that user's Recent Meetings. "captions" says whether this
    // person wants spoken English shown as text.
    const joinRoom = () =>
      socket.emit('join-room', {
        roomId,
        isHost,
        token: localStorage.getItem('token'),
        captions: captionsRef.current,
        name: myName(),
      });

    const onConnect = () => {
      if (streamRef.current) joinRoom();
    };

    // The code is wrong, or the host has not started and nothing was scheduled
    const onRoomNotFound = () => {
      stopMedia();
      setRoomNotFound(true);
      socket.disconnect();
    };

    // A scheduled meeting that the host has not started yet: wait in the lobby
    const onWaiting = (info) => {
      setWaiting({
        title: info?.title || 'this meeting',
        startsAt: info?.startsAt || null,
      });
    };

    // The host started: join automatically
    const onHostStarted = () => {
      setWaiting(null);
      joinRoom();
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
      // the host typed a name before the connection was ready: send it now
      if (pendingTitleRef.current) {
        socket.emit('set-title', pendingTitleRef.current);
        pendingTitleRef.current = '';
      }
    };

    // The meeting name changed (also fills the name box in the host's start popup)
    const onRoomTitle = (t) => {
      if (!nameTouched.current) setMeetingName(t || '');
    };

    // Who is sharing their screen right now (or null)
    const onScreenSharer = (id) => {
      setSharerId(id || null);
    };

    // A caption arrived from another participant who is signing.
    // Each new word is spoken right away (if the user kept that setting on).
    const onSignCaption = ({ from, text, final, word }) => {
      showCaption(from, text, final);
      if (word && prefsRef.current.speakSigns && 'speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
      }
    };

    // Someone spoke, and this user turned live captions on
    const onSpeechCaption = ({ from, text }) => {
      showSpeechCaption(from, text);
    };

    socket.on('connect', onConnect);
    socket.on('room-not-found', onRoomNotFound);
    socket.on('waiting-for-host', onWaiting);
    socket.on('host-started', onHostStarted);
    socket.on('user-joined', onUserJoined);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('host-ended', onHostEnded);
    socket.on('host-left', onHostLeft);
    socket.on('host-id', onHostId);
    socket.on('room-title', onRoomTitle);
    socket.on('screen-sharer', onScreenSharer);
    socket.on('sign-caption', onSignCaption);
    socket.on('speech-caption', onSpeechCaption);

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
        setCamReady(true);

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
      socket.off('waiting-for-host', onWaiting);
      socket.off('host-started', onHostStarted);
      socket.off('user-joined', onUserJoined);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.off('host-ended', onHostEnded);
      socket.off('host-left', onHostLeft);
      socket.off('host-id', onHostId);
      socket.off('room-title', onRoomTitle);
      socket.off('screen-sharer', onScreenSharer);
      socket.off('sign-caption', onSignCaption);
      socket.off('speech-caption', onSpeechCaption);
      socket.disconnect();
      stopMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Load this user's saved accessibility settings
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    fetchSettings()
      .then((s) => {
        setPrefs(s);
        captionsRef.current = s.liveCaptions;
        setCaptionsOn(s.liveCaptions);
        socket.emit('caption-pref', { on: s.liveCaptions });
      })
      .catch(() => {});
  }, []);

  // Start sign recognition by itself if the user asked for that (once per meeting)
  useEffect(() => {
    if (!camReady || waiting || autoSignDone.current) return;
    if (prefs.autoSign) {
      autoSignDone.current = true;
      setSignOn(true);
    }
  }, [camReady, waiting, prefs.autoSign]);

  // Tick every second while waiting, so the countdown updates
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

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

  // Silently listen to my voice. Finished sentences are saved for the summary,
  // and the words are streamed live to people who turned captions on.
  useEffect(() => {
    if (!speechOn || !micOn || waiting) return;
    let lastText = '';
    let lastAt = 0;
    const stop = startSpeechRecognition({
      onInterim: (text) => {
        const t = Date.now();
        if (text === lastText || t - lastAt < 250) return; // at most 4 updates a second
        lastText = text;
        lastAt = t;
        socket.emit('speech-interim', { text });
      },
      onFinal: (text) => socket.emit('transcript-line', { text, kind: 'speech' }),
      onError: (msg) => {
        console.warn('Speech recognition:', msg);
        setSpeechOn(false);
      },
    });
    return stop;
  }, [speechOn, micOn, waiting]);

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

  // Start / stop sign recognition when the hand button is toggled.
  // It always reads the camera, so signing keeps working while sharing a screen.
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

  // Turn live captions of spoken English on or off for this meeting
  const toggleCaptions = () => {
    const next = !captionsOn;
    setCaptionsOn(next);
    captionsRef.current = next;
    if (!next) setSpeechCaption(null);
    socket.emit('caption-pref', { on: next });
  };

  // ----- Screen sharing -----
  // Swap the picture sent to everyone, without reconnecting
  const swapVideo = async (track) => {
    await Promise.all(
      Object.values(peerConnectionsRef.current).map((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        return sender ? sender.replaceTrack(track).catch(() => {}) : null;
      })
    );
  };

  const stopShare = async () => {
    const screen = screenTrackRef.current;
    if (!screen) return;
    screenTrackRef.current = null;
    screen.onended = null;
    try {
      screen.stop();
    } catch (err) {
      console.error(err);
    }
    const cam = streamRef.current?.getVideoTracks()[0];
    if (cam) await swapVideo(cam);
    socket.emit('screen-state', { on: false });
    setSharing(false);
  };

  const startShare = async () => {
    setShareNote('');
    if (!canShare || sharing || !streamRef.current) return;

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: false,
      });
    } catch (err) {
      // pressing Cancel in the browser's picker is not an error
      if (err.name !== 'NotAllowedError') setShareNote('Could not start screen sharing.');
      return;
    }

    const track = display.getVideoTracks()[0];
    if (!track) return;
    try {
      track.contentHint = 'detail'; // keeps text sharp
    } catch (err) {
      // not supported everywhere
    }

    // the server allows one sharer at a time
    socket.emit('screen-state', { on: true }, async (res) => {
      if (res && res.error) {
        track.stop();
        setShareNote(res.error);
        return;
      }
      screenTrackRef.current = track;
      await swapVideo(track);
      // the browser's own "Stop sharing" button ends the track
      track.onended = () => stopShare();
      setSharing(true);
    });
  };

  // Go home. Speech and sign recognition stop first, so the last sentence
  // is sent; the connection closes a moment later.
  const finishLeave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setSpeechOn(false);
    setSignOn(false);
    setHostEndedPopup(false);
    setShowStartPopup(false);
    setWaiting(null);
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

  // Name + code + link, ready to paste into a message
  const handleCopyInvite = () => {
    const text =
      `${meetingName.trim() || 'Meeting'}\n` +
      `Meeting code: ${roomId}\n` +
      `Join: ${window.location.origin}/meeting/${roomId}\n` +
      `(Log in to ConnectSphere first.)`;
    navigator.clipboard.writeText(text);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  // Host presses "Start meeting" in the start popup
  const handleStartMeeting = () => {
    const t = meetingName.trim();
    if (t) {
      if (hostId) socket.emit('set-title', t);
      else pendingTitleRef.current = t; // sent as soon as the connection is ready
    }
    setShowStartPopup(false);
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
              <p className="ended-title">The host hasn't started yet</p>
              <p className="code-modal-text">
                The host hasn't started this meeting. Please wait or try again in
                a minute. If it still doesn't open, check that the code is right.
              </p>
              <button
                className="v3-btn"
                style={{ width: '100%', marginBottom: 10 }}
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
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

  // Text under "Waiting for the host": scheduled time and a live countdown
  const waitText = (() => {
    if (!waiting?.startsAt) return '';
    const start = new Date(waiting.startsAt);
    const at = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diff = start.getTime() - nowTick;
    if (diff > 1000) {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `Scheduled for ${at} · starts in ${m}:${String(s).padStart(2, '0')}`;
    }
    return `Scheduled for ${at} · waiting for the host to press Start`;
  })();

  // Look of the caption boxes, from the user's accessibility settings
  const capBox = {
    ...captionStyle(prefs),
    padding: '10px 18px',
    borderRadius: 12,
    maxWidth: '100%',
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
      <MeetingExtras isHost={isHost} />
      {error && <p className="v3-error room-error">{error}</p>}

      {sharing && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '8px 16px',
            margin: '8px 16px 0',
            background: 'rgba(22,163,74,0.2)',
            border: '1px solid rgba(22,163,74,0.5)',
            color: '#bbf7d0',
            fontSize: 13,
            borderRadius: 10,
          }}
        >
          <span>You are sharing your screen with everyone.</span>
          <button className="join-go" onClick={stopShare}>
            Stop sharing
          </button>
        </div>
      )}
      {shareNote && <p className="v3-error room-error">{shareNote}</p>}

      {hostLeftBanner && (
        <div className="host-left-banner">
          <span>The host has left the meeting. You can keep talking with others here.</span>
          <button onClick={() => setHostLeftBanner(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 12, opacity: 0.6, margin: '4px 0' }}>
        This meeting is being transcribed. Chat messages are saved with it.
      </p>

      <div className="room-video-grid">
        <div className="video-tile">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <div className="video-label">
            {isHost ? 'You (Host)' : 'You'}
            {sharing ? ' · sharing screen' : ''}
          </div>
        </div>

        {peerIds.map((id) => (
          <RemoteVideo
            key={id}
            stream={peers[id]}
            isSharing={sharerId === id}
            label={
              (names[id]
                ? names[id] + (id === hostId ? ' (Host)' : '')
                : id === hostId
                ? 'Host'
                : 'Participant') + (sharerId === id ? ' · screen' : '')
            }
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

      {(caption || speechCaption) && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 110,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            maxWidth: '90%',
            zIndex: 50,
          }}
        >
          {speechCaption && (
            <div style={capBox}>
              <strong>{labelFor(speechCaption.fromId)}:</strong> {speechCaption.text}
            </div>
          )}
          {caption && (
            <div style={capBox}>
              <strong>{labelFor(caption.fromId)} (sign):</strong> {caption.text}
            </div>
          )}
        </div>
      )}

      <div className="room-controls" style={{ zIndex: 100 }}>
        <button
          className={`control-btn ${!micOn ? 'off' : ''}`}
          onClick={toggleMic}
          title={micOn ? 'Mute' : 'Unmute'}
        >
          {micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
        <button
          className={`control-btn ${!camOn ? 'off' : ''}`}
          onClick={toggleCam}
          title={camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        {canShare && (
          <button
            className="control-btn"
            style={sharing ? { background: '#16a34a' } : undefined}
            onClick={sharing ? stopShare : startShare}
            title={sharing ? 'Stop sharing' : 'Share your screen'}
          >
            {sharing ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
          </button>
        )}
        <button
          className="control-btn"
          style={captionsOn ? { background: '#6c5ce7' } : undefined}
          onClick={toggleCaptions}
          title="Live captions for spoken English"
        >
          <span style={{ fontWeight: 700, fontSize: 13 }}>CC</span>
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
              <p className="code-modal-text">Name your meeting, then share the code</p>
              <input
                className="v3-input"
                style={{ width: '100%' }}
                placeholder="Meeting name"
                value={meetingName}
                maxLength={80}
                onChange={(e) => {
                  nameTouched.current = true;
                  setMeetingName(e.target.value);
                }}
              />
              <div className="code-display">
                <span>{roomId}</span>
                <button onClick={handleCopyCode} className="code-copy-btn">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <button
                className="v3-btn"
                style={{ width: '100%', marginBottom: 10 }}
                onClick={handleCopyInvite}
              >
                {inviteCopied ? 'Invite copied' : 'Copy invite (name + code + link)'}
              </button>
              <button className="v3-btn" style={{ width: '100%' }} onClick={handleStartMeeting}>
                Start meeting
              </button>
            </div>
          </div>
        </div>
      )}

      {waiting && (
        <div className="modal-overlay">
          <div className="v3-ring code-modal-ring">
            <div className="v3-card ended-card">
              <div className="v3-logo" style={{ fontSize: 32 }}>
                Connect<span>Sphere</span>
              </div>
              <p className="ended-title">Waiting for the host</p>
              {waitText && (
                <p className="code-modal-text" style={{ fontWeight: 600 }}>
                  {waitText}
                </p>
              )}
              <p className="code-modal-text">
                "{waiting.title}" hasn't started yet. You'll join automatically
                as soon as the host starts it. You can leave this page open.
              </p>
              <button
                className="v3-btn"
                style={{ width: '100%' }}
                onClick={finishLeave}
              >
                Leave
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
// When that person is sharing their screen the tile is wide and not mirrored.
function RemoteVideo({ stream, label, isSharing, onNeedsUnmute }) {
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

  const tileStyle = isSharing
    ? {
        gridColumn: '1 / -1',
        width: '100%',
        maxWidth: 960,
        justifySelf: 'center',
      }
    : undefined;

  const videoStyle = isSharing
    ? { transform: 'none', objectFit: 'contain', background: '#000' }
    : undefined;

  return (
    <div className="video-tile" style={tileStyle}>
      <video
        ref={videoRef}
        className="remote-video"
        style={videoStyle}
        autoPlay
        playsInline
      />
      <div className="video-label">{label}</div>
    </div>
  );
}

export default MeetingRoom;