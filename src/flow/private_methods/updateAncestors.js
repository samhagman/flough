const Promise = require('bluebird');
const util = require('util');

/**
 * Takes information about a job and persists it to mongo and updates instance
 * @param _d
 * @param flowInstance
 * @param {object} job - A Kue job object
 * @param {Number} step - the step this job is occurring on.
 * @param {Number} substep - the substep this job is occurring on.
 * @returns {bluebird|exports|module.exports|Job}
 */
export default function updateAncestors(_d, flowInstance, job, step, substep) {

    return new Promise((resolve, reject) => {

        const Logger = _d.Logger;

        // Push job on to the activeChildren stack
        //Logger.error(')()()()(BEFOREEEEE RElating job here is activeChildren', _this.activeChildren);
        //Logger.error(_this);

        flowInstance.activeChildren.push[ job ];

        //Logger.error(')()()()(AFTER RElating job here is activeChildren', _this.activeChildren);
        _d.FlowModel.findOneAndUpdate({ _id: flowInstance.uuid }, {
            $set: {
                [`ancestors.${step}.${substep}`]: {
                    data:   job.data,
                    result: null
                }
            }
        }, { new: true }, (err, flowDoc) => {
            if (err) {
                Logger.error(`Error updating ancestors: ${err.stack}`);
                Logger.debug(util.inspect(flowDoc, { depth: null, colors: true }));
                reject(job);
            }

            // If this job is part of a helper flow, update parent flows ancestors with this info
            else {

                flowInstance.ancestors = flowDoc.ancestors;

                if (flowInstance.isChild) {

                    _d.FlowModel.findOneAndUpdate({ _id: flowInstance.parentUUID }, {
                        $set: {
                            [`ancestors.${flowInstance.data._step}.${flowInstance.data._substep}.data._ancestors`]: flowDoc.ancestors
                        }
                    }, { new: true, upsert: true }, (err, parentFlowDoc) => {
                        if (err) {
                            Logger.error(`Error updating parent flow's ancestors: ${err}`);
                            reject(job);
                        }
                        else {
                            resolve(job);
                        }
                    });
                }
                else {
                    resolve(job);
                }
            }
        });

    });
}