const dgram = require('dgram');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const alawmulaw = require('alawmulaw');

/**
 * Simple RTP Server for audio streaming
 * Handles RTP packets with PCMU (G.711 μ-law) codec using proper library
 */
class RTPServer extends EventEmitter {
  constructor(startPort = 10000, endPort = 10100) {
    super();
    this.startPort = startPort;
    this.endPort = endPort;
    this.sessions = new Map();
    this.portPool = [];
    
    for (let port = startPort; port <= endPort; port++) {
      this.portPool.push(port);
    }
  }

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

    // Parse RTP header
    const payloadType = packet[1] & 0x7F;
    const sequenceNumber = packet.readUInt16BE(2);
    const timestamp = packet.readUInt32BE(4);

    const payload = packet.slice(12);
    
    // Decode PCMU to PCM - alawmulaw returns Uint8Array of 16-bit samples
    const decoded = alawmulaw.mulaw.decode(payload);
    
    // Convert to Buffer for compatibility with resampling
    const pcm = Buffer.from(decoded.buffer);

    // Calculate RMS to check if audio is silence
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const sample = pcm.readInt16LE(i);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (pcm.length / 2));

    logger.debug('RTP packet received', {
      sessionId,
      pt: payloadType,
      seq: sequenceNumber,
      ts: timestamp,
      payloadBytes: payload.length,
      pcmBytes: pcm.length,
      rms: Math.round(rms),
    });

    this.emit('audio', sessionId, pcm);
  }

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

    // Convert Buffer to Int16Array for alawmulaw library
    const int16 = new Int16Array(pcmAudio.buffer, pcmAudio.byteOffset, pcmAudio.length / 2);
    
    // Encode PCM to PCMU using proper library
    const encoded = alawmulaw.mulaw.encode(int16);
    const pcmu = Buffer.from(encoded);

    // Build RTP packet
    const packet = Buffer.alloc(12 + pcmu.length);
    packet[0] = 0x80;
    packet[1] = 0x00;
    packet.writeUInt16BE(session.sequenceNumber, 2);
    packet.writeUInt32BE(session.timestamp, 4);
    packet.writeUInt32BE(session.ssrc, 8);
    pcmu.copy(packet, 12);

    // Send packet
    session.socket.send(packet, session.remotePort, session.remoteAddress, (err) => {
      if (err) {
        logger.error('Failed to send RTP packet', {
          sessionId,
          error: err.message,
        });
      }
    });

    // Increment sequence number and timestamp
    session.sequenceNumber = (session.sequenceNumber + 1) % 65536;
    session.timestamp += pcmAudio.length / 2;

    return true;
  }

  closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.socket.close();
    this.sessions.delete(sessionId);
    this.portPool.push(session.localPort);

    logger.info('RTP session closed', { sessionId });
  }

  shutdown() {
    for (const [sessionId] of this.sessions) {
      this.closeSession(sessionId);
    }
    logger.info('RTP server shutdown complete');
  }
}

module.exports = RTPServer;
