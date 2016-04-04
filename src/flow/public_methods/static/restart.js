const kue = require('kue');
const Promise = require('bluebird');

/**
 * Restart a flow so it is re-initialized in memory and in Kue
 * @method Flow.restart
 * @public
 * @param {object} _d - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise.<Flow>}
 */
function restart(_d, UUID) {

    return _d.Flow.status(UUID)
        .then(flowData => {
            if (flowData.isParent && !flowData.isChild) {
                return Promise.resolve(flowData);
            }
            else {
                return Promise.reject(new Error(`Only top-level parent flows can be safely restarted.`));
            }
        })
        .then(flowData => Promise.join(_d.flowInstances.get(UUID).timeout(1000), flowData))
        .catchReturn(Promise.TimeoutError, false)
        .then((isInMemory, flowData) => {

            return new Promise((resolve, reject) => {

                // If flow is saved in memory, remove it
                if (isInMemory) _d.flowInstances.remove(UUID);

                // Find the job in Kue and remove it
                kue.Job.get(flowData.jobId, flowData.type, (err, job) => {
                    if (err) reject(err);

                    // Remove the job for Kue
                    job.remove(() => resolve(flowData));
                });
            });
        })
        .then(flowData => Promise.resolve(new _d.Flow(flowData.type, flowData)))
        .catch(err => {
            _d.Logger.error(`Error resetting flow ${UUID}: \n ${err.stack}`);
        });
}

export default restart;
