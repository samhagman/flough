let http = require('http');

// Load server configuration.
global.CONFIG = require('./config.js');

// Load Logger singleton.
let Logger = require('./lib/Logger');

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

            // Kue setup.
            let [kueApp, queue] = require('../../lib/kue')(app, mongo.connection, redisClient);

            app.use(kueApp);

            // Server setup.
            let server = http.createServer(app);
            server.listen(CONFIG.SERVER.PORT, () => {
                Logger.info('HTTP server listening on ' +
                    `http://localhost:${server.address().port}/.`);
            });

        });
});




