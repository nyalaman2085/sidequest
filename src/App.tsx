import { useEffect, useRef, useState } from "react";
import "./App.css";

type ConnectionState = "idle" | "searching" | "connected";
type ChatMessage = {
  id: string;
  text: string;
  sender: "you" | "other";
};
type Account = { username: string };

const readStoredJson = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(import.meta.env.VITE_TURN_URL
    ? [{
        urls: import.meta.env.VITE_TURN_URL,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL,
      }]
    : []),
];

function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [notice, setNotice] = useState("Ready when you are.");
  const [sessionTime, setSessionTime] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [account, setAccount] = useState<Account | null>(() => {
    const saved = readStoredJson<Account | null>("sidequest-account", null);
    return saved?.username ? { username: saved.username } : null;
  });
  const [accountForm, setAccountForm] = useState<Account>({
    username: "",
  });
  const [showAccount, setShowAccount] = useState(false);
  const [otherUsername, setOtherUsername] = useState("Someone new");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const hasLobbyRequestRef = useRef(false);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isMutedRef = useRef(false);
  const isInitiatorRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const restartAttemptsRef = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [chatMessages]);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (remoteRef.current) remoteRef.current.muted = isMuted;
  }, [isMuted]);

  const requestMediaAccess = async () => {
    const isSecure = window.isSecureContext;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname.endsWith(".local");

    if (!isSecure && !isLocalhost) {
      setNotice(
        "Camera access needs a secure browser connection. Use localhost or HTTPS.",
      );
      return false;
    }

    const prefersPortrait =
      window.matchMedia("(orientation: portrait)").matches ||
      window.innerHeight > window.innerWidth;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          aspectRatio: prefersPortrait ? 9 / 16 : 16 / 9,
          width: { ideal: prefersPortrait ? 1080 : 1920, max: 1920 },
          height: { ideal: prefersPortrait ? 1920 : 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      streamRef.current = stream;
      const microphone = stream.getAudioTracks()[0];
      if (microphone) {
        microphone.contentHint = "speech";
        await microphone
          .applyConstraints({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          })
          .catch(() => undefined);
      }
      if (previewRef.current) previewRef.current.srcObject = stream;
      return true;
    } catch {
      setNotice("Camera access is off. Please allow camera and mic access.");
      return false;
    }
  };

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current?.close();
      socketRef.current?.close();
    },
    [],
  );

  useEffect(() => {
    if (connectionState !== "connected") return;
    const timer = window.setInterval(
      () => setSessionTime((time) => time + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [connectionState]);

  const closePeer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    peerRef.current?.close();
    peerRef.current = null;
    pendingCandidatesRef.current = [];
    restartAttemptsRef.current = 0;
    isInitiatorRef.current = false;
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  const addRemoteCandidate = async (candidate: RTCIceCandidateInit) => {
    const peer = peerRef.current;
    if (!peer || !peer.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await peer.addIceCandidate(candidate);
  };

  const setRemoteDescription = async (
    peer: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
  ) => {
    await peer.setRemoteDescription(description);
    const pendingCandidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    await Promise.all(pendingCandidates.map((candidate) => peer.addIceCandidate(candidate)));
  };

  const leaveCurrentMatch = () => {
    closePeer();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
    }
    socket?.close();
  };

  const resolveSignalUrl = () => {
    const explicitUrl = import.meta.env.VITE_WS_URL;
    if (explicitUrl) return explicitUrl;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/ws`;
  };

  const openSearch = () => {
    hasLobbyRequestRef.current = true;
    leaveCurrentMatch();
    setConnectionState("searching");
    setSessionTime(0);
    setNotice("Looking for another person...");
    const socket = new WebSocket(resolveSignalUrl());
    socketRef.current = socket;
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "join",
          username: account?.username || "Guest",
        }),
      );
    socket.onmessage = async (event) => {
      let message: { type: string; payload?: unknown };
      try {
        message = JSON.parse(event.data) as {
          type: string;
          payload?: unknown;
        };
      } catch {
        setNotice("Received an invalid lobby message. Please try again.");
        return;
      }
      if (!message.type) return;
      if (message.type === "matched") {
        const match = message.payload as {
          initiator?: boolean;
          otherUsername?: string;
          username?: string;
        };
        setOtherUsername(
          match.otherUsername || match.username || "Someone new",
        );
        setConnectionState("connected");
        setNotice("You are live. Say hello.");
        isInitiatorRef.current = Boolean(match.initiator);
        restartAttemptsRef.current = 0;
        const peer = makePeer(socket);
        peerRef.current = peer;
        if ((message.payload as { initiator?: boolean })?.initiator) {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.send(JSON.stringify({ type: "offer", payload: offer }));
        }
      }
      if (message.type === "offer") {
        const peer = peerRef.current ?? makePeer(socket);
        peerRef.current = peer;
        await setRemoteDescription(
          peer,
          message.payload as RTCSessionDescriptionInit,
        );
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", payload: answer }));
      }
      if (message.type === "answer" && peerRef.current)
        await setRemoteDescription(
          peerRef.current,
          message.payload as RTCSessionDescriptionInit,
        );
      if (message.type === "candidate") {
        await addRemoteCandidate(message.payload as RTCIceCandidateInit)
          .catch(() => setNotice("Could not establish a video connection."));
      }
      if (message.type === "error") {
        const error = message.payload as { message?: string } | undefined;
        setNotice(error?.message || "The lobby could not complete that action.");
      }
      if (message.type === "partner-left") {
        closePeer();
        setConnectionState("idle");
        setNotice("That person left. Find someone else?");
        setOtherUsername("Someone new");
      }
      if (
        message.type === "chat" &&
        message.payload &&
        typeof message.payload === "object"
      ) {
        const chat = message.payload as { id?: string; text?: string };
        if (!chat.id || !chat.text) return;
        const { id, text } = chat;
        setChatMessages((messages) => [
          ...messages,
          {
            id,
            text,
            sender: "other",
          },
        ]);
      }
    };
    socket.onerror = () => {
      if (!hasLobbyRequestRef.current) return;
      setConnectionState("idle");
      setNotice("The lobby is offline. Run npm run dev and try again.");
      hasLobbyRequestRef.current = false;
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (peerRef.current) closePeer();
      setConnectionState((state) => {
        if (state !== "idle" && hasLobbyRequestRef.current) {
          setNotice("The lobby connection closed. Try again.");
        }
        if (!hasLobbyRequestRef.current) {
          setNotice("Ready when you are.");
        }
        hasLobbyRequestRef.current = false;
        return "idle";
      });
    };
  };

  const resetChatForNewMatch = () => {
    setChatMessages([]);
  };

  const saveAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/\s+/g, " ");
    if (!username) return;
    const nextAccount = { username };
    setAccount(nextAccount);
    localStorage.setItem("sidequest-account", JSON.stringify(nextAccount));
    setShowAccount(false);
  };

  const findSomeone = async () => {
    if (!account) {
      setShowAccount(true);
      setNotice("Add a display name before joining the lobby.");
      return;
    }

    hasLobbyRequestRef.current = true;

    const granted = await requestMediaAccess();
    if (!granted) return;

    resetChatForNewMatch();

    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      setConnectionState("searching");
      setSessionTime(0);
      setNotice("Looking for another person...");
      socket.send(JSON.stringify({ type: "join" }));
      return;
    }
    openSearch();
  };

  const restartIce = async (peer: RTCPeerConnection, socket: WebSocket) => {
    if (
      !isInitiatorRef.current ||
      peer.connectionState === "closed" ||
      socket.readyState !== WebSocket.OPEN ||
      restartAttemptsRef.current >= 3
    ) {
      return;
    }

    restartAttemptsRef.current += 1;
    setNotice("Restoring your connection...");
    try {
      const offer = await peer.createOffer({ iceRestart: true });
      await peer.setLocalDescription(offer);
      socket.send(JSON.stringify({ type: "offer", payload: offer }));
    } catch {
      setNotice("Connection recovery failed. Try Next person.");
    }
  };

  const makePeer = (socket: WebSocket) => {
    const peer = new RTCPeerConnection({ iceServers });
    streamRef.current
      ?.getTracks()
      .forEach((track) =>
        peer.addTrack(track, streamRef.current as MediaStream),
      );
    peer.onicecandidate = (event) =>
      event.candidate &&
      socket.send(
        JSON.stringify({ type: "candidate", payload: event.candidate }),
      );
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        restartAttemptsRef.current = 0;
        setNotice("Video and clear voice are connected.");
      }
      if (peer.connectionState === "disconnected") {
        setNotice("Connection is weak. Trying to restore it...");
        if (reconnectTimerRef.current === null) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            if (peer.connectionState === "disconnected")
              void restartIce(peer, socket);
          }, 5_000);
        }
      }
      if (peer.connectionState === "failed") {
        void restartIce(peer, socket);
      }
    };
    peer
      .getSenders()
      .forEach((sender) => {
        const parameters = sender.getParameters();
        parameters.encodings ??= [{}];
        if (sender.track?.kind === "audio") {
          parameters.encodings[0].maxBitrate = 128000;
          parameters.encodings[0].priority = "high";
        }
        if (sender.track?.kind === "video") {
          parameters.encodings[0].maxBitrate = 2_000_000;
          parameters.encodings[0].maxFramerate = 30;
          parameters.degradationPreference = "maintain-framerate";
        }
        void sender.setParameters(parameters).catch(() => undefined);
      });
    peer.ontrack = (event) => {
      if (remoteRef.current) {
        remoteRef.current.srcObject = event.streams[0];
        remoteRef.current.volume = 1;
        remoteRef.current.muted = isMutedRef.current;
      }
    };
    return peer;
  };

  const nextPerson = () => {
    hasLobbyRequestRef.current = true;
    resetChatForNewMatch();
    closePeer();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      setConnectionState("searching");
      setSessionTime(0);
      setNotice("Looking for another person...");
      socket.send(JSON.stringify({ type: "skip" }));
      return;
    }
    openSearch();
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    if (remoteRef.current) remoteRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const toggleCamera = () => {
    const stream = streamRef.current;
    const videoTracks = stream?.getVideoTracks() || [];

    // Keep the existing WebRTC track alive. Stopping/replacing it can freeze
    // the remote video stream during renegotiation on some browsers.
    if (videoTracks.length > 0) {
      const nextCameraOff = !isCameraOff;
      videoTracks.forEach((track) => {
        track.enabled = !nextCameraOff;
      });
      setIsCameraOff(nextCameraOff);
      return;
    }

    // Fallback for a call that was started before the track-preserving toggle
    // was available and no longer has a local video track.
    if (isCameraOff) {
      navigator.mediaDevices
        ?.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
        })
        .then((cameraStream) => {
          const videoTrack = cameraStream.getVideoTracks()[0];
          if (!videoTrack || !stream) return;
          stream.addTrack(videoTrack);
          const videoSender = peerRef.current
            ?.getTransceivers()
            .find(
              (transceiver) =>
                transceiver.sender.track?.kind === "video" ||
                transceiver.receiver.track.kind === "video",
            )?.sender;
          void videoSender?.replaceTrack(videoTrack);
          if (previewRef.current) previewRef.current.srcObject = stream;
          setIsCameraOff(false);
        })
        .catch(() => setNotice("Camera permission is still off."));
      return;
    }
    setNotice("Camera is not available. Allow camera access and try again.");
  };

  const sendChatMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatInput.trim();
    const socket = socketRef.current;
    if (
      !text ||
      connectionState !== "connected" ||
      socket?.readyState !== WebSocket.OPEN
    )
      return;
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    socket.send(JSON.stringify({ type: "chat", payload: { id, text } }));
    setChatMessages((messages) => [...messages, { id, text, sender: "you" }]);
    setChatInput("");
  };

  const formatTime = `${String(Math.floor(sessionTime / 60)).padStart(2, "0")}:${String(sessionTime % 60).padStart(2, "0")}`;

  return (
    <main className="shell">
      <nav className="topbar">
        <a className="brand" href="/" aria-label="SideQuest home">
          <span className="brand-mark">✳</span> sidequest
        </a>
        <div className="nav-actions">
          <span className="secure">
            <span className="pulse" /> private room
          </span>
          <button
            className="account-button"
            onClick={() => {
              setAccountForm(account || { username: "" });
              setShowAccount(true);
            }}
          >
            {account ? `@${account.username}` : "Create account"}
          </button>
        </div>
      </nav>
      <section className="intro">
        <p className="eyebrow">Meet someone new</p>
        <h1>
          Find a friendly face
          <br />
          <em>and start talking.</em>
        </h1>
        <p className="subhead">
          Click the button, wait for a match, and start a friendly conversation.
        </p>
      </section>
      <section className="stage">
        <div className={`video-card stranger ${connectionState}`}>
          <div className="video-top">
            <span className="label">OTHER PERSON</span>
          </div>
          <video ref={remoteRef} autoPlay playsInline />
          <div className="empty-state">
            <span className="signal-icon">◌</span>
            <strong>
              {connectionState === "searching"
                ? "Looking for a match"
                : "No match yet"}
            </strong>
            <span>{notice}</span>
          </div>
          <div className="video-footer">
            <span>
              {connectionState === "connected" ? formatTime : "--:--"}
            </span>
            <span>
              {connectionState === "connected"
                ? "private connection"
                : "click Find someone below"}
            </span>
          </div>
        </div>
        <div className={`video-card you ${isCameraOff ? "camera-off" : ""}`}>
          <div className="video-top">
            <span className="label">YOUR CAMERA</span>
            <span className="camera-state">{isCameraOff ? "OFF" : "ON"}</span>
          </div>
          <video ref={previewRef} autoPlay muted playsInline />
          <div className="self-placeholder">
            <span>✦</span>
            <small>{isCameraOff ? "Camera is off" : "Camera preview"}</small>
          </div>
          <div className="video-footer">
            <span>you</span>
          </div>
        </div>
      </section>
      <section className="controls">
        <div className="control-group">
          <button
            className={`round-control ${isMuted ? "active" : ""}`}
            onClick={toggleMute}
            aria-label={isMuted ? "Turn sound on" : "Turn sound off"}
            aria-pressed={isMuted}
            title={isMuted ? "Turn sound on" : "Turn sound off"}
          >
            {isMuted ? "♩" : "♬"}
          </button>
          <button
            className={`round-control ${isCameraOff ? "active" : ""}`}
            onClick={toggleCamera}
            aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
            aria-pressed={isCameraOff}
          >
            ▣
          </button>
        </div>
        <button
          className="primary-action"
          onClick={connectionState === "connected" ? nextPerson : findSomeone}
        >
          <span>
            {connectionState === "connected"
              ? "Next person"
              : connectionState === "searching"
                ? "Keep looking"
                : "Find someone"}
          </span>
          <b>↗</b>
        </button>
      </section>
      <section className="chat-panel">
        <div className="chat-heading">
          <div>
            <p className="eyebrow">Easy conversation</p>
            <h2>Chat with your match</h2>
          </div>
          <span className="chat-status">
            {connectionState === "connected" ? `@${otherUsername}` : "No match"}
          </span>
        </div>
        <div className="chat-messages" aria-live="polite">
          {chatMessages.length === 0 ? (
            <p className="chat-empty">
              {connectionState === "connected"
                ? "Say hello to start the chat."
                : "Match with someone to send messages."}
            </p>
          ) : (
            chatMessages.map((message) => (
              <div
                className={`chat-message ${message.sender}`}
                key={message.id}
              >
                <p className="chat-bubble">{message.text}</p>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
        <form className="chat-form" onSubmit={sendChatMessage}>
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Write a message..."
            maxLength={300}
            disabled={connectionState !== "connected"}
            aria-label="Chat message"
          />
          <button
            type="submit"
            disabled={connectionState !== "connected" || !chatInput.trim()}
            aria-label="Send message"
          >
            Send <span>↗</span>
          </button>
        </form>
      </section>
      <footer className="foot">
        <span>Be kind and respectful.</span>
      </footer>
      {showAccount ? (
        <div className="modal-backdrop" role="presentation">
          <form className="account-modal" onSubmit={saveAccount}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowAccount(false)}
              aria-label="Close"
            >
              ×
            </button>
            <p className="eyebrow">Your profile</p>
            <h2>Choose a display name</h2>
            <p className="modal-copy">
              This is the only name other people see. Camera and microphone
              permission is requested only when you start a video call.
            </p>
            <label>
              Display name
              <input
                value={accountForm.username}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    username: event.target.value,
                  })
                }
                maxLength={24}
                required
                placeholder="Your name"
              />
            </label>
            <button className="save-account" type="submit">
              Save display name
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

export default App;
