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

      // 5. Store session info
      const session = {
        sessionId,
        conversationId,
        websocket: ws,
        userChannel,
        externalMediaChannel,
        conversationId: null,
        userChannel,
        externalMediaChannel,
        bridge,
        isAgentSpeaking: false, // Track agent speech state
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
    // Handle incoming audio from Asterisk (via RTP)
    this.rtpServer.on('audio', (sid, pcm8k, rawPayload, rms) => {
      if (sid !== sessionId) return;

      // Barge-In / Interruption Logic
      // If agent is speaking but user speaks loudly (RMS > Threshold), stop agent and let user through
      const BARGE_IN_THRESHOLD = parseInt(process.env.BARGE_IN_THRESHOLD) || 2000;
      
      if (session.isAgentSpeaking) {
        if (rms > BARGE_IN_THRESHOLD) {
           logger.info('🗣️ Barge-in detected! Stopping playback.', { sessionId, rms });
           
           // 1. Clear Playback Buffer (Stop agent voice immediately)
           session.audioBuffer = Buffer.alloc(0);
           session.isPlaying = false;
           session.isAgentSpeaking = false; 

           // 2. Send explicit interrupt (optional, but ensures ElevenLabs stops generating)
           // Sending audio usually triggers it, but we want to be sure.
        } else {
           // User is silent/background noise -> Ignore (Half-Duplex)
           return;
        }
      }

      const audioMode = config.elevenlabs.audioMode || 'pcm_16000';

      // Always Upsample 8kHz → 16kHz for ElevenLabs Input
      // (ElevenLabs works best with PCM 16k input, even if output is μ-law)
      const pcm16k = upsample8to16(pcm8k);
      const base64Audio = pcm16k.toString('base64');
      const outputBytes = pcm16k.length;

      // Send to ElevenLabs via WebSocket
      if (websocket && websocket.readyState === 1) {
        websocket.send(JSON.stringify({
          user_audio_chunk: base64Audio,
        }));

        logger.debug('Audio sent to ElevenLabs', {
          sessionId,
          mode: audioMode,
          inputBytes: pcm8k.length,
          outputBytes: outputBytes,
        });
      }
    });
  }

  /**
   * Setup WebSocket event handlers for ElevenLabs
   */
  setupWebSocketHandlers(session) {
    const { websocket, sessionId } = session;
    let { conversationId } = session;

    // Helper: Sequential Playback with Drift Correction
    const startPlayback = (session, rtpServer) => {
        session.isPlaying = true;
        session.isAgentSpeaking = true;
        
        let offset = 0;
        let packetCount = 0;
        const CHUNK_SIZE = 320; // 20ms @ 8kHz
        const PACKET_INTERVAL = 20;
        const startTime = Date.now();

        const sendNextChunk = () => {
             // Check if we have enough data left
             if (!session.audioBuffer || offset + CHUNK_SIZE > session.audioBuffer.length) {
                 // Buffer underrun or end of stream
                 // Remove played portion
                 if (session.audioBuffer) {
                    session.audioBuffer = session.audioBuffer.slice(offset);
                 }
                 
                 if (!session.audioBuffer || session.audioBuffer.length === 0) {
                     logger.debug('Playback queue drained/complete', { sessionId: session.sessionId });
                     session.isPlaying = false;
                     session.isAgentSpeaking = false; 
                     return;
                 }
                 
                 session.isPlaying = false;
                 session.isAgentSpeaking = false; 
                 return;
             }

             const chunk = session.audioBuffer.slice(offset, offset + CHUNK_SIZE);
             rtpServer.sendAudio(session.sessionId, chunk);
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

        // Update conversation ID from ElevenLabs if provided
        if (message.conversation_initiation_metadata_event?.conversation_id) {
          const realConversationId = message.conversation_initiation_metadata_event.conversation_id;
          
          logger.info('🔄 Updating conversation ID from ElevenLabs', {
            oldId: conversationId,
            newId: realConversationId,
          });
          
          conversationId = realConversationId;
          session.conversationId = realConversationId;
        }

        // Handle audio from ElevenLabs
        if (message.audio_event?.audio_base_64) {
          // Handle audio based on configured mode
          const audioMode = config.elevenlabs.audioMode || 'pcm_16000';
          let pcm8k;

          if (audioMode === 'ulaw_8000') {
            // Case: ulaw_8000 (raw μ-law bytes)
            // Need to decode to PCM 8kHz because rtpServer expects PCM input (it re-encodes)
            // TODO: Optimization - Add rtpServer.sendRawAudio() to avoid decode/encode cycle
             const ulawData = Buffer.from(message.audio_event.audio_base_64, 'base64');
             const decoded = alawmulaw.mulaw.decode(ulawData);
             pcm8k = Buffer.from(decoded.buffer);
          } else {
             // Case: pcm_16000 (PCM 16kHz)
             // Default behavior: Downsample 16kHz → 8kHz
             const pcm16k = Buffer.from(message.audio_event.audio_base_64, 'base64');
             pcm8k = downsample16to8(pcm16k);
          }

          // Append to session audio buffer
          if (!session.audioBuffer) {
            session.audioBuffer = Buffer.alloc(0);
          }
          session.audioBuffer = Buffer.concat([session.audioBuffer, pcm8k]);
          
          // Start playback if not running
          if (!session.isPlaying) {
             startPlayback(session, this.rtpServer);
          }

          logger.info('🎵 Audio buffered', {
            sessionId,
            addedBytes: pcm8k.length,
            totalBuffered: session.audioBuffer.length,
            isPlaying: session.isPlaying
          });
        }

        // Handle agent response text
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
      logger.error('WebSocket error', {
        error: error.message,
        sessionId,
      });
    });

    websocket.on('close', (code, reason) => {
      logger.warn('WebSocket connection closed', {
        sessionId,
        code,
        reason: reason.toString(),
      });
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
        
        // Close WebSocket
        if (session.websocket && session.websocket.readyState === 1) {
          session.websocket.close();
        }

        // End ElevenLabs conversation
        endConversation(session.conversationId);

        // Close RTP session
        this.rtpServer.closeSession(sessionId);

        // Remove from active sessions
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
