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
5. Open `http://localhost:5173`.
6. Click **Create account** and enter a username and email address.
7. Open the same URL in a second tab or browser and create another username.
8. Allow camera and microphone access in both tabs.
9. Click **Find someone** in both tabs.
10. Use **Mute**, **Camera**, or **Next person** during a call.
11. When connected, type a message in the chat box and click **Send**.
12. Use **Icebreaker** for a quick friendly message suggestion.

The health endpoint is available at `http://localhost:8787/health`.

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

The email is stored in the current browser only and is never sent to the matching server or another user. Only the username is sent for matching and displayed during a call. Camera and microphone access are requested by the browser for the call; the app does not upload recordings.

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
