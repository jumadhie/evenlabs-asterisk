const axios = require('axios');
const WebSocket = require('ws');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Initialize a new conversation with ElevenLabs Conversational AI
 * @param {string} agentId - Optional agent ID (uses config default if not provided)
 * @returns {Promise<Object>} - Conversation details including conversation_id
 */
async function createConversation(agentId = null) {
  const agent = agentId || config.elevenlabs.agentId;

  if (!agent) {
    throw new Error('Agent ID is required for conversational AI');
  }

  const url = 'https://api.elevenlabs.io/v1/convai/conversation';

  logger.elevenlabs('Creating new conversation', { agentId: agent });

  try {
    const response = await axios({
      method: 'POST',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      data: {
        agent_id: agent,
      },
      timeout: config.timeouts.api,
    });

    logger.success('Conversation created', {
      conversationId: response.data.conversation_id,
      agentId: agent,
    });

    return response.data;
  } catch (error) {
    logger.failure('Failed to create conversation', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    throw error;
  }
}

/**
 * Connect to conversation via WebSocket for real-time audio streaming
 * @param {string} conversationId - Conversation ID from createConversation
 * @returns {Promise<WebSocket>} - WebSocket connection
 */
async function connectToConversation(conversationId) {
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation/${conversationId}?api_key=${config.elevenlabs.apiKey}`;

  logger.elevenlabs('Connecting to conversation WebSocket', {
    conversationId,
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      logger.success('WebSocket connection established', { conversationId });
      resolve(ws);
    });

    ws.on('error', (error) => {
      logger.failure('WebSocket error', {
        error: error.message,
        conversationId,
      });
      reject(error);
    });

    ws.on('message', (data) => {
      logger.debug('WebSocket message received', {
        conversationId,
        dataLength: data.length,
      });
    });

    ws.on('close', (code, reason) => {
      logger.info('WebSocket connection closed', {
        conversationId,
        code,
        reason: reason.toString(),
      });
    });
  });
}

/**
 * Send audio data to conversation
 * @param {WebSocket} ws - WebSocket connection
 * @param {Buffer} audioData - Audio data to send
 */
function sendAudio(ws, audioData) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(audioData);
    logger.debug('Audio data sent', { size: audioData.length });
  } else {
    logger.warn('Cannot send audio, WebSocket not open', {
      state: ws.readyState,
    });
  }
}

/**
 * End a conversation
 * @param {string} conversationId - Conversation ID
 */
async function endConversation(conversationId) {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}`;

  logger.elevenlabs('Ending conversation', { conversationId });

  try {
    await axios({
      method: 'DELETE',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: config.timeouts.api,
    });

    logger.success('Conversation ended', { conversationId });
  } catch (error) {
    logger.failure('Failed to end conversation', {
      error: error.message,
      conversationId,
    });
    throw error;
  }
}

/**
 * Get conversation history
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Object>} - Conversation history
 */
async function getConversationHistory(conversationId) {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/${conversationId}`;

  try {
    const response = await axios({
      method: 'GET',
      url: url,
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
      timeout: config.timeouts.api,
    });

    logger.success('Retrieved conversation history', {
      conversationId,
      messageCount: response.data.messages?.length || 0,
    });

    return response.data;
  } catch (error) {
    logger.failure('Failed to get conversation history', {
      error: error.message,
      conversationId,
    });
    throw error;
  }
}

module.exports = {
  createConversation,
  connectToConversation,
  sendAudio,
  endConversation,
  getConversationHistory,
};
