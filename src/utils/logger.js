const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger
const logger = winston.createLogger({
  level: config.app.logLevel,
  format: fileFormat,
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add console transport in development
if (config.app.env !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Custom logging methods with emojis for better visibility
logger.call = (message, meta = {}) => {
  logger.info(`📞 ${message}`, meta);
};

logger.elevenlabs = (message, meta = {}) => {
  logger.info(`🎤 ${message}`, meta);
};

logger.asterisk = (message, meta = {}) => {
  logger.info(`📡 ${message}`, meta);
};

logger.success = (message, meta = {}) => {
  logger.info(`✅ ${message}`, meta);
};

logger.failure = (message, meta = {}) => {
  logger.error(`❌ ${message}`, meta);
};

module.exports = logger;
