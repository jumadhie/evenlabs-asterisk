const { v4: uuidv4 } = require('uuid');
const logger = require('../../../utils/logger');
const config = require('../../../config/config');
const alawmulaw = require('alawmulaw');
const { createConversation, endConversation } = require('../elevenlabs');

/**
 * Audio sample rate conversion utilities
 */
function upsample8to16(pcm8k) {
  const pcm16k = Buffer.alloc(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm8k.readInt16LE(i * 2);
    pcm16k.writeInt16LE(sample, i * 4);
    pcm16k.writeInt16LE(sample, i * 4 + 2); // Duplicate sample
  }
  return pcm16k;
}

function downsample16to8(pcm16k) {
  // Ensure we only process complete 4-byte sample pairs
  const samplePairs = Math.floor(pcm16k.length / 4);
  const pcm8k = Buffer.alloc(samplePairs * 2);
  for (let i = 0; i < samplePairs; i++) {
    const sample = pcm16k.readInt16LE(i * 4);
    pcm8k.writeInt16LE(sample, i * 2);
  }
  return pcm8k;
}

/**
 * Calculate RMS (Root Mean Square) for Dynamic Threshold
 */
function calculateRMS(pcmBuffer) {
    let sum = 0;
    for (let i = 0; i < pcmBuffer.length; i += 2) {
        if (i + 1 >= pcmBuffer.length) break;
        const sample = pcmBuffer.readInt16LE(i);
        sum += sample * sample;
    }
    return Math.sqrt(sum / (pcmBuffer.length / 2));
}

/**
 * RTP Bridge for ElevenLabs Conversational AI
 * ARCHITECTURE: Mixing Bridge + Dynamic Threshold (Peak Hold)
 * 
 * Reverted to Mixing Bridge because 'Snoop' API is unavailable in this ARI client version.
 * Implements "Peak Hold" software logic to solve racing/echo.
 */
class RTPBridge {
  constructor(rtpServer) {
    this.rtpServer = rtpServer;
    this.activeSessions = new Map(); // sessionId -> session
  }

