export default function FlowSchemaBuilder(mongoose) {
    let Schema = mongoose.Schema;

    const ChildLogSchema = new Schema({
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
            uuid:          { type: String, required: true },
            type:          { type: String, required: false },
            jobId:         { type: Number, required: true },
            phase:         { type: String, default: 'NoPhase', required: true },
            parentUUID:    { type: String, default: 'NoFlow', required: true },
            parentType:    { type: String, default: 'NoFlow', required: true },
            stepsTaken:    { type: Number, required: true, default: -1 },
            substepsTaken: { type: Array, required: false, default: [] },
            totalSteps:    { type: Number, required: false },
            jobData:       { type: Schema.Types.Mixed, required: true },
            ancestors:     { type: Schema.Types.Mixed, required: true },
            logs:          [ FlowLogSchema ],
            childLogs:     [ ChildLogSchema ],
            isParent:      { type: Boolean, required: true, default: false },
            isCancelled:   { type: Boolean, required: true, default: false },
            isCompleted:   { type: Boolean, required: true, default: false },
            isRestarted:   { type: Boolean, required: true, default: false },
            result:        { type: Schema.Types.Mixed, default: null, required: false }
        },
        { collection: 'flow' });

    return FlowSchema;
}
