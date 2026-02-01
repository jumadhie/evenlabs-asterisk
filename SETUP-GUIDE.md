# Setup Guide - Step by Step

Panduan lengkap untuk setup project ElevenLabs-Asterisk Agent dari awal sampai running.

## 📍 Lokasi Project

Project ini sudah dibuat di:
```
/Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent/
```

## ✅ Step 1: Install Dependencies

```bash
cd /Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent
npm install
```

Dependencies yang akan diinstall:
- `ari-client` - Asterisk ARI client
- `axios` - HTTP client
- `winston` - Logging
- `ws` - WebSocket support
- `fluent-ffmpeg` - Audio conversion

## ✅ Step 2: Install FFmpeg

FFmpeg diperlukan untuk konversi audio MP3 → SLIN/ULAW/ALAW.

```bash
# Cek apakah sudah terinstall
ffmpeg -version

# Jika belum, install dengan Homebrew (macOS)
brew install ffmpeg
```

## ✅ Step 3: Setup Environment Variables

```bash
# Copy template
cp .env.example .env

# Edit dengan nano atau VS Code
nano .env
# atau
code .env
```

**Isi minimum yang WAJIB diubah:**

```env
# 1. Asterisk Server (ganti dengan IP server Anda)
ASTERISK_HOST=http://192.168.1.100:8088

# 2. ARI Credentials
ASTERISK_USERNAME=ari_user
ASTERISK_PASSWORD=password_anda

# 3. ElevenLabs API Key (dari https://elevenlabs.io/app/settings/api-keys)
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 4. Voice ID (opsional, gunakan  default atau pilih dari list)
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

**Cara mendapatkan ElevenLabs API Key:**
1. Buka https://elevenlabs.io
2. Sign up / Login
3. Buka Settings → API Keys
4. Copy API key Anda

## ✅ Step 4: Konfigurasi Asterisk Server

⚠️ **Langkah ini dilakukan di server Asterisk Ubuntu Anda**

### A. Enable ARI

Edit `/etc/asterisk/ari.conf`:

```bash
sudo nano /etc/asterisk/ari.conf
```

Tambahkan/edit:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins = *  ; Untuk production, specify IP

[ari_user]  ; Nama user bebas, sesuaikan dengan .env Anda
type = user
read_only = no
password = your_secure_password_123
```

### B. Enable HTTP/WebSocket

Edit `/etc/asterisk/http.conf`:

```bash
sudo nano /etc/asterisk/http.conf
```

Tambahkan/edit:

```ini
[general]
enabled = yes
bindaddr = 0.0.0.0  ; Listen on all interfaces
bindport = 8088
```

### C. Setup Dialplan

Edit `/etc/asterisk/extensions.conf`:

```bash
sudo nano /etc/asterisk/extensions.conf
```

Tambahkan context baru atau edit existing:

```ini
[from-trunk]  ; Atau context yang sesuai dengan trunk Anda
exten => 123,1,NoOp(Test ElevenLabs Agent)
  same => n,Answer()
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()

; Atau untuk semua incoming call:
exten => _X.,1,NoOp(Incoming: ${CALLERID(num)})
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()
```

**Keterangan:**
- `elevenlabs-agent` harus sama dengan `ASTERISK_APP_NAME` di `.env`
- Sesuaikan extension pattern dengan kebutuhan Anda

### D. Reload Asterisk

```bash
# Masuk ke Asterisk CLI
sudo asterisk -rvvv

# Di dalam CLI, jalankan:
module reload res_ari
module reload res_http
dialplan reload
exit
```

### E. Verifikasi Konfigurasi

```bash
# Check ARI status
sudo asterisk -rx "ari show users"

# Check HTTP status
sudo asterisk -rx "http show status"

# Check port listening
sudo netstat -tulpn | grep 8088
```

## ✅ Step 5: Network & Firewall

Pastikan komputer development Anda (macOS) bisa akses Asterisk server.

### Test dari Mac Anda:

```bash
# Test HTTP connection
curl http://YOUR_ASTERISK_IP:8088/ari/asterisk/info \
  -u ari_user:your_password

# Atau dengan telnet
telnet YOUR_ASTERISK_IP 8088
```

### Jika gagal, buka firewall di Ubuntu:

```bash
# UFW
sudo ufw allow 8088/tcp

# IPTables
sudo iptables -A INPUT -p tcp --dport 8088 -j ACCEPT
```

## ✅ Step 6: Test Connections

Kembali ke Mac, test koneksi:

```bash
cd /Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent
npm run test:connection
```

**Output yang diharapkan:**

