const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const config = require('../config/config');

/**
 * Convert audio file to Asterisk-compatible format
 * @param {string} inputPath - Path to input audio file
 * @param {string} format - Target format (slin, ulaw, alaw, gsm)
 * @returns {Promise<string>} - Path to converted file
 */
async function convertToAsteriskFormat(inputPath, format = 'slin') {
  const outputPath = inputPath.replace(path.extname(inputPath), `.${format}`);

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath);

    // Configure based on format
    switch (format) {
      case 'slin':
        // Signed Linear PCM, 16-bit, mono, 8kHz (default for Asterisk)
        command
          .audioCodec('pcm_s16le')
          .audioChannels(1)
          .audioFrequency(config.audio.sampleRate)
          .format('s16le');
        break;

      case 'ulaw':
        // G.711 μ-law
        command
          .audioCodec('pcm_mulaw')
          .audioChannels(1)
          .audioFrequency(8000)
          .format('mulaw');
        break;

      case 'alaw':
        // G.711 A-law
        command
          .audioCodec('pcm_alaw')
          .audioChannels(1)
          .audioFrequency(8000)
          .format('alaw');
        break;

      case 'gsm':
        // GSM
        command
          .audioCodec('gsm')
          .audioChannels(1)
          .audioFrequency(8000)
          .format('gsm');
        break;

      default:
        reject(new Error(`Unsupported format: ${format}`));
        return;
    }

    command
      .on('start', (commandLine) => {
        logger.debug('FFmpeg command:', { commandLine });
      })
      .on('end', () => {
        logger.debug('Audio conversion completed', {
          input: inputPath,
          output: outputPath,
          format,
        });
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('Audio conversion failed', {
          error: err.message,
          input: inputPath,
          format,
        });
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Convert MP3 to WAV
 * @param {string} inputPath - Path to MP3 file
 * @returns {Promise<string>} - Path to WAV file
 */
async function convertToWav(inputPath) {
  const outputPath = inputPath.replace('.mp3', '.wav');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(config.audio.sampleRate)
      .format('wav')
      .on('end', () => {
        logger.debug('MP3 to WAV conversion completed', {
          input: inputPath,
          output: outputPath,
        });
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error('MP3 to WAV conversion failed', {
          error: err.message,
          input: inputPath,
        });
        reject(err);
      })
      .save(outputPath);
  });
}

/**
 * Get audio file duration
 * @param {string} filePath - Path to audio file
 * @returns {Promise<number>} - Duration in seconds
 */
async function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

/**
 * Clean up temporary audio files
 * @param {string[]} filePaths - Array of file paths to delete
 */
async function cleanupAudioFiles(filePaths) {
  const deletePromises = filePaths.map(async (filePath) => {
    try {
      await fs.unlink(filePath);
      logger.debug('Deleted temporary file', { path: filePath });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn('Failed to delete temporary file', {
          path: filePath,
          error: err.message,
        });
      }
    }
  });

  await Promise.all(deletePromises);
}

module.exports = {
  convertToAsteriskFormat,
  convertToWav,
  getAudioDuration,
  cleanupAudioFiles,
};
