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
        .then(([flowData]) => {

            return new Promise((resolve, reject) => {

                _d.Logger.debug(flowData);
                if (!(flowData.isParent && flowData.ancestors)) return reject(new Error('Flow is not a parent.'));
                if (!flowData) return reject(new Error(`Error rolling back flow ${UUID}: Flow wasn't found in MongoDB`));

                // Find the job in Kue
                kue.Job.get(flowData.jobId, flowData.type, (err, job) => {
                    // Check to see if error is that job doesn't exist
                    if (err && err.message.indexOf('doesnt exist') === -1) {
                        return reject(err);
                    }

                    // Remove the instance from memory if stored there
                    if (_d.flowInstances.has(UUID)) _d.flowInstances.remove(UUID);

                    if (job) {
                        return resolve([ flowData, job ]);
                    }
                    else {
                        return reject(new Error(`Job number ${flowData.jobId} is not an active job.`));
                    }
                });
            });
        })
        .spread((flowData, job) => {

            return gatherAllDescendantJobIds(flowData)
                .then(childrenArray => {

                    // Turn array into Map for faster lookup later
                    const childrenData = childrenArray.reduce((prev, curr) => {
                        prev[ curr ] = true;
                        return prev;
                    }, {});

                    return Promise.resolve([ flowData, job, childrenData ]);
                });
        })
        .spread((flowData, job, childrenData) => {

            _d.queue.complete((err, completedJobIds) => {
                _d.queue.inactive((err, inactiveJobIds) => {
                    _d.queue.active((err, activeJobIds) => {
                        _d.queue.failed((err, failedJobIds) => {
                            const kueJobIds = _.concat(completedJobIds, inactiveJobIds, activeJobIds, failedJobIds);

                            kueJobIds.forEach(jobId => {
                                kue.Job.get(jobId, (err, job) => {
                                    // Check to see if error is that job doesn't exist
                                    if (job && !(err && err.message.indexOf('doesnt exist') === -1)) {

                                        // Lookup UUID in childrenData map and remove the job if it is found
                                        if (childrenData[ job.data._uuid ]) {
                                            job.remove();
                                        }
                                    }
                                });
                            });
                        });
                    });
                });
            });

            return Promise.resolve([flowData, job, childrenData]);
        })
        .spread((flowData, job, childrenData) => {

            return new Promise((resolve, reject) => {

                // Build mongoose update object
                const updateObject = {};
                updateObject.stepsTaken = stepNumber - 1;
                updateObject.substepsTaken = [];
                updateObject.phase = 'NoPhase';
                updateObject.ancestors = _.omitBy(flowData.ancestors, (value, key) => flowData.stepsTaken <= parseInt(key, 10));

                _d.FlowModel.findOneAndUpdate({ _id: UUID }, updateObject, { new: true }, (err, newFlowData) => {
                    if (err) return reject(err);

                    // Restart the job
                    job.inactive();

                    return resolve([ newFlowData, childrenData ]);
                });
            });
        })
        .catch(err => {
            _d.Logger.error(`Error rolling back flow ${UUID}: ${ err.stack}`);
            throw err;
        });

    function gatherAllDescendantJobIds(flowData) {

        let descendantJobIds = [];

        return new Promise((resolve, reject) => {
            let childrenUUIDs = [];
            _.forOwn(flowData.ancestors, (substepMap) => {
                _.forOwn(substepMap, substep => childrenUUIDs.push(substep.data._uuid));
            });

            return resolve(childrenUUIDs);
        })
            .then(childrenUUIDs => {
                _d.Logger.debug(childrenUUIDs);
                return new Promise((resolve, reject) => {
                    _d.FlowModel.find({ uuid: { $in: childrenUUIDs } }, (err, flowDocs) => {
                        if (err) reject(err);
                        return resolve(flowDocs.map(flowDoc => flowDoc.toJSON()));
                    });
                });
            })
            .then(childrenFlows => {
                let gatheringPromises = [];
                childrenFlows.forEach(childFlow => {
                    descendantJobIds.push(childFlow.uuid);
                    if (childFlow.isParent && childFlow.ancestors) {
                        gatheringPromises.push(gatherAllDescendantJobIds(childFlow));
                    }
                });

                return Promise.all(gatheringPromises);
            })
            .then(childJobIds => Promise.resolve(descendantJobIds.concat(childJobIds)));
    }
}


export default rollback;
