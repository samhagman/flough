let path = require('path');
let fs = require('fs');
let extend = require('extend');
let mongoose = require('mongoose');
let session = require('express-session');
let MongoStore = require('connect-mongo')(session);
let attachHelpers = require('./lib/attachHelpers');

export default function(redisClient) {

    // Connect to Mongo.
    let connection = mongoose.createConnection(
        CONFIG.MONGO.URI,
        CONFIG.MONGO.OPTIONS
    );

    // Load Mongoose models.
    let modelDirectory = path.join(__dirname, 'models');
    fs.readdirSync(modelDirectory).forEach(function(filename) {
        if (path.extname(filename) === '.js') {
            // Create a model from each Schema with the same name as the file it
            // is loaded from (without '.js' and in lowercase).
            let basename = path.basename(filename, '.js').toLowerCase();
            let filepath = path.join(modelDirectory, filename);
            let Schema = require(filepath);

            // Set the collection name in MongoDB to be the same as the Mongoose model
            Schema.set('collection', basename);

            connection.model(basename, attachHelpers(Schema, redisClient));
        }
    });

    // Set up session store.
    let store = new MongoStore(
        extend({ mongooseConnection: connection }, CONFIG.MONGO.STORE_OPTIONS)
    );

    return { connection, store };
}
