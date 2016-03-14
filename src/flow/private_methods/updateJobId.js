const Promise = require('bluebird');

export default function updateJobId(_d, flowInstance, flowJob, step, substep) {

    return new Promise((resolve, reject) => {

        const Logger = _d.Logger;

        let updateInterval;
        let numTries = 0;
        const maxTries = 4;
        const clearTheInterval = () => clearInterval(updateInterval);

        const updateTheJob = () => {
            numTries += 1;
            _d.FlowModel.findOneAndUpdate({ _id: flowJob.data._uuid }, { jobId: flowJob.id }, /*{new: true}, */function(err, flowDoc) {
                if (err && maxTries > 4) {
                    clearTheInterval();
                    flowInstance.flowLogger(`Error updating job in MongoDB with new job id: ${err}`, flowJob.data._uuid, flowJob.id);
                    Logger.error('Error updating job in MongoDB with new job id');
                    Logger.error(err.stack);
                    reject(err);
                }
                else if (!flowDoc && maxTries > 4) {
                    clearTheInterval();
                    const errorMsg = `Error updating job in MongoDB with new job id: Could not find job UUID of ${flowJob.data._uuid} in MongoDB`;
                    flowInstance.flowLogger(errorMsg, flowJob.data._uuid, flowJob.id);
                    Logger.error(errorMsg);
                    reject(new Error(errorMsg));
                }
                else {
                    clearTheInterval();
                    resolve();
                }
            });
        };

        setInterval(updateTheJob, 1000);

    });
}