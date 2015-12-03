export default function FlowSchemaBuilder(mongoose) {
    let Schema = mongoose.Schema;

    const JobLogSchema = new Schema({
        jobId:      { type: Number, require: true },
        step:       { type: Number, require: true },
        personHuid: { type: String, require: true },
        message:    { type: String, required: true },
        createdOn:  { type: Date, default: Date.now }
    }, { _id: false });

    const FlowLogSchema = new Schema({
        step:      { type: Number, require: true },
        message:   { type: String, required: true },
        createdOn: { type: Date, default: Date.now }
    }, { _id: false });

    const FlowSchema = new Schema({
            stepsTaken:    { type: Number, required: true, default: -1 },
            substepsTaken: { type: Array, required: false, default: [] },
            totalSteps:    { type: Number, required: false },
            jobType:       { type: String, required: false },
            jobId:         { type: Number, required: true },
            phase:         { type: String, default: 'NoPhase', required: true },
            jobData:       { type: Schema.Types.Mixed, required: true },
            relatedJobs:   { type: Schema.Types.Mixed, required: true },
            jobLogs:       [ JobLogSchema ],
            flowLogs:      [ FlowLogSchema ],
            isCancelled:   { type: Boolean, required: true, default: false },
            completed:     { type: Boolean, required: true, default: false },
            result:        { type: Schema.Types.Mixed, default: null, required: false }
        },
        { collection: 'flow' });

    return FlowSchema;
}
