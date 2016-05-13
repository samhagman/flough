const Promise = require('bluebird');
const util = require('util');

export default Promise.method(save);

/**
 * Proxy method for calling kueJob#save which makes Kue run the registered job
 * @method save
 * @memberOf Flow
 * @public
 * @this Flow
 * @param {Flow~privateData} _d - Private Flow data
 * @param {object} buildOptions - Options for building the Flow
 * @returns {Promise.<Flow>}
 */
function save(_d, buildOptions = {}) {

    const _this = this;
    const { Logger } = _d;

    let buildFlowData = _this.buildPromise !== null
            ? _this.buildPromise  // If Flow#build already called by user, just wait for it to finish
            : _this.build(buildOptions)  // If Flow#build has not been called
        ;

    return buildFlowData.then(() => {

        return new Promise((resolve, reject) => {

            // Attach data that was not persisted back onto the flow's data object
            const dataToAttach = _d.toBeAttached.get(_this);
            Object.assign(_this.data, dataToAttach);

            // Save the instance of this flow so the register function can inject this instance that was created here
            _d.flowInstances.set(_this.data._uuid, _this);

            // This actually triggers the Flow's registered function to start running
            _this.kueJob.save(err => {
                if (err) return reject(err);

                // Setup flow instance properties that require a kueJob id (which it gets after being .save()'d)
                _this.jobId = _this.kueJob.id;
                _this.loggerPrefix = `[${_this.type}][${_this.uuid}][${_this.kueJob.id}]`;

                return saveToMongoDB(_d, _this)
                    .then(() => resolve(_this))
                    .catch(err => reject(err));
            });

        });

    });
}

/**
 * Save the flow instance's data to MongoDB
 * @param {Flow~privateData} _d
 * @param {Flow} flowInstance
 * @returns {Promise.<{}>}
 */
function saveToMongoDB(_d, flowInstance) {
    const { Logger, FlowModel } = _d;

    // Look for the passed uuid, if found => restart flow, if not => create a new flow record
    return FlowModel
        .findById(flowInstance.uuid)
        .exec()
        .then((flowDoc) => {

            return new Promise((resolve, reject) => {
                // The passed _id wasn't found, this is a new Flow
                if (!flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                    return FlowModel
                        .create({
                            _id:           flowInstance.uuid,
                            uuid:          flowInstance.uuid,
                            type:          flowInstance.type,
                            jobId:         flowInstance.jobId,
                            stepsTaken:    flowInstance.stepsTaken || -1,
                            substepsTaken: flowInstance.substepsTaken || [],
                            data:          flowInstance.data,
                            isParent:      false,
                            isStarted:     false,

                            // Reinitialize with related jobs if this is a helper flow
                            ancestors: flowInstance.ancestors || {},
                            logs:      [],
                            childLogs: []
                        })
                        .then((flowDoc) => {
                            //Logger.debug('Correctly made mongo doc');
                            //Logger.info(`[${data._uuid}] New Flow created. Flow.save() complete.`);
                            return resolve(flowInstance);
                        })
                        .error(err => {
                            Logger.error('Error creating Mongoose Flow document.');
                            Logger.error(err.stack);
                            return reject(err);
                        });
                }

                // Found the _id in Mongo, we are restarting a failed Flow
                else if (flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                    // Update that the flow was restarted
                    flowDoc.isRestarted = true;
                    flowDoc.save();

                    return resolve(flowInstance);
                }
                else {
                    return reject(new Error(`[${flowInstance.uuid}] Something went very very wrong when start()ing Flow...`));
                }
            });

        })
        .then(flowInstance => {

            return Promise.resolve(flowInstance);
        })
        .error(err => {
            // Handle error
            Logger.error(`[${flowInstance.uuid}] Error finding flowRecord ${flowInstance.uuid} in Flow constructor`);
            Logger.error(`[${flowInstance.uuid}] ${err.stack}`);
        });
}

// TODO remove partially initialized Flows and kueJobs if there is an error
// function rollBackPersist() {
//
// }
