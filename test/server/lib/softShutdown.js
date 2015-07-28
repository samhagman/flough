let kue = require('kue');
let Logger = require('./Logger');

/**
 * Shuts down the node process gracefully.
 * - Shuts down Kue
 * - Finishes/closes client connections
 * @param {Error} [err] - The error that is causing us to shutdown
 */
export default function softShutdown(err) {

    // Log error if there is one.
    if (err) {
        Logger.error(`[SOFT_SHUTDOWN] - ${err}`);
    }

    // TODO do other shutdown stuff, then close kue
    // Stuff
    // More Stuff

    let queue = kue.createQueue({
        disableSearch: false
    });

    queue.shutdown(5000, function(err) {
        Logger.info('Kue shutdown: ', err || '');
        process.exit(0);
    });
}