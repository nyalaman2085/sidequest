# Quick Start: Production Deployment

Get Sidequest running on production in under 10 minutes.

## Fastest Path: Render.com

### Step 1: Prepare GitHub

```bash
# Ensure you're on main branch
git add .
git commit -m "production: deployment ready"
git push origin main
```

### Step 2: Connect to Render

1. Go to [render.com](https://render.com)
2. Click **New +**
3. Select **Web Service**
4. Connect your GitHub account
5. Select this repository
6. Fill in settings:
   - **Name**: `sidequest`
   - **Environment**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
   - **Region**: Choose closest to users

### Step 3: Add Environment Variables

Click **Advanced** and add:

```
NODE_ENV=production
VITE_WS_URL=wss://sidequest-XXXX.onrender.com
VITE_TURN_URL=turn:your-turn.com:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-password
```

(Replace `XXXX` with your Render domain)

### Step 4: Deploy

Click **Deploy**. Render will:

- Install dependencies
- Build your app
- Start the server
- Enable HTTPS automatically
- Provide a free domain: `sidequest-XXXX.onrender.com`

**Total time**: ~3 minutes

---

## Alternative: Railway.app

### Step 1: Push to GitHub (same as above)

### Step 2: Connect Railway

1. Go to [railway.app](https://railway.app)
2. Click **New Project**
3. Select **Deploy from GitHub repo**
4. Connect your account and select this repo
5. Railway auto-detects Node.js

### Step 3: Add Variables

In the **Variables** tab, add the same env vars as Render.

### Step 4: Deploy

Click **Deploy**. Railway will handle everything.

**Total time**: ~2 minutes

---

## How to Get TURN Credentials

### Free Option: Self-Host Coturn

```bash
# On your VPS
sudo apt-get install coturn
sudo nano /etc/coturn/turnserver.conf
```

Add to config:

```
realm=your-domain.com
listening-port=3478
listening-ip=0.0.0.0
user=myuser:mypassword
```

Start:

```bash
sudo systemctl start coturn
sudo systemctl enable coturn
```

### Paid Option: Twilio

1. Create [Twilio account](https://www.twilio.com)
2. Get TURN credentials from console
3. Update `.env` variables

### Paid Option: Agora

1. Create [Agora account](https://www.agora.io)
2. Get temporary TURN credentials via API
3. Refresh periodically

---

## Verify Deployment

After deploy completes:

```bash
# Health check (replace with your domain)
curl https://sidequest-XXXX.onrender.com/health

# Expected response
{
  "ok": true,
  "waiting": 0,
  "timestamp": "2026-09-01T12:00:00.000Z",
  "uptimeSeconds": 45
}
```

---

## What Happens Next

1. **DNS** (if using custom domain):

   ```bash
   CNAME sidequest.example.com sidequest-XXXX.onrender.com
   ```

2. **Update env vars** when domain is live

3. **Test on mobile**: Open app on iPhone and Android to verify:
   - Camera works
   - Microphone works
   - Video connects
   - Chat works
   - No offline errors

4. **Monitor**:
   - Render/Railway dashboard
   - `/health` endpoint every 5 minutes
   - Error tracking (optional: Sentry)

---

## Troubleshooting

### "WebSocket connection failed"

- Check VITE_WS_URL starts with `wss://` (not `ws://`)
- Verify domain is correct
- Wait 5 minutes for DNS to propagate

### "Video won't connect on mobile"

- Confirm TURN server is set and working
- Test TURN with: `turnutils_uclient -v -u user:pass -w password your-turn.com`
- Check if mobile network blocks UDP

### "Too many waiting"

- Server is healthy, just popular
- Scale vertically (upgrade instance)
- Or run multiple instances with load balancer

---

## Next Steps

1. ✅ Deploy
2. ✅ Test on devices
3. Share with friends
4. Monitor usage
5. Add custom domain (optional)
6. Add analytics (optional)
7. Plan next features based on feedback
