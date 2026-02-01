const logger = require('../utils/logger');
const config = require('../config/config');
const audioBridge = require('./rtpBridge'); // Use RTP bridge instead of AudioSocket
// const externalMediaManager = require('./externalMedia'); // Deprecated

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

  let bridgeInfo = null;
  let isCleanedUp = false;

  // Cleanup function
  const cleanup = async () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;

    logger.info('Cleaning up call', { channelId, callerId });

    try {
      // Cleanup audio bridge first
      await audioBridge.cleanup(channelId);

      // Hangup user channel if still active
      try {
        await channel.hangup();
      } catch (err) {
        logger.debug('User channel already hung up', { channelId });
      }
    } catch (error) {
      logger.warn('Error during cleanup', {
        channelId,
        error: error.message,
      });
    }
  };

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

    // Create audio bridge with ElevenLabs
    bridgeInfo = await audioBridge.createBridge(client, channel, agentId);

    logger.success('Conversational AI session started', {
      channelId,
      bridgeId: bridgeInfo.bridgeId,
      conversationId: bridgeInfo.conversationId,
    });

    // Handle channel StasisEnd (call hangup from user side)
    const stasisEndHandler = async (event) => {
      logger.call('Call ended (StasisEnd)', {
        channelId,
        callerId,
      });
      await cleanup();
    };

    // Handle channel destroyed
    const destroyedHandler = async (event) => {
      logger.call('Channel destroyed', { channelId });
      await cleanup();
    };

    // Register event handlers
    channel.once('StasisEnd', stasisEndHandler);
    channel.once('ChannelDestroyed', destroyedHandler);

    // Also handle hangup event
    channel.once('ChannelHangupRequest', async (event) => {
      logger.call('Hangup requested', { channelId });
      await cleanup();
    });

  } catch (error) {
    logger.failure('Error handling Conversational AI call', {
      channelId,
      callerId,
      error: error.message,
      stack: error.stack,
    });

    // Cleanup on error
    await cleanup();
  }
}

module.exports = {
  handleCallConvAI,
};
