let mongoose = require('mongoose');
let Schema = mongoose.Schema;
let Promise = require('bluebird');
let Logger = require('../../lib/Logger');

let PositionSchema = new Schema({

    positionControlID:     { type: String, index: { unique: true } },
    positionHolderHUID:    String,
    positionTitle:         String,
    positionDescription:   String,
    salaryGrade:           String,
    departmentDescription: String,
    primaryCategory:       String, //Enum?
    primaryHrFte:          String,
    primaryFinanceFte:     String,
    secondaryCategory:     String, //Enum?
    secondaryHrFte:        String,
    secondaryFinanceFte:   String,
    reportsTo:             Schema.Types.Mixed, // another Position Schema

    termEndDate:       Date,
    isTermAppointment: Boolean,
    isActive:          Boolean
}, { collection: 'position' });


/**
 * Retrieves the person with the given HUID. Then executes the given callback function, handing it an
 * object that either contains an error or the person data.
 * @param {string}   HUID
 * @param {Function} cb
 */
PositionSchema.statics.getOne = function getOne(HUID, cb) {
    this.model('position')
        .findOne({ HUID: HUID })
        .exec((err, doc) => {
            if (!doc) {
                doc = { error: `No user record for HUID ${HUID}.` };
            }
            cb(err ? { error: err } : doc);
        });
};

/**
 * Turns an array of positionIds into an array of the people that hold those positions.
 * @param {Array} positionIds
 * @returns {bluebird|exports|module.exports}
 */
PositionSchema.statics.getPersons = function getPersons(positionIds) {

    return new Promise((resolve, reject) => {
        let Position = this.model('position');
        let Person = this.model('person');

        Position
            .find({ positionControlID: { $in: positionIds } })
            .then((docs, err) => {
                if (err) {
                    reject(err);
                }
                else if (docs.length !== positionIds.length) {
                    throw new Error('One or more position ids did not exist.  Look at position Ids for typos.');
                }
                else {
                    let HUIDs = docs.map((doc) => doc.positionHolderHUID);
                    Person.find({ huid: { $in: HUIDs } })
                        .then((docs, err) => {
                            if (err) {
                                reject(err);
                            }
                            else {
                                // DEBUGGER STATEMENT!
                                if (CONFIG.EXPRESS.DEV_BUILD && docs.length === 0) {
                                    docs.push({_DEBUGGERPERSON: true, huid: CONFIG.EXPRESS.CAS_DEV_USER});
                                }
                                resolve(docs);
                            }
                        })
                    ;
                }
            })
        ;
    });
};

export default PositionSchema;
