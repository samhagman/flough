let Schema = require('mongoose').Schema;

let ItemSchema = new Schema({
    title : String
},
    {collection: 'Item'});

/**
 * Retrieves all of the items. Then executes the given callback function, handing it an object that
 * either contains an error or the item data.
 * @param {Function} cb
 */
ItemSchema.statics.getAll = function getAll(cb) {

    this.find({})
        .exec((err, doc) => {
            cb(err ? { error: err } : doc);
        });
};

/**
 * Retrieves the item with the given ID. Then executes the given callback function, handing it an
 * object that either contains an error or the item data.
 * @param {string}   itemId
 * @param {Function} cb
 */
ItemSchema.statics.getOne = function getOne(itemId, cb) {

    this.findOne({ _id: itemId })
        .exec((err, doc) => {
            cb(err ? { error: err } : doc);
        });
};

export default ItemSchema;
