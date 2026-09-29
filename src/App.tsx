import { useEffect, useRef, useState } from "react";
import "./App.css";

type ConnectionState =
  | "idle"
  | "requesting-media"
  | "media-ready"
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
  const [chatOpen, setChatOpen] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [microphoneAvailable, setMicrophoneAvailable] = useState(false);
  const [cameraIssue, setCameraIssue] = useState("");
  const [microphoneIssue, setMicrophoneIssue] = useState("");
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
  const searchingRef = useRef(false);
  const activeMatchRef = useRef(false);
  const exitingRef = useRef(false);
  const mediaPendingRef = useRef(false);
  const matchIdRef = useRef<string | null>(null);
  const seenChatIdsRef = useRef(new Set<string>());
  const pendingChatRef = useRef(new Map<string, { matchId: string; text: string }>());
  const sendingChatRef = useRef(false);

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

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = streamRef.current;
  }, [connectionState]);

  useEffect(() => {
    if (!showAccount) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAccount(false);
      if (event.key !== "Tab") return;
      const modal = document.querySelector<HTMLElement>(".account-modal");
      const focusable = modal?.querySelectorAll<HTMLElement>("button, input:not(:disabled)");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showAccount]);

  const closePeer = () => {
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    disconnectTimerRef.current = null;
    pendingCandidatesRef.current = [];
    activeMatchRef.current = false;
    matchIdRef.current = null;
    seenChatIdsRef.current.clear();
    pendingChatRef.current.clear();
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.onicecandidate = null;
      peer.oniceconnectionstatechange = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  const closeSocket = (notify = true) => {
    closePeer();
    searchingRef.current = false;
    const socket = socketRef.current;
    socketRef.current = null;
    intentionalCloseRef.current = true;
    if (notify && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" }));
    }
    socket?.close();
    window.setTimeout(() => (intentionalCloseRef.current = false), 0);
  };

  const acquireMedia = async (requestId: number) => {
    if (streamRef.current?.getTracks().some((track) => track.readyState === "live")) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Media devices are unavailable in this browser.");
    const video: MediaTrackConstraints = { width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 30, max: 30 } };
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (combinedError) {
      const name = combinedError instanceof DOMException ? combinedError.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") throw combinedError;
      const [videoResult, audioResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({ video, audio: false }),
        navigator.mediaDevices.getUserMedia({ video: false, audio }),
      ]);
      const tracks = [videoResult, audioResult].flatMap((result) => result.status === "fulfilled" ? result.value.getTracks() : []);
      if (!tracks.length) throw combinedError;
      stream = new MediaStream(tracks);
    }
    stream.getAudioTracks().forEach((track) => { track.enabled = !isMuted; });
    stream.getVideoTracks().forEach((track) => { track.enabled = !isCameraOff; });
    const microphone = stream.getAudioTracks()[0];
    if (microphone) {
      microphone.contentHint = "speech";
      await microphone.applyConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }).catch(() => undefined);
    }
    if (requestId !== mediaRequestRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    if (previewRef.current) previewRef.current.srcObject = stream;
  };

  const beginCameraCheck = () => {
    if (mediaPendingRef.current) return;
    mediaPendingRef.current = true;
    exitingRef.current = false;
    setConnectionState("requesting-media");
    setNotice("Allow camera and microphone access to check your setup.");
    const requestId = ++mediaRequestRef.current;
    void acquireMedia(requestId)
      .then(() => {
        if (requestId !== mediaRequestRef.current) return;
        mediaPendingRef.current = false;
        const hasCamera = Boolean(streamRef.current?.getVideoTracks().length);
        const hasMicrophone = Boolean(streamRef.current?.getAudioTracks().length);
        setCameraAvailable(hasCamera);
        setMicrophoneAvailable(hasMicrophone);
        setCameraIssue(hasCamera ? "" : "Camera unavailable");
        setMicrophoneIssue(hasMicrophone ? "" : "Microphone unavailable");
        setConnectionState("media-ready");
        setNotice(hasCamera && hasMicrophone
          ? "Camera and microphone are ready."
          : [hasCamera ? "Camera ready" : "Camera unavailable", hasMicrophone ? "Microphone ready" : "Microphone unavailable"].join(" · "));
      })
      .catch((error: unknown) => {
        if (requestId !== mediaRequestRef.current) return;
        mediaPendingRef.current = false;
        setCameraAvailable(false);
        setMicrophoneAvailable(false);
        const name = error instanceof DOMException ? error.name : "";
        const issue = name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
          ? "Permission denied" : name === "NotFoundError" ? "Device not found" : "Device unavailable";
        setCameraIssue(issue);
        setMicrophoneIssue(issue);
        setNotice(name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Permission was denied. Check your browser's camera and microphone settings, or continue without video."
          : name === "NotFoundError" ? "A camera or microphone could not be found. Connect a device or continue without video."
            : "Camera or microphone is unavailable. Check your device settings or continue without video.");
        setConnectionState("media-ready");
      });
  };

  const openSearch = (statusNotice?: string) => {
    if (searchingRef.current || exitingRef.current) return;
    closeSocket();
    searchingRef.current = true;
    exitingRef.current = false;
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
      let messageChain = Promise.resolve();
      socket.onmessage = (event) => {
        messageChain = messageChain.then(async () => {
        if (socket !== socketRef.current) return;
        try {
          const message = JSON.parse(event.data) as { type: string; payload?: unknown };
          if (message.type === "matched") {
            if (!searchingRef.current) return;
            searchingRef.current = false;
            activeMatchRef.current = true;
            const match = message.payload as { initiator?: boolean; otherUsername?: string; username?: string; matchId?: string };
            if (!match.matchId) throw new Error("Match did not include an id");
            matchIdRef.current = match.matchId;
            seenChatIdsRef.current.clear();
            setOtherUsername(match.otherUsername || match.username || "Someone new");
            setConnectionState("connecting");
            setNotice("Match found. Connecting...");
            setChatMessages([]);
            const peer = makePeer(socket);
            peerRef.current = peer;
            if (match.initiator) {
              const offer = await peer.createOffer();
              if (socket !== socketRef.current || peer !== peerRef.current) return;
              await peer.setLocalDescription(offer);
              if (socket !== socketRef.current || peer !== peerRef.current) return;
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "offer", payload: peer.localDescription }));
            }
          } else if (message.type === "offer") {
            if (!activeMatchRef.current) return;
            const peer = peerRef.current ?? makePeer(socket);
            peerRef.current = peer;
            await peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
            if (socket !== socketRef.current || peer !== peerRef.current) return;
            for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(candidate);
            pendingCandidatesRef.current = [];
            const answer = await peer.createAnswer();
            if (socket !== socketRef.current || peer !== peerRef.current) return;
            await peer.setLocalDescription(answer);
            if (socket !== socketRef.current || peer !== peerRef.current) return;
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "answer", payload: peer.localDescription }));
          } else if (message.type === "answer") {
            if (!activeMatchRef.current) return;
            const peer = peerRef.current;
            if (peer) {
              await peer.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
              if (socket !== socketRef.current || peer !== peerRef.current) return;
              for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(candidate);
              pendingCandidatesRef.current = [];
            }
          } else if (message.type === "candidate") {
            if (!activeMatchRef.current) return;
            const candidate = message.payload as RTCIceCandidateInit;
            if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(candidate);
            else pendingCandidatesRef.current.push(candidate);
          } else if (message.type === "partner-left") {
            if (!activeMatchRef.current) return;
            closePeer();
            setConnectionState("error");
            setChatMessages([]);
            setNotice(`${otherUsername} left the conversation. Find someone new whenever you are ready.`);
            setOtherUsername("Someone new");
          } else if (message.type === "chat" && message.payload && typeof message.payload === "object") {
            if (!activeMatchRef.current) return;
            const chat = message.payload as { id?: string; matchId?: string; text?: string };
            const text = chat.text?.trim();
            if (!chat.id || chat.matchId !== matchIdRef.current || !text || text.length > 300 || seenChatIdsRef.current.has(chat.id)) return;
            seenChatIdsRef.current.add(chat.id);
            setChatMessages((messages) => messages.some((item) => item.id === chat.id)
              ? messages
              : [...messages, { id: chat.id as string, text, sender: "other" }]);
          } else if (message.type === "chat-ack" && message.payload && typeof message.payload === "object") {
            const ack = message.payload as { id?: string; matchId?: string };
            if (!ack.id || ack.matchId !== matchIdRef.current) return;
            const pending = pendingChatRef.current.get(ack.id);
            if (!pending || pending.matchId !== ack.matchId) return;
            pendingChatRef.current.delete(ack.id);
            seenChatIdsRef.current.add(ack.id);
            setChatMessages((messages) => messages.some((item) => item.id === ack.id)
              ? messages
              : [...messages, { id: ack.id as string, text: pending.text, sender: "you" }]);
          } else if (message.type === "chat-error" && message.payload && typeof message.payload === "object") {
            const failure = message.payload as { id?: string; matchId?: string };
            if (!failure.id || failure.matchId !== matchIdRef.current) return;
            pendingChatRef.current.delete(failure.id);
            setNotice("A message could not be delivered. Please try again.");
          }
        } catch {
          if (socket !== socketRef.current) return;
          searchingRef.current = false;
          activeMatchRef.current = false;
          closePeer();
          setConnectionState("error");
          setNotice("Could not establish the call. Try again.");
          socketRef.current = null;
          socket.close();
        }
        });
      };
      socket.onclose = () => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        if (intentionalCloseRef.current) return;
        searchingRef.current = false;
        activeMatchRef.current = false;
        closePeer();
        setConnectionState("error");
        setNotice("The lobby connection ended. Try again.");
      };
      socket.onerror = () => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        searchingRef.current = false;
        activeMatchRef.current = false;
        closePeer();
        setConnectionState("error");
        setNotice("The lobby is unavailable. Check your connection and try again.");
        socket.close();
      };
    } catch {
      searchingRef.current = false;
      setConnectionState("error");
      setNotice("Could not connect to the lobby. Try again.");
    }
  };

  const saveAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = accountForm.username.trim().replace(/\s+/g, " ");
    if (!username) return;
    const nextAccount = { username };
    setAccount(nextAccount);
    localStorage.setItem("sidequest-account", JSON.stringify(nextAccount));
    setShowAccount(false);
    beginCameraCheck();
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
    if (["requesting-media", "media-ready", "searching", "connecting", "connected"].includes(connectionState)) return;
    beginCameraCheck();
  };

  const makePeer = (socket: WebSocket) => {
    const peer = new RTCPeerConnection({ iceServers });
    streamRef.current
      ?.getTracks()
      .forEach((track) =>
        peer.addTrack(track, streamRef.current as MediaStream),
      );
    peer.onicecandidate = (event) => {
      if (event.candidate && peer === peerRef.current && socket === socketRef.current && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "candidate", payload: event.candidate }));
      }
    };
    const updateConnectionState = () => {
      if (peer !== peerRef.current) return;
      if (peer.connectionState === "connected") {
        if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        setConnectionState("connected");
        setNotice("Video and clear voice are connected.");
      }
      if (peer.connectionState === "failed" || peer.iceConnectionState === "failed") {
        searchingRef.current = false;
        activeMatchRef.current = false;
        closePeer();
        closeSocket();
        setConnectionState("error");
        setNotice("The call could not connect. Check your network and try again.");
        return;
      }
      const disconnected = peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected";
      if (disconnected && !disconnectTimerRef.current) {
        setNotice("Connection interrupted. Trying to reconnect...");
        disconnectTimerRef.current = window.setTimeout(() => {
          if (peer === peerRef.current && (peer.connectionState === "disconnected" || peer.iceConnectionState === "disconnected")) {
            searchingRef.current = false;
            activeMatchRef.current = false;
            closePeer();
            closeSocket();
            setConnectionState("error");
            setNotice("The call disconnected. Find someone to try again.");
          }
        }, 5000);
      }
      if (!disconnected && disconnectTimerRef.current) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };
    peer.onconnectionstatechange = updateConnectionState;
    peer.oniceconnectionstatechange = updateConnectionState;
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
        const stream = event.streams[0] ?? (remoteRef.current.srcObject instanceof MediaStream
          ? remoteRef.current.srcObject
          : new MediaStream());
        if (!event.streams[0] && !stream.getTracks().includes(event.track)) stream.addTrack(event.track);
        remoteRef.current.srcObject = stream;
        remoteRef.current.volume = 1;
      }
    };
    return peer;
  };

  const nextPerson = () => {
    if (connectionState !== "connected" || !activeMatchRef.current) return;
    closePeer();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      searchingRef.current = true;
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
    if (exitingRef.current) return;
    exitingRef.current = true;
    mediaPendingRef.current = false;
    mediaRequestRef.current += 1;
    searchingRef.current = false;
    activeMatchRef.current = false;
    closeSocket();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraAvailable(false);
    setMicrophoneAvailable(false);
    if (previewRef.current) previewRef.current.srcObject = null;
    setConnectionState("idle");
    setSessionTime(0);
    setChatMessages([]);
    setChatInput("");
    setOtherUsername("Someone new");
    setNotice("Call ended. Find someone when you are ready.");
  };

  const cancelSearch = () => {
    if (exitingRef.current) return;
    if (!searchingRef.current && connectionState !== "requesting-media") return;
    mediaRequestRef.current += 1;
    mediaPendingRef.current = false;
    closeSocket();
    setConnectionState(streamRef.current?.active ? "media-ready" : "idle");
    setNotice("Search cancelled. Your devices are ready when you are.");
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
    const matchId = matchIdRef.current;
    if (
      !text ||
      text.length > 300 ||
      sendingChatRef.current ||
      connectionState !== "connected" ||
      !activeMatchRef.current ||
      !matchId ||
      socket?.readyState !== WebSocket.OPEN
    )
      return;
    sendingChatRef.current = true;
    window.setTimeout(() => { sendingChatRef.current = false; }, 0);
    const id = crypto.randomUUID();
    pendingChatRef.current.set(id, { matchId, text });
    try {
      socket.send(JSON.stringify({ type: "chat", payload: { id, matchId, text } }));
      setChatInput("");
    } catch {
      pendingChatRef.current.delete(id);
      setNotice("Message could not be sent. Check the connection and try again.");
    }
  };

  const addIcebreaker = () => {
    setChatInput(icebreakers[icebreakerIndex]);
    setIcebreakerIndex((index) => (index + 1) % icebreakers.length);
  };

  const formatTime = `${String(Math.floor(sessionTime / 60)).padStart(2, "0")}:${String(sessionTime % 60).padStart(2, "0")}`;

  const inSession = ["searching", "connecting", "connected"].includes(connectionState);
  const statusTitle = connectionState === "searching" ? "Finding someone..."
    : connectionState === "connecting" ? "You found someone"
      : connectionState === "error" ? "Connection interrupted"
        : "Your conversation starts here";

  return (
    <main className={`shell ${inSession ? "session-shell" : ""}`}>
      <nav className="topbar">
        <a className="brand" href="/" aria-label="Sidequest home">
          <span className="brand-mark">✳</span><span>sidequest</span>
        </a>
        <div className="nav-actions">
          {inSession ? <span className="session-identity">{account ? `@${account.username}` : "Guest"}</span> : null}
          <button className="theme-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Change theme">
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button className="account-button" onClick={() => { setAccountForm(account || { username: "" }); setShowAccount(true); }}>
            {account ? `@${account.username}` : "Your profile"}
          </button>
        </div>
      </nav>

      {connectionState === "idle" || connectionState === "error" ? (
        <section className="landing">
          <div className="landing-copy">
            <p className="eyebrow"><span className="eyebrow-mark">✳</span> A little more human</p>
            <h1>Make room for<br /><em>a new perspective.</em></h1>
            <p className="landing-intro">Sidequest is a simple way to meet someone new, face to face. No feed, no fuss. Just a conversation.</p>
            <button className="primary-action landing-action" onClick={findSomeone}>
              <span>Start a Sidequest</span><b aria-hidden="true">↗</b>
            </button>
            <p className="privacy-note">No email needed · Your camera stays off until you choose to join</p>
            {connectionState === "error" ? <div className="inline-error" role="alert"><strong>We lost the connection.</strong><span>{notice}</span></div> : null}
          </div>
          <div className="landing-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="art-sun">✳</div>
            <div className="art-card card-back"><span>01</span><i>curiosity</i></div>
            <div className="art-card card-front"><span>02</span><i>connection</i></div>
            <span className="art-caption">A good conversation<br />can start anywhere.</span>
          </div>
          <div className="how-it-works">
            <div><span className="step-number">01</span><strong>Get ready</strong><p>Choose a name and check your camera.</p></div>
            <div><span className="step-number">02</span><strong>Meet someone</strong><p>We’ll find another person who’s ready to talk.</p></div>
            <div><span className="step-number">03</span><strong>See where it goes</strong><p>Talk, share a thought, or move on anytime.</p></div>
          </div>
        </section>
      ) : null}

      {connectionState === "requesting-media" || connectionState === "media-ready" ? (
        <section className="device-check">
          <div className="device-copy">
            <p className="eyebrow">Before you begin</p>
            <h1>Make sure you’re<br /><em>good to go.</em></h1>
            <p className="device-description">Check your camera and microphone. They’ll only be shared when you’re in a conversation.</p>
            <div className={`device-message ${connectionState === "media-ready" && (!cameraAvailable || !microphoneAvailable) ? "message-warning" : ""}`} role="status">
              <span className="status-indicator" />
              <span>{connectionState === "requesting-media" ? "Waiting for device permission…" : notice}</span>
            </div>
            <div className="device-status-list">
              <span className={cameraAvailable ? "device-available" : ""}><i />Camera {cameraAvailable ? "ready" : cameraIssue || "check required"}</span>
              <span className={microphoneAvailable ? "device-available" : ""}><i />Microphone {microphoneAvailable ? "ready" : microphoneIssue || "check required"}</span>
            </div>
            <div className="device-actions">
              <button className="primary-action" onClick={connectionState === "media-ready" ? () => openSearch() : cancelSearch}>
                <span>{connectionState === "media-ready" ? "Continue to search" : "Cancel device check"}</span><b aria-hidden="true">↗</b>
              </button>
              <button className="text-action" onClick={beginCameraCheck} disabled={connectionState === "requesting-media"}>Retry device check</button>
            </div>
          </div>
          <div className={`device-preview ${isCameraOff ? "camera-off" : ""}`}>
            <video ref={previewRef} autoPlay muted playsInline aria-label="Your camera preview" />
            {!cameraAvailable || isCameraOff ? <div className="preview-placeholder"><span>✳</span><strong>{isCameraOff ? "Camera is off" : "Preview will appear here"}</strong><small>Your video is private until you start a conversation.</small></div> : null}
            <div className="preview-label"><span>YOUR PREVIEW</span><span>{isCameraOff ? "Camera off" : "Just you"}</span></div>
            <div className="preview-controls">
              <button className={`round-control ${isMuted ? "active" : ""}`} onClick={toggleMute} aria-pressed={isMuted} aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}>{isMuted ? "Mic off" : "Mic on"}</button>
              <button className={`round-control ${isCameraOff ? "active" : ""}`} onClick={toggleCamera} aria-pressed={isCameraOff} aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}>{isCameraOff ? "Cam off" : "Cam on"}</button>
            </div>
          </div>
        </section>
      ) : null}

      {inSession ? (
        <section className={`conversation-layout ${chatOpen ? "chat-is-open" : ""}`}>
          <div className="conversation-main">
            <div className="conversation-heading">
              <div><p className="eyebrow">SIDEQUEST / LIVE</p><h1>{connectionState === "connected" ? `Talking with @${otherUsername}` : statusTitle}</h1></div>
              <div className={`connection-pill ${connectionState}`}><i />{connectionState === "connected" ? "Connected" : connectionState === "connecting" ? "Match found · connecting" : "Finding a match"}</div>
            </div>
            <div className={`call-stage ${connectionState}`}>
              <video className="remote-video" ref={remoteRef} autoPlay playsInline aria-label="Your conversation partner" />
              {connectionState !== "connected" ? <div className="call-overlay" aria-live="polite">
                <div className={`search-symbol ${connectionState === "searching" ? "is-searching" : ""}`}>{connectionState === "searching" ? <span>✳</span> : connectionState === "connecting" ? <span>↗</span> : <span>✳</span>}</div>
                <h2>{statusTitle}</h2><p>{connectionState === "searching" ? "Hang tight. We’re looking for someone to talk with." : connectionState === "connecting" ? "Your match is here. Connecting your video now…" : notice}</p>
              </div> : null}
              <div className={`local-preview ${isCameraOff ? "camera-off" : ""}`}>
                <video ref={previewRef} autoPlay muted playsInline aria-label="Your camera preview" />
                {!cameraAvailable || isCameraOff ? <div className="pip-placeholder">{isCameraOff ? "Camera off" : "No camera"}</div> : null}
                <span className="pip-name">You</span>
              </div>
              <div className="call-meta"><span>{connectionState === "connected" ? formatTime : ""}</span><span>{connectionState === "connected" ? `@${otherUsername}` : "Sidequest video room"}</span></div>
            </div>
            <div className="call-controls" aria-label="Call controls">
              <button className={`call-control ${isMuted ? "control-off" : ""}`} onClick={toggleMute} aria-pressed={isMuted} aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}><span aria-hidden="true">{isMuted ? "◌" : "◖"}</span><small>{isMuted ? "Unmute" : "Mute"}</small></button>
              <button className={`call-control ${isCameraOff ? "control-off" : ""}`} onClick={toggleCamera} aria-pressed={isCameraOff} aria-label={isCameraOff ? "Turn camera on" : "Turn camera off"}><span aria-hidden="true">▣</span><small>{isCameraOff ? "Camera on" : "Camera"}</small></button>
              <button className={`call-control ${chatOpen ? "control-selected" : ""}`} onClick={() => setChatOpen((open) => !open)} aria-expanded={chatOpen} aria-label={chatOpen ? "Close chat" : "Open chat"}><span aria-hidden="true">▤</span><small>Chat</small></button>
              <button className="call-control" onClick={connectionState === "searching" ? cancelSearch : nextPerson} disabled={connectionState !== "connected" && connectionState !== "searching"} aria-label={connectionState === "searching" ? "Cancel search" : "Next person"}><span aria-hidden="true">{connectionState === "searching" ? "×" : "↻"}</span><small>{connectionState === "searching" ? "Cancel" : "Next"}</small></button>
              <button className="call-control exit-control" onClick={exitCall} aria-label="Exit conversation"><span aria-hidden="true">×</span><small>Exit</small></button>
            </div>
          </div>

          {chatOpen ? <aside className="chat-panel" aria-label="Conversation chat">
            <div className="chat-heading"><div><p className="eyebrow">SIDE CHAT</p><h2>Messages</h2></div><button className="chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">×</button></div>
            <div className="chat-messages" aria-live="polite">
              {chatMessages.length === 0 ? <div className="chat-empty"><span>✳</span><strong>Say hello</strong><p>A friendly message is a good place to start.</p></div> : chatMessages.map((message) => <div className={`chat-message ${message.sender}`} key={message.id}><span>{message.sender === "you" ? "You" : `@${otherUsername}`}</span><p className="chat-bubble">{message.text}</p></div>)}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-tools"><button type="button" className="icebreaker-button" onClick={addIcebreaker} disabled={connectionState !== "connected"}>✳ Try a conversation starter</button></div>
            <form className="chat-form" onSubmit={sendChatMessage}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Write a message…" maxLength={300} disabled={connectionState !== "connected"} aria-label="Chat message" /><button type="submit" disabled={connectionState !== "connected" || !chatInput.trim()} aria-label="Send message">Send ↗</button></form>
            <div className="safety-tools"><button onClick={blockUser} disabled={connectionState !== "connected"}>Block person</button><button onClick={reportUser} disabled={connectionState !== "connected"}>Report</button></div>
          </aside> : null}
        </section>
      ) : null}

      {!inSession && connectionState !== "requesting-media" && connectionState !== "media-ready" ? <footer className="foot"><span>Be kind. Stay curious.</span><span>One conversation at a time.</span></footer> : null}

      {showAccount ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAccount(false); }}>
        <form className="account-modal" onSubmit={saveAccount} role="dialog" aria-modal="true" aria-labelledby="profile-title">
          <button type="button" className="modal-close" onClick={() => setShowAccount(false)} aria-label="Close profile">×</button>
          <p className="eyebrow">YOUR SIDEQUEST</p><h2 id="profile-title">What should we call you?</h2>
          <p className="modal-copy">Choose a name to use in your conversations. No email or account needed.</p>
          <label htmlFor="profile-username">Username</label>
          <input id="profile-username" value={accountForm.username} onChange={(event) => setAccountForm({ username: event.target.value })} maxLength={24} required autoFocus placeholder="your_name" />
          <button className="save-account" type="submit">Continue <span aria-hidden="true">↗</span></button>
        </form>
      </div> : null}
    </main>
  );
}

export default App;
