# Sidequest

Sidequest is a simple random video chat app. It matches two people and connects their cameras directly with WebRTC.

## Resume Project Description

- Engineered a full-stack peer-to-peer video chat platform with a React, TypeScript, and Vite frontend featuring dynamic media rendering, call controls, in-call text chat, and client-side privacy controls.
- Architected a Node.js, Express, and WebSockets signaling server with queue-based matchmaking and real-time offer, answer, ICE candidate, and chat message exchange.
- Implemented WebRTC browser-to-browser media streaming with STUN server discovery, connection lifecycle management, and local/remote stream handling.
- Optimized audio/video capture for 720p video at 30 FPS with echo cancellation, noise suppression, automatic gain control, and configurable microphone and camera controls.

**Tech Stack:** React, TypeScript, Node.js, WebSockets, WebRTC, Vite, Express

## Run the app

1. Install Node.js 20 or newer.
2. Open this project folder in VS Code.
3. Run `npm install` in the terminal.
4. Run `npm run dev`.
5. Open `http://localhost:4173`.
6. Click **Your profile** and choose a username.
7. Open the same URL in a second tab or browser and create another username.
8. Allow camera and microphone access in both tabs.
9. Click **Find someone** in both tabs.
10. Use **Mute**, **Camera**, or **Next person** during a call.
11. When connected, type a message in the chat box and click **Send**.
12. Use **Icebreaker** for a quick friendly message suggestion.

The health endpoint is available at `http://localhost:8787/health`.

## Test camera and microphone from an iPad on your local network

An iPad cannot use camera or microphone from the plain HTTP LAN address. Use a locally trusted HTTPS certificate for the Mac's LAN IP instead. The Vite server stays on port `4173`; its existing `/ws` and `/api` proxies continue forwarding to the local signaling server on port `8787`.

### 1. Install mkcert and create a local certificate authority

On the Mac, install Homebrew if it is not already installed, then run:

```sh
brew install mkcert
mkcert -install
mkdir -p certs
```

`mkcert -install` creates a local development CA and trusts it on the Mac. This CA is for local development only.

### 2. Generate a certificate for the Mac's current LAN IP

For a Mac connected over Wi-Fi, get its current address and generate a certificate/key pair:

```sh
export SIDEQUEST_LAN_IP="$(ipconfig getifaddr en0)"
mkcert -key-file certs/sidequest-key.pem -cert-file certs/sidequest.pem "$SIDEQUEST_LAN_IP" localhost 127.0.0.1 ::1
```

Check the address with `echo "$SIDEQUEST_LAN_IP"`. If that variable is empty, find the Mac's Wi-Fi address in **System Settings → Wi-Fi → Details** and set it manually, for example `export SIDEQUEST_LAN_IP="192.168.29.4"`, then rerun the `mkcert` command. If the Mac's LAN IP changes, regenerate the certificate for the new IP.

### 3. Trust the local CA on the iPad

Find the CA certificate on the Mac:

```sh
mkcert -CAROOT
```

Transfer the `rootCA.pem` file from that directory to the iPad (for example, using AirDrop). Do **not** transfer `rootCA-key.pem`; the CA private key must remain on the Mac. On the iPad, open the transferred certificate and install its profile in **Settings → Profile Downloaded** (or **Settings → General → VPN & Device Management**). Then enable trust under **Settings → General → About → Certificate Trust Settings → Enable Full Trust for Root Certificates**. Apple requires manually installed root certificates to be explicitly trusted for SSL/TLS.

### 4. Start Sidequest over HTTPS and open it on the iPad

From the project directory on the Mac, run:

```sh
SIDEQUEST_DEV_CERT=certs/sidequest.pem SIDEQUEST_DEV_KEY=certs/sidequest-key.pem npm run dev
```

Keep the Mac and iPad on the same reachable Wi-Fi network, allow incoming connections to port `4173` in the Mac firewall, then open this URL in iPad Safari (replace the address if the Mac's LAN IP differs):

```text
https://192.168.29.4:4173
```

The certificate variables are optional. If either variable is unset or either file does not exist, Vite keeps its normal HTTP development mode at `http://localhost:4173`. When HTTPS is enabled, the browser uses WSS for `/ws`; Vite terminates TLS and proxies that connection to the existing local WebSocket server.

## Skills and technologies, in order

1. **HTML**: page structure, headings, buttons, video elements, and accessibility labels.
2. **CSS**: responsive layout, colors, spacing, video panels, buttons, and animation.
3. **JavaScript**: browser actions, button clicks, timers, media permissions, and WebSocket messages.
4. **TypeScript**: safer JavaScript with types for connection states and WebRTC messages.
5. **React**: reusable UI, component state, effects, and live screen updates.
6. **Vite**: fast development server and production frontend build.
7. **Node.js**: JavaScript runtime for the backend server.
8. **Express**: simple backend health endpoint.
9. **WebSockets**: real-time connection between the browser and matchmaking server.
10. **WebRTC**: direct browser-to-browser camera and microphone connection.
11. **STUN**: helps browsers discover how to connect across networks.
12. **npm**: installs packages and runs project scripts.

## Project flow

- React shows the interface and asks for camera and microphone access.
- The browser connects to the WebSocket server when **Find someone** is clicked.
- The server places the first visitor in a waiting queue.
- The next visitor is matched with the first visitor.
- WebRTC exchanges an offer, answer, and network candidates through WebSockets.
- After setup, video and audio travel directly between the two browsers.
- Chat messages travel through the WebSocket server only between the matched pair.

For a real public launch, add login, moderation, report storage, rate limiting, HTTPS/WSS, and a TURN server.

## Privacy

No email is collected. The username is stored in the current browser and sent to the matching server for display during a call. Camera and microphone access are requested by the browser when you begin the device check; the app does not upload recordings.

The call requests HD video up to 720p at 30 FPS and uses microphone echo cancellation, noise suppression, automatic gain control, and mono audio to reduce background noise and feedback.

## Folder guide

```text
new/
|-- src/                 Frontend React application
|   |-- App.tsx          Video chat screen and WebRTC logic
|   |-- App.css          Video chat design
|   |-- index.css        Global browser styles
|   `-- main.tsx         React entry point
|-- server/
|   `-- index.ts         Matchmaking and WebSocket signaling
|-- docs/
|   `-- FOLDER_GUIDE.md  Detailed folder explanation
|-- index.html           Browser page shell
|-- package.json         Commands and dependencies
|-- vite.config.ts       Vite configuration
`-- README.md            Setup, skills, and project guide
```
