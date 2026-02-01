# Quick Reference - Local Extension Testing

## 🎯 Endpoint Credentials

### Extension 100
```
Server: 192.168.50.2
Port: 5060
Username: 100
Password: test100
Context: from-internal
```

### Extension 101
```
Server: 192.168.50.2
Port: 5060
Username: 101
Password: test101
Context: from-internal
```

---

## 📞 Dial Codes

| Code | Function |
|------|----------|
| `*123` | Test ElevenLabs Voice Agent |
| `9123` | Alternative Voice Agent Test |
| `100` | Call Extension 100 |
| `101` | Call Extension 101 |
| `888` | Echo Test (audio check) |
| `777` | Playback Test |

---

## 📁 Configuration Files Location (Ubuntu Server)

| File | Purpose |
|------|---------|
| `/etc/asterisk/pjsip_wizard.conf` | Extension definitions |
| `/etc/asterisk/extensions.conf` | Dialplan/routing |
| `/etc/asterisk/ari.conf` | ARI user credentials |
| `/etc/asterisk/http.conf` | HTTP/WebSocket settings |

---

## 🔄 Essential Commands (Ubuntu)

### Reload Config
```bash
sudo asterisk -rx "pjsip reload"
sudo asterisk -rx "dialplan reload"
sudo asterisk -rx "ari reload"
```

### Check Status
```bash
# Show registered endpoints
sudo asterisk -rx "pjsip show endpoints"

# Show active channels
sudo asterisk -rx "core show channels"

# Show ARI apps
sudo asterisk -rx "ari show apps"
```

### Monitor Real-time
```bash
# Enter Asterisk CLI (verbose mode)
sudo asterisk -rvvvv

# Exit: type "exit" or press Ctrl+C
```

---

## 🔥 Firewall Ports (Ubuntu)

```bash
sudo ufw allow from YOUR_MAC_IP to any port 8088 proto tcp  # ARI
sudo ufw allow 5060/udp                                     # PJSIP SIP
sudo ufw allow 5060/tcp                                     # PJSIP SIP
sudo ufw allow 10000:20000/udp                              # RTP Audio
sudo ufw reload
```

---

## 🧪 Testing Checklist

### On Ubuntu Server:
- [ ] Asterisk running: `sudo systemctl status asterisk`
- [ ] ARI enabled: `sudo asterisk -rx "ari show status"`
- [ ] Port 8088 listening: `sudo netstat -tulpn | grep 8088`
- [ ] Firewall allows ports: `sudo ufw status`
- [ ] Extension configured: `sudo asterisk -rx "pjsip show endpoints"`

### On Mac:
- [ ] Network reachable: `ping 192.168.50.2`
- [ ] Port 8088 open: `nc -zv 192.168.50.2 8088`
- [ ] ARI accessible: `curl http://192.168.50.2:8088/ari/asterisk/info -u jarjit:PASSWORD`
- [ ] .env configured correctly
- [ ] Dependencies installed: `npm install`

### Softphone:
- [ ] Registered to extension 100
- [ ] Can dial `*123`
- [ ] Hearing audio

### Node.js App:
- [ ] Running: `npm run dev`
- [ ] Logs show connection: `tail -f logs/combined.log`
- [ ] Receives call events

---

## 🐛 Troubleshooting Quick Fixes

### "Extension not registered"
```bash
# Check endpoint exists
sudo asterisk -rx "pjsip show endpoint 100"

# Check authentication
sudo asterisk -rx "pjsip show auth 100-auth"

# Reload
sudo asterisk -rx "pjsip reload"
```

### "No audio during call"
```bash
# Check RTP ports open
sudo ufw allow 10000:20000/udp
sudo ufw reload

# Check RTP config
sudo asterisk -rx "rtp show settings"
```

### "Cannot connect to ARI"
```bash
# Check HTTP/ARI listening
sudo netstat -tulpn | grep 8088

# If not listening, check config
sudo nano /etc/asterisk/http.conf
# Ensure: bindaddr = 0.0.0.0, bindport = 8088

# Reload
sudo asterisk -rx "module reload res_http"
```

### "ETIMEDOUT error from Node.js"
```bash
# From Mac, test connectivity
nc -zv 192.168.50.2 8088

# If fails, check UFW on Ubuntu
sudo ufw allow from YOUR_MAC_IP to any port 8088 proto tcp
sudo ufw reload
```

---

## 📞 Expected Call Flow

1. **Softphone dials `*123`**
2. **Asterisk receives call** → routes to `from-internal` context
3. **Dialplan matches `*123`** → executes `Stasis(elevenlabs-agent)`
4. **Node.js app receives** `StasisStart` event via ARI
5. **App answers call** and plays ElevenLabs TTS
6. **User hears greeting** and can press DTMF (1, 2, #)
7. **App responds** with appropriate TTS based on DTMF

---

## 🎤 Recommended Softphones

### Mac
- **Linphone** (Free, Open Source)
- **Zoiper** (Free/Paid)
- **Telephone** (Free, Mac App Store)

### iOS/Android
- **Linphone** (Free)
- **Zoiper** (Free/Paid)
- **Groundwire** (Paid, Best Quality)

---

## 📊 Monitoring Commands

### Watch Logs in Real-time

**Terminal 1 - Node.js App:**
```bash
npm run dev
```

**Terminal 2 - App Logs:**
```bash
tail -f logs/combined.log | grep -E "call|elevenlabs|asterisk"
```

**Terminal 3 - Asterisk CLI (on Ubuntu):**
```bash
sudo asterisk -rvvvv
```

---

## 🚀 Quick Start Script

Save as `quick-test.sh` on Mac:

```bash
#!/bin/bash
echo "1. Testing connection..."
nc -zv 192.168.50.2 8088 && echo "✅ ARI reachable"

echo "2. Starting Node.js app..."
npm run dev
```

Run: `chmod +x quick-test.sh && ./quick-test.sh`
