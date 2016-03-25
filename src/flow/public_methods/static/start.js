const _ = require('lodash');
const crypto = require('crypto');
const util = require('util');
const ObjectId = require('mongoose').Types.ObjectId;
const Promise = require('bluebird');

/**
 * Start up a type of Flow instance using the given data
 * @method Flow.start
 * @public
 * @param {object} _d - Object holding private Flow class data
 * @param {string} flowType - The type of flow to start
 * @param {object} [givenData={}] - The data given to initialize the flow
 * @param {boolean} [isChild=false] - Whether or not this is the child of a parent flow
 * @returns {Promise.<Flow>}
 */
function start(_d, flowType, givenData = {}, isChild = false) {

    const Flow = _d.Flow;

    const Logger = _d.Logger;

    // Clone the given data to modify
    let flowData = _.clone(givenData);

    // If there was no stepsTaken set, set it to the default: -1
    if (!flowData._stepsTaken) {
        flowData._stepsTaken = -1;
    }

    // If there were no substepsTaken, set it to the default: empty array
    if (!flowData._substepsTaken) {
        flowData._substepsTaken = [];
    }

    if (!flowData._parentUUID) {
        flowData._parentUUID = 'NoFlow';
    }

    if (!flowData._parentType) {
        flowData._parentType = 'NoFlow';
    }

    // If no type, set it to the flow's name that was passed in
    if (!flowData._type) {
        flowData._type = flowType;
    }

    // Set the isChild property
    flowData._isChild = isChild;

    // Get the dynamicPropertyFunc that was registered to this flow type
    const dynamicPropFunc = _d.dynamicPropFuncs[ flowType ];

    // Get the job options that were registered to this flow type
    const jobOptions = _d.jobOptions[ flowType ];

    // Get the field names that should not be saved into Kue (and stringified)
    const noSaveFieldNames = jobOptions.noSave || [];

    // Remove the fields we shouldn't save
    const newData = _.omit(flowData, noSaveFieldNames);

    if (!_.isFunction(dynamicPropFunc)) {

        Logger.error(`Dynamic property passed was not a function for job type ${flowType}`);
        Logger.error(util.inspect(dynamicPropFunc));
        return Promise.reject(new Error('Dynamic property passed was not a function.'));

    }

    // Build dynamic properties and merge them into the given data
    let dynamicProperties = dynamicPropFunc(newData);
    let mergedProperties = _.merge(newData, dynamicProperties);

    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
    return persistFlow(_d, mergedProperties)
        .then(finalProps => {

            // Get the kueJob for this flow
            const kueJob = _d.queue.create(`flow:${flowType}`, finalProps);

            // Setup Flow Controller
            const flowInstance = new _d.Flow(kueJob);

            // Attach data that wasn't saved to Kue/MongoDB
            flowInstance.data = _.merge(flowInstance.data, _.pick(flowData, noSaveFieldNames));

            // Save the instance of this flow so the register function can inject this instance that was created here
            _d.flowInstances.set(finalProps._uuid, flowInstance);

            return Promise.resolve(flowInstance);
        })
        .catch(err => {
            Logger.error('Error starting flow: \n' + err.stack);
            return Promise.reject(err);
        });
}


function persistFlow(_d, mergedProperties) {
    const Logger = _d.Logger;

    // If no uuid, create a random ObjectId for it
    if (!mergedProperties._uuid) {
        const randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = crypto.randomBytes(1)[ 0 ] % 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
            return v.toString(16);
        });
        mergedProperties._uuid = (new ObjectId(randomStr)).toString();

        //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
        return _d.FlowModel.create(
            {
                _id:           mergedProperties._uuid,
                type:          mergedProperties._type,
                jobId:         -1,
                stepsTaken:    mergedProperties._stepsTaken,
                substepsTaken: mergedProperties._substepsTaken,
                jobData:       {},
                isParent:      true,

                // Reinitialize with related jobs if this is a helper flow
                ancestors: mergedProperties._ancestors || {},
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
                    //Logger.info(`[${data._uuid}] New Flow created. Flow.start() complete.`);
                    return Promise.resolve(mergedProperties);
                }
            })
            ;

    }
    else {
        // Look for the passed uuid, if found => restart flow, if not => create a new flow record
        return _d.FlowModel.findById(mergedProperties._uuid)
            .then((flowDoc, err) => {

                // Handle error
                if (err) {
                    Logger.error(`[${mergedProperties._uuid}] Error finding flowRecord in Flow constructor`);
                    Logger.error(`[${mergedProperties._uuid}] ${err}`);
                    Logger.error(`[${mergedProperties._uuid}] ${flowDoc}`);
                    return Promise.reject(err);
                }

                // The passed _id wasn't found, this is a new Flow
                else if (!flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                    return _d.FlowModel.create(
                        {
                            _id:           mergedProperties._uuid,
                            type:          mergedProperties._type,
                            jobId:         -1,
                            stepsTaken:    mergedProperties._stepsTaken,
                            substepsTaken: mergedProperties._substepsTaken,
                            jobData:       {},
                            isParent:      true,

                            // Reinitialize with related jobs if this is a helper flow
                            ancestors: mergedProperties._ancestors || {},
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
                                //Logger.info(`[${data._uuid}] New Flow created. Flow.start() complete.`);
                                return Promise.resolve(mergedProperties);
                            }
                        });
                }

                // Found the _id in Mongo, we are restarting a failed Flow
                else if (flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                    // Restart Flow with values that were saved to storage
                    mergedProperties._stepsTaken = flowDoc.stepsTaken;
                    mergedProperties._substepsTaken = flowDoc.substepsTaken;
                    mergedProperties._ancestors = flowDoc.ancestors;
                    return Promise.resolve(mergedProperties);
                }
                else {
                    return Promise.reject(new Error(`[${mergedProperties._uuid}] Something went very very wrong when start()ing Flow...`));
                }
            })
            ;
    }
}

function rollBackPersist() {

}

export default start;
