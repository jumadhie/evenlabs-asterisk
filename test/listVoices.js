/**
 * Utility script to list all available ElevenLabs voices
 */
const { getVoices } = require('../src/elevenlabs/tts');
const logger = require('../src/utils/logger');

async function listVoices() {
  logger.info('='.repeat(60));
  logger.info('🎤 Fetching Available ElevenLabs Voices');
  logger.info('='.repeat(60));

  try {
    const voices = await getVoices();

    if (voices.length === 0) {
      logger.warn('No voices found');
      return;
    }

    logger.info(`\nFound ${voices.length} voices:\n`);

    voices.forEach((voice, index) => {
      logger.info(`${index + 1}. ${voice.name}`);
      logger.info(`   ID: ${voice.voice_id}`);
      logger.info(`   Category: ${voice.category || 'N/A'}`);
      logger.info(`   Description: ${voice.description || 'No description'}`);
      logger.info('');
    });

    logger.info('='.repeat(60));
    logger.info('To use a voice, copy its ID to .env as ELEVENLABS_VOICE_ID');
    logger.info('='.repeat(60));

  } catch (error) {
    logger.failure('Failed to fetch voices', {
      error: error.message,
    });
    process.exit(1);
  }
}

listVoices();
