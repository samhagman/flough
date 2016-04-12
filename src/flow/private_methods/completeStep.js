const Promise = require('bluebird');
const _ = require('lodash');

/**
 * This increments the stepsTaken of this Flow on both the mongo doc and flow instance,
 * also resets the substepsTaken to [] on both the Mongo doc and the flow instance as well.
 * @memberOf Flow
 * @protected
 * @param {Flow~privateData} _d - Private Flow data
 * @param {Flow} flowInstance - The Flow instance to act upon
 * @param {number} step - The step that is being completed
 * @returns {Promise}
 */
function completeStep(_d, flowInstance, step) {
    return new Promise((resolve, reject) => {
        const Logger = _d.Logger;

        // Update the mongo doc's stepsTaken and substepsTaken
        _d.FlowModel.findByIdAndUpdate(flowInstance.uuid, {
                stepsTaken:    step,
                substepsTaken: []
            }, { new: true })
            .then((flowDoc, err) => {
                if (err) {
                    Logger.error(`[${flowInstance.uuid}] Error incrementing Flow step.`);
                    return reject(err);
                }
                else {
                    // Update the flow instance
                    flowInstance.stepsTaken = step;
                    flowInstance.substepsTaken = [];
                    return resolve();
                }
            })
        ;
    });
}

export default completeStep;
