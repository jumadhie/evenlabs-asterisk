const logger = require('../utils/logger');
const externalMediaManager = require('./externalMedia');
const { 
  createConversation, 
  connectToConversation,
  endConversation 
} = require('../elevenlabs/conversationalAI');

/**
 * Audio Bridge between Asterisk and ElevenLabs Conversational AI
 */
class AudioBridge {
  constructor() {
    this.activeConnections = new Map();
  }

  /**
   * Create bridge between user channel and ElevenLabs
   * @param {Object} client - ARI client
   * @param {Object} userChannel - User's channel
   * @param {string} agentId - ElevenLabs agent ID
   * @returns {Promise<Object>} - Bridge details
   */
  async createBridge(client, userChannel, agentId) {
    const bridgeId = `bridge-${userChannel.id}`;
    
    try {
      logger.info('Creating audio bridge', {
        channelId: userChannel.id,
        agentId,
      });

      // 1. Create ElevenLabs conversation (with WebSocket)
      const conversation = await createConversation(agentId);
      const conversationId = conversation.conversation_id;
      const ws = conversation.websocket;

      logger.success('ElevenLabs conversation created', {
        conversationId,
      });

      // 3. Create ExternalMedia channel for RTP
      const externalChannel = await externalMediaManager.createExternalMedia(
        client,
        process.env.EXTERNAL_MEDIA_HOST || '0.0.0.0',
        parseInt(process.env.EXTERNAL_MEDIA_PORT || '10000')
      );

      // 4. Create bridge in Asterisk
      const bridge = await client.Bridge().create({
        type: 'mixing',
        bridgeId: bridgeId,
      });

      logger.success('Asterisk bridge created', {
        bridgeId: bridge.id,
      });

      // 5. Add channels to bridge
      await bridge.addChannel({ channel: userChannel.id });
      await bridge.addChannel({ channel: externalChannel.id });

      logger.success('Channels added to bridge', {
        bridgeId: bridge.id,
        channels: [userChannel.id, externalChannel.id],
      });

      // 6. Setup audio streaming
      const connection = {
        userChannel,
        externalChannel,
        bridge,
        websocket: ws,
        conversationId,
        sequenceNumber: 0,
        timestamp: 0,
      };

      this.activeConnections.set(userChannel.id, connection);

      // Setup bidirectional audio
      await this.setupAudioStreaming(connection);

      return {
        bridgeId: bridge.id,
        conversationId,
        connection,
      };

    } catch (error) {
      logger.failure('Failed to create audio bridge', {
        error: error.message,
        channelId: userChannel.id,
      });
      throw error;
    }
  }

  /**
   * Setup bidirectional audio streaming
   * @param {Object} connection - Connection details
   */
  async setupAudioStreaming(connection) {
    const { websocket, userChannel } = connection;

    logger.info('Setting up bidirectional audio streaming', {
      channelId: userChannel.id,
    });

    // Handle audio FROM Asterisk TO ElevenLabs
    externalMediaManager.onAudioReceived((audioData, rinfo) => {
      // Store RTP endpoint for sending back
      if (!connection.rtpEndpoint) {
        connection.rtpEndpoint = {
          address: rinfo.address,
          port: rinfo.port,
        };
        logger.debug('RTP endpoint detected', connection.rtpEndpoint);
      }

      // Send audio to ElevenLabs via WebSocket
      if (websocket.readyState === 1) { // WebSocket.OPEN
        // ElevenLabs expects base64 encoded PCM
        const base64Audio = audioData.toString('base64');
        
        websocket.send(JSON.stringify({
          user_audio_chunk: base64Audio,
        }));

        logger.debug('Audio sent to ElevenLabs', {
          size: audioData.length,
        });
      }
    });

    // Handle audio FROM ElevenLabs TO Asterisk
    websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.audio) {
          // Decode base64 audio from ElevenLabs
          const audioBuffer = Buffer.from(message.audio, 'base64');

          // Send to Asterisk via RTP if endpoint known
          if (connection.rtpEndpoint) {
            connection.sequenceNumber = (connection.sequenceNumber + 1) % 65536;
            connection.timestamp += audioBuffer.length / 2; // 16-bit samples

            externalMediaManager.sendAudio(
              audioBuffer,
              connection.rtpEndpoint.address,
              connection.rtpEndpoint.port,
              connection.sequenceNumber,
              connection.timestamp
            );

            logger.debug('Audio sent to Asterisk', {
              size: audioBuffer.length,
            });
          }
        }

        if (message.type === 'conversation_initiation_metadata') {
          logger.info('Conversation initiated', {
            conversationId: connection.conversationId,
          });
        }

        if (message.type === 'interruption') {
          logger.debug('User interrupted AI');
        }

      } catch (error) {
        logger.warn('Error processing WebSocket message', {
          error: error.message,
        });
      }
    });

    websocket.on('error', (error) => {
      logger.failure('WebSocket error', {
        error: error.message,
        conversationId: connection.conversationId,
      });
    });

    websocket.on('close', () => {
      logger.info('WebSocket closed', {
        conversationId: connection.conversationId,
      });
    });
  }

  /**
   * Cleanup bridge
   * @param {string} channelId - Channel ID
   */
  async cleanup(channelId) {
    const connection = this.activeConnections.get(channelId);
    
    if (!connection) {
      return;
    }

    logger.info('Cleaning up audio bridge', { channelId });

    try {
      // Close WebSocket
      if (connection.websocket) {
        connection.websocket.close();
      }

      // End ElevenLabs conversation
      if (connection.conversationId) {
        await endConversation(connection.conversationId);
      }

      // Destroy bridge
      if (connection.bridge) {
        try {
          await connection.bridge.destroy();
        } catch (error) {
          logger.debug('Bridge already destroyed', { channelId });
        }
      }

      // Hangup external channel
      if (connection.externalChannel) {
        try {
          await connection.externalChannel.hangup();
        } catch (error) {
          logger.debug('External channel already hung up', { channelId });
        }
      }

      this.activeConnections.delete(channelId);

      logger.success('Audio bridge cleaned up', { channelId });

    } catch (error) {
      logger.warn('Error during cleanup', {
        error: error.message,
        channelId,
      });
    }
  }

  /**
   * Cleanup all bridges
   */
  async cleanupAll() {
    const channelIds = Array.from(this.activeConnections.keys());
    
    for (const channelId of channelIds) {
      await this.cleanup(channelId);
    }

    externalMediaManager.cleanup();
  }
}

module.exports = new AudioBridge();
