let Schema = require('mongoose').Schema;

let EmployeeRecord = new Schema({
    HUID:           { type: String, index: { unique: true } },
    title:          String,
    employeeRecord: Schema.Types.Mixed, // TODO What is this?
    startDate:      Date,
    endDate:        Date,
    departmentId:   String,
    departmentName: String, //Enum?
    fte:            String, // TODO float?
    reportsTo:      Schema.Types.Mixed, // TODO Points at Person? or at Position?
    seasPositionId: String,
    //
    supportsPi:     [ Schema.Types.Mixed ] // Array of people
},
    { collection: 'employeerecord'});


/**
 * Retrieves the user with the given HUID. Then executes the given callback function, handing it an
 * object that either contains an error or the user data.
 * @param {string}   HUID
 * @param {Function} cb
 */
EmployeeRecord.statics.getOne = function getOne(HUID, cb) {
    this.model('employeerecord')
        .findOne({ HUID: HUID })
        .exec((err, doc) => {
            if (!doc) {
                doc = { error: `No user record for HUID ${HUID}.` };
            }
            cb(err ? { error: err } : doc);
        });
};

export default EmployeeRecord;
