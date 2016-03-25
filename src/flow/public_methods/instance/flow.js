const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Adds a child flow to the flow chain
 * @method Flow.flow
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {number} step - The step in the chain to add this flow to
 * @param {string} type - The type of flow to add
 * @param {object|function} [flowData]
 * @returns {Flow}
 */
export default function flow(_d, step, type, flowData = {}) {

    const _this = this;
    const Logger = _d.Logger;
    const Flow = _d.Flow;

    Promise.all(_this.promised[ '0' ])
        .then((promised) => {

            let substep;

            /* Determine Step/Substep */

            // If we already have substeps at this step, increase substeps by 1 and set substep to the result
            if (_this.substeps[ step ]) {
                _this.substeps[ step ] += 1;
                substep = _this.substeps[ step ];
            }

            // If no substeps at this step, set them to 1 and set substep to 1
            else {
                _this.substeps[ step ] = 1;
                substep = 1;
            }

            //Logger.debug(`Step: ${step}, Substep: ${substep}`);

            /* Push job handler for this function into the job handler's array to be eventually handled by .end(). */

            // I never want to type job handler again...
            _this.flowHandlers.push(() => {

                // .handleChild() will eventually determine when and if to run this job based on step, substep,
                // and previous completion
                return _d.handleChild(_this, step, substep, (currentAncestors) => {
                    return new Promise((flowResolve, flowReject) => {
                        try {

                            /* Build data to attach to the Kue job's data. */

                            // Build finalJobData from either passed object or passed function.
                            let finalJobData;

                            if (_.isFunction(flowData)) {
                                finalJobData = flowData(currentAncestors);
                            }
                            else if (_.isObject(flowData)) {
                                finalJobData = flowData;
                            }
                            else {
                                _this.flowLogger(`Step ${step} was a flow that was not passed either an object or function for it's job data.`);
                                Logger.error(`[FLOW][${_this.uuid}][STEP][${step}][SUBSTEP]${substep}] was passed a bad job data.`);
                                Logger.error(`Bad flow data: ${JSON.stringify(flowData)}`);
                                flowReject(`Bad flow data: ${JSON.stringify(flowData)}`);
                            }

                            // Attach step and substep information to the job.
                            finalJobData._step = step;
                            finalJobData._substep = substep;
                            finalJobData._type = type;

                            // Reuse the previous uuid if there is one.
                            finalJobData._uuid = _.get(currentAncestors, `${step}.${substep}.jobData._uuid`, null);

                            // Reinitialize flow with the correct steps/substeps taken.
                            finalJobData._stepsTaken = _.get(currentAncestors, `${step}.${substep}._stepsTaken`, null);
                            finalJobData._substepsTaken = _.get(currentAncestors, `${step}.${substep}._substepsTaken`, null);

                            // Attach past results to job's data before starting it, so users can
                            // access these.
                            finalJobData._ancestors = _.get(currentAncestors, `${step - 1}`, {});

                            // Grab the previous step's results (if there are any)
                            let lastStepResult = {};

                            for (let key of Object.keys(finalJobData._ancestors)) {
                                lastStepResult[ `${key}` ] = finalJobData._ancestors[ key ].result;
                            }

                            finalJobData._lastStepResult = lastStepResult;

                            // Set parent values on child flow
                            finalJobData._parentUUID = _this.uuid;
                            finalJobData._parentType = _this.type;

                            /**
                             * Start the flow.
                             */

                            Flow.start(type, finalJobData, true)
                                .then(flowJob => {

                                    // When job is enqueued into Kue, relate the job to this flow.
                                    let updateAncestorsPromise;
                                    let updateJobIdPromise;
                                    flowJob.on('enqueue', () => {

                                        // TODO? Maybe have to also update flow's jobId lke in job function
                                        updateAncestorsPromise = _d.updateAncestors(flowInstance, flowJob, step, substep);
                                        updateJobIdPromise = _d.updateJobId(flowInstance, job, step, substep);
                                    });

                                    // When job is complete, resolve with job and result.
                                    flowJob.on('complete', (result) => {
                                        Promise.join(updateAncestorsPromise, updateJobIdPromise)
                                            .then(() => {
                                                _this.flowLogger('Completed child flow duties.', flowJob.data._uuid, flowJob.id);
                                                flowResolve([ flowJob, (result ? result : null) ]);
                                            })
                                            .catch((err) => flowReject(err))
                                        ;
                                    });

                                    // Actually start this job inside Kue.
                                    flowJob.save(err => {
                                        if (err) {
                                            Logger.error(err.stack);
                                        }
                                    });
                                })
                            ;
                        }
                        catch (err) {
                            flowReject(err);
                        }
                    });
                });
            });

        })
    ;

    return _this;
}