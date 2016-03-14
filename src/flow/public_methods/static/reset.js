const _ = require('lodash');
const kue = require('kue');
const Promise = require('bluebird');

/**
 * @param {object} _d - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @param {number} stepNumber - The step number to reset to
 * @returns {Promise.<TResult>}
 */
export default function resetFlow(_d, UUID, stepNumber) {

    return _d.Flow.status(UUID)
        .then(flowData => {
            return new Promise((resolve, reject) => {

                // Build mongoose update object
                const updateObject = {};
                updateObject.stepsTaken = stepNumber - 1;
                updateObject.substepsTaken = [];
                updateObject.phase = 'NoPhase';
                updateObject.ancestors = _.omitBy(flowData.ancestors, (value, key) => parseInt(key, 10) >= flowData.stepsTaken);

                // Update the flow's data in mongo
                this.FlowModel.update({ _id: UUID }, updateObject, (err, value) => {
                    if (err) { reject(err); }
                    resolve(value);
                });

            });
        })
        .then(flowData => {
            return new Promise((resolve, reject) => {

                // Find the job in Kue and restart it
                kue.Job.get(flowData.jobId, flowData.type, (err, job) => {
                    if (err) { reject(err); }

                    // Restarts the job
                    job.inactive();
                    resolve();
                });
            });
        })
        .catch(err => {
            this.Logger.error(`Error resetting flow ${UUID}: \n ${err.stack}`);
        })
    ;
}