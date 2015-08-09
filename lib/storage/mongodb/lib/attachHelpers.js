let Promise = require('bluebird');
let ObjectId = require('mongoose').Types.ObjectId;
let Logger = require('../../lib/Logger');

/**
 * Takes a Mongoose Schema, attaches helpers to it, and returns the Schema
 * @param {Schema} Schema
 * @param redisClient
 * @returns {Schema}
 */
export default function attachHelpers(Schema, redisClient) {

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

    //
    ///**
    // * Executes .findByAndUpdate() but also increments the revisionKey by 1.
    // * @param onWhat
    // * @param query
    // * @param options
    // * @param [cb]
    // * @returns {Query}
    // */
    //Schema.statics.findByIdAndUpdateInc = function(onWhat, query, options, cb) {
    //
    //    if (query.$inc) {
    //        query.$inc.revisionKey = 1;
    //    }
    //    else {
    //        query.$inc = { revisionKey: 1 };
    //    }
    //
    //    if (cb) {
    //        return this.findByIdAndUpdate(onWhat, query, options, cb);
    //    }
    //    else {
    //        return this.findByIdAndUpdate(onWhat, query, options);
    //    }
    //
    //};
    //
    //
    ///**
    // * Executes .findOneAndUpdate() but also increments the revisionKey by 1.
    // * @param onWhat
    // * @param query
    // * @param options
    // * @param [cb]
    // * @returns {Query}
    // */
    //Schema.statics.findOneAndUpdateInc = function(onWhat, query, options, cb) {
    //
    //    if (query.$inc) {
    //        query.$inc.revisionKey = 1;
    //    }
    //    else {
    //        query.$inc = { revisionKey: 1 };
    //    }
    //
    //    if (cb) {
    //        return this.findOneAndUpdate(onWhat, query, options, cb);
    //    }
    //    else {
    //        return this.findOneAndUpdate(onWhat, query, options);
    //    }
    //
    //};



    /**
     * This is so that if you don't happen to use findByIdAndUpdateInc, but instead save the document, the
     * revision key will still be incremented.
     */
    Schema.pre('save', function(next) {
        //Logger.debug('^^^^SAVE PRE REVISION +!');
        this.revisionKey += 1;
        next();
    });

    Schema.pre('update', function() {
        //Logger.debug('^^^^UPDATE PRE REVISION +1');
        this.update({}, { $inc: { revisionKey: 1 } });
    });

    Schema.pre('findOneAndUpdate', function() {
        //Logger.debug('^^^^UPDATE PRE REVISION +!');
        this.update({}, { $inc: { revisionKey: 1 } });
    });

    function cacheNewDoc(updatedDoc) {

        redisClient.set(`${updatedDoc._id}:${updatedDoc.revisionKey}`, updatedDoc);
    }

    Schema.post('findOneAndUpdate', function(updatedDoc) {
        cacheNewDoc(updatedDoc);
    });

    Schema.post('save', function(updatedDoc) {
        cacheNewDoc(updatedDoc);
    });

    Schema.post('update', function(updatedDoc) {
        cacheNewDoc(updatedDoc);
    });

    return Schema;

}