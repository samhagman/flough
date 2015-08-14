export default function FlowSchemaBuilder(mongoose) {
    let Schema = mongoose.Schema;

    let JobLogSchema = new Schema({
        jobId:      { type: Number, require: true },
        step:       { type: Number, require: true },
        personHuid: { type: String, require: true },
        message:    { type: String, required: true },
        createdOn:  { type: Date, default: Date.now }
    }, { _id: false });

    // Unused for now.
    //let RelatedJobSchema = new Schema({
    //    jobId:     { type: Number, required: true },
    //    type:      { type: String, required: true },
    //    completed: { type: Boolean, default: false, required: true },
    //    step:      { type: Number, required: true },
    //    substep:   { type: Number, required: true },
    //    data:      { type: Schema.Types.Mixed, required: false },
    //    result:    { type: Schema.Types.Mixed, required: false },
    //    createdOn: { type: Date, default: Date.now }
    //}, { _id: false });

    let FlowSchema = new Schema({
            stepsTaken:    { type: Number, required: false },
            substepsTaken: { type: Array, required: false, default: [] },
            totalSteps:    { type: Number, required: false },
            jobType:       { type: String, required: false },
            jobData:       { type: Schema.Types.Mixed, required: true },
            relatedJobs:   { type: Schema.Types.Mixed, required: true, default: {} },
            jobLogs:       [ JobLogSchema ],
            completed:     { type: Boolean, required: true, default: false }
        },
        { collection: 'flow' });

    return FlowSchema;
}
