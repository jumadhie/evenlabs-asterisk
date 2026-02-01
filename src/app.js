const ariClient = require('./asterisk/ariClient');
const { handleCall } = require('./asterisk/callHandler');
const logger = require('./utils/logger');
const config = require('./config/config');
const audioFileServer = require('./utils/audioFileServer');


/**
 * Main application entry point
 */
async function startApplication() {
  logger.info('='.repeat(60));
  logger.info('🚀 Starting ElevenLabs-Asterisk Voice Agent');
  logger.info('='.repeat(60));

  logger.info('Configuration:', {
    asteriskHost: config.asterisk.host,
    asteriskApp: config.asterisk.appName,
    environment: config.app.env,
    logLevel: config.app.logLevel,
  });

  try {
    // Start audio file server first
    audioFileServer.start();
    
    // Connect to Asterisk ARI
    const client = await ariClient.connect();

    logger.success('Application started successfully');
    logger.info(`📞 Listening for calls on Stasis app: ${config.asterisk.appName}`);
    logger.info('='.repeat(60));

    // Handle incoming calls (Stasis Start)
    client.on('StasisStart', async (event, channel) => {
      await handleCall(client, channel, event);
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
  logger.failure('Uncaught exception', {
    error: error.message,
    stack: error.stack,
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
