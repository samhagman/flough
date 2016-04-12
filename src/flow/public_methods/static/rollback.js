const _ = require('lodash');
const kue = require('kue');
const Promise = require('bluebird');

/**
 * Reset an active Flow instance back to a certain step
 * @method Flow.rollback
 * @memberOf Flow
 * @alias Flow.rollback
 * @public
 * @param {Flow~privateData} _d - Private Flow data
 * @param {string} UUID - The UUID of a flow
 * @param {number} stepNumber - The step number to rollback to
 * @returns {Promise}
 */
function rollback(_d, UUID, stepNumber) {

    return _d.Flow.status(UUID)
        .then(flowData => {
            return new Promise((resolve, reject) => {

                // Build mongoose update object
                const updateObject = {};
                updateObject.stepsTaken = stepNumber - 1;
                updateObject.substepsTaken = [];
                updateObject.phase = 'NoPhase';
                updateObject.ancestors = _.omitBy(flowData.ancestors, (value, key) => flowData.stepsTaken <= parseInt(key, 10));

                // Update the flow's data in mongo
                this.FlowModel.update({ _id: UUID }, updateObject, (err, value) => {
                    if (err) reject(err);

                    resolve(value);
                });

            });
        })
        .then(flowData => {
            return new Promise((resolve, reject) => {

                // Find the job in Kue and restart it
                kue.Job.get(flowData.jobId, flowData.type, (err, job) => {
                    if (err) reject(err);

                    // Remove the instance from memory if stored there
                    if (_d.flowInstances.has(UUID)) _d.flowInstances.remove(UUID);

                    // Restarts the job
                    job.inactive();
                    resolve();
                });
            });
        })
        .catch(err => {
            _d.Logger.error(`Error resetting flow ${UUID}: ${ err.stack}`);
        });
}

export default rollback;
