let Promise = require('bluebird');
let ObjectId = require('mongoose').Types.ObjectId;

/**
 * Takes a Mongoose Schema, attaches helpers to it, and returns the Schema
 * @param {Schema} Schema
 * @returns {Schema}
 */
export default function attachHelpers(Schema) {

    /**
     * Checks whether a value is a valid Mongo ObjectId
     * @param value
     * @returns {boolean}
     */
    Schema.statics.isObjectId = (value) => {

        if (value) {
            try {
                let stringValue = value.toString();
                let testObjectId = new ObjectId(stringValue);

                return (testObjectId.toString() === stringValue);
            } catch (e) {
                return false;
            }
        }
        else {
            return false;
        }

    };

    Schema.add({
        createdOn:   { type: Date, default: Date.now },
        updatedOn:   { type: Date, default: Date.now }
    });

    return Schema;

}