const Promise = require('bluebird');

/**
 * Cancels this flow, cancels all currently running jobs related to this Flow.
 * @method Flow.cancel
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {object} [cancellationData] - Data to be sent along with the cancellation event
 * @returns {Promise.<Flow>}
 */
export default function cancel(_d, cancellationData) {

    return Promise.all(this.promised[ '0' ]).then(() => {

        const _this = this;
        const Logger = _d.Logger;

        return new Promise((resolve, reject) => {
            //Logger.debug(`activeChildren:`);
            //Logger.debug(_this.activeChildren);

            _this.isCancelled = true;

            const cancelFlowJob = () => {
                _this.kueJob.log('Flow was cancelled.');
                _this.flowLogger('Flow was cancelled', _this.uuid, _this.kueJob.id);
                _this.kueJob.failed();
            };

            _this.activeChildren.forEach((job) => {

                _d.FloughInstance.emit(`CancelFlow:${job.data._uuid}`, cancellationData);

            });

            _d.FlowModel.findByIdAndUpdate(_this.uuid, { isCancelled: true }, { new: true }, (err, flowDoc) => {
                if (err) {
                    Logger.error(`Error setting flow as cancelled in MongoDB. Flow ${_this.uuid} still has 'isCancelled' as false.`);
                    Logger.error(err.stack);
                    cancelFlowJob();
                    return reject(err);
                }
                else if (!flowDoc) {
                    const errorMsg = `UUID of ${_this.uuid} is not in MongoDB and could not be set to cancelled.`;
                    Logger.error(errorMsg);
                    cancelFlowJob();
                    return reject(errorMsg);
                }
                else {
                    Logger.info(`${_this.loggerPrefix} cancelled successfully.`);
                    cancelFlowJob();
                    return resolve(_this);
                }
            });
        });

    });
}
