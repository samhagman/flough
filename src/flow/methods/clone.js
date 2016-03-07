const _ = require('lodash');

/**
 * @this Flow
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
export default function cloneFlow(UUID) {

    return this.status(UUID)
        .then(flowData => {

            const newFlowData = _.omitBy(flowData.jobData, (value, key) => key.charAt(0) === '_');

            return this.start(flowData.jobData._flowType, newFlowData, flowData.jobData._helper)
        });
}
