# ElevenLabs-Asterisk Voice Agent

Integrasi voice agent antara Asterisk PBX dan ElevenLabs AI untuk membuat sistem IVR yang natural menggunakan text-to-speech berkualitas tinggi.

## 🎯 Fitur

- ✅ Integrasi Asterisk ARI (Asterisk REST Interface)
- ✅ Text-to-Speech menggunakan ElevenLabs API
- ✅ Support multiple voices dan bahasa (termasuk Bahasa Indonesia)
- ✅ DTMF menu system
- ✅ Audio conversion otomatis (MP3 → SLIN/ULAW/ALAW)
- ✅ Logging komprehensif dengan Winston
- ✅ Error handling dan auto-reconnect
- ✅ Ready untuk Conversational AI (2-way conversation)

## 📋 Prerequisites

### Software yang Diperlukan

1. **Node.js** >= 18.0.0
2. **Asterisk** >= 16.0 dengan ARI enabled
3. **FFmpeg** untuk audio conversion
4. **ElevenLabs API Key** ([Daftar di sini](https://elevenlabs.io))

### Install FFmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Check installation
ffmpeg -version
```

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
cd /Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent
npm install
```

### 2. Konfigurasi Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env dengan editor favorit
nano .env
```

**Minimal configuration yang diperlukan:**

```env
# Asterisk Configuration
ASTERISK_HOST=http://YOUR_ASTERISK_IP:8088
ASTERISK_USERNAME=your_ari_user
ASTERISK_PASSWORD=your_ari_password
ASTERISK_APP_NAME=elevenlabs-agent

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### 3. Konfigurasi Asterisk

#### `/etc/asterisk/ari.conf`:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins = *

[your_ari_user]
type = user
read_only = no
password = your_secure_password
```

#### `/etc/asterisk/http.conf`:

```ini
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
```

#### `/etc/asterisk/extensions.conf`:

```ini
[from-trunk]
exten => _X.,1,NoOp(Incoming Call - ElevenLabs Agent)
  same => n,Stasis(elevenlabs-agent)
  same => n,Hangup()
```

**Reload Asterisk:**

```bash
asterisk -rx "module reload res_ari"
asterisk -rx "module reload res_http"
asterisk -rx "dialplan reload"
```

### 4. Test Connections

```bash
# Test koneksi ke Asterisk dan ElevenLabs
npm run test:connection
```

Output yang diharapkan:
```
✅ Asterisk connection successful
✅ ElevenLabs connection successful
✅ Voice configuration valid
🎉 All tests passed!
```

### 5. Run Application

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

## 📱 Testing

### Manual Test Call

1. Pastikan aplikasi sudah running
2. Telepon ke nomor yang di-route ke dialplan `Stasis(elevenlabs-agent)`
3. Dengarkan greeting dari ElevenLabs
4. Tekan:
   - `1` untuk menu informasi
   - `2` untuk menu dukungan
   - `#` untuk keluar

### Utility Scripts

```bash
# List available voices
node test/listVoices.js

# Test specific connection
npm run test:connection
```

## 📁 Struktur Project

```
elevenlabs-asterisk-agent/
├── src/
│   ├── app.js                    # Main application
│   ├── config/
│   │   └── config.js             # Configuration management
│   ├── asterisk/
│   │   ├── ariClient.js          # ARI connection handler
│   │   └── callHandler.js        # Call event handlers
│   ├── elevenlabs/
│   │   ├── tts.js                # Text-to-Speech API
│   │   └── conversationalAI.js   # Conversational AI API
│   └── utils/
│       ├── logger.js             # Logging utility
│       └── audioConverter.js     # Audio format conversion
├── test/
│   ├── testConnection.js         # Connection tests
│   └── listVoices.js             # Voice listing utility
├── logs/                         # Application logs
├── .env                          # Environment variables
└── package.json
```

## 🔧 Configuration Options

### Asterisk Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ASTERISK_HOST` | - | Asterisk server URL with port |
| `ASTERISK_USERNAME` | - | ARI username |
| `ASTERISK_PASSWORD` | - | ARI password |
| `ASTERISK_APP_NAME` | elevenlabs-agent | Stasis app name |
| `ASTERISK_AUDIO_FORMAT` | slin | Audio format (slin/ulaw/alaw) |

### ElevenLabs Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `ELEVENLABS_API_KEY` | - | API key from ElevenLabs |
| `ELEVENLABS_VOICE_ID` | - | Voice ID for TTS |
| `ELEVENLABS_MODEL_ID` | eleven_multilingual_v2 | TTS model |
| `VOICE_STABILITY` | 0.5 | Voice stability (0-1) |
| `VOICE_SIMILARITY_BOOST` | 0.75 | Similarity boost (0-1) |

## 📊 Logging

Logs disimpan di direktori `logs/`:

- `error.log` - Errors saja
- `combined.log` - Semua log events

Console log menggunakan emoji untuk better visibility:
- 📞 Call events - 🎤 ElevenLabs events
- 📡 Asterisk events
- ✅ Success
- ❌ Errors

## 🐛 Troubleshooting

### Connection Refused to Asterisk

```bash
# Check if Asterisk is running
asterisk -rx "core show version"

# Check if ARI is enabled
asterisk -rx "http show status"

# Check if port 8088 is listening
netstat -an | grep 8088
```

### ElevenLabs API Errors

- `401 Unauthorized`: Check API key di `.env`
- `404 Voice not found`: Run `node test/listVoices.js` untuk list voices
- `429 Too many requests`: Rate limit exceeded

### Audio Playback Issues

```bash
# Check FFmpeg installation
ffmpeg -version

# Check audio file permissions
ls -la /tmp/elevenlabs-audio/

# Check Asterisk can read temp directory
asterisk -rx "core show file formats"
```

## 🎓Development Tips

### Extending Call Handler

Edit `src/asterisk/callHandler.js` untuk menambah menu:

```javascript
case '3':
  await playTTS(channel, 'Menu baru Anda', tempFiles);
  break;
```### Changing Voice

```bash
# List available voices
node test/listVoices.js

# Update .env dengan voice ID yang diinginkan
ELEVENLABS_VOICE_ID=new_voice_id_here
```

## 📝 License

MIT

## 🤝 Support

Untuk bantuan lebih lanjut, check:
- [Asterisk ARI Documentation](https://wiki.asterisk.org/wiki/display/AST/Asterisk+REST+Interface)
- [ElevenLabs API Docs](https://elevenlabs.io/docs/api-reference)
