const net = require('net');
const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * AudioSocket Protocol Constants
 */
const MESSAGE_TYPES = {
  AUDIO: 0x01,      // Audio frame (320 bytes of PCM)
  DTMF: 0x02,       // DTMF digit
  HANGUP: 0x10,     // Hangup signal
};

const HEADER_SIZE = 3;
const AUDIO_FRAME_SIZE = 320; // 20ms of 16-bit 8kHz PCM

/**
 * AudioSocket Server for bidirectional audio streaming with Asterisk
 * 
 * Protocol: [1 byte type][2 bytes length][N bytes payload]
 * Audio format: Signed 16-bit PCM, 8kHz, Mono, Little-endian
 */
class AudioSocketServer extends EventEmitter {
  constructor(port = 9092, host = '0.0.0.0') {
    super();
    this.port = port;
    this.host = host;
    this.server = null;
    this.connections = new Map(); // uuid -> socket
  }

  /**
   * Start AudioSocket TCP server
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error) => {
        logger.error('AudioSocket server error', { error: error.message });
        reject(error);
      });

      this.server.listen(this.port, this.host, () => {
        logger.success('AudioSocket server listening', {
          address: this.host,
          port: this.port,
        });
        resolve();
      });
    });
  }

  /**
   * Stop AudioSocket server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        // Close all active connections
        this.connections.forEach((socket) => {
          socket.destroy();
        });
        this.connections.clear();

        this.server.close(() => {
          logger.info('AudioSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new AudioSocket connection
   */
  handleConnection(socket) {
    const connectionId = `${socket.remoteAddress}:${socket.remotePort}`;
    let uuid = null;
    let buffer = Buffer.alloc(0);

    logger.info('AudioSocket connection established', {
      connectionId,
    });

    // Store connection
    this.connections.set(connectionId, socket);

    socket.on('data', (data) => {
      // Append to buffer
      buffer = Buffer.concat([buffer, data]);

      // Process complete messages
      while (buffer.length >= HEADER_SIZE) {
        // Parse header
        const type = buffer.readUInt8(0);
        const length = buffer.readUInt16BE(1);

        // Check if we have the full message
        if (buffer.length < HEADER_SIZE + length) {
          break; // Wait for more data
        }

        // Extract payload
        const payload = buffer.slice(HEADER_SIZE, HEADER_SIZE + length);
        buffer = buffer.slice(HEADER_SIZE + length);

        // Handle message based on type
        this.handleMessage(connectionId, type, payload);
      }
    });

    socket.on('end', () => {
      logger.info('AudioSocket connection closed', { connectionId });
      this.connections.delete(connectionId);
      this.emit('disconnect', connectionId);
    });

    socket.on('error', (error) => {
      logger.warn('AudioSocket connection error', {
        connectionId,
        error: error.message,
      });
      this.connections.delete(connectionId);
    });

    // Emit connection event
    this.emit('connection', connectionId, socket);
  }

  /**
   * Handle parsed AudioSocket message
   */
  handleMessage(connectionId, type, payload) {
    switch (type) {
      case MESSAGE_TYPES.AUDIO:
        // Emit audio event
        this.emit('audio', connectionId, payload);
        
        logger.debug('AudioSocket audio received', {
          connectionId,
          bytes: payload.length,
        });
        break;

      case MESSAGE_TYPES.DTMF:
        const digit = String.fromCharCode(payload[0]);
        this.emit('dtmf', connectionId, digit);
        
        logger.debug('AudioSocket DTMF received', {
          connectionId,
          digit,
        });
        break;

      case MESSAGE_TYPES.HANGUP:
        this.emit('hangup', connectionId);
        
        logger.info('AudioSocket hangup signal received', {
          connectionId,
        });
        break;

      default:
        logger.warn('Unknown AudioSocket message type', {
          connectionId,
          type,
        });
    }
  }

  /**
   * Send audio frame to Asterisk
   * @param {string} connectionId - Connection identifier
   * @param {Buffer} audioData - PCM audio data (16-bit 8kHz)
   */
  sendAudio(connectionId, audioData) {
    const socket = this.connections.get(connectionId);
    if (!socket) {
      logger.warn('AudioSocket connection not found', { connectionId });
      return false;
    }

    // Create AudioSocket packet
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt8(MESSAGE_TYPES.AUDIO, 0);
    header.writeUInt16BE(audioData.length, 1);

    const packet = Buffer.concat([header, audioData]);

    // Send packet
    try {
      socket.write(packet);
      
      logger.debug('AudioSocket audio sent', {
        connectionId,
        bytes: audioData.length,
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to send AudioSocket audio', {
        connectionId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Send hangup signal to Asterisk
   * @param {string} connectionId - Connection identifier
   */
  sendHangup(connectionId) {
    const socket = this.connections.get(connectionId);
    if (!socket) {
      return false;
    }

    // Create hangup packet
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt8(MESSAGE_TYPES.HANGUP, 0);
    header.writeUInt16BE(0, 1);

    try {
      socket.write(header);
      logger.info('AudioSocket hangup sent', { connectionId });
      return true;
    } catch (error) {
      logger.error('Failed to send AudioSocket hangup', {
        connectionId,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Wait for connection with specific UUID
   * @param {string} uuid - Call UUID
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<string>} Connection ID
   */
  waitForConnection(uuid, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('connection', handler);
        reject(new Error(`AudioSocket connection timeout for UUID: ${uuid}`));
      }, timeout);

      const handler = (connectionId) => {
        clearTimeout(timer);
        resolve(connectionId);
      };

      this.once('connection', handler);
    });
  }
}

module.exports = AudioSocketServer;
