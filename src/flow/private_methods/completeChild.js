const Promise = require('bluebird');
const setPath = require('../../util/setPath');
const _ = require('lodash');

/**
 * Increments the substeps taken by the Flow on the instance and in Mongo,
 * sets the Job record in mongo as complete,
 * and adds the flowJob's results to the Flow instance, Flow mongodb record, and Job mongodb record.
 * @returns {Promise}
 */
export default function completeChild(_d, flowInstance, flowJob, jobResult) {
    return new Promise((resolve, reject) => {
        const Logger = _d.Logger;

        if (flowJob) {
            // Create field to update
            const relatedJobResultField = `ancestors.${flowJob.data._step}.${flowJob.data._substep}.result`;

            // Update instance with this result
            setPath(flowInstance, relatedJobResultField, jobResult);

            // Find this Flow's doc in Mongo and update the substeps taken
            _d.FlowModel.findByIdAndUpdate(flowInstance.uuid, {
                    $addToSet: { substepsTaken: flowJob.data._substep },
                    $set:      { [relatedJobResultField]: jobResult }
                }, { new: true })
                .then((flowDoc, err) => {
                    if (err) {
                        Logger.error(`[${flowInstance.uuid}] Error incrementing Flow step.`);
                        return reject(err);
                    }
                    else {

                        // Remove flowJob from activeChildren
                        flowInstance.activeChildren = _.remove(flowInstance.activeChildren, (activeJob) => {
                            return activeJob.id === flowJob.id;
                        });

                        // Update the substeps taken on this flow instance
                        flowInstance.substepsTaken = flowDoc.substepsTaken;

                        return resolve(flowJob);
                    }
                })
            ;
        }
        else {

            return resolve(null);
        }
    });
}
