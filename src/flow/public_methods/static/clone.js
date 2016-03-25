const _ = require('lodash');

/**
 * Take an existing flow and start a copy of it
 * @method Flow.clone
 * @public
 * @param {object} _d - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise.<object>} - A flow instance
 */
function clone(_d, UUID) {

    // Get the flow's data
    return _d.Flow.status(UUID)
        .then(flowData => {

            // Create a copy of all data that isn't flough's private data ('_' prefixed)
            const newFlowData = _.omitBy(flowData.jobData, (value, key) => key.charAt(0) === '_');

            // start the flow with the new data
            return _d.Flow.start(flowData.jobData._type, newFlowData, flowData.jobData._isChild)
        });
}

export default clone;
