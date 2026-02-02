const { v4: uuidv4 } = require('uuid');
const logger = require('../../../utils/logger');
const config = require('../../../config/config');
const alawmulaw = require('alawmulaw');
const { createConversation, endConversation } = require('../elevenlabs');

/**
 * Audio sample rate conversion utilities
 */
function upsample8to16(pcm8k) {
  const pcm16k = Buffer.alloc(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length / 2; i++) {
    const sample = pcm8k.readInt16LE(i * 2);
    pcm16k.writeInt16LE(sample, i * 4);
    pcm16k.writeInt16LE(sample, i * 4 + 2); // Duplicate sample
  }
  return pcm16k;
}

function downsample16to8(pcm16k) {
  // Ensure we only process complete 4-byte sample pairs
  const samplePairs = Math.floor(pcm16k.length / 4);
  const pcm8k = Buffer.alloc(samplePairs * 2);
  for (let i = 0; i < samplePairs; i++) {
    const sample = pcm16k.readInt16LE(i * 4);
    pcm8k.writeInt16LE(sample, i * 2);
  }
  return pcm8k;
}

/**
 * RTP Bridge for ElevenLabs Conversational AI
 * SPLIT-PATH ARCHITECTURE (SNOOP EDITION)
 * 
 * Path 1 (TX): Agent -> RTP(TX) -> ExtMedia(TX) -> Bridge(User) -> User Speaker
 * Path 2 (RX): User Mic -> Snoop(Spy='in') -> Bridge(Snoop) -> ExtMedia(RX) -> RTP(RX) -> Agent
 * 
 * Result: 0% Acoustic Echo, 100% Full Duplex.
 */
class RTPBridge {
  constructor(rtpServer) {
    this.rtpServer = rtpServer;
    this.activeSessions = new Map(); // sessionId -> { conversation, websocket, ... }
  }