  /**
   * Create RTP bridge for conversation
   */
  async createBridge(client, userChannel, agentId) {
    try {
      logger.info('Creating RTP bridge (Dynamic Mixed Mode)', {
        channelId: userChannel.id,
        agentId,
      });

      // 1. Create ElevenLabs conversation
      const conversation = await createConversation(agentId);
      const ws = conversation.websocket;
      let conversationId = conversation.conversation_id;

      // 2. Create RTP session
      const { sessionId, localPort } = await this.rtpServer.createSession();

      // 3. Create ExternalMedia channel
      const externalMediaChannel = await client.Channel().externalMedia({
        app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
        external_host: `127.0.0.1:${localPort}`,
        format: 'ulaw',
        channelId: `rtp-ext-${uuidv4()}`,
      });

      // 4. Create mixing bridge
      const bridge = await client.Bridge().create({ type: 'mixing', name: `bridge-${sessionId}` });
      await bridge.addChannel({ channel: [userChannel.id, externalMediaChannel.id] });

      logger.success('Bridge created', { sessionId, bridgeId: bridge.id });

      // 5. Store session info
      const session = {
        sessionId,
        conversationId,
        websocket: ws,
        userChannel,
        externalMediaChannel,
        mediaBridge: bridge,
        
        // State
        audioBuffer: Buffer.alloc(0),
        isPlaying: false,
        isAgentSpeaking: false,
        isClosed: false,
        
        // Dynamic Threshold State
        lastAgentAudioTime: 0,
        currentAgentRMS: 0,
        peakAgentRMS: 0,
        playbackInterrupted: false
      };

      this.activeSessions.set(sessionId, session);

      // 6. Setup Handlers
      this.setupRTPHandlers(session);
      this.setupWebSocketHandlers(session);

      return session;

    } catch (error) {
      logger.error('Failed to create RTP bridge', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  setupRTPHandlers(session) {
    const { sessionId, websocket } = session;

    this.rtpServer.on('audio', (sid, pcm8k, rawPayload, rms) => {
      if (sid !== sessionId) return;

      // === DYNAMIC THRESHOLD LOGIC (PEAK HOLD) ===
      // Solves "Racing" (Echo) vs "Unresponsive" (Blocked User)
      
      const ECHO_WINDOW_MS = 1000; // 1 second echo tail
      const MIN_THRESHOLD = 800; // Sensitive for silence (was 3000)
      
      let dynamicThreshold = MIN_THRESHOLD;
      const timeSinceOutput = Date.now() - session.lastAgentAudioTime;
      
      if (session.isAgentSpeaking) {
          // While agent speaks: Threshold = 80% of current output
          // Effectively blocks self-echo
          dynamicThreshold = Math.max(MIN_THRESHOLD, session.currentAgentRMS * 0.8);
          // Also update peak for the echo tail
          session.peakAgentRMS = Math.max(session.peakAgentRMS, session.currentAgentRMS);
      } else if (timeSinceOutput < ECHO_WINDOW_MS) {
          // Echo Tail: Threshold = 80% of PEAK output during utterance
          dynamicThreshold = Math.max(MIN_THRESHOLD, session.peakAgentRMS * 0.8);
      } else {
          // Silence: High sensitivity
          dynamicThreshold = MIN_THRESHOLD;
      }
      
      // Safety Cap: Don't let threshold go impossible high (e.g. scream level)
      // Allow user to barge-in if they yell (RMS > 4000) regardless of echo
      if (dynamicThreshold > 4000) dynamicThreshold = 4000;

      // DECISION:
      if (rms < dynamicThreshold) {
          // Block (Echo or Silence)
          return;
      }

      // If we are here, User is speaking (Barge-In)
      if (session.isAgentSpeaking || timeSinceOutput < ECHO_WINDOW_MS) {
          if (!session.playbackInterrupted) {
             logger.info('🗣️ Barge-In Detected', { rms, threshold: dynamicThreshold });
             session.audioBuffer = Buffer.alloc(0); // Stop agent
             session.isPlaying = false;
             session.isAgentSpeaking = false;
             session.playbackInterrupted = true;
          }
      }

      // Send to ElevenLabs
      if (websocket && websocket.readyState === 1) {
          const pcm16k = upsample8to16(pcm8k);
          const base64Audio = pcm16k.toString('base64');
          websocket.send(JSON.stringify({ user_audio_chunk: base64Audio }));
      }
    });
  }

  setupWebSocketHandlers(session) {
    const { websocket, sessionId } = session;

    const startPlayback = () => {
        session.isPlaying = true;
        session.isAgentSpeaking = true;
        session.peakAgentRMS = 0; // Reset peak for new utterance
        session.playbackInterrupted = false;

        let offset = 0;
        const CHUNK_SIZE = 320; 
        const PACKET_INTERVAL = 20;
        const startTime = Date.now();
        let packetCount = 0;

        const sendNextChunk = () => {
             if (session.isClosed) return;

             if (!session.audioBuffer || offset + CHUNK_SIZE > session.audioBuffer.length) {
                 // Check if actually empty or just waiting for stream
                 if (session.audioBuffer && offset < session.audioBuffer.length) {
                     session.audioBuffer = session.audioBuffer.slice(offset);
                 } else {
                     session.audioBuffer = Buffer.alloc(0);
                 }
                 
                 if (session.audioBuffer.length === 0) {
                     session.isPlaying = false;
                     session.isAgentSpeaking = false;
                     return;
                 }
                 
                 session.isPlaying = false;
                 session.isAgentSpeaking = false;
                 return;
             }

             const chunk = session.audioBuffer.slice(offset, offset + CHUNK_SIZE);
             
             // TRACK OUTPUT VOLUME
             const outputRMS = calculateRMS(chunk);
             session.currentAgentRMS = outputRMS;
             if (outputRMS > session.peakAgentRMS) session.peakAgentRMS = outputRMS;
             
             this.rtpServer.sendAudio(session.sessionId, chunk);
             
             // State Update
             session.lastAgentAudioTime = Date.now();
             
             offset += CHUNK_SIZE;
             packetCount++;

             const elapsed = Date.now() - startTime;
             const targetTime = packetCount * PACKET_INTERVAL;
             const delay = Math.max(0, targetTime - elapsed);
             
             setTimeout(sendNextChunk, delay);
        };

        sendNextChunk();
    };

    websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        if (message.conversation_initiation_metadata_event?.conversation_id) {
            session.conversationId = message.conversation_initiation_metadata_event.conversation_id;
        }

        if (message.audio_event?.audio_base_64) {
             const audioMode = config.elevenlabs.audioMode || 'pcm_16000';
             let pcm8k; 

             if (audioMode === 'ulaw_8000') {
                 const ulawData = Buffer.from(message.audio_event.audio_base_64, 'base64');
                 const decoded = alawmulaw.mulaw.decode(ulawData);
                 pcm8k = Buffer.from(decoded.buffer);
             } else {
                 const pcm16k = Buffer.from(message.audio_event.audio_base_64, 'base64');
                 pcm8k = downsample16to8(pcm16k);
             }

             if (!session.audioBuffer) session.audioBuffer = Buffer.alloc(0);
             session.audioBuffer = Buffer.concat([session.audioBuffer, pcm8k]);
             
             if (!session.isPlaying) startPlayback();
        }
      } catch (e) {
          logger.error('WS Error', { error: e.message });
      }
    });
    
    websocket.on('close', () => logger.warn('ElevenLabs WS Closed', { sessionId }));
  }

  async cleanup(channelId) {
    logger.info('Cleaning up Bridge', { channelId });
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.userChannel.id === channelId || session.externalMediaChannel.id === channelId) {
         if (session.websocket) session.websocket.close();
         if (session.conversationId) endConversation(session.conversationId);
         this.rtpServer.closeSession(sessionId);
         this.activeSessions.delete(sessionId);
         session.isClosed = true;
         // Channels usually auto-hangup
         try { await session.mediaBridge.destroy(); } catch(e) {}
         return;
      }
    }
  }

  async shutdown() {
      this.activeSessions.clear();
  }
}

module.exports = RTPBridge;
