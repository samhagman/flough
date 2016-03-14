const kue = require('kue');

/**
 * Creates a flowLogger() which when called will log its message to both the Kue's job and Mongo's job
 * @param {object} mongoCon - Mongoose connection
 * @param {object} Logger - Internal Flough Logger
 * @returns {flowLogger}
 */
export default function flowLoggerFactory(mongoCon, Logger) {

    // Get models from Mongoose
    const FlowModel = mongoCon.model('flow');

    /**
     * Logs messages to both the redis job and optionally the persistent storage's job
     * @param {string} msgString - The message to be logged
     * @param {string} UUID - The job's UUID the message belongs to.
     * @param {Number} [jobId] - Optionally pass a Kue jobId to force flowLogger to use.
     */
    function flowLogger(msgString, UUID, jobId) {

        const timeCalled = new Date();
        const timeStampedMsg = `[${timeCalled.toISOString()}] ${msgString}`;

        //Logger.debug('msgString', msgString);
        //Logger.debug('UUID', UUID);
        //Logger.debug('jobId', jobId);

        // Find the Kue job and log the message onto it.
        const logToKueJob = function logToKueJob(kueJobId, msgString) {
            kue.Job.get(kueJobId, function(err, job) {
                if (err) {
                    Logger.error(
                        `Error getting job ${kueJobId} in Kue with UUID ${UUID} for flowLogger: ${err}
                         msg:${msgString}, jobId: ${jobId}`);
                }
                else {
                    job.log(msgString);
                }
            });
        };

        if (UUID) {
            let kueJobId = jobId || null;
            console.log('**************', UUID);
            //
            FlowModel.findById(UUID)
                .then((flowDoc, err) => {
                    if (err) {
                        Logger.error(`Error getting flow ${flowDoc.uuid} for job ${UUID}: ${err}`);
                    }
                    else if (!flowDoc) {
                        Logger.error(`Error getting stored flow with UUID ${UUID} for flowLogger(): No flow document with that UUID found.`);

                    }
                    else if (flowDoc) {

                        kueJobId = flowDoc.jobId;

                        logToKueJob(kueJobId, timeStampedMsg);

                        // Push message into the flow doc's job logs
                        flowDoc.jobLogs.push({
                            step:    flowDoc.step,
                            message: timeStampedMsg
                        });

                        flowDoc.save();

                    }
                    else {
                        Logger.error(`Error getting flow ${flowDoc.uuid} for job ${UUID}: ${err}`);
                    }
                })
            ;

        }
        else {
            throw new Error('job uuid is a required parameter for flowLogger() to be able to log.');
        }
    }



    return flowLogger;
}