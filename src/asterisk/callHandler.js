const logger = require('../utils/logger');
const { generateSpeech } = require('../elevenlabs/tts');
const { convertToAsteriskFormat, cleanupAudioFiles } = require('../utils/audioConverter');
const config = require('../config/config');

/**
 * Handle incoming call
 * @param {Object} client - ARI client instance
 * @param {Object} channel - Channel object from Asterisk
 * @param {Object} event - Stasis start event
 */
async function handleCall(client, channel, event) {
  const callerId = channel.caller.number || 'Unknown';
  const channelId = channel.id;
  const tempFiles = [];

  logger.call('Incoming call', {
    channelId,
    callerId,
    state: channel.state,
  });

  try {
    // Answer the call
    await channel.answer();
    logger.success('Call answered', { channelId, callerId });

    // Play greeting
    const greeting = 
      'Halo, selamat datang di sistem voice agent berbasis ElevenLabs. ' +
      'Bagaimana saya bisa membantu Anda hari ini? ' +
      'Tekan 1 untuk informasi, tekan 2 untuk dukungan, atau tekan tagar untuk keluar.';

    await playTTS(channel, greeting, tempFiles);

    // Setup DTMF handler
    channel.on('ChannelDtmfReceived', async (event, channel) => {
      const digit = event.digit;
      logger.info('DTMF received', { channelId, digit });

      try {
        switch (digit) {
          case '1':
            await handleInformationMenu(channel, tempFiles);
            break;
          case '2':
            await handleSupportMenu(channel, tempFiles);
            break;
          case '#':
            await playTTS(channel, 'Terima kasih telah menghubungi kami. Selamat tinggal.', tempFiles);
            await channel.continueInDialplan();
            break;
          default:
            await playTTS(channel, 'Pilihan tidak valid. Silakan coba lagi.', tempFiles);
            break;
        }
      } catch (err) {
        logger.failure('Error handling DTMF', {
          channelId,
          digit,
          error: err.message,
        });
      }
    });

    // Handle channel hangup
    channel.on('StasisEnd', async (event) => {
      logger.call('Call ended', {
        channelId,
        callerId,
        duration: event.timestamp - channel.creationtime,
      });

      // Cleanup temporary files
      await cleanupAudioFiles(tempFiles);
    });

    // Handle channel destroyed
    channel.on('ChannelDestroyed', async (event) => {
      logger.call('Channel destroyed', { channelId });
      await cleanupAudioFiles(tempFiles);
    });

  } catch (error) {
    logger.failure('Error handling call', {
      channelId,
      callerId,
      error: error.message,
      stack: error.stack,
    });

    // Try to hang up gracefully
    try {
      await channel.hangup();
    } catch (hangupError) {
      // Channel might already be hung up
      logger.debug('Could not hang up channel', {
        channelId,
        error: hangupError.message,
      });
    }

    // Cleanup on error
    await cleanupAudioFiles(tempFiles);
  }
}

/**
 * Handle information menu
 * @param {Object} channel - Channel object
 * @param {Array} tempFiles - Array to track temp files
 */
async function handleInformationMenu(channel, tempFiles) {
  const message = 
    'Anda memilih menu informasi. ' +
    'Sistem ini menggunakan teknologi ElevenLabs untuk menghasilkan suara natural. ' +
    'Tekan 9 untuk kembali ke menu utama.';

  await playTTS(channel, message, tempFiles);
}

/**
 * Handle support menu
 * @param {Object} channel - Channel object
 * @param {Array} tempFiles - Array to track temp files
 */
async function handleSupportMenu(channel, tempFiles) {
  const message = 
    'Anda memilih menu dukungan. ' +
    'Untuk bantuan lebih lanjut, tim kami akan menghubungi Anda kembali. ' +
    'Tekan 9 untuk kembali ke menu utama.';

  await playTTS(channel, message, tempFiles);
}

/**
 * Play text-to-speech audio on channel
 * @param {Object} channel - Channel object
 * @param {string} text - Text to convert to speech
 * @param {Array} tempFiles - Array to track temp files for cleanup
 */
async function playTTS(channel, text, tempFiles = []) {
  const channelId = channel.id;

  try {
    logger.elevenlabs('Generating TTS', {
      channelId,
      textLength: text.length,
    });

    // Generate speech from ElevenLabs
    const mp3File = await generateSpeech(text);
    tempFiles.push(mp3File);

    // Convert to Asterisk format
    const asteriskFile = await convertToAsteriskFormat(
      mp3File,
      config.asterisk.audioFormat
    );
    tempFiles.push(asteriskFile);

    logger.success('Audio ready for playback', {
      channelId,
      file: asteriskFile,
    });

    // Copy file to Asterisk server via SCP
    const { copyToAsterisk } = require('../utils/scpHelper');
    const soundPath = await copyToAsterisk(asteriskFile);

    logger.success('Starting playback from Asterisk server', {
      channelId,
      soundPath,
    });

    try {
      const playback = await channel.play({ media: soundPath });

      // Wait for playback to finish
      return new Promise((resolve, reject) => {
        playback.once('PlaybackFinished', (event) => {
          logger.success('Playback completed', { channelId });
          resolve();
        });

        playback.once('PlaybackFailed', (event) => {
          logger.failure('Playback failed', {
            channelId,
            error: event,
          });
          reject(new Error('Playback failed'));
        });
      });
    } catch (playbackError) {
      logger.failure('Error starting playback', {
        channelId,
        error: playbackError.message,
      });
      throw playbackError;
    }

  } catch (error) {
    logger.failure('Error playing TTS', {
      channelId,
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  handleCall,
  playTTS,
};
