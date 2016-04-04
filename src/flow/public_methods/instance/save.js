const Promise = require('bluebird');

/**
 * Proxy method for calling kueJob#save which makes Kue run the registered job
 * @method save
 * @memberOf Flow
 * @public
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {function} [cb] - Optional callback interface
 * @returns {Flow}
 */
function save(_d, cb) {

    const _this = this;

    return new Promise((resolve, reject) => {

        _this.kueJob.save(err => {
            if (err) return reject(err);

            return persistFlow(_d, _this.data).then(resolve).catch(err => reject(err));
        });

    }).asCallback(cb);

}

function persistFlow(_d, jobData) {
    const Logger = _d.Logger;

    // If no uuid, create a random ObjectId for it
    if (!jobData._uuid) {

        //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
        return _d.FlowModel.create(
            {
                _id:           jobData._uuid,
                type:          jobData._type,
                jobId:         jobData.jobId,
                stepsTaken:    jobData._stepsTaken,
                substepsTaken: jobData._substepsTaken,
                jobData:       {},
                isParent:      true,

                // Reinitialize with related jobs if this is a helper flow
                ancestors: jobData._ancestors || {},
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
                    return Promise.resolve(jobData);
                }
            });

    }
    else {
        // Look for the passed uuid, if found => restart flow, if not => create a new flow record
        return _d.FlowModel.findById(jobData._uuid)
            .then((flowDoc, err) => {

                // Handle error
                if (err) {
                    Logger.error(`[${jobData._uuid}] Error finding flowRecord in Flow constructor`);
                    Logger.error(`[${jobData._uuid}] ${err}`);
                    Logger.error(`[${jobData._uuid}] ${flowDoc}`);
                    return Promise.reject(err);
                }

                // The passed _id wasn't found, this is a new Flow
                else if (!flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                    return _d.FlowModel.create(
                        {
                            _id:           jobData._uuid,
                            type:          jobData._type,
                            jobId:         -1,
                            stepsTaken:    jobData._stepsTaken,
                            substepsTaken: jobData._substepsTaken,
                            jobData:       {},
                            isParent:      true,

                            // Reinitialize with related jobs if this is a helper flow
                            ancestors: jobData._ancestors || {},
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
                                return Promise.resolve(jobData);
                            }
                        });
                }

                // Found the _id in Mongo, we are restarting a failed Flow
                else if (flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                    // Restart Flow with values that were saved to storage
                    jobData._stepsTaken = flowDoc.stepsTaken;
                    jobData._substepsTaken = flowDoc.substepsTaken;
                    jobData._ancestors = flowDoc.ancestors;
                    return Promise.resolve(jobData);
                }
                else {
                    return Promise.reject(new Error(`[${jobData._uuid}] Something went very very wrong when start()ing Flow...`));
                }
            })
            ;
    }
}

// TODO remove partially initialized Flows if there is an error
// function rollBackPersist() {
//
// }

export default save;
