const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const path = require('path');
const config = require('../config/config');
const logger = require('./logger');

/**
 * Upload audio file to Asterisk server via HTTP
 * @param {string} localFilePath - Path to local audio file
 * @param {string} fileName - Name for the file on Asterisk server
 * @returns {Promise<string>} - Path to file on Asterisk server
 */
async function uploadToAsterisk(localFilePath, fileName) {
  try {
    // Read file
    const fileBuffer = await fs.readFile(localFilePath);
    
    // Create form data
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/octet-stream',
    });

    // Upload via ARI media endpoint
    const uploadUrl = `${config.asterisk.host}/ari/sounds/${fileName}`;
    
    logger.debug('Uploading audio to Asterisk', {
      localPath: localFilePath,
      uploadUrl,
      fileName,
    });

    await axios({
      method: 'POST',
      url: uploadUrl,
      auth: {
        username: config.asterisk.username,
        password: config.asterisk.password,
      },
      data: formData,
      headers: formData.getHeaders(),
      timeout: config.timeouts.api,
    });

    logger.success('Audio uploaded to Asterisk', {
      fileName,
    });

    return `sound:${fileName.replace(/\.[^/.]+$/, '')}`;
  } catch (error) {
    logger.failure('Failed to upload audio to Asterisk', {
      error: error.message,
      localPath: localFilePath,
    });
    throw error;
  }
}

/**
 * Play audio file via external media (base64 encoded)
 * @param {Object} channel - Channel object
 * @param {string} filePath - Path to audio file
 * @returns {Promise<Object>} - Playback object
 */
async function playExternalMedia(channel, filePath) {
  try {
    // Read file and encode as base64
    const fileBuffer = await fs.readFile(filePath);
    const base64Audio = fileBuffer.toString('base64');
    
    // Determine media type based on extension
    const ext = path.extname(filePath).toLowerCase();
    let mediaType;
    
    switch (ext) {
      case '.mp3':
        mediaType = 'audio/mpeg';
        break;
      case '.wav':
        mediaType = 'audio/wav';
        break;
      case '.slin':
      case '.pcm':
        mediaType = 'audio/x-slin';
        break;
      default:
        mediaType = 'application/octet-stream';
    }
    
    // Play via external media
    const mediaUri = `data:${mediaType};base64,${base64Audio}`;
    
    logger.debug('Playing external media', {
      channelId: channel.id,
      mediaType,
      size: fileBuffer.length,
    });
    
    return await channel.play({ media: mediaUri });
  } catch (error) {
    logger.failure('Failed to play external media', {
      error: error.message,
      filePath,
    });
    throw error;
  }
}

module.exports = {
  uploadToAsterisk,
  playExternalMedia,
};
