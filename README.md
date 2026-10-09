# Sidequest — Random Video Chat

Sidequest is a browser-based, one-to-one video chat demo. It uses React and TypeScript for the client, a Node.js WebSocket server for matchmaking/signaling, and WebRTC for peer-to-peer media.

> **Portfolio/demo status:** This is a learning project, not a production-ready anonymous chat service. The current signaling server keeps its matchmaking state and user reports in memory. The WebRTC configuration uses a public STUN server and does not include a TURN relay, so some network combinations will fail to connect.

## Highlights

- Username-based lobby and queue matchmaking
- Browser camera and microphone permission flow
- WebRTC audio/video with local and remote media panels
- Mute and camera controls
- In-call text chat
- Next-person / leave flow
- Responsive interface and keyboard-accessible profile dialog
- WebSocket message validation, payload limits, rate limits, heartbeat checks, and origin allowlisting on the server
- Health endpoint at \`/health\`

## Tech stack

- React, TypeScript, Vite
- Node.js, Express, \`ws\`
- WebRTC APIs: \`RTCPeerConnection\`, ICE candidates, media tracks
- CSS
- TypeScript build for the signaling server

## Architecture

\`\`\`text
React browser client
  |-- getUserMedia: local camera/microphone
  |-- WebSocket /ws: matchmaking + signaling + chat
  |-- RTCPeerConnection: peer-to-peer media
  |
Node.js + Express server
  |-- waiting queue and match IDs
  |-- validates/rate-limits signaling and chat messages
  |-- /health endpoint
  |-- serves the built frontend in production
\`\`\`

The server relays WebRTC offers, answers, and ICE candidates; the media stream is intended to travel directly between browsers. The server does not receive or record the media stream.

## Requirements

- Node.js 20 or newer
- npm
- A modern browser with camera/microphone support
- For LAN testing on iOS/iPadOS, a trusted HTTPS certificate is required for camera/microphone access

## Run locally

\`\`\`bash
git clone https://github.com/nyalaman2085/sidequest.git
cd sidequest
npm ci
npm run dev
\`\`\`

Open the Vite URL printed in the terminal (normally \`http://localhost:4173\`). The development frontend proxies \`/ws\` and \`/api\` to the local signaling server on port \`8787\`.

### Test the main flow

1. Open Sidequest in two separate browser sessions (for example, a normal window and a private window).
2. Set a different username in each session.
3. Allow camera and microphone access.
4. Click **Find someone** in both sessions.
5. Confirm the remote video appears and audio works in both directions.
6. Test mute, camera off/on, in-call chat, and **Next person**.
7. Close one browser session and confirm the other sees the partner-left state and can search again.
8. Reload the page and verify the app returns to a usable state.

Camera and microphone permissions generally require HTTPS or localhost. See the LAN/iPad section below for development certificate instructions.

## Production build

Run the same build command used by the project:

\`\`\`bash
npm ci
npm run build
npm start
\`\`\`

The build should produce the Vite frontend in \`dist/\` and the compiled signaling server in \`server-dist/\`. The production server requires the hosting platform to supply \`PORT\`. Configure \`SIDEQUEST_ALLOWED_ORIGINS\` as a comma-separated list of the exact public frontend origins, including scheme and hostname, for example:

\`\`\`text
SIDEQUEST_ALLOWED_ORIGINS=https://your-app.example.com
\`\`\`

Do not use a wildcard origin for production. Verify the deployed health endpoint at \`https://your-app.example.com/health\` and test WebSocket upgrade behavior from the deployed origin.

## Free/local demonstration

No paid service is required to run the project locally. A public hosted demo may sleep, expire, or be unavailable on free hosting; the repository and local run instructions are the dependable demo path. Do not advertise a public live demo unless you have checked it recently.

## HTTPS for iPad on a local network

A plain HTTP LAN address generally cannot access camera/microphone APIs. For development only, you can use \`mkcert\` to create a locally trusted certificate for your Mac's LAN IP.

1. Install mkcert and create a local development CA: \`brew install mkcert && mkcert -install\`.
2. Create a local \`certs\` directory and generate a certificate for the Mac's current LAN IP plus localhost.
3. Keep the CA private key on the Mac; never commit certificate private keys to GitHub.
4. Trust the development CA on the iPad using Apple's certificate-profile and full-trust settings.
5. Start the app with \`SIDEQUEST_DEV_CERT\` and \`SIDEQUEST_DEV_KEY\` pointing to the certificate and key files.
6. Open the HTTPS URL using the Mac's current LAN IP on the iPad.

Certificates are for local development only. Do not use a local mkcert CA for public production hosting.

## Configuration notes and limitations

- **STUN-only WebRTC:** some restrictive networks need a TURN relay. TURN is not configured by default, and adding a reliable public service may incur cost.
- **In-memory reports:** reports are kept in process memory and are lost on restart. There is no moderation dashboard or durable report database.
- **Local block list:** the browser stores blocked usernames locally. This is not an account-level moderation system and should not be described as guaranteed matchmaking exclusion unless that behavior is tested and implemented.
- **No authentication:** usernames are display labels, not verified identities.
- **No media recording:** the app does not upload or persist the audio/video stream by design.
- **Scale:** queue and match state are held in one server process; multiple replicas would need shared state and coordination.

## Privacy and safety

- Camera/microphone access is controlled by browser permissions.
- Leave the call or close the page to stop using the session; the app cleanup stops local media tracks.
- Do not use this demo with sensitive conversations or assume that usernames are verified.
- A public launch needs stronger moderation, abuse reporting and retention policies, durable storage, operational monitoring, TURN infrastructure, and a documented privacy policy.

## Troubleshooting

- **Camera/mic unavailable:** use localhost or HTTPS, check browser permissions, and ensure another application is not exclusively using the device.
- **WebSocket fails:** verify the frontend origin is allowed in production and that the hosting platform supports WebSocket upgrades.
- **Matched but no media:** try a different network/browser. STUN-only ICE can fail behind some NAT/firewall combinations; a TURN relay is the usual next step.
- **Production page loads but API fails:** confirm the server is serving the built \`dist/\` directory and that the deployment provides \`PORT\`.
- **iPad on LAN:** use the HTTPS instructions above; a certificate warning usually means the local certificate is not trusted or does not match the current IP.

## Portfolio walkthrough

In an interview, explain the lifecycle in this order:

1. Client requests local media with \`getUserMedia\`.
2. Client opens \`/ws\` and joins the waiting queue.
3. The server pairs two clients and creates a match ID.
4. The initiator creates an SDP offer; both peers exchange offers/answers and ICE candidates over WebSocket signaling.
5. Once ICE connects, media travels peer-to-peer.
6. Chat uses the WebSocket server and is scoped to the active match ID.
7. Leave/skip/disconnect closes the peer connection, clears match state, and lets the remaining user continue.

Be ready to discuss race conditions during skip/disconnect, the difference between STUN and TURN, why production origin allowlisting matters, and why in-memory moderation is only a demo-level implementation.

## License

Add a license file before inviting reuse or contributions. Review dependency licenses separately.
