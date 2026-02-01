const axios = require('axios');
const WebSocket = require('ws');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Initialize a new conversation with ElevenLabs Conversational AI 
 * NEW APPROACH: Connect directly via WebSocket with agent_id
 * @param {string} agentId - Optional agent ID (uses config default if not provided)
 * @returns {Promise<Object>} - Conversation details including websocket
 */
async function createConversation(agentId = null) {
  const agent = agentId || config.elevenlabs.agentId;

  if (!agent) {
    throw new Error('Agent ID is required for conversational AI');
  }

  logger.elevenlabs('Creating new conversation', { agentId: agent });

  try {
    // Connect directly to agent via WebSocket (no separate conversation creation)
    const ws = await connectToAgent(agent);
    
    // Generate a local conversation ID for tracking
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.success('Conversation created', {
      conversationId,
      agentId: agent,
    });

    return {
      conversation_id: conversationId,
      agent_id: agent,
      websocket: ws,
    };
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
 * Connect directly to ElevenLabs agent via WebSocket
 * @param {string} agentId - ElevenLabs agent ID
 * @returns {Promise<WebSocket>} - WebSocket connection
 */
async function connectToAgent(agentId) {
  // Direct WebSocket connection to agent
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;

  logger.elevenlabs('Connecting to agent WebSocket', {
    agentId,
  });

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
      },
    });

    let connectionTimeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 10000);

    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      logger.success('WebSocket connection established', { agentId });
      
      // Dynamic configuration based on audio mode
      const audioMode = config.elevenlabs.audioMode || 'pcm_16000';
      const outputFormat = audioMode === 'ulaw_8000' ? 'ulaw_8000' : 'pcm_16000';

      const initMessage = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          tts: {
            output_audio_format: outputFormat
          }
        }
      };
      
      ws.send(JSON.stringify(initMessage));
      logger.info('Sent conversation initiation data', { agentId, outputFormat });

      logger.debug('WebSocket opened, waiting for messages...');
      
      resolve(ws);
    });

    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      logger.failure('WebSocket error', {
        error: error.message,
        code: error.code,
        agentId,
      });
      reject(error);
    });

    ws.on('message', (data) => {
      try {
        const message = typeof data === 'string' ? data : data.toString();
        logger.debug('WebSocket message received', {
          agentId,
          message: message.substring(0, 200), // Log first 200 chars
        });
      } catch (err) {
        logger.warn('Error logging WebSocket message', {
          error: err.message,
        });
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'No reason provided';
      logger.warn('WebSocket connection closed', {
        agentId,
        code,
        reason: reasonStr,
        wasClean: code === 1000,
      });
      
      // Log common close codes
      if (code === 1002) {
        logger.failure('WebSocket protocol error - check API compatibility');
      } else if (code === 1003) {
        logger.failure('WebSocket unsupported data');
      } else if (code === 1006) {
        logger.failure('WebSocket abnormal closure - connection lost');
      } else if (code === 1008) {
        logger.failure('WebSocket policy violation - check authentication');
      } else if (code === 4001) {
        logger.failure('WebSocket unauthorized - check API key');
      }
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
  sendAudio,
  endConversation,
  getConversationHistory,
};
