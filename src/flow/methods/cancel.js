const crypto = require('crypto');
const util = require('util');
let kue = require('kue');

/**
 * @this Flow
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
export default function cancelFlow(UUID) {

    return new Promise((resolve, reject) => {

        this.FlowModel.findById(UUID, (err, flow) => {
            if (err) {
                this.Logger.error('Error finding flow by UUID to delete.');
                this.Logger.error(err.stack);
                reject(err);
            }
            else {
                kue.Job.get(flow.jobId, (err, job) => {
                    if (err) {
                        reject(new Error('Error finding kue job by ID to be deleted. \n' + err.stack));
                    }
                    else {
                        try {
                            this.FloughInstance.emit(`CancelFlow:${UUID}`);
                        }
                        catch (err) {
                            this.Logger.error('Error emitting flow cancellation event from route.');
                            this.Logger.error(err.stack);
                            reject(new Error('Error emitting cancellation event. \n' + err));
                        }
                    }
                });
            }
        });

    });

}
