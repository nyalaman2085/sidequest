import { useEffect, useRef, useState } from "react";
import "./App.css";

type ConnectionState =
  | "idle"
  | "requesting-media"
  | "searching"
  | "connecting"
  | "connected"
  | "error";
type ChatMessage = {
  id: string;
  text: string;
  sender: "you" | "other";
};
type Account = { username: string };

const icebreakers = [
  "What is something small that made you smile today?",
  "What is a place you would love to visit?",
  "What song have you been enjoying lately?",
  "What is a hobby you would like to try?",
];

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [notice, setNotice] = useState("Ready when you are.");
  const [sessionTime, setSessionTime] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [icebreakerIndex, setIcebreakerIndex] = useState(0);
  const [account, setAccount] = useState<Account | null>(() => {
    try {
      const saved = localStorage.getItem("sidequest-account");
      if (!saved) return null;
      const parsed = JSON.parse(saved) as { username?: unknown };
      return typeof parsed.username === "string"
        ? { username: parsed.username }
        : null;
    } catch {
      return null;
    }
  });
  const [accountForm, setAccountForm] = useState<Account>({ username: "" });
  const [showAccount, setShowAccount] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(
    () =>
      (localStorage.getItem("sidequest-theme") as "dark" | "light") || "dark",
  );
  const [otherUsername, setOtherUsername] = useState("Someone new");
  const [blockedUsers, setBlockedUsers] = useState<string[]>(
    () =>
      JSON.parse(localStorage.getItem("sidequest-blocked") || "[]") as string[],
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const disconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const mediaRequestRef = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [chatMessages]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("sidequest-theme", theme);
  }, [theme]);

  useEffect(
    () => () => {
      if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
      peerRef.current?.close();
      socketRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    pendingCandidatesRef.current = [];
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  const closeSocket = (notify = true) => {
    closePeer();
    const socket = socketRef.current;
    socketRef.current = null;
    intentionalCloseRef.current = true;
    if (notify && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
    }
    socket?.close();
    window.setTimeout(() => (intentionalCloseRef.current = false), 0);
  };

  const acquireMedia = async () => {
    if (streamRef.current?.getTracks().some((track) => track.readyState === "live")) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media devices are unavailable in this browser.");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 },
    });
    stream.getAudioTracks().forEach((track) => { track.enabled = !isMuted; });
    stream.getVideoTracks().forEach((track) => { track.enabled = !isCameraOff; });
    const microphone = stream.getAudioTracks()[0];
    if (microphone) {
      microphone.contentHint = "speech";
      await microphone.applyConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }).catch(() => undefined);
    }
    streamRef.current = stream;
    if (previewRef.current) previewRef.current.srcObject = stream;
  };

  const openSearch = (statusNotice?: string) => {
    closeSocket();
    setConnectionState("searching");
    setSessionTime(0);
    setChatMessages([]);
    setOtherUsername("Someone new");
    setNotice(statusNotice || "Looking for another person...");
    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socket !== socketRef.current) return;
        socket.send(JSON.stringify({ type: "join", username: account?.username || "Guest" }));
      };
      socket.onmessage = async (event) => {
        if (socket !== socketRef.current) return;
        try {
          const message = JSON.parse(event.data) as { type: string; payload?: unknown };
          if (message.type === "matched") {
            if (connectionStateRef.current !== "searching") return;
            const match = message.payload as { initiator?: boolean; otherUsername?: string; username?: string };
            setOtherUsername(match.otherUsername || match.username || "Someone new");
            setConnectionState("connecting");
            setNotice("Match found. Connecting...");
            setChatMessages([]);
            const peer = makePeer(socket);
            peerRef.current = peer;
            if (match.initiator) {
              const offer = await peer.createOffer();
              await peer.setLocalDescription(offer);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "offer", payload: peer.localDescription }));
            }
          } else if (message.type === "offer") {
            const peer = peerRef.current ?? makePeer(socket);
            peerRef.current = peer;
            await peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
            for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(candidate);
            pendingCandidatesRef.current = [];
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "answer", payload: peer.localDescription }));
          } else if (message.type === "answer") {
            const peer = peerRef.current;
            if (peer) {
              await peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
              for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(candidate);
              pendingCandidatesRef.current = [];
            }
          } else if (message.type === "candidate") {
            const candidate = message.payload as RTCIceCandidateInit;
            if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(candidate);
            else pendingCandidatesRef.current.push(candidate);
          } else if (message.type === "partner-left") {
            closePeer();
            setConnectionState("idle");
            setChatMessages([]);
            setNotice("That person left. Find someone else?");
            setOtherUsername("Someone new");
          } else if (message.type === "chat" && message.payload && typeof message.payload === "object") {
            const chat = message.payload as { id?: string; text?: string };
            if (!chat.id || !chat.text) return;
            setChatMessages((messages) => [...messages, { id: chat.id as string, text: chat.text as string, sender: "other" }]);
          }
        } catch {
          closePeer();
          setConnectionState("error");
          setNotice("Could not establish the call. Try again.");
          socket.close();
        }
      };
      socket.onclose = () => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        if (intentionalCloseRef.current) return;
        closePeer();
        setConnectionState("error");
        setNotice("The lobby connection ended. Try again.");
      };
      socket.onerror = () => {
        if (socket !== socketRef.current) return;
        closePeer();
        setConnectionState("error");
        setNotice("The lobby is unavailable. Check your connection and try again.");
        socket.close();
      };
    } catch {
      setConnectionState("error");
      setNotice("Could not connect to the lobby. Try again.");
    }
  };

  const connectionStateRef = useRef(connectionState);
  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const saveAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/\s+/g, " ");
    if (!username) return;
    const nextAccount = { username };
    setAccount(nextAccount);
    localStorage.setItem("sidequest-account", JSON.stringify(nextAccount));
    setShowAccount(false);
  };

  const reportUser = async () => {
    if (!otherUsername || otherUsername === "Someone new") return;
    await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: otherUsername, reason: "User report" }),
    }).catch(() => undefined);
    setNotice(`${otherUsername} was reported. You can find someone else.`);
    nextPerson();
  };

  const blockUser = () => {
    if (!otherUsername || otherUsername === "Someone new") return;
    const nextBlocked = [...new Set([...blockedUsers, otherUsername])];
    setBlockedUsers(nextBlocked);
    localStorage.setItem("sidequest-blocked", JSON.stringify(nextBlocked));
    setNotice(`${otherUsername} is blocked for this browser.`);
    nextPerson();
  };

  const findSomeone = () => {
    if (!account) {
      setShowAccount(true);
      setNotice("Create a private profile before joining the lobby.");
      return;
    }
    if (["requesting-media", "searching", "connecting", "connected"].includes(connectionState)) return;
    setConnectionState("requesting-media");
    const requestId = ++mediaRequestRef.current;
    setNotice("Allow camera and microphone access to start a video chat.");
    void acquireMedia()
      .then(() => {
        if (requestId === mediaRequestRef.current) openSearch();
        else {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          if (previewRef.current) previewRef.current.srcObject = null;
        }
      })
      .catch((error: unknown) => {
        if (requestId !== mediaRequestRef.current) return;
        const name = error instanceof DOMException ? error.name : "";
        const message = name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Camera or microphone permission was denied. You can continue without video."
          : name === "NotFoundError" ? "No camera or microphone was found. You can continue without video."
            : "Camera or microphone is unavailable. You can continue without video.";
        openSearch(message);
      });
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
      if (peer !== peerRef.current) return;
      if (peer.connectionState === "connected") {
        if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        setConnectionState("connected");
        setNotice("Video and clear voice are connected.");
      }
      if (peer.connectionState === "disconnected" && !disconnectTimerRef.current) {
        setNotice("Connection interrupted. Trying to reconnect...");
        disconnectTimerRef.current = window.setTimeout(() => {
          if (peer === peerRef.current && peer.connectionState === "disconnected") {
            closePeer();
            closeSocket();
            setConnectionState("error");
            setNotice("The call disconnected. Find someone to try again.");
          }
        }, 5000);
      }
      if (peer.connectionState === "failed") {
        closePeer();
        closeSocket();
        setConnectionState("error");
        setNotice("The call could not connect. Check your network and try again.");
      }
    };
    peer
      .getSenders()
      .filter((sender) => sender.track?.kind === "audio")
      .forEach((sender) => {
        const parameters = sender.getParameters();
        parameters.encodings ??= [{}];
        parameters.encodings[0].maxBitrate = 128000;
        void sender.setParameters(parameters).catch(() => undefined);
      });
    peer.ontrack = (event) => {
      if (remoteRef.current) {
        remoteRef.current.srcObject = event.streams[0];
        remoteRef.current.volume = 1;
      }
    };
    return peer;
  };

  const nextPerson = () => {
    if (connectionState !== "connected") return;
    closePeer();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      setConnectionState("searching");
      setSessionTime(0);
      setChatMessages([]);
      setOtherUsername("Someone new");
      setNotice("Looking for another person...");
      socket.send(JSON.stringify({ type: "skip" }));
    } else {
      openSearch();
    }
  };

  const exitCall = () => {
    closeSocket();
    setConnectionState("idle");
    setSessionTime(0);
    setChatMessages([]);
    setChatInput("");
    setOtherUsername("Someone new");
    setNotice("Call ended. Find someone when you are ready.");
  };

  const cancelSearch = () => {
    mediaRequestRef.current += 1;
    closeSocket();
    setConnectionState("idle");
    setNotice("Search cancelled.");
  };

  const toggleMute = () => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = isMuted;
    });
    setIsMuted((muted) => !muted);
  };

  const toggleCamera = () => {
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = isCameraOff;
    });
    setIsCameraOff((off) => !off);
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
    const id = crypto.randomUUID();
    socket.send(JSON.stringify({ type: "chat", payload: { id, text } }));
    setChatMessages((messages) => [...messages, { id, text, sender: "you" }]);
    setChatInput("");
  };

  const addIcebreaker = () => {
    setChatInput(icebreakers[icebreakerIndex]);
    setIcebreakerIndex((index) => (index + 1) % icebreakers.length);
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
            className="theme-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Change theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
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
        <p className="eyebrow">Random video chat</p>
        <h1>
          Talk to someone
          <br />
          <em>new today.</em>
        </h1>
        <p className="subhead">
          Click the button, wait for a match, and start a friendly conversation.
        </p>
      </section>
      <section className="stage">
        <div className={`video-card stranger ${connectionState}`}>
          <div className="video-top">
            <span className="label">OTHER PERSON</span>
            <span
              className={`username-status ${connectionState === "connected" ? "online" : "offline"}`}
            >
              <i />
              {connectionState === "connected"
                ? `@${otherUsername}`
                : "OFFLINE"}
            </span>
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
            <span>only you can see this</span>
          </div>
        </div>
      </section>
      <section className="controls">
        <div className="control-group">
          <button
            className={`round-control ${isMuted ? "active" : ""}`}
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          >
            {isMuted ? "♩" : "♬"}
          </button>
          <button
            className={`round-control ${isCameraOff ? "active" : ""}`}
            onClick={toggleCamera}
            aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}
          >
            ▣
          </button>
        </div>
        <button
          className="primary-action"
          onClick={connectionState === "connected"
            ? nextPerson
            : connectionState === "searching" || connectionState === "requesting-media"
              ? cancelSearch
              : connectionState === "connecting"
                ? exitCall
                : findSomeone}
        >
          <span>
            {connectionState === "connected"
              ? "Next person"
              : connectionState === "searching"
                ? "Cancel search"
                : connectionState === "requesting-media"
                  ? "Cancel"
                  : connectionState === "connecting"
                    ? "Connecting..."
                    : "Find someone"}
          </span>
          <b>↗</b>
        </button>
        {connectionState === "connected" || connectionState === "connecting" ? (
          <button className="skip-action" onClick={exitCall}>Exit call</button>
        ) : null}
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
        <div className="chat-tools">
          <button
            type="button"
            className="icebreaker-button"
            onClick={addIcebreaker}
            disabled={connectionState !== "connected"}
          >
            ✦ Icebreaker
          </button>
          <span>Start with a friendly question</span>
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
      <section className="safety-tools">
        <span>Only your username is visible. Email stays private.</span>
        <div>
          <button
            onClick={blockUser}
            disabled={connectionState !== "connected"}
          >
            Block @{otherUsername}
          </button>
          <button
            onClick={reportUser}
            disabled={connectionState !== "connected"}
          >
            Report user
          </button>
        </div>
      </section>
      <footer className="foot">
        <span>Be kind and respectful.</span>
        <span>
          <i /> People online now
        </span>
        <span>Report a problem&nbsp; ↗</span>
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
            <p className="eyebrow">Private account</p>
            <h2>Create your profile</h2>
            <p className="modal-copy">
              People see your username only. Camera and microphone permission
              is requested when you join a video chat.
            </p>
            <label>
              Username
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
                placeholder="your_name"
              />
            </label>
            <button className="save-account" type="submit">
              Save private profile
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

export default App;
