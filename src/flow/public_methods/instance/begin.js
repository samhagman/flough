const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Initializes the Flow, needed to finish construction of Flow instance
 * @method Flow#beginChain
 * @public
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {Promise[]} [promiseArray=[]] - Array of promises to resolve before first job of flow will run, not necessarily before the .beginChain() will run.
 * @returns {Flow}
 */
function begin(_d, promiseArray = []) {

    const _this = this;
    const Logger = _d.Logger;

    Logger.info(`${_this.loggerPrefix} - START FLOW`);

    // Attach User passed promises to resolve before any flow.job()s run.
    _this.promised[ '0' ].concat(promiseArray);

    // Attach Flow's initialization function that either creates a new Flow record in storage or restarts
    // itself from a previous record.
    _this.promised[ '0' ].push(new Promise((resolve, reject) => {

        try {

            // Listen for any cancellation event made by routes
            _d.FloughInstance.once(`CancelFlow:${_this.uuid}`, _this.cancel.bind(_this));

            // Validate this is a valid MongoId
            if (_d.FlowModel.isObjectId(_this.uuid)) {

                // Look for the passed uuid, if found => restart flow, if not => create a new flow record
                _d.FlowModel.findById(_this.uuid)
                    .then((flowDoc, err) => {

                        // Handle error
                        if (err) {
                            Logger.error(`[${_this.uuid}] Error finding flowRecord in Flow constructor`);
                            Logger.error(`[${_this.uuid}] ${err}`);
                            Logger.error(`[${_this.uuid}] ${flowDoc}`);
                            reject(err);
                        }

                        // The passed _id wasn't found, this is a new Flow
                        else if (!flowDoc) {

                            //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                            _d.FlowModel.create(
                                {
                                    _id:           _this.uuid,
                                    type:          _this.type,
                                    jobId:         _this.jobId,
                                    stepsTaken:    _this.stepsTaken,
                                    substepsTaken: _this.substepsTaken,
                                    jobData:       _this.data,
                                    isParent:      true,

                                    // Reinitialize with related jobs if this is a helper flow
                                    ancestors: _this.data._ancestors || {},
                                    logs:      [],
                                    childLogs: []
                                })
                                .then((flowDoc, err) => {
                                    if (err) {
                                        Logger.error(err.stack);
                                        reject(err);
                                    }
                                    else {
                                        //Logger.debug('Correctly made mongo doc');
                                        //Logger.info(`[${_this.uuid}] New Flow created. Flow.start() complete.`);
                                        resolve(_this);
                                    }
                                })
                            ;
                        }

                        // Found the _id in Mongo, we are restarting a failed Flow
                        else if (flowDoc) {

                            //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                            // Restart Flow with values that were saved to storage
                            _this.stepsTaken = flowDoc.stepsTaken;
                            _this.substepsTaken = flowDoc.substepsTaken;
                            _this.ancestors = flowDoc.ancestors;
                            resolve(_this);
                        }
                        else {
                            reject(new Error(`[${_this.uuid}] Something went very very wrong when start()ing Flow...`));
                        }
                    })
                ;
            }
            else {
                reject(new Error(`[${_this.uuid}] uuid passed to Flow.start() is not a valid ObjectId.`));
            }

        } catch (err) {
            Logger.error(err.stack);

            reject(err);
        }
    }));

    return _this;
}

export default begin;
