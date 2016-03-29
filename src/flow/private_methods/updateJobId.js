const Promise = require('bluebird');

/**
 * Update the Kue job ID of a flow
 * @memberOf Flow
 * @protected
 * @param {object} _d - The Private Flow data
 * @param {Flow} flowInstance - The instance of Flow to act upon
 * @param {object} kueJob - The kue job to get the ID from
 * @returns {Promise}
 */
function updateJobId(_d, flowInstance, kueJob) {

    return new Promise((resolve, reject) => {

        const Logger = _d.Logger;

        let updateInterval;
        let numTries = 0;
        const maxTries = 4;
        const clearTheInterval = () => clearInterval(updateInterval);

        const updateTheJob = () => {
            numTries += 1;
            _d.FlowModel.findOneAndUpdate({ _id: kueJob.data._uuid }, { jobId: kueJob.id }, /*{new: true}, */function(err, flowDoc) {
                if (err && numTries > maxTries) {
                    clearTheInterval();
                    flowInstance.flowLogger(`Error updating job in MongoDB with new job id: ${err}`, kueJob.data._uuid, kueJob.id);
                    Logger.error('Error updating job in MongoDB with new job id');
                    Logger.error(err.stack);
                    reject(err);
                }
                else if (!flowDoc && numTries > maxTries) {
                    clearTheInterval();
                    const errorMsg = `Error updating job in MongoDB with new job id: Could not find job UUID of ${kueJob.data._uuid} in MongoDB`;
                    flowInstance.flowLogger(errorMsg, kueJob.data._uuid, kueJob.id);
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

export default updateJobId;
