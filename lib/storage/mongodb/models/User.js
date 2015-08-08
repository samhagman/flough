let Schema = require('mongoose').Schema;

let UserSchema = new Schema({
    HUID        : { type: String, index: { unique: true } },
    firstName   : String,
    lastName    : String,
    role        : String,
    /*TODO: if anything is changed here, need `user.markModified('settings');`*/
    settings    : Schema.Types.Mixed,
    lastUpdated : { type: Date, default: Date.now }
}, { collection: 'user' });

UserSchema.pre('save', (next) => {
    this.lastUpdated = new Date();
    next();
});

/**
 * Retrieves the user with the given HUID. Then executes the given callback function, handing it an
 * object that either contains an error or the user data.
 * @param {string}   HUID
 * @param {Function} cb
 */
UserSchema.statics.getOne = function getOne(HUID, cb) {
    this.model('user')
        .findOne({ HUID: HUID })
        .exec((err, doc) => {
            if (!doc) {
                doc = { error: `No user record for HUID ${HUID}.` };
            }
            cb(err ? { error: err } : doc);
        });
};

export default UserSchema;
