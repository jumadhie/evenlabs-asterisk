const dgram = require('dgram');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * ExternalMedia Manager for handling RTP audio streams
 */
class ExternalMediaManager {
  constructor() {
    this.connections = new Map();
    this.rtpServer = null;
  }

  /**
   * Create ExternalMedia channel in Asterisk
   * @param {Object} client - ARI client
   * @param {string} externalHost - Host where RTP server is listening
   * @param {number} externalPort - Port where RTP server is listening
   * @returns {Promise<Object>} - ExternalMedia channel
   */
  async createExternalMedia(client, externalHost, externalPort) {
    try {
      const channelId = `external-media-${Date.now()}`;
      
      logger.info('Creating ExternalMedia channel', {
        channelId,
        externalHost,
        externalPort,
      });

      // Create ExternalMedia channel via ARI
      const channel = await client.Channel().externalMedia({
        channelId: channelId,
        app: config.asterisk.appName,
        external_host: `${externalHost}:${externalPort}`,
        format: 'slin16', // 16kHz signed linear PCM
      });

      logger.success('ExternalMedia channel created', {
        channelId: channel.id,
      });

      return channel;
    } catch (error) {
      logger.failure('Failed to create ExternalMedia channel', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create RTP server to receive and send audio
   * @param {number} port - Port to listen on
   * @returns {Promise<Object>} - Server instance
   */
  async createRTPServer(port = 10000) {
    return new Promise((resolve, reject) => {
      const server = dgram.createSocket('udp4');

      server.on('listening', () => {
        const address = server.address();
        logger.success('RTP server listening', {
          address: address.address,
          port: address.port,
        });
        this.rtpServer = server;
        resolve(server);
      });

      server.on('error', (error) => {
        logger.failure('RTP server error', {
          error: error.message,
        });
        reject(error);
      });

      server.bind(port);
    });
  }

  /**
   * Handle incoming RTP packets
   * @param {Function} callback - Called with audio data
   */
  onAudioReceived(callback) {
    if (!this.rtpServer) {
      throw new Error('RTP server not initialized');
    }

    this.rtpServer.on('message', (msg, rinfo) => {
      // RTP packet structure:
      // - Header: 12 bytes
      // - Payload: audio data
      
      if (msg.length < 12) {
        return; // Invalid RTP packet
      }

      // Extract audio payload (skip RTP header)
      const audioData = msg.slice(12);
      
      logger.debug('RTP packet received', {
        from: `${rinfo.address}:${rinfo.port}`,
        size: audioData.length,
      });

      callback(audioData, rinfo);
    });
  }

  /**
   * Send audio data as RTP packet
   * @param {Buffer} audioData - PCM audio data
   * @param {string} host - Destination host
   * @param {number} port - Destination port
   * @param {number} sequenceNumber - RTP sequence number
   * @param {number} timestamp - RTP timestamp
   */
  sendAudio(audioData, host, port, sequenceNumber = 0, timestamp = 0) {
    if (!this.rtpServer) {
      throw new Error('RTP server not initialized');
    }

    // Create RTP header
    const header = Buffer.alloc(12);
    
    // Version (2), Padding (0), Extension (0), CSRC count (0)
    header[0] = 0x80;
    
    // Marker (0), Payload type (11 for SLIN)
    header[1] = 11;
    
    // Sequence number
    header.writeUInt16BE(sequenceNumber, 2);
    
    // Timestamp
    header.writeUInt32BE(timestamp, 4);
    
    // SSRC (Synchronization source identifier)
    header.writeUInt32BE(0x12345678, 8);
    
    // Combine header and payload
    const packet = Buffer.concat([header, audioData]);
    
    // Send packet
    this.rtpServer.send(packet, port, host, (error) => {
      if (error) {
        logger.warn('Failed to send RTP packet', {
          error: error.message,
          destination: `${host}:${port}`,
        });
      }
    });
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.rtpServer) {
      this.rtpServer.close();
      logger.info('RTP server closed');
    }
    this.connections.clear();
  }
}

module.exports = new ExternalMediaManager();
