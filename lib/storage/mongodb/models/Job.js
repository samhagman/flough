'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = JobSchemaBuilder;

function JobSchemaBuilder(mongoose) {

    var Schema = mongoose.Schema;

    var JobLogSchema = new Schema({
        message: { type: String, required: true },
        createdOn: { type: Date, 'default': Date.now }
    }, { _id: false });

    var JobSchema = new Schema({
        flowId: { type: String, required: false },
        jobId: { type: Number, required: true },
        title: { type: String, required: true },
        type: { type: String, required: true },
        completed: { type: Boolean, 'default': false, required: true },
        step: { type: Number, required: true },
        substep: { type: Number, required: true },
        data: { type: Schema.Types.Mixed, required: false },
        result: { type: Schema.Types.Mixed, required: false },
        jobLogs: [JobLogSchema]
    }, { collection: 'job' });

    return JobSchema;
}

module.exports = exports['default'];