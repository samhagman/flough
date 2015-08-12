const kue = require('kue');

/**
 * Creates a jobLogger() which when called will log its message to both the Kue's job and Mongo's job
 * @param {Object} mongoCon - Mongoose connection
 * @param {Object} Logger - Internal Flough Logger
 * @returns {jobLogger}
 */
export default function jobLogFactory(mongoCon, Logger) {

    // Get models from Mongoose
    const FlowModel = mongoCon.model('flow');
    const JobModel = mongoCon.model('job');

    /**
     * Logs messages to both the redis job and optionally the persistent storage's job
     * @param {String} msgString - The message to be logged
     * @param {String} jobUUID - The job's UUID the message belongs to.
     */
    function jobLogger(msgString, jobUUID) {

        if (jobUUID) {
            // Find job based on UUID
            JobModel.findById(jobUUID, (err, jobDoc) => {
                if (err) {
                    Logger.error(`Error getting stored job with UUID ${jobUUID} for jobLogger(): ${err}`);
                }
                else if (!jobDoc) {
                    Logger.error(`Error getting stored job with UUID ${jobUUID} for jobLogger(): No job document with that UUID found.`);
                }
                else {

                    // Push the message into the docs job logs
                    jobDoc.jobLogs.push({ message: msgString });

                    // Find the Kue job and log the message onto it.
                    kue.Job.get(jobDoc.jobId, function(err, job) {
                        if (err) {
                            Logger.error(`Error getting job ${jobDoc.jobId} in Kue with UUID ${jobUUID} for jobLogger: ${err}`);
                        }
                        else {
                            job.log(msgString);
                        }
                    });

                    // Find Flow this job belongs to, if it does belong to a flow
                    if (FlowModel.isObjectId(jobDoc.flowId)) {
                        FlowModel.findById(jobDoc.flowId)
                            .then((flowDoc, err) => {
                                if (err) {
                                    Logger.error(`Error getting flow ${jobDoc.flowId} for job ${jobUUID}: ${err}`);
                                }
                                else if (flowDoc) {

                                    // Push message into the flow doc's job logs
                                    flowDoc.jobLogs.push({
                                        jobId,

                                        step:       job.step,
                                        personHuid: job.data.personHuid,
                                        message:    msgString
                                    });

                                    flowDoc.save();

                                }
                                else {
                                    Logger.error(`Error getting flow ${jobDoc.flowId} for job ${jobUUID}: ${err}`);
                                }
                            })
                        ;
                    }

                    jobDoc.save();
                }
            });
        }
        else {
            throw new Error('job uuid is a required parameter for jobLogger() to be able to log.');
        }
    }

    return jobLogger;
}