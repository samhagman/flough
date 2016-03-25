const Promise = require('bluebird');
const setPath = require('../../util/setPath');
const _ = require('lodash');

/**
 * - Increments the substeps taken by the Flow on the instance and in Mongo
 * - Sets the Job record in mongo as complete
 * - Adds the kueJob's results to the Flow instance and the Flow mongodb record
 * @memberOf Flow
 * @protected
 * @param {object} _d - Private Flow data
 * @param {Flow} flowInstance - Instance of Flow to act upon
 * @param {object} kueJob - Kue job for this child
 * @param {*} flowResult - The result of the child flow
 * @returns {Promise.<null|object>}
 */
function completeChild(_d, flowInstance, kueJob, flowResult) {
    return new Promise((resolve, reject) => {
        const Logger = _d.Logger;

        if (kueJob) {
            // Create field to update
            const relatedJobResultField = `ancestors.${kueJob.data._step}.${kueJob.data._substep}.result`;

            // Update instance with this result
            setPath(flowInstance, relatedJobResultField, flowResult);

            // Find this Flow's doc in Mongo and update the substeps taken
            _d.FlowModel.findByIdAndUpdate(flowInstance.uuid, {
                    $addToSet: { substepsTaken: kueJob.data._substep },
                    $set:      { [relatedJobResultField]: flowResult }
                }, { new: true })
                .then((flowDoc, err) => {
                    if (err) {
                        Logger.error(`[${flowInstance.uuid}] Error incrementing Flow step.`);
                        return reject(err);
                    }
                    else {

                        // Remove kueJob from activeChildren
                        flowInstance.activeChildren = _.remove(flowInstance.activeChildren, (activeJob) => {
                            return activeJob.id === kueJob.id;
                        });

                        // Update the substeps taken on this flow instance
                        flowInstance.substepsTaken = flowDoc.substepsTaken;

                        return resolve(kueJob);
                    }
                })
            ;
        }
        else {

            return resolve(null);
        }
    });
}

export default completeChild;
