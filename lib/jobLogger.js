'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = jobLogFactory;
var kue = require('kue');

/**
 * Creates a jobLogger() which when called will log its message to both the Kue's job and Mongo's job
 * @param {object} mongoCon - Mongoose connection
 * @param {object} Logger - Internal Flough Logger
 * @returns {jobLogger}
 */

function jobLogFactory(mongoCon, Logger) {

    // Get models from Mongoose
    var FlowModel = mongoCon.model('flow');
    var JobModel = mongoCon.model('job');

    /**
     * Logs messages to both the redis job and optionally the persistent storage's job
     * @param {string} msgString - The message to be logged
     * @param {string} UUID - The job's UUID the message belongs to.
     * @param {Number} [jobId] - Optionally pass a Kue jobId to force jobLogger to use.
     */
    function jobLogger(msgString, UUID, jobId) {

        var timeCalled = new Date();
        var timeStampedMsg = '[' + timeCalled.toISOString() + '] ' + msgString;

        //Logger.debug('msgString', msgString);
        //Logger.debug('UUID', UUID);
        //Logger.debug('jobId', jobId);

        // Find the Kue job and log the message onto it.
        var logToKueJob = function logToKueJob(kueJobId, msgString) {
            kue.Job.get(kueJobId, function (err, job) {
                if (err) {
                    Logger.error('Error getting job ' + kueJobId + ' in Kue with UUID ' + UUID + ' for jobLogger: ' + err + '\n                         msg:' + msgString + ', jobId: ' + jobId);
                } else {
                    job.log(msgString);
                }
            });
        };

        if (UUID) {
            (function () {
                var kueJobId = jobId || null;

                // Find job based on UUID
                JobModel.findById(UUID, function (err, jobDoc) {
                    if (err) {
                        Logger.error('Error getting stored job with UUID ' + UUID + ' for jobLogger(): ' + err);
                    } else {
                        if (!jobDoc) {
                            FlowModel.findById(UUID).then(function (flowDoc, err) {
                                if (err) {
                                    Logger.error('Error getting flow ' + jobDoc.flowId + ' for job ' + UUID + ': ' + err);
                                } else if (!flowDoc) {
                                    Logger.error('Error getting stored flow with UUID ' + UUID + ' for jobLogger(): No flow document with that UUID found.');
                                } else if (flowDoc) {

                                    kueJobId = flowDoc.jobId;

                                    logToKueJob(kueJobId, timeStampedMsg);

                                    // Push message into the flow doc's job logs
                                    flowDoc.jobLogs.push({
                                        step: flowDoc.step,
                                        message: timeStampedMsg
                                    });

                                    flowDoc.save();
                                } else {
                                    Logger.error('Error getting flow ' + jobDoc.flowId + ' for job ' + UUID + ': ' + err);
                                }
                            });
                        } else {
                            // Push the message into the docs job logs
                            jobDoc.jobLogs.push({ message: timeStampedMsg });

                            kueJobId = jobDoc.jobId;

                            logToKueJob(kueJobId, timeStampedMsg);

                            // Find Flow this job belongs to, if it does belong to a flow
                            if (FlowModel.isObjectId(jobDoc.flowId)) {
                                FlowModel.findById(jobDoc.flowId).then(function (flowDoc, err) {
                                    if (err) {
                                        Logger.error('Error getting flow ' + jobDoc.flowId + ' for job ' + UUID + ': ' + err);
                                    } else if (flowDoc) {

                                        // Push message into the flow doc's job logs
                                        flowDoc.jobLogs.push({
                                            jobId: kueJobId,

                                            step: job.step,
                                            personHuid: job.data.personHuid,
                                            message: timeStampedMsg
                                        });

                                        flowDoc.save();
                                    } else {
                                        Logger.error('Error getting flow ' + jobDoc.flowId + ' for job ' + UUID + ': ' + err);
                                    }
                                });
                            }

                            jobDoc.save();
                        }
                    }
                });
            })();
        } else {
            throw new Error('job uuid is a required parameter for jobLogger() to be able to log.');
        }
    }

    return jobLogger;
}

module.exports = exports['default'];