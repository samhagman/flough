const kue = require('kue');
const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Restart a flow so it is re-initialized in memory and in Kue
 * @method Flow.restart
 * @public
 * @param {Flow~privateData} _d - Private Flow data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise.<Flow>}
 */
function restart(_d, UUID) {

    return _d.Flow.status(UUID)
        .then(foundFlows => {
            if (foundFlows.length === 0) {
                return Promise.reject(new Error('Could not find a Flow with that UUID'));
            }
            else if (foundFlows.length === 1 && foundFlows[ 0 ].isChild === false) {
                _d.Logger.debug(foundFlows[ 0 ]);
                return Promise.resolve(foundFlows[ 0 ]);
            }
            else {
                return Promise.reject(new Error(`Only top-level parent flows can be safely restarted.`));
            }
        })
        .then(flowData => {
            return Promise.join(
                _d.flowInstances.get(UUID).timeout(1000).catchReturn(Promise.TimeoutError, false),
                Promise.resolve(flowData)
            );
        })
        .spread((isInMemory, flowData) => {

            return new Promise((resolve, reject) => {

                // If flow is saved in memory, remove it
                if (isInMemory) _d.flowInstances.remove(UUID);

                // Find the job in Kue and remove it
                kue.Job.get(flowData.jobId, flowData.type, (err, job) => {

                    // Check to see if error is that job doesn't exist
                    if (err && err.message.indexOf('doesnt exist') === -1) {
                        reject(err);
                    }

                    // Remove the job for Kue
                    if (job) {
                        job.inactive();
                    }

                    return resolve(flowData);
                });
            });
        })
        .then(flowData => removeDescendants(flowData))
        .catch(err => {
            _d.Logger.error(`Error restarting flow ${UUID}: \n ${err.stack}`);
            throw err;
        });


    function removeDescendants(flowData) {

        return gatherAllDescendantJobIds(flowData)
            .then(childrenArray => {

                // Turn array into Map for faster lookup later
                const childrenData = childrenArray.reduce((prev, curr) => {
                    prev[ curr ] = true;
                    return prev;
                }, {});

                return Promise.resolve([ flowData, childrenData ]);
            })
            .spread((flowData, childrenData) => {

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

                return Promise.resolve([ flowData, childrenData ]);
            });
    }

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



export default restart;
