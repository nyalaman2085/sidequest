# Deployment Guide

This guide covers deploying Sidequest to production on common hosting platforms.

## Prerequisites

- Node.js 20 or newer
- A domain name (optional, but recommended)
- HTTPS/TLS certificate (required for WebRTC and TURN)
- TURN server credentials (required for mobile reliability)
- Environment variables configured

## Environment Setup

Create a `.env` file in the root folder with:

```bash
NODE_ENV=production
PORT=8788
VITE_WS_URL=wss://your-domain.com
VITE_TURN_URL=turn:turn.example.com:3478
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-password
```

## Option 1: Render.com (Recommended)

1. Push your code to GitHub
2. Go to [render.com](https://render.com)
3. Create a new **Web Service**
4. Connect your GitHub repository
5. Set **Build command**: `npm run build`
6. Set **Start command**: `npm run start`
7. Add environment variables from `.env`
8. Deploy

Health check: Render will automatically check `/health` endpoint.

## Option 2: Railway.app

1. Connect your GitHub repository at [railway.app](https://railway.app)
2. Select Node.js
3. Add environment variables
4. Railway will auto-detect and run `npm start`

## Option 3: Docker + VPS/Cloud

### Build and push Docker image:

```bash
docker build -t sidequest:latest .
docker tag sidequest:latest your-registry/sidequest:latest
docker push your-registry/sidequest:latest
```

### Run on VPS:

```bash
docker run -d \
  -p 443:8788 \
  -e NODE_ENV=production \
  -e VITE_WS_URL=wss://your-domain.com \
  -e VITE_TURN_URL=turn:turn.example.com:3478 \
  -e VITE_TURN_USERNAME=your-turn-username \
  -e VITE_TURN_CREDENTIAL=your-turn-password \
  --name sidequest \
  --restart unless-stopped \
  your-registry/sidequest:latest
```

Then use Nginx or Caddy as a reverse proxy with TLS.

## HTTPS/WSS Setup

Sidequest **requires** HTTPS and WSS (WebSocket Secure).

### Using Caddy (easiest):

```
your-domain.com {
  reverse_proxy localhost:8788
}
```

Caddy automatically obtains and renews Let's Encrypt certificates.

### Using Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name your-domain.com;

  ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

  location / {
    proxy_pass http://localhost:8788;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Obtain certificates with Let's Encrypt:

```bash
sudo certbot certonly --standalone -d your-domain.com
```

## TURN Server Setup

For reliable mobile connections, use a TURN server:

- [Coturn](https://github.com/coturn/coturn) (self-hosted, free)
- [Twilio](https://www.twilio.com/docs/stun-turn) (managed, paid)
- [Agora TURN](https://www.agora.io) (managed, paid)

Coturn setup:

```bash
sudo apt-get install coturn
sudo nano /etc/coturn/turnserver.conf
sudo systemctl start coturn
```

Configure with:

```conf
realm=your-domain.com
listening-port=3478
listening-ip=0.0.0.0
external-ip=YOUR_SERVER_IP
user=your-turn-username:your-turn-password
```

## Health Monitoring

Sidequest exposes a health endpoint at `/health`:

```json
{
  "ok": true,
  "waiting": 5,
  "timestamp": "2026-09-01T15:30:00.000Z",
  "uptimeSeconds": 3600
}
```

Use this for uptime monitoring services:

- [Uptimerobot](https://uptimerobot.com)
- [Pingdom](https://www.pingdom.com)
- [Datadog](https://www.datadoghq.com)

## Performance Tips

1. **Enable compression**: Nginx/Caddy compress responses automatically.
2. **Use CDN**: Cloudflare or your provider's CDN for static assets.
3. **Monitor WebSocket connections**: Watch `/health` for queue depth.
4. **Set resource limits**: Docker `--memory` and `--cpus`.

## Security Checklist

- ✅ HTTPS/WSS enabled (required)
- ✅ Security headers included in server
- ✅ Input validation in signaling protocol
- ✅ Rate limiting on signaling messages
- ✅ Message size limits enforced
- ⚠️ Add username uniqueness or reporting system (optional)
- ⚠️ Add abuse reporting mechanism (optional)
- ⚠️ Consider age verification or terms acceptance (optional)

## Troubleshooting

### WebSocket connection fails

- Check that WSS (not WS) is used
- Verify firewall allows port 443
- Confirm TLS certificate is valid

### Video calls fail

- Confirm TURN server is configured and working
- Test with `turnutils_uclient` tool
- Check browser console for WebRTC errors

### Poor video quality on mobile

- Verify mobile network allows UDP
- Check TURN server logs for client rejection
- Ensure `VITE_TURN_URL` is correctly set in frontend `.env`

### High queue (many waiting)

- Server is healthy but popular; scale horizontally
- Run multiple instances behind a load balancer

## Scaling

For large deployments, consider:

1. **Horizontal scaling**: Run multiple instances behind a load balancer
2. **Session stickiness**: Ensure same user stays on same instance
3. **Database**: Store chat history, user profiles, reports (not included)
4. **Message queue**: Use Redis for off-instance communication
5. **Analytics**: Track usage, call duration, match success rate

## Next Steps

1. Deploy to your chosen platform
2. Obtain TLS certificate
3. Set up TURN server
4. Configure environment variables
5. Test with real users on different networks and devices
6. Add analytics and monitoring
7. Plan moderation and abuse handling strategy
