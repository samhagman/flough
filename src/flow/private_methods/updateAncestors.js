const Promise = require('bluebird');
const util = require('util');

/**
 * Takes information about a kueJob and persists it to mongo and updates instance
 * @memberOf Flow
 * @protected
 * @param {Flow~privateData} _d - Private Flow data
 * @param {Flow} flowInstance - The instance of Flow to act upon
 * @param {object} kueJob - A Kue job object
 * @param {number} step - the step of the flowInstance the ancestor should be inserted at
 * @param {number} substep - the substep of the flowInstance the ancestor should be inserted at
 * @returns {Promise.<object>} - The Kue Job that was used to update the flowInstance
 */
function updateAncestors(_d, flowInstance, kueJob, step, substep) {

    return new Promise((resolve, reject) => {

        const Logger = _d.Logger;

        // Push kueJob on to the activeChildren stack
        //Logger.error(')()()()(BEFOREEEEE RElating kueJob here is activeChildren', _this.activeChildren);
        //Logger.error(_this);

        flowInstance.activeChildren.push[ kueJob ];

        //Logger.error(')()()()(AFTER RElating kueJob here is activeChildren', _this.activeChildren);
        _d.FlowModel.findOneAndUpdate({ _id: flowInstance.uuid }, {
            $set: {
                [`ancestors.${step}.${substep}`]: {
                    data:   kueJob.data,
                    result: null
                }
            }
        }, { new: true }, (err, flowDoc) => {
            if (err) {
                Logger.error(`Error updating ancestors: ${err.stack}`);
                Logger.debug(util.inspect(flowDoc, { depth: null, colors: true }));
                reject(kueJob);
            }

            // If this kueJob is part of a helper flow, update parent flows ancestors with this info
            else {

                flowInstance.ancestors = flowDoc.ancestors;

                if (flowInstance.isChild) {

                    _d.FlowModel.findOneAndUpdate({ _id: flowInstance.parentUUID }, {
                        $set: {
                            [`ancestors.${flowInstance.data._step}.${flowInstance.data._substep}.data._ancestors`]: flowDoc.ancestors
                        }
                    }, { new: true, upsert: true }, (err, parentFlowDoc) => {
                        if (err) {
                            Logger.error(`Error updating parent flow's ancestors: ${err.stack}`);
                            reject(err);
                        }
                        else {
                            resolve(kueJob);
                        }
                    });
                }
                else {
                    resolve(kueJob);
                }
            }
        });

    });
}

export default updateAncestors;
