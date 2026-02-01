/**
 * Test script to verify connections to Asterisk and ElevenLabs
 */
const axios = require('axios');
const config = require('../src/config/config');
const logger = require('../src/utils/logger');

async function testAsteriskConnection() {
  logger.info('Testing Asterisk ARI connection...');

  try {
    const response = await axios({
      method: 'GET',
      url: `${config.asterisk.host}/ari/asterisk/info`,
      auth: {
        username: config.asterisk.username,
        password: config.asterisk.password,
      },
      timeout: 5000,
    });

    logger.success('✅ Asterisk connection successful', {
      version: response.data.system?.version,
      status: response.data.status,
    });

    return true;
  } catch (error) {
    logger.failure('❌ Asterisk connection failed', {
      error: error.message,
      host: config.asterisk.host,
    });

    if (error.code === 'ECONNREFUSED') {
      logger.error('Connection refused. Is Asterisk running?');
    } else if (error.response?.status === 401) {
      logger.error('Authentication failed. Check ARI credentials.');
    }

    return false;
  }
}

async function testElevenLabsConnection() {
  logger.info('Testing ElevenLabs API connection...');

  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api.elevenlabs.io/v1/user',
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: 5000,
    });

    logger.success('✅ ElevenLabs connection successful', {
      subscription: response.data.subscription?.tier,
      characterCount: response.data.subscription?.character_count,
      characterLimit: response.data.subscription?.character_limit,
    });

    return true;
  } catch (error) {
    logger.failure('❌ ElevenLabs connection failed', {
      error: error.message,
      status: error.response?.status,
    });

    if (error.response?.status === 401) {
      logger.error('Invalid API key. Check ELEVENLABS_API_KEY in .env');
    }

    return false;
  }
}

async function testElevenLabsVoice() {
  logger.info('Testing ElevenLabs voice...');

  try {
    const response = await axios({
      method: 'GET',
      url: `https://api.elevenlabs.io/v1/voices/${config.elevenlabs.voiceId}`,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: 5000,
    });

    logger.success('✅ Voice configuration valid', {
      voiceId: config.elevenlabs.voiceId,
      name: response.data.name,
      category: response.data.category,
    });

    return true;
  } catch (error) {
    logger.failure('❌ Voice test failed', {
      error: error.message,
      voiceId: config.elevenlabs.voiceId,
    });

    if (error.response?.status === 404) {
      logger.error('Voice not found. Check ELEVENLABS_VOICE_ID in .env');
      logger.info('Run: npm run test:voices -- to list available voices');
    }

    return false;
  }
}

async function runAllTests() {
  logger.info('='.repeat(60));
  logger.info('🧪 Running Connection Tests');
  logger.info('='.repeat(60));

  const results = {
    asterisk: await testAsteriskConnection(),
    elevenlabs: await testElevenLabsConnection(),
    voice: await testElevenLabsVoice(),
  };

  logger.info('='.repeat(60));
  logger.info('📊 Test Results Summary');
  logger.info('='.repeat(60));

  Object.entries(results).forEach(([test, passed]) => {
    logger.info(`${test.padEnd(15)}: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  });

  const allPassed = Object.values(results).every((r) => r === true);

  if (allPassed) {
    logger.success('\n🎉 All tests passed! You are ready to start the application.');
    logger.info('\nRun: npm start');
  } else {
    logger.failure('\n❌ Some tests failed. Please fix the issues above before proceeding.');
  }

  logger.info('='.repeat(60));

  process.exit(allPassed ? 0 : 1);
}

// Run tests
runAllTests().catch((error) => {
  logger.failure('Test execution failed', {
    error: error.message,
  });
  process.exit(1);
});
