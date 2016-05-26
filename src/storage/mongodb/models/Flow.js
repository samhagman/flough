export default function FlowSchemaBuilder(mongoose) {
    let Schema = mongoose.Schema;

    const ChildLogSchema = new Schema({
        jobId:      { type: Number, required: true },
        step:       { type: Number, required: true },
        personHuid: { type: String, required: true },
        message:    { type: String, required: true },
        createdOn:  { type: Date, default: Date.now }
    }, { _id: false });

    const FlowLogSchema = new Schema({
        step:      { type: Number, required: true },
        message:   { type: String, required: true },
        createdOn: { type: Date, default: Date.now }
    }, { _id: false });

    const FlowSchema = new Schema({
            uuid:          { type: String, required: true },
            type:          { type: String, required: true },
            jobId:         { type: Number, required: true },
            phase:         { type: String, default: 'NoPhase', required: true },
            parentUUID:    { type: String, default: 'NoFlow', required: true },
            parentType:    { type: String, default: 'NoFlow', required: true },
            stepsTaken:    { type: Number, required: true },
            substepsTaken: { type: Array, default: [], required: false },
            totalSteps:    { type: Number, required: false },
            data:          { type: Schema.Types.Mixed },
            ancestors:     { type: Schema.Types.Mixed },
            logs:          [ FlowLogSchema ],
            childLogs:     [ ChildLogSchema ],
            isParent:      { type: Boolean, required: true, default: false },
            isChild:       { type: Boolean, required: true, default: false },
            isCancelled:   { type: Boolean, required: true, default: false },
            isCompleted:   { type: Boolean, required: true, default: false },
            isRestarted:   { type: Boolean, required: true, default: false },
            isStarted:     { type: Boolean, required: true, default: false },
            result:        { type: Schema.Types.Mixed, default: null, required: false }
        },
        { collection: 'flow' });

    return FlowSchema;
}
