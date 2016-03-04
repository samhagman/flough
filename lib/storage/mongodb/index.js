'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
var path = require('path');
var fs = require('fs');
var session = require('express-session');
var attachHelpers = require('./lib/attachHelpers');

exports['default'] = function (_ref) {
    var storage = _ref.storage;
    var logger = _ref.logger;

    var Logger = logger.func;

    // Setup mongoose connection
    var connection = undefined;
    var mongoose = undefined;

    if (storage.type === 'mongodb') {
        mongoose = require('mongoose');

        // Connect to Mongo.
        connection = mongoose.createConnection(storage.uri, storage.options);
    } else if (storage.type === 'mongoose') {
        mongoose = storage.mongoose;
        connection = storage.connection;
    } else {
        throw new Error('Storage type/options passed to mongodb storage adapter were invalid.');
    }

    // Load Mongoose models.
    var modelDirectory = path.join(__dirname, 'models');
    fs.readdirSync(modelDirectory).forEach(function (filename) {
        if (path.extname(filename) === '.js') {
            // Create a model from each Schema with the same name as the file it
            // is loaded from (without '.js' and in lowercase).
            var basename = path.basename(filename, '.js').toLowerCase();
            var filepath = path.join(modelDirectory, filename);
            var Schema = require(filepath)(mongoose);

            // Set the collection name in MongoDB to be the same as the Mongoose model
            Schema.set('collection', basename);

            connection.model(basename, attachHelpers(Schema));
        }
    });

    return connection;
};

module.exports = exports['default'];