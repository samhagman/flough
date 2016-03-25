const crypto = require('crypto');
const util = require('util');
const kue = require('kue');
const Promise = require('bluebird');

/**
 * Cancel a particular Flow by UUID
 * @method Flow.cancel
 * @public
 * @param {object} _d - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
function cancelFlow(_d, UUID) {

    return new Promise((resolve, reject) => {
        const Logger = _d.Logger;

        // Check that the flow exists in mongo
        _d.FlowModel.findById(UUID, (err, flow) => {
            if (err) {
                Logger.error('Error finding flow by UUID to cancel.');
                Logger.error(err.stack);
                return reject(err);
            }
            else {

                // Check that the flow exists in Kue
                kue.Job.get(flow.jobId, flow.type, (err, job) => {
                    if (err) {
                        return reject(new Error('Error finding kue job by ID to be cancelled. \n' + err.stack));
                    }
                    else {

                        // Cancel the flow by emitting a cancellation event
                        try {
                            _d.FloughInstance.emit(`CancelFlow:${UUID}`);
                            return resolve();
                        }
                        catch (err) {
                            Logger.error('Error emitting flow cancellation event from route.');
                            Logger.error(err.stack);
                            return reject(new Error('Error emitting cancellation event. \n' + err));
                        }
                    }
                });
            }
        });

    });

}

export default cancelFlow;
