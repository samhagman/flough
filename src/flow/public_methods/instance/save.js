const Promise = require('bluebird');

export default Promise.method(save);

/**
 * Proxy method for calling kueJob#save which makes Kue run the registered job
 * @method save
 * @memberOf Flow
 * @public
 * @this Flow
 * @param {Flow~privateData} _d - Private Flow data
 * @returns {Promise.<Flow>}
 */
function save(_d) {

    const _this = this;

    let buildFlowData = _this.buildPromise !== null
        ? _this.buildPromise  // If Flow#build already called by user, just wait for it to finish
        : _this.build()       // If Flow#build
    ;

    return buildFlowData.then(() => {

        return new Promise((resolve, reject) => {

            // This actually triggers the Flow's registered function to start running
            _this.kueJob.save(err => {
                if (err) return reject(err);

                return saveToMongoDB(_d, _this).then(() => resolve(_this)).catch(err => reject(err));
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
        .then((flowDoc, err) => {

            // Handle error
            if (err) {
                Logger.error(`[${flowInstance.uuid}] Error finding flowRecord in Flow constructor`);
                Logger.error(`[${flowInstance.uuid}] ${err}`);
                Logger.error(`[${flowInstance.uuid}] ${flowDoc}`);
                return Promise.reject(err);
            }
            // The passed _id wasn't found, this is a new Flow
            else if (!flowDoc) {

                //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                return FlowModel
                    .create({
                        _id:           flowInstance.uuid,
                        type:          flowInstance.type,
                        jobId:         flowInstance.jobId,
                        stepsTaken:    flowInstance.stepsTaken,
                        substepsTaken: flowInstance.substepsTaken,
                        data:          flowInstance.data,
                        isParent:      true,

                        // Reinitialize with related jobs if this is a helper flow
                        ancestors: flowInstance.ancestors || {},
                        logs:      [],
                        childLogs: []
                    })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(err.stack);
                            return Promise.reject(err);
                        }
                        else {
                            //Logger.debug('Correctly made mongo doc');
                            //Logger.info(`[${data._uuid}] New Flow created. Flow.save() complete.`);
                            return Promise.resolve(flowInstance);
                        }
                    });
            }

            // Found the _id in Mongo, we are restarting a failed Flow
            else if (flowDoc) {

                //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                // Update that the flow was restarted
                flowDoc.isRestarted = true;
                flowDoc.save();

                return Promise.resolve(flowInstance);
            }
            else {
                return Promise.reject(new Error(`[${flowInstance.uuid}] Something went very very wrong when start()ing Flow...`));
            }
        });
}

// TODO remove partially initialized Flows if there is an error
// function rollBackPersist() {
//
// }
