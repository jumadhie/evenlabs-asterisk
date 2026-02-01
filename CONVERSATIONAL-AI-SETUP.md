# Conversational AI Setup Guide

## 🎤 What's New

Your voice agent now supports **real-time conversational AI** powered by ElevenLabs! Instead of pre-scripted responses, users can have natural, flowing conversations with your AI agent.

## 🎯 Modes Available

### **TTS Mode** (Default - Simple)
- Pre-defined text responses
- DTMF menu navigation
- Best for: IVR, announcements, simple menus

### **Conversational AI Mode** (Advanced - Recommended)
- Real-time AI conversation
- Natural language understanding
- Voice-to-voice interaction
- Best for: Customer support, virtual assistants

## 📝 Setup

### 1. Configure Mode

Edit `.env`:

```bash
# Switch to Conversational AI mode
VOICE_AGENT_MODE=conversational_ai

# Your ElevenLabs Agent ID (from dashboard)
ELEVENLABS_AGENT_ID=agent_8301kgcrb3tbe0xaxa3kj2m3r39j

# RTP server settings (usually don't need to change)
EXTERNAL_MEDIA_HOST=0.0.0.0
EXTERNAL_MEDIA_PORT=10000
```

### 2. Verify Agent Configuration

1. Go to https://elevenlabs.io/app/conversational-ai
2. Click your agent ("Support agent")
3. Copy the Agent ID
4. Paste into `.env` as `ELEVENLABS_AGENT_ID`

### 3. Deploy to Server

```bash
# On Mac
cd /Users/kibo/Project/eventlabs.my.id/elevenlabs-asterisk-agent
tar -czf ~/Desktop/convai-update.tar.gz src/ .env package.json

# Copy to server
scp ~/Desktop/convai-update.tar.gz root@192.168.50.2:/home/kibo/aplikasi/evenslabs/

# On Server
ssh root@192.168.50.2
cd /home/kibo/aplikasi/evenslabs
tar -xzf convai-update.tar.gz
rm convai-update.tar.gz

# Start app
npm start
```

### 4. Firewall Configuration

**On Ubuntu server, open RTP port:**

```bash
# Allow RTP port for audio streaming
sudo ufw allow 10000/udp
sudo ufw reload
```

## 🧪 Testing

### 1. Start Application

**On server:**

```bash
cd /home/kibo/aplikasi/evenslabs
npm start
```

**Expected output:**

```
🚀 Starting ElevenLabs-Asterisk Voice Agent
Configuration:
  mode: CONVERSATIONAL_AI
  
✅ Connected to Asterisk ARI
📞 Listening for calls on Stasis app: elevenlabs-agent
```

### 2. Make Test Call

1. Dial `*123` from your softphone
2. Wait for connection
3. **Start talking naturally!**

**Example conversation:**

```
User: "Hello, I need help with my order"
AI: "I'd be happy to help you with your order! Could you please provide your order number?"
User: "It's order 12345"
AI: "Thank you! Let me look that up for you..."
```

### 3. Monitor Logs

**Expected logs:**

```
📞 Incoming call (Conversational AI mode)
✅ Call answered
🎤 ElevenLabs conversation created
  conversationId: conv_xxxxx
✅ Asterisk bridge created
✅ RTP server listening
  port: 10000
✅ Conversational AI session started
🔊 Audio sent to ElevenLabs
🔉 Audio sent to Asterisk
```

## 🎛️ Advanced Configuration

### Switching Between Modes

**Switch to TTS mode:**

```bash
# Edit .env
VOICE_AGENT_MODE=tts

# Restart app
npm start
```

**Switch to ConvAI mode:**

```bash
# Edit .env
VOICE_AGENT_MODE=conversational_ai

# Restart app
npm start
```

### Deployment with PM2

```bash
# Install PM2
sudo npm install -g pm2

# Start in ConvAI mode
pm2 start src/app.js --name elevenlabs-agent

# View logs
pm2 logs elevenlabs-agent

# Restart
pm2 restart elevenlabs-agent

# Stop
pm2 stop elevenlabs-agent
```

## 🐛 Troubleshooting

### No Audio During Call

**Check RTP port:**

```bash
# On server
sudo netstat -ulpn | grep 10000
# Should show Node.js listening on port 10000
```

**Check UFW:**

```bash
sudo ufw status | grep 10000
# Should show: 10000/udp ALLOW Anywhere
```

### WebSocket Connection Failed

**Verify Agent ID:**

```bash
# Check .env
cat .env | grep ELEVENLABS_AGENT_ID

# Test API
curl https://api.elevenlabs.io/v1/convai/agents \
  -H "xi-api-key: YOUR_API_KEY"
```

### ExternalMedia Channel Error

**Check Asterisk version:**

```bash
sudo asterisk -rx "core show version"
# ExternalMedia requires Asterisk 13+
```

**Check ARI support:**

```bash
sudo asterisk -rx "ari show apps"
# Should list: elevenlabs-agent
```

## 📊 Performance Tips

1. **Low latency**: Use server with good internet connection
2. **Audio quality**: Ensure 16kHz audio support in Asterisk
3. **Concurrent calls**: Each call uses ~100kbps bandwidth

## 🔒 Security

- RTP port (10000) should be firewalled to known IPs
- Use TLS for WebSocket in production
- Rotate ElevenLabs API keys regularly

## 📞 Support

**Common Issues:**

| Issue | Solution |
|-------|----------|
| No AI response | Check Agent ID in .env |
| Audio choppy | Check network latency |
| Call drops | Check Asterisk channel limit |
| WebSocket error | Verify API key valid |

## ✅ Success Checklist

- [ ] Agent ID configured in .env
- [ ] Mode set to `conversational_ai`
- [ ] Port 10000/udp open in firewall
- [ ] App running on server
- [ ] Test call successful
- [ ] Can hear AI agent
- [ ] AI can hear user
- [ ] Conversation flows naturally

---

**Enjoy your AI-powered voice agent!** 🎉
