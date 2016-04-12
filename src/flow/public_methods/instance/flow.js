const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Adds a child flow to the flow chain
 * @method Flow#flow
 * @public
 * @this Flow
 * @param {Flow~privateData} _d - Private Flow data
 * @param {number} step - The step in the chain to add this flow to
 * @param {string} type - The type of flow to add
 * @param {object|function} [flowData={}]
 * @returns {Flow}
 */
function flow(_d, step, type, flowData = {}) {

    const _this = this;
    const { Logger, Flow } = _d;

    if (!_this.buildPromise) throw new Error('Cannot call `Flow#flow` before `Flow#save`.');
    if (!_this.isParent) throw new Error('Cannot call `Flow#flow` before `Flow#beginChain`.');

    Promise.all(_this.promised[ '0' ])
        .then(promised => {

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

            /* Push job handler for this function into the job handler's array to be eventually handled by .endChain(). */

            // I never want to type job handler again...
            _this.flowHandlers.push(() => {

                // .handleChild() will eventually determine when and if to run this job based on step, substep,
                // and previous completion
                return _d.handleChild(_this, step, substep, currentAncestors => {
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
                            finalJobData._isChild = true;

                            /**
                             * Start the flow.
                             */

                            const flow = new Flow(type, finalJobData);

                            // When job is enqueued into Kue, relate the job to this flow.
                            let updateAncestorsPromise;
                            flow.on('enqueue', () => {
                                process.nextTick(() => {
                                    updateAncestorsPromise = _d.updateAncestors(_this, flow, step, substep);
                                });
                            });

                            // When job is complete, resolve with job and result.
                            flow.on('complete', (result) => {
                                updateAncestorsPromise
                                    .then(() => {
                                        _this.flowLogger('Completed child flow duties.', flow.data._uuid, flow.id);
                                        flowResolve([ flow, (result ? result : null) ]);
                                    })
                                    .catch((err) => flowReject(err))
                                ;
                            });

                            flow
                                .save()
                                .error(err => flowReject(err))
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

export default flow;
