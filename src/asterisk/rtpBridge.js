/**
 * RTP Bridge Wrapper Module
 * This module exports the RTP bridge instance that is initialized in app.js
 */

let rtpBridgeInstance = null;

module.exports = {
  get instance() {
    if (!rtpBridgeInstance) {
      throw new Error('RTP bridge not initialized. Make sure app.js initializes it first.');
    }
    return rtpBridgeInstance;
  },
  
  set instance(bridge) {
    rtpBridgeInstance = bridge;
  },

  // Proxy methods to instance
  async createBridge(client, channel, agentId) {
    return this.instance.createBridge(client, channel, agentId);
  },

  async cleanup(channelId) {
    return this.instance.cleanup(channelId);
  },

  async shutdown() {
    return this.instance.shutdown();
  },
};