  /**
   * Create RTP bridge for conversation
   */
  async createBridge(client, userChannel, agentId) {
    try {
      logger.info('Creating Split-Path RTP bridge (Snoop Mode)', {
        channelId: userChannel.id,
        agentId,
      });

      // 1. Create ElevenLabs conversation
      const conversation = await createConversation(agentId);
      const ws = conversation.websocket;
      let conversationId = conversation.conversation_id;

      // 2. Setup TX Path (Agent Speaking)
      // Standard mixing bridge so User can hear Agent
      const txSessionInfo = await this.rtpServer.createSession();
      const txSessionId = txSessionInfo.sessionId;
      
      const txChannel = await client.Channel().externalMedia({
        app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
        external_host: `127.0.0.1:${txSessionInfo.localPort}`,
        format: 'ulaw',
        channelId: `rtp-tx-${uuidv4()}`,
      });

      const mediaBridge = await client.Bridge().create({ type: 'mixing', name: `bridge-tx-${uuidv4()}` });
      await mediaBridge.addChannel({ channel: [userChannel.id, txChannel.id] });

      // 3. Setup RX Path (Agent Listening)
      // Isolate User Mic using Snoop (Spy='in') to bypass Echo
      const rxSessionInfo = await this.rtpServer.createSession();
      const rxSessionId = rxSessionInfo.sessionId;

      const rxChannel = await client.Channel().externalMedia({
        app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
        external_host: `127.0.0.1:${rxSessionInfo.localPort}`,
        format: 'ulaw',
        channelId: `rtp-rx-${uuidv4()}`,
      });
      
      // Snoop channel: Spies on USER, direction=IN (from Mic only)
      const snoopId = `snoop-${uuidv4()}`;
      const snoopChannel = await userChannel.snoop({
          app: process.env.ASTERISK_APP_NAME || 'elevenlabs-agent',
          spy: 'in', // CRITICAL: Only spy on input (mic), ignore output (speaker)
          snoopId: snoopId
      });

      // Bridge for Snoop -> RX
      const snoopBridge = await client.Bridge().create({ type: 'mixing', name: `bridge-rx-${uuidv4()}` });
      await snoopBridge.addChannel({ channel: [snoopChannel.id, rxChannel.id] });

      logger.success('Split-Path Infrastructure Ready', {
        txSessionId,
        rxSessionId,
        snoopId
      });

      // 4. Store session info
      const session = {
        sessionId: txSessionId, // Primary ID
        txSessionId,
        rxSessionId,
        conversationId,
        websocket: ws,
        
        userChannel,
        txChannel,
        rxChannel,
        snoopChannel,
        mediaBridge,
        snoopBridge,
        
        // Playback State
        audioBuffer: Buffer.alloc(0),
        isPlaying: false,
        isClosed: false,
      };

      this.activeSessions.set(txSessionId, session);
      this.activeSessions.set(rxSessionId, session); // Map both IDs to same session

      // 5. Setup Handlers
      this.setupSplitHandlers(session);

      return session;

    } catch (error) {
      logger.error('Failed to create Split-Path bridge', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  setupSplitHandlers(session) {
    const { txSessionId, rxSessionId, websocket } = session;

    // --- RX HANDLER (User -> Agent) ---
    // Listen to rxSession (Clean Mic Audio via Snoop)
    this.rtpServer.on('audio', (sid, pcm8k, rawPayload, rms) => {
        if (sid !== rxSessionId) return; // Only process RX session

        // No Echo Guard needed. It's clean.
        // No Threshold needed (optional, just silence filter).
        
        if (rms < 100) return; // Basic silence filter

        // Send to ElevenLabs
        const pcm16k = upsample8to16(pcm8k);
        const base64Audio = pcm16k.toString('base64');

        if (websocket && websocket.readyState === 1) {
            websocket.send(JSON.stringify({
                user_audio_chunk: base64Audio,
            }));
            
            // Barge-in Logic (Optional):
            // Since we are Full Duplex, we don't HAVE to stop the agent.
            // But usually, we want to stop agent if user speaks loud enough.
            if (rms > 500 && session.isPlaying) {
                // Soft Interrupt - clear buffer so agent stops talking soon
                session.audioBuffer = Buffer.alloc(0); 
                session.isPlaying = false;
            }
        }
    });

    // --- TX HANDLER (Agent -> User) ---
    // Handle WebSocket messages & Playback to txSession
    const startPlayback = () => {
        session.isPlaying = true;
        let offset = 0;
        const CHUNK_SIZE = 320;
        
        const sendNextChunk = () => {
             if (session.isClosed) return;

             if (!session.audioBuffer || offset + CHUNK_SIZE > session.audioBuffer.length) {
                 if (session.audioBuffer && offset < session.audioBuffer.length) {
                    session.audioBuffer = session.audioBuffer.slice(offset);
                 } else {
                    session.audioBuffer = Buffer.alloc(0);
                 }
                 
                 if (session.audioBuffer.length === 0) {
                     session.isPlaying = false;
                     return;
                 }
                 
                 session.isPlaying = false;
                 return;
             }

             const chunk = session.audioBuffer.slice(offset, offset + CHUNK_SIZE);
             // Send to TX Session (User hears this)
             this.rtpServer.sendAudio(session.txSessionId, chunk);
             
             offset += CHUNK_SIZE;
             setTimeout(sendNextChunk, 20); // 20ms pacing
        };

        sendNextChunk();
    };

    websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        // Conv ID update
        if (message.conversation_initiation_metadata_event?.conversation_id) {
            session.conversationId = message.conversation_initiation_metadata_event.conversation_id;
        }

        // Incoming Audio from Agent
        if (message.audio_event?.audio_base_64) {
            const audioMode = config.elevenlabs.audioMode || 'pcm_16000';
            let pcm8k; 

            if (audioMode === 'ulaw_8000') {
                const ulawData = Buffer.from(message.audio_event.audio_base_64, 'base64');
                const decoded = alawmulaw.mulaw.decode(ulawData);
                pcm8k = Buffer.from(decoded.buffer);
            } else {
                const pcm16k = Buffer.from(message.audio_event.audio_base_64, 'base64');
                pcm8k = downsample16to8(pcm16k);
            }

            if (!session.audioBuffer) session.audioBuffer = Buffer.alloc(0);
            session.audioBuffer = Buffer.concat([session.audioBuffer, pcm8k]);
            
            if (!session.isPlaying) startPlayback();
        }
        
        if (message.agent_response_event?.agent_response) {
            logger.info('Agent Response:', { text: message.agent_response_event.agent_response });
        }

      } catch (e) {
          logger.error('WS Message Error', { error: e.message });
      }
    });
    
    websocket.on('close', () => logger.warn('ElevenLabs WS Closed', { sessionId: txSessionId }));
  }

  /**
   * Cleanup session
   */
  async cleanup(channelId) {
    logger.info('Cleaning up Split-Path bridge', { channelId });

    // Find session by any channel ID
    let targetSession = null;
    for (const session of this.activeSessions.values()) {
        if (session.userChannel.id === channelId || 
            session.txChannel.id === channelId || 
            session.rxChannel.id === channelId ||
            (session.snoopChannel && session.snoopChannel.id === channelId)) {
            targetSession = session;
            break;
        }
    }

    if (targetSession) {
        // Close WS
        if (targetSession.websocket) targetSession.websocket.close();
        if (targetSession.conversationId) endConversation(targetSession.conversationId);

        // Close RTP
        this.rtpServer.closeSession(targetSession.txSessionId);
        this.rtpServer.closeSession(targetSession.rxSessionId);
        
        targetSession.isClosed = true;

        // Cleanup Map
        this.activeSessions.delete(targetSession.txSessionId);
        this.activeSessions.delete(targetSession.rxSessionId);

        // Channels and bridges will be cleaned up by Asterisk when User hangs up,
        // but robustly we should probably hangup our created channels.
        try { await targetSession.txChannel.hangup(); } catch(e) {}
        try { await targetSession.rxChannel.hangup(); } catch(e) {}
        try { await targetSession.snoopChannel.hangup(); } catch(e) {}
        try { await targetSession.mediaBridge.destroy(); } catch(e) {}
        try { await targetSession.snoopBridge.destroy(); } catch(e) {}
        
        logger.success('Split-Path Cleaned Up');
    }
  }

  async shutdown() {
      // Basic shutdown implementation
      logger.info('Shutting down RTP Bridge');
      this.activeSessions.clear();
      // Implementation omitted for brevity in snippet but logic allows clean exit
  }
}

module.exports = RTPBridge;
