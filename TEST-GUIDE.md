# 🎯 Step-by-Step: Test Call dengan ElevenLabs

## Status Saat Ini
- ✅ ElevenLabs API Key: Sudah dikonfigurasi
- ✅ Voice ID: `3AwU3nHsI4YWeBJbz6yn` (sudah diset)
- ⚠️ Asterisk Connection: TIMEOUT (perlu fix)

## 🔧 Fix Connection Timeout Dulu

### Step 1: Test dari Mac Anda

```bash
# Test 1: Ping server
ping 192.168.50.2

# Test 2: Test port 8088 (ARI)
nc -zv 192.168.50.2 8088

# Test 3: Curl ARI endpoint
curl http://192.168.50.2:8088/ari/asterisk/info \
  -u jarjit:semangat
```

**Expected hasil:**
- Ping: Reply dari 192.168.50.2
- nc: "Connection succeeded"
- curl: JSON response dengan info Asterisk

### Step 2: Jika Test Gagal - Fix di Ubuntu Server

**Di Ubuntu Asterisk server, jalankan:**

```bash
# 1. Check Asterisk running
sudo systemctl status asterisk

# 2. Check ARI enabled
sudo asterisk -rx "ari show status"
sudo asterisk -rx "http show status"

# 3. Check port 8088 listening
sudo netstat -tulpn | grep 8088
# Harus ada output: tcp ... 0.0.0.0:8088 ... LISTEN

# 4. Check UFW firewall
sudo ufw status numbered

# 5. BUKA port 8088 dari IP Mac Anda
# Cari IP Mac dulu dengan: ifconfig | grep "inet "
# Misal IP Mac = 192.168.50.100
sudo ufw allow from 192.168.50.100 to any port 8088 proto tcp
sudo ufw reload

# 6. Verify
sudo ufw status | grep 8088
```

### Step 3: Fix http.conf jika Port Tidak Listening

```bash
# Edit http.conf
sudo nano /etc/asterisk/http.conf
```

Pastikan:
```ini
[general]
enabled = yes
bindaddr = 0.0.0.0  # PENTING: BUKAN 127.0.0.1
bindport = 8088
```

Reload:
```bash
sudo asterisk -rx "module reload res_http"
sudo asterisk -rx "http show status"
```

---

## 📞 Setelah Connection OK, Test Call

### Step 4: Setup Extension Lokal

**Edit `/etc/asterisk/pjsip_wizard.conf`:**

```bash
sudo nano /etc/asterisk/pjsip_wizard.conf
```

Tambahkan:
```ini
[100]
type = wizard
accepts_registrations = yes
accepts_auth = yes
has_hint = yes
inbound_auth/username = 100
inbound_auth/password = test100
endpoint/context = from-internal
endpoint/disallow = all
endpoint/allow = ulaw
endpoint/allow = alaw
endpoint/direct_media = no
aor/max_contacts = 1
```

**Edit `/etc/asterisk/extensions.conf`:**

```bash
sudo nano /etc/asterisk/extensions.conf
```

Tambahkan context:
```ini
[from-internal]
exten => *123,1,NoOp(Test ElevenLabs)
  same => n,Answer()
  same => n,Wait(1)
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()
```

**Reload:**
```bash
sudo asterisk -rx "pjsip reload"
sudo asterisk -rx "dialplan reload"
sudo asterisk -rx "pjsip show endpoints"
```

### Step 5: Register Softphone

**Install softphone di Mac:**
- **Linphone** (recommended): `brew install --cask linphone`
- Atau download dari: https://www.linphone.org/

**SIP Account Settings:**
```
Username: 100
Password: test100
Domain: 192.168.50.2
Transport: UDP
```

**Pastikan port 5060 terbuka di Ubuntu:**
```bash
sudo ufw allow 5060/udp
sudo ufw allow 10000:20000/udp  # RTP audio
sudo ufw reload
```

### Step 6: Start Node.js Application

**Di Mac, terminal baru:**

```bash
cd /Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent

# Stop app yang running (jika ada)
# Press Ctrl+C di terminal yang running npm start

# Start fresh
npm run dev
```

