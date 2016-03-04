'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = attachHelpers;
var Promise = require('bluebird');
var ObjectId = require('mongoose').Types.ObjectId;

/**
 * Takes a Mongoose Schema, attaches helpers to it, and returns the Schema
 * @param {Schema} Schema
 * @returns {Schema}
 */

function attachHelpers(Schema) {

    /**
     * Checks whether a value is a valid Mongo ObjectId
     * @param value
     * @returns {boolean}
     */
    Schema.statics.isObjectId = function (value) {

        if (value) {
            try {
                var stringValue = value.toString();
                var testObjectId = new ObjectId(stringValue);

                return testObjectId.toString() === stringValue;
            } catch (e) {
                return false;
            }
        } else {
            return false;
        }
    };

    Schema.add({
        createdOn: { type: Date, 'default': Date.now },
        updatedOn: { type: Date, 'default': Date.now }
    });

    return Schema;
}

module.exports = exports['default'];