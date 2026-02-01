const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config/config');
const alawmulaw = require('alawmulaw');
const { createConversation, endConversation } = require('../elevenlabs/conversationalAI');

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
    this.rtpServer.on('audio', (sid, pcm8k, rawPayload) => {
      if (sid !== sessionId) return;

      // prevent echo/hallucinations: ignore user audio while agent is speaking
      if (session.isAgentSpeaking) {
        return;
      }

      let base64Audio;
      let outputBytes;

      const audioMode = config.elevenlabs.audioMode || 'pcm_16000';

      if (audioMode === 'ulaw_8000' && rawPayload) {
        // Optimization: Pass raw μ-law directly
        base64Audio = rawPayload.toString('base64');
        outputBytes = rawPayload.length;
      } else {
        // Default: Upsample 8kHz → 16kHz for ElevenLabs PCM
        const pcm16k = upsample8to16(pcm8k);
        base64Audio = pcm16k.toString('base64');
        outputBytes = pcm16k.length;
      }

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

          // Send audio in chunks - 160 bytes per RTP packet (20ms at 8kHz)
          // PCM 8kHz mono 16-bit = 8000 samples/sec * 2 bytes = 16000 bytes/sec
          // 20ms = 160 samples * 2 bytes = 320 bytes of PCM
          const CHUNK_SIZE = 320; // 20ms of PCM at 8kHz 16-bit
          const PACKET_INTERVAL = 20; // 20ms between packets

          let offset = 0;
          let packetCount = 0;

          const sendNextChunk = () => {
            if (offset >= pcm8k.length) {
              logger.debug('Audio playback complete', {
                sessionId,
                totalPackets: packetCount,
              });
              // Set speaking state OFF after playback
              session.isAgentSpeaking = false;
              return;
            }

            const chunk = pcm8k.slice(offset, offset + CHUNK_SIZE);
            this.rtpServer.sendAudio(sessionId, chunk);
            offset += CHUNK_SIZE;
            packetCount++;

            // Calculate next scheduled time to compensate for drift
            const elapsed = Date.now() - startTime;
            const targetTime = packetCount * PACKET_INTERVAL;
            const delay = Math.max(0, targetTime - elapsed);

            setTimeout(sendNextChunk, delay);
          };

          // Start sending audio with drift compensation
          const startTime = Date.now();
          sendNextChunk();

          logger.info('📤 Started audio playback to Asterisk', {
            sessionId,
            totalBytes: pcm8k.length,
            estimatedPackets: Math.ceil(pcm8k.length / CHUNK_SIZE),
            estimatedDuration: Math.ceil(pcm8k.length / CHUNK_SIZE) * PACKET_INTERVAL + 'ms',
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
