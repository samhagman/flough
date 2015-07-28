let fs = require('fs');
let util = require('util');
let colors = require('colors');

let streamOpts = { flags: 'a', encoding: 'UTF-8' };
let accessLogger = fs.createWriteStream(CONFIG.SERVER.APP_LOG, streamOpts);
let errorLogger = fs.createWriteStream(CONFIG.SERVER.ERROR_LOG, streamOpts);

CONFIG.LOGGER.ACCESS = accessLogger;
CONFIG.LOGGER.ERROR = errorLogger;

/**
 * Enum for log levels.
 * @enum {number}
 */
const LogLevel = {
    SUPPRESS: 0,
    ERROR:    1,
    WARN:     2,
    INFO:     3,
    DEBUG:    4
};

/**
 * Enum for log colors.
 * @enum {string}
 */
const LogColor = {
    SUPPRESS: 'white',
    ERROR:    'red',
    WARN:     'magenta',
    INFO:     'cyan',
    DEBUG:    'yellow'
};

let Logger = {};

for (let level of Object.keys(LogLevel)) {
    if (LogLevel[ level ] > 0) {
        Logger[ level.toLowerCase() ] = function() {
            // Write log only if logging level in the config is above the
            // threshold for the current log level.
            if (LogLevel[ CONFIG.SERVER.LOG_LEVEL ] >= LogLevel[ level ]) {
                let logDate = new Date().toISOString()
                    .replace(/T/, ' ')
                    .replace(/\..+/, '');
                logDate = `[${logDate}]`;
                let logMessage = util.format.apply(util.format, arguments);
                // If the config log level is not DEBUG, write all logs to file.
                if (LogLevel[ CONFIG.SERVER.LOG_LEVEL ] !== LogLevel.DEBUG) {
                    let logTag = `[${level}]`;
                    let log = `${logTag} ${logDate} ${logMessage}\n`;
                    errorLogger.write(log);
                }
                // If the config log level is DEBUG, log directly to the
                // console with colors.
                else {
                    let logTag = colors.blue('[') +
                        colors[ LogColor[ level ] ].bold(level) +
                        colors.blue(']');
                    let log = `${logTag}${logDate} ${logMessage}\n`;
                    console.log(log);
                }
            }
        };
    }
}

export default Logger;