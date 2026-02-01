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
    this.rtpHandlerInstalled = false; // Track if global RTP handler is installed
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
    const { websocket, userChannel, externalChannel } = connection;

    logger.info('Setting up bidirectional audio streaming', {
      channelId: externalChannel.id,
    });

    // Increase max listeners to prevent memory leak warning
    websocket.setMaxListeners(20);

    // Set up CENTRALIZED RTP routing (do this only ONCE globally)
    this.ensureRTPHandler();

    // Register this connection for RTP routing
    // When RTP packets arrive, they'll be routed to the correct connection
    connection.expectingRTP = true;

    // Handle audio FROM ElevenLabs TO Asterisk
    const messageHandler = (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.audio) {
          // Decode base64 audio from ElevenLabs
          const audioBuffer = Buffer.from(message.audio, 'base64');

          logger.debug('Audio received from ElevenLabs', {
            channelId: externalChannel.id,
            bytes: audioBuffer.length,
          });

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
              channelId: externalChannel.id,
              bytes: audioBuffer.length,
              seq: connection.sequenceNumber,
            });
          } else {
            logger.warn('RTP endpoint not yet detected, dropping audio');
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
    };

    const errorHandler = (error) => {
      logger.failure('WebSocket error', {
        error: error.message,
        conversationId: connection.conversationId,
      });
    };

    const closeHandler = () => {
      logger.info('WebSocket closed', {
        conversationId: connection.conversationId,
      });
      
      // Cleanup listeners
      websocket.removeListener('message', messageHandler);
      websocket.removeListener('error', errorHandler);
      websocket.removeListener('close', closeHandler);
      
      // Mark connection as not expecting RTP anymore
      connection.expectingRTP = false;
    };

    websocket.on('message', messageHandler);
    websocket.on('error', errorHandler);
    websocket.on('close', closeHandler);
  }

  /**
   * Ensure global RTP handler is set up (only once)
   */
  ensureRTPHandler() {
    if (this.rtpHandlerInstalled) {
      return;
    }

    this.rtpHandlerInstalled = true;

    logger.info('Installing centralized RTP handler');

    externalMediaManager.rtpServer.on('message', (msg, rinfo) => {
      // RTP packet structure: 12 byte header + payload
      if (msg.length < 12) {
        return;
      }

      // Extract audio payload
      const audioData = msg.slice(12);
      
      // Find which connection this RTP packet belongs to
      let targetConnection = null;

      for (const [channelId, conn] of this.activeConnections.entries()) {
        if (!conn.expectingRTP) {
          continue;
        }

        // If RTP endpoint not yet detected, this could be the first packet
        if (!conn.rtpEndpoint) {
          // Associate this connection with this RTP source
          conn.rtpEndpoint = {
            address: rinfo.address,
            port: rinfo.port,
          };
          targetConnection = conn;
          
          logger.info('RTP endpoint detected and associated', {
            channelId: conn.externalChannel.id,
            endpoint: `${rinfo.address}:${rinfo.port}`,
          });
          break;
        }
        
        // Check if packet is from this connection's endpoint
        if (conn.rtpEndpoint.address === rinfo.address && 
            conn.rtpEndpoint.port === rinfo.port) {
          targetConnection = conn;
          break;
        }
      }

      if (!targetConnection) {
        // Orphan packet - no connection found
        return;
      }

      // Send audio to ElevenLabs for this specific connection
      if (targetConnection.websocket && targetConnection.websocket.readyState === 1) {
        try {
          const base64Audio = audioData.toString('base64');
          
          targetConnection.websocket.send(JSON.stringify({
            user_audio_chunk: base64Audio,
          }));

          logger.debug('Audio routed to ElevenLabs', {
            channelId: targetConnection.externalChannel.id,
            bytes: audioData.length,
          });
        } catch (error) {
          logger.warn('Failed to send audio to ElevenLabs', {
            error: error.message,
            channelId: targetConnection.externalChannel.id,
          });
        }
      }
    });
  }

  /**
   * Cleanup bridge
   * @param {string} channelId - Channel ID
   */
  async cleanup(channelId) {
    const connection = this.activeConnections.get(channelId);
    
    if (!connection) {
      logger.debug('No active connection to cleanup', { channelId });
      return;
    }

    logger.info('Cleaning up audio bridge', { channelId });

    try {
      // Close WebSocket first
      if (connection.websocket) {
        try {
          connection.websocket.close();
          logger.debug('WebSocket closed', { channelId });
        } catch (error) {
          logger.debug('WebSocket already closed', { error: error.message });
        }
      }

      // Destroy bridge
      if (connection.bridge) {
        try {
          await connection.bridge.destroy();
          logger.debug('Bridge destroyed', { 
            channelId,
            bridgeId: connection.bridge.id,
          });
        } catch (error) {
          logger.debug('Bridge already destroyed', { 
            channelId,
            error: error.message,
          });
        }
      }

      // Hangup external channel
      if (connection.externalChannel) {
        try {
          await connection.externalChannel.hangup();
          logger.debug('External channel hung up', { 
            channelId,
            externalChannelId: connection.externalChannel.id,
          });
        } catch (error) {
          logger.debug('External channel already hung up', { 
            channelId,
            error: error.message,
          });
        }
      }

      // Hangup user channel  
      if (connection.userChannel) {
        try {
          await connection.userChannel.hangup();
          logger.debug('User channel hung up', { 
            channelId,
          });
        } catch (error) {
          logger.debug('User channel already hung up', { 
            channelId,
            error: error.message,
          });
        }
      }

      // Remove from active connections
      this.activeConnections.delete(channelId);

      logger.success('Audio bridge cleaned up', { channelId });

    } catch (error) {
      logger.warn('Error during cleanup', {
        error: error.message,
        channelId,
      });
      
      // Force remove from map even on error
      this.activeConnections.delete(channelId);
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
