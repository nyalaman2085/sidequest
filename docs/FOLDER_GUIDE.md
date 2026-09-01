# Sidequest folder guide

The project is divided into two simple parts.

## Frontend: `src`

- `App.tsx`: buttons, video elements, camera access, WebRTC, and matching actions.
- `App.css`: layout, colors, video panels, controls, and responsive design.
- `index.css`: global page defaults.
- `main.tsx`: starts the React app.

## Backend: `server`

- `index.ts`: Express health check, WebSocket connections, waiting queue, matching, Skip, and signaling messages.

## Root files

- `index.html`: browser page shell and title.
- `package.json`: scripts and installed packages.
- `vite.config.ts`: frontend development and build configuration.
- `README.md`: setup instructions, ordered skills, and project flow.
