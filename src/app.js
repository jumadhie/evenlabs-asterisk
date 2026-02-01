const ariClient = require('./asterisk/ariClient');
const { handleCall } = require('./asterisk/callHandler');
const { handleCallConvAI } = require('./asterisk/callHandlerConvAI');
const logger = require('./utils/logger');
const config = require('./config/config');
const audioFileServer = require('./utils/audioFileServer');
const audioBridge = require('./asterisk/audioBridge');

// Determine mode: 'tts' or 'conversational_ai'
const MODE = process.env.VOICE_AGENT_MODE || 'tts';

/**
 * Main application entry point
 */
async function startApplication() {
  logger.info('============================================================');
  logger.info('🚀 Starting ElevenLabs-Asterisk Voice Agent');
  logger.info('============================================================');

  logger.info('Configuration:', {
    asteriskHost: config.asterisk.host,
    asteriskApp: config.asterisk.appName,
    logLevel: config.app.logLevel,
    mode: MODE.toUpperCase(),
  });

  try {
    // Start audio file server (for TTS mode)
    if (MODE === 'tts') {
      audioFileServer.start();
    }
    
    // Initialize RTP server (for ConvAI mode)
    if (MODE === 'conversational_ai') {
      const externalMediaManager = require('./asterisk/externalMedia');
      const rtpPort = parseInt(process.env.EXTERNAL_MEDIA_PORT || '10000');
      await externalMediaManager.createRTPServer(rtpPort);
    }
    
    // Connect to Asterisk ARI
    const client = await ariClient.connect();

    logger.success('Application started successfully');
    logger.info(`📞 Listening for calls on Stasis app: ${config.asterisk.appName}`);
    logger.info('============================================================');

    // Start listening for calls
    client.on('StasisStart', async (event, channel) => {
      // Filter out ExternalMedia channels to prevent infinite loop
      if (channel.name && channel.name.startsWith('ExternalMedia/')) {
        logger.debug('Ignoring ExternalMedia channel', {
          channelId: channel.id,
          channelName: channel.name,
        });
        return;
      }

      // Filter out channels we created ourselves
      if (channel.id.startsWith('external-media-')) {
        logger.debug('Ignoring self-created external channel', {
          channelId: channel.id,
        });
        return;
      }

      // Route to appropriate handler based on mode
      if (MODE === 'conversational_ai') {
        await handleCallConvAI(client, channel, event);
      } else {
        await handleCall(client, channel, event);
      }
    });

    // Handle application errors
    client.on('error', (error) => {
      logger.failure('ARI client error', {
        error: error.message,
        stack: config.app.debug ? error.stack : undefined,
      });
    });

    // Log reconnection attempts
    client.on('WebSocketReconnecting', () => {
      logger.warn('ARI WebSocket connection lost, attempting to reconnect...');
    });

    client.on('WebSocketConnected', () => {
      logger.success('ARI WebSocket reconnected successfully');
    });

  } catch (error) {
    logger.failure('Failed to start application', {
      error: error.message,
      stack: error.stack,
    });

    logger.error('Please check:');
    logger.error('1. Asterisk server is running and accessible');
    logger.error('2. ARI is enabled in /etc/asterisk/ari.conf');
    logger.error('3. ARI credentials are correct in .env file');
    logger.error('4. Network connectivity to Asterisk server');
    logger.error('5. ElevenLabs API key is valid');

    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  logger.info(`\n${signal} received, shutting down gracefully...`);

  try {
    // Cleanup audio bridges (ConvAI mode)
    await audioBridge.cleanupAll();
    
    // Stop audio file server
    audioFileServer.stop();
    
    // Disconnect from ARI
    ariClient.disconnect();

    logger.success('Application shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.failure('Error during shutdown', {
      error: error.message,
    });
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  logger.failure('Uncaught exception', {
    error: error.message || String(error),
    stack: error.stack,
    type: error.constructor?.name,
    fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.failure('Unhandled promise rejection', {
    reason,
    promise,
  });
});

// Start the application
startApplication();