```
🧪 Running Connection Tests
============================================================
Testing Asterisk ARI connection...
✅ Asterisk connection successful
Testing ElevenLabs API connection...
✅ ElevenLabs connection successful
Testing ElevenLabs voice...
✅ Voice configuration valid
============================================================
📊 Test Results Summary
============================================================
asterisk       : ✅ PASSED
elevenlabs     : ✅ PASSED
voice          : ✅ PASSED

🎉 All tests passed! You are ready to start the application.
```

## ✅ Step 7: (Optional) List Available Voices

Jika ingin menggunakan voice lain:

```bash
node test/listVoices.js
```

Copy Voice ID yang Anda suka dan update di `.env`:

```env
ELEVENLABS_VOICE_ID=<voice_id_yang_dipilih>
```

## ✅ Step 8: Run Application

```bash
# Development mode (auto-reload on code changes)
npm run dev

# Atau production mode
npm start
```

**Output yang diharapkan:**

```
============================================================
🚀 Starting ElevenLabs-Asterisk Voice Agent
============================================================
📡 Connecting to Asterisk ARI
✅ Connected to Asterisk ARI
📞 Listening for calls on Stasis app: elevenlabs-agent
============================================================
```

## ✅ Step 9: Test dengan Call

1. Telepon ke nomor/extension yang sudah di-configure (misalnya 123)
2. Call harus di-answer otomatis
3. Anda akan mendengar greeting dari ElevenLabs
4. Coba tekan DTMF:
   - `1` → Menu informasi
   - `2` → Menu dukungan
   - `#` → Keluar

## 📹 Architecture Flow

```
┌─────────────┐           ┌─────────────┐           ┌─────────────┐
│   Caller    │──SIP/IAX─→│  Asterisk   │◄──ARI────►│  Node.js    │
│  (Phone)    │           │   Ubuntu    │  HTTP/WS  │  (Mac Dev)  │
└─────────────┘           └─────────────┘           └──────┬──────┘
                                                            │
                                                         HTTPS
                                                            │
                                                            ▼
                                                  ┌─────────────────┐
                                                  │  ElevenLabs API │
                                                  │     (Cloud)     │
                                                  └─────────────────┘
```

## 🔍 Troubleshooting

### Error: "Failed to connect to Asterisk ARI"

**Solusi:**
1. Check Asterisk service running: `sudo systemctl status asterisk`
2. Check ARI enabled: `sudo asterisk -rx "ari show status"`
3. Check firewall allows port 8088
4. Verify credentials di `.env` match `/etc/asterisk/ari.conf`

### Error: "ElevenLabs connection failed"

**Solusi:**
1. Verify API key valid di https://elevenlabs.io/app/settings/api-keys
2. Check internet connection dari Mac
3. Check quota/credits tersedia di ElevenLabs account

### Call masuk tapi tidak ada audio

**Solusi:**
1. Check FFmpeg installed: `ffmpeg -version`
2. Check permissions direktori `/tmp/elevenlabs-audio/`
3. Check logs di `logs/error.log`
4. Pastikan Asterisk bisa read audio files dari temp directory

### Application crash on playback

**Solusi:**
1. Check audio format compatibility
2. Try ubah `ASTERISK_AUDIO_FORMAT` di `.env` ke `ulaw` atau `alaw`
3. Check FFmpeg conversion logs

## 🎯 Next Steps

Setelah basic setup berhasil, Anda bisa:

1. **Customize Menu** - Edit `src/asterisk/callHandler.js`
2. **Add Conversational AI** - Enable 2-way conversation dengan WebSocket
3. **Deploy to Production** - Pindahkan Node.js app ke server
4. **Add Database** - Store call logs, conversations, dll
5. **Implement Authentication** - Secure dengan PIN/password

## 💡 Pro Tips

### Development Workflow

```bash
# Terminal 1: Watch logs
tail -f logs/combined.log

# Terminal 2: Run app
npm run dev

# Terminal 3: Test
# (make test calls)
```

### Production Deployment

Untuk production, sebaiknya Node.js app juga di-deploy ke server (bisa server yang sama dengan Asterisk):

```bash
# Di server Ubuntu
cd /opt/
git clone <your-repo>
cd elevenlabs-asterisk-agent
npm install --production
cp .env.example .env
nano .env  # Edit sesuai environment

# Run dengan PM2
npm install -g pm2
pm2 start src/app.js --name elevenlabs-agent
pm2 save
pm2 startup
```

---

**Selamat! 🎉** 

Anda sudah berhasil setup ElevenLabs-Asterisk Voice Agent.

Untuk pertanyaan atau masalah, check logs di `logs/` directory.
