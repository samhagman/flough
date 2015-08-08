const kue = require('kue');

export default function jobLogFactory(mongoCon, Logger) {

    const FlowModel = mongoCon.model('flow');
    const JobModel = mongoCon.model('job');

    /**
     * Logs messages to both the redis job and optionally the persistent storage's job
     * @param msgString
     * @param jobId
     * @param jobUUID
     * @param [flowId]
     */
    function jobLogger(msgString, jobUUID) {

        if (jobUUID) {
            JobModel.findById(jobUUID, (err, jobDoc) => {
                if (err) {
                    Logger.error(`Error getting stored job with UUID ${jobUUID} for jobLogger(): ${err}`);
                }
                else if (!jobDoc) {
                    Logger.error(`Error getting stored job with UUID ${jobUUID} for jobLogger(): No job document with that UUID found.`);
                }
                else {

                    jobDoc.jobLogs.push({ message: msgString });

                    kue.Job.get(jobDoc.jobId, function(err, job) {
                        if (err) {
                            Logger.error(`Error getting job ${jobDoc.jobId} in Kue with UUID ${jobUUID} for jobLogger: ${err}`);
                        }
                        else {
                            job.log(msgString);
                        }
                    });

                    if (FlowModel.isObjectId(jobDoc.flowId)) {
                        FlowModel.findById(jobDoc.flowId)
                            .then((flowDoc, err) => {
                                if (err) {
                                    Logger.error(`Error getting flow ${jobDoc.flowId} for job ${jobUUID}: ${err}`);
                                }
                                else if (flowDoc) {

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