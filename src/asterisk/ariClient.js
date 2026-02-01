const ari = require('ari-client');
const config = require('../config/config');
const logger = require('../utils/logger');

class AsteriskARIClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  /**
   * Connect to Asterisk ARI
   * @returns {Promise<Object>} - ARI client instance
   */
  async connect() {
    if (this.client && this.isConnected) {
      logger.asterisk('Already connected to ARI');
      return this.client;
    }

    logger.asterisk('Connecting to Asterisk ARI', {
      host: config.asterisk.host,
      username: config.asterisk.username,
      appName: config.asterisk.appName,
    });

    try {
      this.client = await ari.connect(
        config.asterisk.host,
        config.asterisk.username,
        config.asterisk.password
      );

      // Start the Stasis application
      await this.client.start(config.asterisk.appName);

      this.isConnected = true;

      logger.success('Connected to Asterisk ARI', {
        appName: config.asterisk.appName,
      });

      // Setup error handling
      this.setupErrorHandlers();

      return this.client;
    } catch (error) {
      this.isConnected = false;
      logger.failure('Failed to connect to Asterisk ARI', {
        error: error.message,
        host: config.asterisk.host,
      });
      throw error;
    }
  }

  /**
   * Setup error handlers for ARI client
   */
  setupErrorHandlers() {
    this.client.on('error', (error) => {
      logger.failure('ARI client error', {
        error: error.message,
      });
      this.isConnected = false;
    });

    // Reconnect on WebSocket close
    this.client.on('WebSocketReconnecting', () => {
      logger.warn('ARI WebSocket reconnecting...');
      this.isConnected = false;
    });

    this.client.on('WebSocketConnected', () => {
      logger.success('ARI WebSocket reconnected');
      this.isConnected = true;
    });
  }

  /**
   * Get the ARI client instance
   * @returns {Object} - ARI client
   */
  getClient() {
    if (!this.client || !this.isConnected) {
      throw new Error('ARI client not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isClientConnected() {
    return this.isConnected;
  }

  /**
   * Disconnect from ARI
   */
  disconnect() {
    if (this.client) {
      logger.asterisk('Disconnecting from ARI');
      this.client = null;
      this.isConnected = false;
    }
  }
}

// Export singleton instance
module.exports = new AsteriskARIClient();
