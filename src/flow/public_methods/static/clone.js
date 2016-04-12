const _ = require('lodash');
const Promise = require('bluebird');

/**
 * Take an existing flow and start a copy of it
 * @method Flow.clone
 * @public
 * @param {Flow~privateData} _d - Private Flow data
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
            return Promise.resolve(new _d.Flow(flowData.jobData._type, newFlowData));
        });
}

export default clone;
