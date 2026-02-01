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

  // Temporary handler for ari-client Swagger errors
  let swaggerErrorCaught = false;
  const tempSwaggerHandler = (error) => {
    const errorStr = String(error);
    if (errorStr.includes('api-docs') || errorStr.includes('swagger')) {
      logger.warn('Caught Swagger API docs error (non-critical)', {
        error: errorStr.substring(0, 200),
      });
      swaggerErrorCaught = true;
      // Don't exit - this is non-critical
      return;
    }
    // Re-throw other errors
    throw error;
  };

  try {
    // Install temporary handler
    process.on('uncaughtException', tempSwaggerHandler);

    // Start audio file server (for TTS mode)
    if (MODE === 'tts') {
      audioFileServer.start();
    }
    
    // Initialize RTP server and bridge (for ConvAI mode)
    if (MODE === 'conversational_ai') {
      const RTPServer = require('./rtp/rtpServer');
      const RTPBridge = require('./rtp/rtpBridge');
      
      // Create RTP server (ports 10000-10100)
      const rtpServer = new RTPServer(10000, 10100);
      
      // Create RTP bridge instance
      const rtpBridge = new RTPBridge(rtpServer);
      
      // Export for handler access
      require('./asterisk/rtpBridge').instance = rtpBridge;
      
      logger.success('RTP server initialized', {
        portRange: '10000-10100',
      });
    }
    
    // Connect to Asterisk ARI
    const client = await ariClient.connect();

    // Remove temporary handler after connection
    process.removeListener('uncaughtException', tempSwaggerHandler);

    // Install permanent handler
    installUncaughtExceptionHandler();

    // If Swagger error occurred but we still connected, log it
    if (swaggerErrorCaught && client) {
      logger.success('Connected despite Swagger warning');
    }

    logger.success('Application started successfully');
    logger.info(`📞 Listening for calls on Stasis app: ${config.asterisk.appName}`);
    logger.info('============================================================');

    // Start listening for calls
    client.on('StasisStart', async (event, channel) => {
      // Filter out UnicastRTP (ExternalMedia) channels to prevent infinite loop
      if (channel.name && (channel.name.startsWith('UnicastRTP/') || channel.name.startsWith('ExternalMedia/'))) {
        logger.debug('Ignoring UnicastRTP/ExternalMedia channel', {
          channelId: channel.id,
          channelName: channel.name,
        });
        return;
      }

      // Filter out channels we created ourselves
      if (channel.id && channel.id.startsWith('external-media-')) {
        logger.debug('Ignoring self-created external channel', {
          channelId: channel.id,
        });
        return;
      }

      // Filter out internal AudioSocket utility channels (prevent infinite loop)
      const args = event.args || [];
      if (args.includes('audiosocket')) {
        logger.debug('Ignoring internal AudioSocket channel', {
          channelId: channel.id,
          args: args
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

/**
 * Install permanent uncaught exception handler
 */
function installUncaughtExceptionHandler() {
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
}

// Handle process signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start the application
startApplication();
