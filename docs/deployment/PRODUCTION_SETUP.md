# Sidequest Production Setup & Deployment

This is the complete production setup guide for Sidequest. The app is fully built and ready to deploy. Follow this guide step-by-step.

## 📋 Pre-Deployment Checklist

Before you deploy, ensure:

- [ ] You have a GitHub account and this code is pushed to GitHub
- [ ] You have chosen a hosting platform (Render, Railway, VPS, etc.)
- [ ] You have obtained or plan to set up a TURN server
- [ ] You understand WebSocket security (WSS vs WS)

## 🚀 Fastest Deployment: Render.com (3 minutes)

This is the easiest path to a live app.

### 1. Push code to GitHub

```bash
git add .
git commit -m "feat: production deployment ready"
git push origin main
```

### 2. Create Render account and connect repo

1. Go to [render.com](https://render.com)
2. Sign up (free account)
3. Click **New +** → **Web Service**
4. Select **Connect my own GitHub repo**
5. Authorize Render to access your GitHub account
6. Select your repository

### 3. Configure deployment settings

In Render, fill in:

| Setting           | Value                        |
| ----------------- | ---------------------------- |
| **Name**          | `sidequest`                  |
| **Environment**   | `Node`                       |
| **Build Command** | `npm run build`              |
| **Start Command** | `npm run start`              |
| **Region**        | Choose closest to your users |

### 4. Add environment variables

Click **Advanced** → **Environment Variables**

Add these variables:

```
NODE_ENV=production
VITE_WS_URL=https://{your-render-domain}.onrender.com
VITE_TURN_URL=turn:your-turn-server.com:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-password
```

**Note:** Replace `{your-render-domain}` with the domain Render assigns you (e.g., `sidequest-abc123.onrender.com`). You'll see it after you hit Deploy.

Actually, for the first deploy, leave `VITE_WS_URL` empty and come back to it after Render gives you your domain.

### 5. Deploy

Click **Deploy Web Service**

Render will:

- Clone your repo
- Install dependencies (`npm install`)
- Build the app (`npm run build`)
- Start the server (`npm run start`)
- Assign a free domain
- Provision HTTPS automatically

**Time to deploy**: 2-3 minutes

**Your app is now live at**: `https://sidequest-XXXXX.onrender.com`

### 6. Update WebSocket URL

After deployment:

1. Go to Render dashboard
2. Go to your service settings
3. Add/update environment variable:
   ```
   VITE_WS_URL=wss://sidequest-XXXXX.onrender.com
   ```
4. Click **Deploy** again

Render will rebuild with the correct WebSocket URL.

### 7. Verify deployment

Test the health endpoint:

```bash
curl https://sidequest-XXXXX.onrender.com/health

# Expected response
{
  "ok": true,
  "waiting": 0,
  "timestamp": "2026-09-01T12:00:00.000Z",
  "uptimeSeconds": 45
}
```

## 🚀 Alternative: Railway.app (2 minutes)

Railway is even faster than Render.

### 1. Push to GitHub (same as above)

### 2. Create Railway account

1. Go to [railway.app](https://railway.app)
2. Sign up (free account)
3. Click **New Project**
4. Select **Deploy from GitHub repo**

### 3. Connect your GitHub repo

Railway will automatically detect `package.json` and configure Node.js.

### 4. Add environment variables

In Railway dashboard, go to **Variables** tab:

```
NODE_ENV=production
VITE_WS_URL=wss://your-railway-domain.railway.app
VITE_TURN_URL=turn:your-turn-server.com:3478
VITE_TURN_USERNAME=your-username
VITE_TURN_CREDENTIAL=your-password
```

### 5. Deploy

Click **Deploy**. Railway handles everything automatically.

**Time to deploy**: ~2 minutes

**Your app is now live at**: `https://your-service.railway.app`

## 🔧 Getting a TURN Server

Video calls fail without a TURN server on restrictive networks (most mobile networks). You need one for production.

### Option 1: Self-host Coturn (Free)

On a VPS (DigitalOcean, Linode, AWS, etc.):

```bash
# 1. SSH into your VPS
ssh root@your-vps-ip

# 2. Install Coturn
sudo apt-get update
sudo apt-get install -y coturn

# 3. Edit configuration
sudo nano /etc/coturn/turnserver.conf
```

Add to the config:

```conf
# Basics
listening-port=3478
listening-ip=0.0.0.0
external-ip=YOUR_VPS_PUBLIC_IP
realm=your-domain.com

# Authentication
user=sidequest:mySecurePassword123
fingerprint
userdb=/var/lib/coturn/turndb
```

Replace:

- `YOUR_VPS_PUBLIC_IP` = your VPS's public IP (from provider dashboard)
- `mySecurePassword123` = a secure random password

Then:

```bash
# 4. Start Coturn
sudo systemctl start coturn
sudo systemctl enable coturn  # Auto-start on reboot

# 5. Check it's running
sudo systemctl status coturn

# 6. Allow firewall (if using ufw)
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
```

Test it works:

```bash
# From your local machine
turnutils_uclient -v -u sidequest:mySecurePassword123 -w mySecurePassword123 your-vps-ip
```

Then set in deployment:

```
VITE_TURN_URL=turn:your-vps-ip:3478
VITE_TURN_USERNAME=sidequest
VITE_TURN_CREDENTIAL=mySecurePassword123
```

### Option 2: Managed TURN Services (Paid)

**Twilio**:

- Sign up at [twilio.com](https://www.twilio.com)
- Get TURN credentials from console
- Pay per usage

**Agora**:

- Sign up at [agora.io](https://www.agora.io)
- Use API to get temporary TURN credentials
- Pay per usage

**Xirsys**:

- Sign up at [xirsys.com](https://www.xirsys.com)
- Easy TURN server management
- Pay per usage

## 🌐 Using a Custom Domain (Optional)

If you have your own domain (e.g., `sidequestchat.com`):

### 1. Update DNS

Add a CNAME record in your domain registrar:

```
CNAME sidequestchat.com sidequest-XXXXX.onrender.com
```

(or your Railway domain)

Wait 5-30 minutes for DNS to propagate.

### 2. Update environment variables

In your deployment:

```
VITE_WS_URL=wss://sidequestchat.com
```

### 3. Redeploy

Trigger a redeploy in Render/Railway to pick up the new env var.

## ✅ Post-Deployment Testing

### 1. Test the app

1. Open `https://your-domain.com` in your browser
2. Click **Create account** and enter a display name
3. Click **Find someone**
4. Open the same URL in a second browser/tab
5. Click **Create account** with a different name
6. Click **Find someone** in the second tab
7. Should see video connect between both

### 2. Test on mobile

1. Get your domain
2. Open on iPhone Safari
3. Open on Android Chrome
4. Verify both can see video and chat

### 3. Verify health endpoint

```bash
curl https://your-domain.com/health
```

Should return:

```json
{
  "ok": true,
  "waiting": 0,
  "timestamp": "...",
  "uptimeSeconds": ...
}
```

## 📊 Monitoring & Uptime

Once live, monitor your app with free services:

### Uptime Monitoring (Health endpoint)

1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Sign up (free tier allows 50 monitors)
3. Add monitor
   - URL: `https://your-domain.com/health`
   - Check interval: Every 5 minutes
   - Alert email: Your email
4. You'll get alerts if the app goes down

### View Logs

**Render**: Dashboard → Select service → **Logs** tab
**Railway**: Dashboard → Select service → **Logs** tab

### Performance Metrics

Render and Railway dashboards show:

- CPU usage
- Memory usage
- Request rate
- Error rate
- Network I/O

## 🔐 Security Checklist

Before sharing your link widely:

- [x] HTTPS/WSS enabled (automatic on Render/Railway)
- [x] Rate limiting enabled (in server code)
- [x] Input validation (in server code)
- [ ] Set `NODE_ENV=production` in deployment env vars
- [ ] Verify `.env` file is NOT in git history
- [ ] Monitor `/health` endpoint for anomalies
- [ ] Have a plan for abusive users (optional: add reporting feature)
- [ ] Keep Node.js and dependencies updated

## 📈 Scaling When Popular

If you get a lot of users:

### Render

- Go to Settings → **Instance Type**
- Upgrade to higher tier
- Autoscaling available on paid plans

### Railway

- Go to **Deployments**
- Increase reserved resources

### Self-hosted

- Run multiple instances behind load balancer (Nginx, HAProxy)
- Use Redis for cross-instance communication
- Consider adding database for chat history

## ❓ Troubleshooting

### "WebSocket connection failed"

**Cause**: WSS URL is wrong or server is down
**Solution**:

1. Check `/health` endpoint responds
2. Verify `VITE_WS_URL` starts with `wss://` (not `ws://`)
3. Check Render/Railway logs for errors
4. Restart service

### "Video won't connect"

**Cause**: TURN server missing or misconfigured
**Solution**:

1. Verify TURN env vars are set
2. Test TURN server: `turnutils_uclient -v -u user:pass turn-server`
3. Check if network blocks UDP (common on public Wi-Fi)
4. Try on different network to verify

### "Too many people waiting"

**Good problem!** Your server is popular.
**Solution**:

1. Scale up instance size in Render/Railway
2. Or run multiple instances (requires load balancer)

### "App keeps crashing"

**Solution**:

1. Check Render/Railway logs
2. Look for memory leaks or errors
3. Increase instance memory
4. File issue on GitHub with error details

## 🎉 Success!

Your Sidequest video chat app is now live!

### Next Steps

1. **Share the link** with friends and test
2. **Monitor** with Uptimerobot
3. **Gather feedback** from users
4. **Plan** next features (profiles, chat history, etc.)
5. **Add** custom domain when ready
6. **Scale** if it gets popular

## 📚 Additional Resources

- [Render Docs](https://render.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Coturn Docs](https://github.com/coturn/coturn)
- [WebRTC Guide](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Express Docs](https://expressjs.com)

## 📧 Support

If you have issues:

1. Check the **Troubleshooting** section above
2. Review **Render/Railway logs**
3. Check `/health` endpoint
4. Read full [DEPLOYMENT.md](./DEPLOYMENT.md) guide
5. File issue on this repo

---

**Good luck! 🚀**
