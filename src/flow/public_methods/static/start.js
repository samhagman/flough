const _ = require('lodash');
const crypto = require('crypto');
const util = require('util');
const ObjectId = require('mongoose').Types.ObjectId;
const Promise = require('bluebird');

/**
 * @this Flow
 * @param {object} privateData - Object holding private Flow class data
 * @param flowName
 * @param givenData
 * @param isChild
 * @returns {Promise}
 */
export default function startFlow(privateData, flowName, givenData = {}, isChild = false) {


    const Flow = privateData.Flow;
    const _d = privateData;

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
        flowData._type = flowName;
    }

    // Set the isChild property
    flowData._isChild = isChild;

    // Get the dynamicPropertyFunc that was registered to this flow type
    const dynamicPropFunc = _d.dynamicPropFuncs[ flowName ];

    // Get the job options that were registered to this flow type
    const jobOptions = _d.jobOptions[ flowName ];

    // Get the field names that should not be saved into Kue (and stringified)
    const noSaveFieldNames = jobOptions.noSave || [];

    // Remove the fields we shouldn't save
    const newData = _.omit(flowData, noSaveFieldNames);

    if (!_.isFunction(dynamicPropFunc)) {

        Logger.error(`Dynamic property passed was not a function for job type ${flowName}`);
        Logger.error(util.inspect(dynamicPropFunc));
        return Promise.reject(new Error('Dynamic property passed was not a function.'));

    }

    // Build dynamic properties and merge them into the given data
    let dynamicProperties = dynamicPropFunc(newData);
    let mergedProperties = _.merge(newData, dynamicProperties);

    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
    return persistFlow(privateData, mergedProperties)
        .then(finalProps => {

            // Add the fields that aren't going into Kue to a temp storage spot, to be attached back later
            _d.toBeAttached[finalProps._uuid] = _.pick(flowData, noSaveFieldNames);

            return Promise.resolve(_d.queue.create(`flow:${flowName}`, finalProps));
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