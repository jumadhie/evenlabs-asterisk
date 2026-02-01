const express = require('express');
const path = require('path');
const config = require('../../config/config');
const logger = require('../../utils/logger');

class AudioFileServer {
  constructor() {
    this.app = null;
    this.server = null;
    this.port = config.app.port + 1; // Use port 3001 by default
  }

  start() {
    if (this.server) {
      logger.warn('Audio file server already running');
      return;
    }

    this.app = express();

    // Serve audio files from temp directory
    this.app.use('/audio', express.static(config.app.tempDir, {
      setHeaders: (res, filepath) => {
        // Set appropriate content type
        if (filepath.endsWith('.mp3')) {
          res.setHeader('Content-Type', 'audio/mpeg');
        } else if (filepath.endsWith('.wav')) {
          res.setHeader('Content-Type', 'audio/wav');
        } else if (filepath.endsWith('.slin') || filepath.endsWith('.pcm')) {
          res.setHeader('Content-Type', 'audio/x-slin');
        }
        
        // Allow CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', serving: config.app.tempDir });
    });

    // Start server
    this.server = this.app.listen(this.port, '0.0.0.0', () => {
      logger.success('Audio file server started', {
        port: this.port,
        directory: config.app.tempDir,
      });
    });

    this.server.on('error', (error) => {
      logger.failure('Audio file server error', {
        error: error.message,
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('Audio file server stopped');
      });
      this.server = null;
    }
  }

  getFileUrl(filePath) {
    const fileName = path.basename(filePath);
    // Get local IP or hostname
    const host = config.asterisk.host.match(/https?:\/\/([^:]+)/)[1];
    const localIp = require('os').networkInterfaces().en0?.find(i => i.family === 'IPv4')?.address || 'localhost';
    
    return `http://${localIp}:${this.port}/audio/${fileName}`;
  }
}

// Export singleton
module.exports = new AudioFileServer();
