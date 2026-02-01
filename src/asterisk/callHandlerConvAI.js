const logger = require('../utils/logger');
const config = require('../config/config');
const audioBridge = require('./audioBridge');
const externalMediaManager = require('./externalMedia');

/**
 * Handle incoming call with Conversational AI
 * @param {Object} client - ARI client instance
 * @param {Object} channel - Channel object from Asterisk
 * @param {Object} event - Stasis start event
 */
async function handleCallConvAI(client, channel, event) {
  const callerId = channel.caller.number || 'Unknown';
  const channelId = channel.id;

  logger.call('Incoming call (Conversational AI mode)', {
    channelId,
    callerId,
    state: channel.state,
  });

  try {
    // Answer the call
    await channel.answer();
    logger.success('Call answered', { channelId, callerId });

    // Get agent ID from config
    const agentId = config.elevenlabs.agentId;
    
    if (!agentId) {
      throw new Error('ELEVENLABS_AGENT_ID not configured');
    }

    logger.info('Starting Conversational AI session', {
      channelId,
      agentId,
    });

    // Initialize RTP server if not already running
    if (!externalMediaManager.rtpServer) {
      const rtpPort = parseInt(process.env.EXTERNAL_MEDIA_PORT || '10000');
      await externalMediaManager.createRTPServer(rtpPort);
    }

    // Create audio bridge with ElevenLabs
    const bridgeInfo = await audioBridge.createBridge(client, channel, agentId);

    logger.success('Conversational AI session started', {
      channelId,
      bridgeId: bridgeInfo.bridgeId,
      conversationId: bridgeInfo.conversationId,
    });

    // Handle channel hangup
    channel.on('StasisEnd', async (event) => {
      logger.call('Call ended', {
        channelId,
        callerId,
      });

      await audioBridge.cleanup(channelId);
    });

    // Handle channel destroyed
    channel.on('ChannelDestroyed', async (event) => {
      logger.call('Channel destroyed', { channelId });
      await audioBridge.cleanup(channelId);
    });

  } catch (error) {
    logger.failure('Error handling Conversational AI call', {
      channelId,
      callerId,
      error: error.message,
      stack: error.stack,
    });

    // Try to hang up gracefully
    try {
      await channel.hangup();
    } catch (hangupError) {
      logger.debug('Could not hang up channel', {
        channelId,
        error: hangupError.message,
      });
    }

    // Cleanup
    await audioBridge.cleanup(channelId);
  }
}

module.exports = {
  handleCallConvAI,
};
