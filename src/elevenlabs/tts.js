const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Generate speech audio from text using ElevenLabs TTS
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Optional voice ID (uses config default if not provided)
 * @returns {Promise<string>} - Path to generated audio file
 */
async function generateSpeech(text, voiceId = null) {
  const voice = voiceId || config.elevenlabs.voiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

  logger.elevenlabs('Generating speech', {
    textLength: text.length,
    voiceId: voice,
  });

  try {
    const response = await axios({
      method: 'POST',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      data: {
        text: text,
        model_id: config.elevenlabs.modelId,
        voice_settings: config.elevenlabs.voiceSettings,
      },
      responseType: 'arraybuffer',
      timeout: config.timeouts.api,
    });

    // Ensure temp directory exists
    await fs.mkdir(config.app.tempDir, { recursive: true });

    // Save audio file
    const filename = `tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    const filepath = path.join(config.app.tempDir, filename);

    await fs.writeFile(filepath, response.data);

    logger.success('Speech generated successfully', {
      filepath,
      size: response.data.length,
    });

    return filepath;
  } catch (error) {
    logger.failure('Failed to generate speech', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data?.toString(),
    });
    throw error;
  }
}

/**
 * Generate speech with streaming (for real-time playback)
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Optional voice ID
 * @returns {Promise<Buffer>} - Audio data as buffer
 */
async function generateSpeechStream(text, voiceId = null) {
  const voice = voiceId || config.elevenlabs.voiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`;

  logger.elevenlabs('Generating speech stream', {
    textLength: text.length,
    voiceId: voice,
  });

  try {
    const response = await axios({
      method: 'POST',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      data: {
        text: text,
        model_id: config.elevenlabs.modelId,
        voice_settings: config.elevenlabs.voiceSettings,
      },
      responseType: 'arraybuffer',
      timeout: config.timeouts.api,
    });

    logger.success('Speech stream generated', {
      size: response.data.length,
    });

    return response.data;
  } catch (error) {
    logger.failure('Failed to generate speech stream', {
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * Get available voices from ElevenLabs
 * @returns {Promise<Array>} - List of available voices
 */
async function getVoices() {
  const url = 'https://api.elevenlabs.io/v1/voices';

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: config.timeouts.api,
    });

    logger.success('Retrieved voices', {
      count: response.data.voices?.length || 0,
    });

    return response.data.voices || [];
  } catch (error) {
    logger.failure('Failed to get voices', {
      error: error.message,
      status: error.response?.status,
    });
    throw error;
  }
}

/**
 * Get voice details by ID
 * @param {string} voiceId - Voice ID
 * @returns {Promise<Object>} - Voice details
 */
async function getVoiceDetails(voiceId) {
  const url = `https://api.elevenlabs.io/v1/voices/${voiceId}`;

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: config.timeouts.api,
    });

    logger.success('Retrieved voice details', {
      voiceId,
      name: response.data.name,
    });

    return response.data;
  } catch (error) {
    logger.failure('Failed to get voice details', {
      error: error.message,
      voiceId,
    });
    throw error;
  }
}

module.exports = {
  generateSpeech,
  generateSpeechStream,
  getVoices,
  getVoiceDetails,
};
