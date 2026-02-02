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
 * Calculate RMS (Root Mean Square) of PCM audio buffer
 * Used for simple silence detection and barge-in
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
 * Handles bidirectional audio streaming via RTP ExternalMedia
 */
class RTPBridge {
  constructor(rtpServer) {
    this.rtpServer = rtpServer;
    this.activeSessions = new Map(); // sessionId -> { conversation, websocket, channel }
  }

  /**
   * Create RTP bridge for conversation
   */
  async createBridge(client, userChannel, agentId) {
    try {
      logger.info('Creating RTP bridge', {
        channelId: userChannel.id,
        agentId,
      });

      // 1. Create ElevenLabs conversation with WebSocket
      const conversation = await createConversation(agentId);
      const ws = conversation.websocket;
      let conversationId = conversation.conversation_id;

      logger.success('ElevenLabs conversation created', {
        conversationId,
      });

      // 2. Create RTP session
      const { sessionId, localPort } = await this.rtpServer.createSession();

      logger.success('RTP session created', {
        sessionId,
        localPort,
      });

      // 3. Create ExternalMedia channel
      const externalMediaChannel = await client.Channel().externalMedia({
        app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
        external_host: `127.0.0.1:${localPort}`,
        format: 'ulaw', // PCMU codec
        channelId: `rtp-external-${uuidv4()}`,
        variables: {
          RTP_SESSION_ID: sessionId,
        },
      });

      logger.success('ExternalMedia channel created', {
        channelId: externalMediaChannel.id,
        sessionId,
      });

      // 4. Create bridge and add both channels
      const bridge = await client.Bridge().create({
        type: 'mixing',
        name: `rtp-bridge-${sessionId}`,
      });

      await bridge.addChannel({ channel: [userChannel.id, externalMediaChannel.id] });

      logger.success('Channels bridged', {
        bridgeId: bridge.id,
        channels: [userChannel.id, externalMediaChannel.id],
      });

      // 5. Store session info - Simplified State for Low Latency
      const session = {
        sessionId,
        conversationId,
        websocket: ws,
        userChannel,
        externalMediaChannel,
        isAgentSpeaking: false,
        isPlaying: false, 
        lastAgentAudioTime: 0,
        peakAgentRMS: 0, 
        currentAgentRMS: 0,
        playbackInterrupted: false,
        audioBuffer: Buffer.alloc(0),
        isClosed: false,
      };

      this.activeSessions.set(sessionId, session);

      // 6. Setup RTP audio handlers
      this.setupRTPHandlers(session);

      // 7. Setup WebSocket handlers
      this.setupWebSocketHandlers(session);

      logger.success('RTP bridge created successfully', {
        sessionId,
        conversationId,
      });

      return session;
    } catch (error) {
      logger.error('Failed to create RTP bridge', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Setup RTP audio event handlers
   */
  setupRTPHandlers(session) {
    const { sessionId, websocket } = session;

    // Handle incoming audio from Asterisk (via RTP)
    this.rtpServer.on('audio', (sid, pcm8k, rawPayload, rms) => {
      if (sid !== sessionId) return;

      // === ZERO-LATENCY DYNAMIC GATE ===
      
      const audioMode = config.elevenlabs.audioMode || 'pcm_16000';
      const ECHO_WINDOW = 1000; // 1 second echo tail protection
      
      // Calculate Dynamic Threshold
      let referenceRMS = 0;
      const timeSinceOutput = Date.now() - session.lastAgentAudioTime;

      if (session.isAgentSpeaking) {
          // While speaking, use current volume (or peak to be safe)
          referenceRMS = Math.max(session.currentAgentRMS, session.peakAgentRMS);
      } else if (timeSinceOutput < ECHO_WINDOW) {
          // In the echo tail window, maintain the peak threshold
          // This ensures delayed loud echoes are still blocked
          referenceRMS = session.peakAgentRMS;
      } else {
          // Safe silence
          referenceRMS = 0;
      }

      // Base threshold 800 (silence), max threshold proportional to Echo
      // Echo Factor 0.8: We expect echo to be weaker than original, but we set threshold high to be safe.
      const dynamicThreshold = Math.max(800, referenceRMS * 0.8);

      if (rms < dynamicThreshold) {
           return; // Block Echo/Silence
      }
      
      // If we are here, it's LOUD enough to be user input (Barge-In)
      if (session.isAgentSpeaking || timeSinceOutput < ECHO_WINDOW) {
          // Logic for interruption
          session.audioBuffer = Buffer.alloc(0);
          session.isPlaying = false;
          session.isAgentSpeaking = false;
          session.playbackInterrupted = true;
          // outputHistory is removed, no need to clear
      }

      // 2. Silence Filter
      if (rms < 150) return;

      // 3. Fast Forward
      // Use raw packet if possible, but EL needs 16kHz
      const pcm16k = upsample8to16(pcm8k);
      const base64Audio = pcm16k.toString('base64');

      if (websocket && websocket.readyState === 1) {
        websocket.send(JSON.stringify({
          user_audio_chunk: base64Audio,
        }));
      }
    });
  }

  /**
   * Setup WebSocket event handlers for ElevenLabs
   */
  setupWebSocketHandlers(session) {
    const { websocket, sessionId } = session;
    let { conversationId } = session;

    const startPlayback = (session, rtpServer) => {
        session.isPlaying = true;
        session.isAgentSpeaking = true;
        session.peakAgentRMS = 0; // Reset peak for new utterance
        
        let offset = 0;
        let packetCount = 0;
        const CHUNK_SIZE = 320; // 20ms @ 8kHz
        const PACKET_INTERVAL = 20;
        const startTime = Date.now();

        const sendNextChunk = () => {
             if (session.isClosed) return;

             // Buffer underrun check
             if (!session.audioBuffer || offset + CHUNK_SIZE > session.audioBuffer.length) {
                 if (session.audioBuffer) {
                    session.audioBuffer = session.audioBuffer.slice(offset);
                 }
                 
                 // Queue empty?
                 if (!session.audioBuffer || session.audioBuffer.length === 0) {
                     session.isPlaying = false;
                     session.isAgentSpeaking = false; 
                     return;
                 }
                 
                 // Stop state
                 session.isPlaying = false;
                 session.isAgentSpeaking = false; 
                 return;
             }

             const chunk = session.audioBuffer.slice(offset, offset + CHUNK_SIZE);
             
             // Dynamic Threshold Update
             const chunkRMS = calculateRMS(chunk);
             session.currentAgentRMS = chunkRMS;
             session.peakAgentRMS = Math.max(session.peakAgentRMS, chunkRMS);

             rtpServer.sendAudio(session.sessionId, chunk);
             
             // Update State
             session.lastAgentAudioTime = Date.now();
             session.isAgentSpeaking = true;
             
             offset += CHUNK_SIZE;
             packetCount++;

             // Drift correction
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
          conversationId = message.conversation_initiation_metadata_event.conversation_id;
          session.conversationId = conversationId;
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

          if (!session.audioBuffer) {
            session.audioBuffer = Buffer.alloc(0);
          }
          session.audioBuffer = Buffer.concat([session.audioBuffer, pcm8k]);
          
          if (!session.isPlaying) {
             startPlayback(session, this.rtpServer);
          }
        }

        if (message.agent_response_event?.agent_response) {
          logger.info('💬 Agent response', {
            sessionId,
            response: message.agent_response_event.agent_response,
          });
        }

      } catch (error) {
        logger.error('Error processing WebSocket message', {
          error: error.message,
          sessionId,
        });
      }
    });

    websocket.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message, sessionId });
    });

    websocket.on('close', (code, reason) => {
      logger.warn('WebSocket closed', { sessionId, code });
    });
  }

  /**
   * Cleanup session
   */
  async cleanup(channelId) {
    logger.info('Cleaning up RTP bridge', { channelId });

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.userChannel.id === channelId || 
          session.externalMediaChannel.id === channelId) {
        
        if (session.websocket && session.websocket.readyState === 1) {
          session.websocket.close();
        }

        endConversation(session.conversationId);

        session.isClosed = true;
        session.isPlaying = false;

        this.rtpServer.closeSession(sessionId);
        this.activeSessions.delete(sessionId);

        logger.success('RTP bridge cleaned up', { channelId, sessionId });
        return;
      }
    }

    logger.warn('No RTP bridge found for channel', { channelId });
  }

  /**
   * Shutdown all sessions
   */
  async shutdown() {
    logger.info('Shutting down RTP bridge');

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.websocket) {
        session.websocket.close();
      }
      endConversation(session.conversationId);
      this.rtpServer.closeSession(sessionId);
    }

    this.activeSessions.clear();
    logger.success('RTP bridge shutdown complete');
  }
}

module.exports = RTPBridge;
