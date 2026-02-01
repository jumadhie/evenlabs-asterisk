const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const config = require('../config/config');
const logger = require('./logger');

const execAsync = promisify(exec);

/**
 * Copy file to Asterisk server via SCP
 * @param {string} localFilePath - Path to local file
 * @returns {Promise<string>} - Remote file path
 */
async function copyToAsterisk(localFilePath) {
  try {
    const fileName = path.basename(localFilePath);
    
    // Remote directory on Asterisk server where files will be stored
    // This should be accessible by Asterisk (e.g., /var/lib/asterisk/sounds/custom/)
    const remoteDir = process.env.ASTERISK_SOUNDS_DIR || '/var/lib/asterisk/sounds/custom';
    const remotePath = `${remoteDir}/${fileName}`;
    
    // Extract host from ASTERISK_HOST
    const asteriskHost = config.asterisk.host.match(/https?:\/\/([^:]+)/)[1];
    
    // SCP credentials (you'll need to set these in .env)
    const sshUser = process.env.ASTERISK_SSH_USER || 'root';
    const sshKey = process.env.ASTERISK_SSH_KEY || '~/.ssh/id_rsa';
    
    logger.debug('Copying file to Asterisk server', {
      localPath: localFilePath,
      remotePath,
      host: asteriskHost,
    });

    // Create remote directory if it doesn't exist
    const mkdirCmd = `ssh -i ${sshKey} ${sshUser}@${asteriskHost} "mkdir -p ${remoteDir}"`;
    await execAsync(mkdirCmd);

    // Copy file via SCP
    const scpCmd = `scp -i ${sshKey} "${localFilePath}" ${sshUser}@${asteriskHost}:${remotePath}`;
    await execAsync(scpCmd);

    // Set permissions
    const chmodCmd = `ssh -i ${sshKey} ${sshUser}@${asteriskHost} "chmod 644 ${remotePath}"`;
    await execAsync(chmodCmd);

    logger.success('File copied to Asterisk server', {
      localPath: localFilePath,
      remotePath,
    });

    // Return the sound file path for Asterisk (without extension)
    return `sound:custom/${fileName.replace(/\.[^/.]+$/, '')}`;
  } catch (error) {
    logger.failure('Failed to copy file to Asterisk', {
      error: error.message,
      stderr: error.stderr,
    });
    throw error;
  }
}

/**
 * Cleanup remote file
 * @param {string} remotePath - Remote file path
 */
async function cleanupRemoteFile(remotePath) {
  try {
    const asteriskHost = config.asterisk.host.match(/https?:\/\/([^:]+)/)[1];
    const sshUser = process.env.ASTERISK_SSH_USER || 'root';
    const sshKey = process.env.ASTERISK_SSH_KEY || '~/.ssh/id_rsa';
    
    // Extract actual file path from sound: scheme
    const filePath = remotePath.replace('sound:custom/', '/var/lib/asterisk/sounds/custom/');
    
    const rmCmd = `ssh -i ${sshKey} ${sshUser}@${asteriskHost} "rm -f ${filePath}.*"`;
    await execAsync(rmCmd);
    
    logger.debug('Cleaned up remote file', { remotePath });
  } catch (error) {
    logger.warn('Failed to cleanup remote file', {
      error: error.message,
      remotePath,
    });
  }
}

module.exports = {
  copyToAsterisk,
  cleanupRemoteFile,
};
