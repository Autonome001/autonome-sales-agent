import winston from 'winston';
import path from 'path';

/**
 * Autonome Sales System - Centralized Logger
 * 
 * Provides structured logging with multiple transports:
 * - Console: Colorized for development
 * - logs/error.log: Critical errors only
 * - logs/combined.log: All logs for historical tracking
 */

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    success: 3,
    debug: 4,
};

const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'blue',
    success: 'green',
    debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.printf(
        (info) => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}${info.metadata ? '\n' + JSON.stringify(info.metadata, null, 2) : ''}`
    )
);

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => {
            // Map custom levels to emojis for console visibility
            const emojis: Record<string, string> = {
                error: '❌',
                warn: '⚠️',
                info: 'ℹ️',
                success: '✅',
                debug: '🔍'
            };
            const levelBase = info.level.replace(/\x1B\[[0-9;]*m/g, '').toLowerCase();
            const emoji = emojis[levelBase] || '•';
            return `${emoji} [${info.timestamp}] ${info.level}: ${info.message}`;
        }
    )
);

const transports = [
    new winston.transports.Console({
        format: consoleFormat,
        level: process.env.LOG_LEVEL || 'debug',
    }),
    new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: winston.format.combine(
            winston.format.metadata(),
            winston.format.json()
        )
    }),
    new winston.transports.File({
        filename: 'logs/combined.log',
        format: winston.format.combine(
            winston.format.metadata(),
            winston.format.json()
        )
    }),
];

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    transports,
});

// Helper for success messages since it's a custom level
export const logSuccess = (message: string, metadata?: any) => {
    logger.log('success', message, { metadata });
};

export default logger;
