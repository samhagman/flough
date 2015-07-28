let Schema = require('mongoose').Schema;
let ObjectId = Schema.ObjectId;

let JobLogSchema = new Schema({
    message:   { type: String, required: true },
    createdOn: { type: Date, default: Date.now }
});

let RelatedJobSchema = new Schema({
    jobId:     { type: Number, required: true },
    type:      { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    step:      { type: Number, required: true },
    data:      { type: Schema.Types.Mixed, required: false },
    result:    { type: Schema.Types.Mixed, required: false },
    createdOn: { type: Date, default: Date.now }
});

let FlowSchema = new Schema({
    stepsTaken:  { type: Number, required: false },
    totalSteps:  { type: Number, required: false },
    jobType:     { type: String, required: false },
    jobData:     { type: Schema.Types.Mixed, required: true },
    relatedJobs: [ RelatedJobSchema ],
    jobLogs:     [ JobLogSchema ],
    completed:   { type: Boolean, required: true, default: false }
},
    {collection: 'flow'});


export default FlowSchema;
