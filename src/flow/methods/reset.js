const _ = require('lodash');
const crypto = require('crypto');
const util = require('util');
const ObjectId = require('mongoose').Types.ObjectId;

/**
 * @this Flow
 * @param {string} UUID - The UUID of a flow
 * @param {number} stepNumber - The step number to reset to
 * @returns {Promise}
 */
export default function resetFlow(UUID, stepNumber) {


    /*
    Update Flow
    - stepsTaken => stepNumber
    - substepsTaken => []
    - phase => NoPhase
    - relatedJobs => prune above stepNumber

    Find job in Kue and job.inactive() it.
     */

    
    let data = _.clone(givenData);

    if (!data._stepsTaken) {
        data._stepsTaken = -1;
    }

    if (!data._substepsTaken) {
        data._substepsTaken = [];
    }

    if (!data._flowId) {
        const randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            let r = crypto.randomBytes(1)[ 0 ] % 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
            return v.toString(16);
        });
        data._flowId = (new ObjectId(randomStr)).toString();
    }

    //if (!data._uuid) {
    //    data._uuid = new ObjectId(Date.now());
    //}

    if (!data._flowType) {
        data._flowType = flowName;
    }

    data._helper = helper;

    const dynamicPropFunc = this.FloughInstance._dynamicPropFuncs[ flowType ];

    const jobOptions = this.FloughInstance._jobOptions[ flowType ];

    const noSaveFieldNames = jobOptions.noSave || [];

    const newData = _.omit(data, noSaveFieldNames);

    this.FloughInstance._toBeAttached[ data._uuid ] = _.pick(data, noSaveFieldNames);

    if (_.isFunction(dynamicPropFunc)) {
        let dynamicProperties = dynamicPropFunc(newData);
        let mergedProperties = _.merge(newData, dynamicProperties);

        return queue.create(`flow:${flowType}`, mergedProperties);

    }
    else {
        this.Logger.error(`Dynamic property passed was not a function for job type ${flowType}`);
        this.Logger.error(util.inspect(dynamicPropFunc));
        throw new Error('Dynamic property passed was not a function.');
    }

}