**Expected output:**
```
============================================================
🚀 Starting ElevenLabs-Asterisk Voice Agent
============================================================
📡 Connecting to Asterisk ARI
✅ Connected to Asterisk ARI
📞 Listening for calls on Stasis app: elevenlabs-agent
============================================================
```

### Step 7: Make Test Call! 🎉

1. **Di softphone, dial `*123`**
2. **Tunggu call connected**
3. **Dengarkan greeting dari ElevenLabs:**
   - "Halo, selamat datang di sistem voice agent..."
4. **Tekan DTMF:**
   - `1` = Menu informasi
   - `2` = Menu dukungan
   - `#` = Keluar

### Step 8: Monitor Logs

**Terminal 1 - App Output:**
```bash
npm run dev
```

**Terminal 2 - Watch Logs:**
```bash
tail -f logs/combined.log
```

**Terminal 3 - Asterisk CLI (di Ubuntu):**
```bash
sudo asterisk -rvvvv
```

---

## 🐛 Troubleshooting

### "No Audio" atau "Choppy Audio"

**Check FFmpeg installed:**
```bash
ffmpeg -version
```

**Install jika belum:**
```bash
brew install ffmpeg
```

**Check temp directory writable:**
```bash
ls -la /tmp/elevenlabs-audio/
```

### "Extension not registered"

**Check endpoint:**
```bash
sudo asterisk -rx "pjsip show endpoint 100"
```

**Reload if needed:**
```bash
sudo asterisk -rx "pjsip reload"
```

### "Call connects but no ElevenLabs voice"

**Check ElevenLabs API:**
```bash
curl https://api.elevenlabs.io/v1/user \
  -H "xi-api-key: sk_138aacf7805bcee70adf36823a51a88e214a16b56c5c7553"
```

**Check logs untuk errors:**
```bash
cat logs/error.log
tail -f logs/combined.log | grep -i error
```

---

## ✅ Success Checklist

- [ ] Ping ke 192.168.50.2 berhasil
- [ ] Port 8088 open (test dengan nc)
- [ ] ARI endpoint accessible (test dengan curl)
- [ ] Extension 100 terdaftar di Asterisk
- [ ] Softphone berhasil register
- [ ] npm run dev running tanpa error
- [ ] Call ke *123 tersambung
- [ ] Dengar suara dari ElevenLabs
- [ ] DTMF menu bekerja

---

## 🎤 Expected Call Flow

```
1. Softphone dial *123
   ↓
2. Asterisk receives call → routes ke Stasis
   ↓
3. Node.js app receives StasisStart event
   ↓
4. App answers call
   ↓
5. App generates TTS via ElevenLabs API
   ↓
6. App converts MP3 → SLIN format
   ↓
7. App plays audio via ARI
   ↓
8. User hears: "Halo, selamat datang..."
   ↓
9. User presses DTMF (1, 2, or #)
   ↓
10. App responds with appropriate menu
```

---

## 📝 Quick Commands Reference

```bash
# Mac - Test connectivity
./scripts/test-connectivity.sh

# Mac - Start app
npm run dev

# Ubuntu - Reload configs
sudo asterisk -rx "pjsip reload && dialplan reload"

# Ubuntu - Check status
sudo asterisk -rx "pjsip show endpoints"
sudo asterisk -rx "core show channels"

# Ubuntu - Monitor real-time
sudo asterisk -rvvvv
```

---

## 🚀 Quick Fix Script

Jalankan di Mac untuk automated check:

```bash
#!/bin/bash
echo "🔍 Quick Diagnostics..."

# Test connection
nc -zv 192.168.50.2 8088 && echo "✅ ARI reachable" || echo "❌ ARI not reachable"

# Test ElevenLabs
curl -s https://api.elevenlabs.io/v1/user \
  -H "xi-api-key: sk_138aacf7805bcee70adf36823a51a88e214a16b56c5c7553" \
  > /dev/null && echo "✅ ElevenLabs API OK" || echo "❌ ElevenLabs API failed"

# Check FFmpeg
which ffmpeg > /dev/null && echo "✅ FFmpeg installed" || echo "❌ FFmpeg not found"

echo ""
echo "Ready to start? Run: npm run dev"
```
