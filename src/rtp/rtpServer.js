const dgram = require('dgram');
const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Simple RTP Server for audio streaming
 * Handles RTP packets with PCMU (G.711 μ-law) codec
 */
class RTPServer extends EventEmitter {
  constructor(startPort = 10000, endPort = 10100) {
    super();
    this.startPort = startPort;
    this.endPort = endPort;
    this.sessions = new Map(); // sessionId -> { socket, remoteAddress, remotePort }
    this.portPool = [];
    
    // Initialize port pool
    for (let port = startPort; port <= endPort; port++) {
      this.portPool.push(port);
    }
  }

  /**
   * Create a new RTP session
   * Returns { localPort, sessionId }
   */
  async createSession() {
    if (this.portPool.length === 0) {
      throw new Error('No available RTP ports');
    }

    const port = this.portPool.shift();
    const socket = dgram.createSocket('udp4');
    const sessionId = `rtp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      socket.on('error', (err) => {
        logger.error('RTP socket error', { sessionId, error: err.message });
        this.emit('error', sessionId, err);
      });

      socket.on('message', (msg, rinfo) => {
        // First packet from Asterisk - learn remote address
        const session = this.sessions.get(sessionId);
        if (session && !session.remoteAddress) {
          session.remoteAddress = rinfo.address;
          session.remotePort = rinfo.port;
          
          logger.info('RTP session learned remote address', {
            sessionId,
            remoteAddress: rinfo.address,
            remotePort: rinfo.port,
          });
        }

        // Parse and emit RTP audio
        this.handleRTPPacket(sessionId, msg);
      });

      socket.bind(port, '0.0.0.0', () => {
        logger.info('RTP session created', { sessionId, localPort: port });

        this.sessions.set(sessionId, {
          socket,
          localPort: port,
          remoteAddress: null,
          remotePort: null,
          sequenceNumber: Math.floor(Math.random() * 65535),
          timestamp: Math.floor(Math.random() * 4294967295),
          ssrc: Math.floor(Math.random() * 4294967295),
        });

        resolve({ sessionId, localPort: port });
      });

      socket.on('error', reject);
    });
  }

  /**
   * Handle incoming RTP packet
   */
  handleRTPPacket(sessionId, packet) {
    if (packet.length < 12) {
      return; // Invalid RTP packet
    }

    // RTP Header (12 bytes minimum)
    // const version = (packet[0] >> 6) & 0x3;
    const payloadType = packet[1] & 0x7F;
    // const sequenceNumber = packet.readUInt16BE(2);
    // const timestamp = packet.readUInt32BE(4);
    // const ssrc = packet.readUInt32BE(8);

    // Extract payload (audio data after 12-byte header)
    const payload = packet.slice(12);

    // Decode PCMU (μ-law) to PCM
    const pcm = this.decodePCMU(payload);

    logger.debug('RTP packet received', {
      sessionId,
      payloadType,
      payloadBytes: payload.length,
      pcmBytes: pcm.length,
    });

    // Emit audio event
    this.emit('audio', sessionId, pcm);
  }

  /**
   * Send audio to RTP session
   * @param {string} sessionId 
   * @param {Buffer} pcmAudio - PCM 16-bit audio
   */
  sendAudio(sessionId, pcmAudio) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.error('RTP session not found', { sessionId });
      return false;
    }

    if (!session.remoteAddress || !session.remotePort) {
      logger.warn('RTP remote address not yet learned', { sessionId });
      return false;
    }

    // Encode PCM to PCMU
    const pcmu = this.encodePCMU(pcmAudio);

    // Build RTP packet
    const rtpPacket = this.buildRTPPacket(session, pcmu);

    // Send packet
    session.socket.send(rtpPacket, session.remotePort, session.remoteAddress, (err) => {
      if (err) {
        logger.error('Failed to send RTP packet', {
          sessionId,
          error: err.message,
        });
      }
    });

    // Increment sequence number and timestamp
    session.sequenceNumber = (session.sequenceNumber + 1) % 65536;
    session.timestamp += pcmAudio.length / 2; // Samples (16-bit = 2 bytes per sample)

    return true;
  }

  /**
   * Build RTP packet
   */
  buildRTPPacket(session, payload) {
    const packet = Buffer.alloc(12 + payload.length);

    // RTP Header
    packet[0] = 0x80; // Version 2, no padding, no extension, no CSRC
    packet[1] = 0x00; // Payload type 0 (PCMU)
    packet.writeUInt16BE(session.sequenceNumber, 2);
    packet.writeUInt32BE(session.timestamp, 4);
    packet.writeUInt32BE(session.ssrc, 8);

    // Copy payload
    payload.copy(packet, 12);

    return packet;
  }

  /**
   * Decode PCMU (μ-law) to PCM 16-bit
   */
  decodePCMU(pcmuData) {
    const pcm = Buffer.alloc(pcmuData.length * 2); // 16-bit = 2 bytes per sample

    for (let i = 0; i < pcmuData.length; i++) {
      const ulaw = pcmuData[i];
      const sign = (ulaw & 0x80) >> 7;
      const exponent = (ulaw & 0x70) >> 4;
      const mantissa = ulaw & 0x0F;

      let sample = ((mantissa << 3) + 132) << exponent;
      sample = sign ? -sample : sample;

      pcm.writeInt16LE(sample, i * 2);
    }

    return pcm;
  }

  /**
   * Encode PCM 16-bit to PCMU (μ-law)
   */
  encodePCMU(pcmData) {
    const pcmu = Buffer.alloc(pcmData.length / 2);

    for (let i = 0; i < pcmData.length / 2; i++) {
      let sample = pcmData.readInt16LE(i * 2);
      const sign = sample < 0 ? 0x80 : 0x00;
      sample = Math.abs(sample);

      // Compress to μ-law
      sample = Math.min(sample, 32635);
      sample += 132;

      let exponent = 7;
      for (let exp = 0; exp < 8; exp++) {
        if (sample <= (0xFF << exp)) {
          exponent = exp;
          break;
        }
      }

      const mantissa = (sample >> (exponent + 3)) & 0x0F;
      const ulaw = sign | (exponent << 4) | mantissa;

      pcmu[i] = ~ulaw & 0xFF; // Complement for μ-law
    }

    return pcmu;
  }

  /**
   * Close RTP session
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.socket.close();
    this.sessions.delete(sessionId);
    this.portPool.push(session.localPort);

    logger.info('RTP session closed', { sessionId });
  }

  /**
   * Shutdown server
   */
  shutdown() {
    for (const [sessionId] of this.sessions) {
      this.closeSession(sessionId);
    }
    logger.info('RTP server shutdown complete');
  }
}

module.exports = RTPServer;
