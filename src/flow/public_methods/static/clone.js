const _ = require('lodash');
const Promise = require('bluebird');

/**
 * @this Flow
 * @param {object} privateData - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
export default function cloneFlow(privateData, UUID) {

    // Get the flow's data
    return privateData.Flow.status(UUID)
        .then(flowData => {

            // Create a copy of all data that isn't flough's private data ('_' prefixed)
            const newFlowData = _.omitBy(flowData.jobData, (value, key) => key.charAt(0) === '_');

            // start the flow with the new data
            return privateData.Flow.start(flowData.jobData._type, newFlowData, flowData.jobData._isChild)
        });
}
