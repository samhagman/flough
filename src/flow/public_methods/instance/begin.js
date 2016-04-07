const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Initializes a Flow chain
 * @method Flow#beginChain
 * @public
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {Promise[]} [promiseArray=[]] - Array of promises to resolve before first job of flow will run, not necessarily before the .beginChain() will run.
 * @returns {Flow}
 */
function beginChain(_d, promiseArray = []) {

    const _this = this;
    const { Logger } = _d;

    // Attach User passed promises to resolve before any flow.job()s run.
    _this.promised[ '0' ].concat(promiseArray);

    // Attach Flow's initialization function that either creates a new Flow record in storage or restarts
    // itself from a previous record.
    _this.promised[ '0' ].push(new Promise((resolve, reject) => {

        try {

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

                        // Found the _id in Mongo, we are restarting a failed Flow
                        else if (flowDoc) {

                            //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                            // Restart Flow with values that were saved to storage
                            _this.stepsTaken = flowDoc.stepsTaken;
                            _this.substepsTaken = flowDoc.substepsTaken;
                            _this.ancestors = flowDoc.ancestors;

                            // Update everywhere that this Flow is now a parent
                            this.isParent = true;
                            return _d.FlowModel.findByIdAndUpdate(_this.UUID, { isParent: true })
                                .exec()  // return a full-fledged promise from Mongoose
                                .then(() => resolve(_this));
                        }
                        else {
                            return reject(new Error(`[${_this.uuid}] Something went very very wrong when beginning Flow...`));
                        }
                    })
                ;
            }
            else {
                return reject(new Error(`[${_this.uuid}] uuid passed to Flow.start() is not a valid ObjectId.`));
            }

        }
        catch (err) {
            Logger.error(err.stack);

            return reject(err);
        }
    }));

    return _this;
}

export default beginChain;
