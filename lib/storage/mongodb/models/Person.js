let Schema = require('mongoose').Schema;

let FacultySchema = new Schema({
    primaryArea:      String,  //Enum?
    assistant:        Schema.Types.Mixed,  // PersonSchema
    areaAffiliations: Array,
    groupName:        String,
    groupBuilding:    String,
    groupRoom:        String,
    groupPhone:       String,
    titles:           [ String ],
    degrees:          [ String ],
    websites:         [ String ]
});

let ResearcherSchema = new Schema({
    researcherType: String,  //Needed still?
    fund:           String,
    fundingType:    String,
    pi:             Schema.Types.Mixed // PersonSchema
});

let PersonSchema = new Schema({
    HUID:                 { type: String, index: { unique: true } },
    firstName:            String,
    preferredFirstName:   String,
    lastName:             String,
    preferredLastName:    String,
    middleName:           String,
    photo:                String,
    officialDisplayName:  String,
    employmentStatus:     String,  //Boolean?
    SEASUsername:         String,
    email:                String,
    officeBuilding:       String,
    officeRoom:           String,
    officePhone:          String,
    //
    personType:           String,  // TODO Enum.
    facultyInfo:          [ FacultySchema ],
    researcherInfo:       [ ResearcherSchema ],
    //
    showPhotoInDirectory: Boolean,
    includeInDirectory:   Boolean
}, { collection: 'person' });

/**
 * Retrieves the person with the given HUID. Then executes the given callback function, handing it an
 * object that either contains an error or the person data.
 * @param {string}   HUID
 * @param {Function} cb
 */
PersonSchema.statics.getOne = function getOne(HUID, cb) {
    this.model('person')
        .findOne({ HUID: HUID })
        .exec((err, doc) => {
            if (!doc) {
                doc = { error: `No user record for HUID ${HUID}.` };
            }
            cb(err ? { error: err } : doc);
        });
};

export default PersonSchema;
