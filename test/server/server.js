let http = require('http');

// Load server configuration.
global.CONFIG = require('./config.js');

// Create global server scoped require
global.requireServer = function(string) {
    const path = `${__dirname}/${string}`;
    return require(path);
};

// Load Logger singleton.
let Logger = require('./lib/Logger');

//process.title = `${CONFIG.SERVER.PROCESS_TITLE}_WORKER`;

// Redis setup.
let redisClient = require('./redis')();

redisClient.on('connect', function() {
    Logger.info('Connected to redis.');

    // Mongo setup.
    let mongo = require('./mongo')(redisClient);

    let observer = require('./observer')(mongo, redisClient)
        .then((observer) => {

            // Express setup.
            let app = require('./express')(mongo, redisClient);

            // Workflows Setup
            let workflows = require('./workflows')(redisClient, mongo.connection, app);

            // Server setup.
            let server = http.createServer(app);
            server.listen(CONFIG.SERVER.PORT, () => {
                Logger.info('HTTP server listening on ' +
                    `http://localhost:${server.address().port}/.`);
            });

        });
});




