let path = require('path');
let fs = require('fs');
let extend = require('extend');
let session = require('express-session');
let mongoose = require('mongoose');

let attachHelpers = require('./lib/attachHelpers');

export default function({storage, logger}) {
    let Logger = logger.func;

    // Setup mongoose connection
    let connection;
    if (storage.type === 'mongodb') {
        // Connect to Mongo.
        connection = mongoose.createConnection(
            storage.uri,
            storage.options
        );
    }
    else if (storage.type === 'mongoose') {
        connection = storage.connection;
    }
    else {
        throw new Error('Storage type/options passed to mongodb storage adapter were invalid.');
    }

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

            connection.model(basename, attachHelpers(Schema));
        }
    });

    return connection;
}
