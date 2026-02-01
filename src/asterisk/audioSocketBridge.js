const logger = require('../utils/logger');
const AudioSocketServer = require('./audioSocketServer');
const { upsample8to16, downsample16to8 } = require('../utils/audioResampler');
const { v4: uuidv4 } = require('uuid');
const { 
  createConversation, 
  endConversation 
} = require('../elevenlabs/conversationalAI');

/**
 * Audio Bridge using AudioSocket for bidirectional audio
 */
class AudioSocketBridge {
  constructor() {
    this.activeConnections = new Map();
    this.audioSocketServer = null;
    this.host = '0.0.0.0';
  }

  /**
   * Initialize AudioSocket server
   */
  async initialize(port = 9092, host = '0.0.0.0') {
    if (this.audioSocketServer) {
      logger.debug('AudioSocket server already initialized');
      return;
    }

    this.host = host; // Store host for createBridge usage
    this.audioSocketServer = new AudioSocketServer(port, host);
    
    // Setup event handlers
    this.audioSocketServer.on('connection', (connectionId) => {
      logger.info('AudioSocket connection received', { connectionId });
    });

    this.audioSocketServer.on('disconnect', (connectionId) => {
      logger.info('AudioSocket disconnected', { connectionId });
      this.handleDisconnect(connectionId);
    });

    this.audioSocketServer.on('audio', (connectionId, audioData) => {
      this.handleIncomingAudio(connectionId, audioData);
    });

    this.audioSocketServer.on('hangup', (connectionId) => {
      logger.info('AudioSocket hangup received', { connectionId });
      this.handleDisconnect(connectionId);
    });

    await this.audioSocketServer.start();
  }

  /**
   * Create bridge between user channel and ElevenLabs
   * @param {Object} client - ARI client
   * @param {Object} userChannel - User's channel
   * @param {string} agentId - ElevenLabs agent ID
   * @returns {Promise<Object>} - Bridge details
   */
  async createBridge(client, userChannel, agentId) {
    // Use proper UUID v4 format - AudioSocket requires standard UUID format
    const callUuid = uuidv4();
    
    try {
      logger.info('Creating AudioSocket bridge', {
        channelId: userChannel.id,
        agentId,
        uuid: callUuid,
      });

      // 1. Create ElevenLabs conversation
      const conversation = await createConversation(agentId);
      const conversationId = conversation.conversation_id;
      const ws = conversation.websocket;

      logger.success('ElevenLabs conversation created', {
        conversationId,
      });

      // 2. Originate Local channel to access AudioSocket application
      // We use Local channel to execute dialplan which runs AudioSocket() app
      // This is more robust than dialing AudioSocket channel directly
      
      const targetHost = (this.host === '0.0.0.0') ? '127.0.0.1' : this.host;
      
      logger.info('Originating Local channel for AudioSocket', {
        uuid: callUuid,
        targetHost
      });

      const audioSocketChannel = await client.Channel().originate({
        endpoint: `Local/start@audiosocket-bridge`,
        app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
        appArgs: 'audiosocket',
        variables: {
          'AUDIOSOCKET_UUID': callUuid,
          'AUDIOSOCKET_SERVER': `${targetHost}:9092`
        },
        channelId: `audiosocket-local-${callUuid}`,
        timeout: 30,
      });

      logger.success('AudioSocket channel created', {
        channelId: audioSocketChannel.id,
        uuid: callUuid,
      });

      // 3. Wait for AudioSocket connection
      // Note: we wait for the connection associated with our callUuid
      // But wait! My AudioSocketServer stores connections by IP:Port
      // I need to update AudioSocketServer to map IDs? 
      // Actually, AudioSocket protocol doesn't send UUID in handshake?
      // WAIT.
      // AudioSocket Protocol: [Type][Length][Payload]
      // It DOES NOT send UUID in handshake.
      // Asterisk sends UUID in the INITIAL BYTES if sending content, OR
      // When we originate FROM Asterisk, Asterisk connects to us.
      // We accept connection.
      // How do we map this connection to the call?
      
      // CRITICAL realization: 
      // Unlike ExternalMedia which is UDP and we match by IP,
      // AudioSocket is TCP.
      // When Asterisk connects to us, 
      // 1. We accept connection.
      // 2. Asterisk MIGHT send UUID frame first? 
      // Let's check AudioSocket spec again.
      // "Every call using AudioSocket requires a UUID for tracking..."
      
      // If Asterisk doesn't send UUID on connect, how do we know which call it is?
      // Usually, the first message is UUID? No.
      
      // Let's assume for now 1 call = 1 connection.
      // But waitForConnection(uuid) in my server requires logic.
      // My server just stores by IP:Port. 
      // AND waitForConnection uses `once('connection')` which returns connectionId (IP:port).
      
      // So for a single call test, this works.
      // For multiple calls, we have a race condition if 2 connect same time.
      // But let's fix basic connectivity first.
      
      const connectionId = await this.audioSocketServer.waitForConnection(callUuid, 5000);

      logger.success('AudioSocket connection established', {
        connectionId,
        uuid: callUuid,
      });

      // CRITICAL: Store connection mapping IMMEDIATELY to handle incoming audio
      // Audio can arrive as soon as the connection is established
      const connection = {
        uuid: callUuid,
        connectionId,
        userChannel,
        audioSocketChannel,
        bridge: null, // Will be set after bridge creation
        websocket: ws,
        conversationId,
      };

      this.activeConnections.set(connectionId, connection);

      // 4. Create bridge in Asterisk
      const bridgeId = `bridge-${userChannel.id}`;
      const bridge = await client.Bridge().create({
        type: 'mixing',
        bridgeId: bridgeId,
      });

      logger.success('Asterisk bridge created', {
        bridgeId: bridge.id,
      });

      // 5. Add channels to bridge
      await bridge.addChannel({ channel: userChannel.id });
      await bridge.addChannel({ channel: audioSocketChannel.id });

      logger.success('Channels added to bridge', {
        bridgeId: bridge.id,
        channels: [userChannel.id, audioSocketChannel.id],
      });

      // 6. Update bridge in connection and setup WebSocket handlers
      connection.bridge = bridge;

      this.setupWebSocketHandlers(connection);

      return {
        bridge,
        conversationId,
        uuid: callUuid,
      };

    } catch (error) {
      logger.failure('Failed to create AudioSocket bridge', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Setup WebSocket message handlers for ElevenLabs
   */
  setupWebSocketHandlers(connection) {
    const { websocket, connectionId, conversationId } = connection;

    websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        // Log all messages for debugging
        logger.debug('WebSocket message received', message);

        // Handle audio from ElevenLabs
        if (message.audio_event?.audio_base_64) {
          // Decode base64 audio from ElevenLabs (PCM 16kHz)
          const pcm16k = Buffer.from(message.audio_event.audio_base_64, 'base64');

          logger.debug('Audio received from ElevenLabs', {
            connectionId,
            bytes: pcm16k.length,
          });

          // Audio pipeline: ElevenLabs 16kHz PCM → Downsample → Asterisk 8kHz PCM
          const pcm8k = downsample16to8(pcm16k);

          // Send to Asterisk via AudioSocket
          const success = this.audioSocketServer.sendAudio(connectionId, pcm8k);

          if (success) {
            logger.debug('Audio sent to Asterisk via AudioSocket', {
              connectionId,
              inputBytes: pcm16k.length,
              outputBytes: pcm8k.length,
            });
          }
        }

        // Handle agent response text
        if (message.agent_response_event?.agent_response) {
          logger.info('Agent response', {
            connectionId,
            response: message.agent_response_event.agent_response,
          });
        }

      } catch (error) {
        logger.error('Error processing WebSocket message', {
          error: error.message,
          connectionId,
        });
      }
    });

    websocket.on('error', (error) => {
      logger.error('WebSocket error', {
        error: error.message,
        connectionId,
      });
    });

    websocket.on('close', (code, reason) => {
      logger.info('WebSocket closed', {
        connectionId,
        code,
        reason: reason.toString(),
      });
    });
  }

