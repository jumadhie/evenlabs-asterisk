require('dotenv').config();

const config = {
  // Asterisk Configuration
  asterisk: {
    host: process.env.ASTERISK_HOST || 'http://localhost:8088',
    username: process.env.ASTERISK_USERNAME || 'asterisk',
    password: process.env.ASTERISK_PASSWORD || 'asterisk',
    appName: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
    audioFormat: process.env.ASTERISK_AUDIO_FORMAT || 'slin',
  },

  // ElevenLabs Configuration
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    agentId: process.env.ELEVENLABS_AGENT_ID,
    // Audio Configuration
    inputFormat: process.env.ELEVENLABS_INPUT_FORMAT || 'pcm_16000',
    outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT || 'pcm_16000',
    // Legacy support (optional, can be removed if not used)
    audioMode: process.env.ELEVENLABS_AUDIO_MODE || 'pcm_16000',
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    voiceSettings: {
      stability: parseFloat(process.env.VOICE_STABILITY) || 0.5,
      similarity_boost: parseFloat(process.env.VOICE_SIMILARITY_BOOST) || 0.75,
      style: parseFloat(process.env.VOICE_STYLE) || 0.0,
      use_speaker_boost: process.env.VOICE_USE_SPEAKER_BOOST === 'true',
    },
  },

  // Application Configuration
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT) || 3000,
    logLevel: process.env.LOG_LEVEL || 'info',
    tempDir: process.env.TEMP_DIR || '/tmp/elevenlabs-audio',
    debug: process.env.DEBUG === 'true',
  },

  // Audio Configuration
  audio: {
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
    format: process.env.ASTERISK_AUDIO_FORMAT || 'slin',
  },

  // Timeout Configuration
  timeouts: {
    api: parseInt(process.env.API_TIMEOUT) || 30000,
    call: parseInt(process.env.CALL_TIMEOUT) || 300000,
  },
};

// Validation
function validateConfig() {
  const errors = [];

  if (!config.asterisk.host) {
    errors.push('ASTERISK_HOST is required');
  }

  if (!config.asterisk.username) {
    errors.push('ASTERISK_USERNAME is required');
  }

  if (!config.asterisk.password) {
    errors.push('ASTERISK_PASSWORD is required');
  }

  if (!config.elevenlabs.apiKey) {
    errors.push('ELEVENLABS_API_KEY is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

// Validate on load
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

module.exports = config;
