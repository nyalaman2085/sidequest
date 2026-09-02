import { useEffect, useRef, useState } from "react";
import "./App.css";

type ConnectionState = "idle" | "searching" | "connected";
type ChatMessage = {
  id: string;
  text: string;
  sender: "you" | "other";
};
type Account = { username: string; email: string };

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
    const saved = localStorage.getItem("sidequest-account");
    return saved ? (JSON.parse(saved) as Account) : null;
  });
  const [accountForm, setAccountForm] = useState<Account>({
    username: "",
    email: "",
  });
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

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      })
      .then(async (stream) => {
        if (!active) return stream.getTracks().forEach((track) => track.stop());
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
        if (previewRef.current) {
          const preview = previewRef.current;
          preview.srcObject = stream;
          preview.muted = true;
          preview.defaultMuted = true;
          preview.playsInline = true;
          void preview.play().catch(() => undefined);
        }
      })
      .catch(() =>
        setNotice("Camera access is off. You can still browse the lobby."),
      );
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current?.close();
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (connectionState !== "connected") return;
    const timer = window.setInterval(
      () => setSessionTime((time) => time + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [connectionState]);

  const closePeer = () => {
    peerRef.current?.close();
    peerRef.current = null;
    if (remoteRef.current) remoteRef.current.srcObject = null;
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

  const openSearch = () => {
    leaveCurrentMatch();
    setConnectionState("searching");
    setSessionTime(0);
    setChatMessages([]);
    setNotice("Looking for another person...");
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socketRef.current = socket;
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "join",
          username: account?.username || "Guest",
        }),
      );
    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as {
        type: string;
        payload?: unknown;
      };
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
        setChatMessages([]);
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
        await peer.setRemoteDescription(
          message.payload as RTCSessionDescriptionInit,
        );
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", payload: answer }));
      }
      if (message.type === "answer")
        await peerRef.current?.setRemoteDescription(
          message.payload as RTCSessionDescriptionInit,
        );
      if (message.type === "candidate")
        await peerRef.current?.addIceCandidate(
          message.payload as RTCIceCandidateInit,
        );
      if (message.type === "partner-left") {
        closePeer();
        setConnectionState("idle");
        setChatMessages([]);
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
      setConnectionState("idle");
      setNotice("The lobby is offline. Run npm run dev and try again.");
    };
  };

  const saveAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/\s+/g, " ");
    if (!username || !accountForm.email.includes("@")) return;
    const nextAccount = { username, email: accountForm.email.trim() };
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
        setNotice("Video and clear voice are connected.");
      }
      if (["failed", "disconnected"].includes(peer.connectionState)) {
        setNotice("Connection is unstable. Try Next person.");
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
              setAccountForm(account || { username: "", email: "" });
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
              People see your username only. Your email is never shared. Camera
              and microphone permission is requested only for your video call.
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
            <label>
              Email
              <input
                type="email"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm({ ...accountForm, email: event.target.value })
                }
                required
                placeholder="you@example.com"
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
