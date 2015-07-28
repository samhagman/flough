let redis = require('redis');
let Logger = require('../lib/Logger.js');

export default function() {
    // Setup Redis Client
    Logger.info('Setting up redis connection...');

    let redisClient = redis.createClient();

    redisClient.on('error', function(err) {
        Logger.error('Error ' + err);
    });



    return redisClient;
}