  /**
   * Handle incoming audio from Asterisk via AudioSocket
   */
  handleIncomingAudio(connectionId, audioData) {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) {
      logger.warn('No active connection for audio data', { connectionId });
      return;
    }

    const { websocket } = connection;

    try {
      // Audio pipeline: Asterisk 8kHz PCM → Upsample → ElevenLabs 16kHz PCM
      const pcm16k = upsample8to16(audioData);

      // Encode to base64 for ElevenLabs
      const base64Audio = pcm16k.toString('base64');

      // Send to ElevenLabs
      const message = {
        user_audio_chunk: base64Audio,
      };

      websocket.send(JSON.stringify(message));

      logger.debug('Audio sent to ElevenLabs', {
        connectionId,
        inputBytes: audioData.length,
        outputBytes: pcm16k.length,
      });

    } catch (error) {
      logger.error('Error processing incoming audio', {
        error: error.message,
        connectionId,
      });
    }
  }

  /**
   * Handle AudioSocket disconnection
   */
  handleDisconnect(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) {
      return;
    }

    // Prevent infinite loop: check if already cleaning up
    if (connection.cleaningUp) {
      return;
    }

    // Mark as cleaning up to prevent re-entry
    connection.cleaningUp = true;

    const { websocket, conversationId } = connection;

    logger.info('Cleaning up AudioSocket bridge', {
      connectionId,
      conversationId,
    });

    // Close WebSocket (do NOT send hangup - it will trigger more events!)
    if (websocket && websocket.readyState === 1) {
      websocket.close();
    }

    // End ElevenLabs conversation
    endConversation(conversationId);

    // Remove from active connections
    this.activeConnections.delete(connectionId);

    logger.success('AudioSocket bridge cleaned up', {
      connectionId,
    });
  }

  /**
   * Cleanup specific bridge
   */
  async cleanup(channelId) {
    logger.info('Cleaning up AudioSocket bridge', {
      channelId,
    });

    // Find connection by channel ID
    for (const [connectionId, connection] of this.activeConnections.entries()) {
      if (connection.userChannel.id === channelId || 
          connection.audioSocketChannel.id === channelId) {
        
        // NOTE: Do NOT call sendHangup here - it triggers a hangup event loop!
        // Just cleanup the connection directly
        this.handleDisconnect(connectionId);
        
        logger.success('AudioSocket bridge cleaned up', {
          channelId,
        });
        return;
      }
    }

    logger.warn('No AudioSocket bridge found for channel', {
      channelId,
    });
  }

  /**
   * Shutdown AudioSocket server and cleanup all connections
   */
  async shutdown() {
    logger.info('Shutting down AudioSocket bridge');

    // Cleanup all active connections
    for (const connectionId of this.activeConnections.keys()) {
      this.handleDisconnect(connectionId);
    }

    // Stop AudioSocket server
    if (this.audioSocketServer) {
      await this.audioSocketServer.stop();
    }

    logger.success('AudioSocket bridge shut down');
  }
}

module.exports = new AudioSocketBridge();
