const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Completes this Flow
 * 0. Waits for start() to finish, which includes any promises passed to start() by the user
 * 1. Cleans up the ancestors that were not completed if this flow restarted otherwise is a noop
 * 2. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
 * 3. Waits for all of the jobHandler promises to be done, that were just created.
 * 4. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls
 * itself once all the promises it initiated at a step are complete.
 *
 * Once endChain resolves, the flow function using this flow will call `done(result)` which will pass the result back
 * to the flowAPI.js file which will then call `.setFlowResult` on an instance of this class which will both set
 * this flow as complete and update the result the user passed inside of Mongo.
 * @method Flow#endChain
 * @public
 * @this Flow
 * @param {object} _d - Private Flow data
 * @returns {Promise.<Flow>}
 */
function endChain(_d) {

    const _this = this;
    const { Logger } = _d;

    if (!_this.buildPromise) throw new Error('Cannot call `Flow#endChain` before `Flow#save`.');
    if (!_this.isParent) throw new Error('Cannot call `Flow#endChain` before `Flow#beginChain`.');

    /**
     * Removes related jobs that were not completed before.  This is run inside of endChain() because jobs use their
     * uncompleted related jobs to reuse their UUIDs and/or uuids.
     * @returns {bluebird|exports|module.exports}
     */
    function cleanupAncestry() {

        return new Promise((resolve, reject) => {

            _d.FlowModel.findById(_this.uuid, (err, flowDoc) => {
                if (err) {
                    reject(err);
                }
                else if (flowDoc) {

                    // Flows to get
                    let subFlows = [];

                    // Remove ancestors that were added but their step/substep never completed
                    _this.ancestors = _(_this.ancestors)
                        .pick(_.range(1, _this.stepsTaken + 2))
                        .mapValues((substepsObj, step, obj) => {
                            const stepNum = parseInt(step, 10);

                            if (stepNum < _this.stepsTaken) {
                                return substepsObj;
                            }
                            else {
                                _.forOwn(substepsObj, (flowData, substep) => {
                                    if (!_.get(flowData, '.data._uuid', false)) {
                                        subFlows.push({ step, substep, uuid: flowData.data._uuid });
                                    }
                                });

                                if (_this.substepsTaken.length !== 0) {
                                    return _.pick(substepsObj, _this.substepsTaken);
                                }
                                else {
                                    return {};
                                }

                            }
                        })
                        .value()
                    ;

                    const attachFlowProgress = ({ step, substep, uuid }) => {
                        return new Promise((resolve, reject) => {
                            _d.FlowModel.findOne(uuid, (err, doc) => {
                                if (err) {
                                    Logger.error(err.stack);
                                    reject(err);
                                }
                                else {

                                    if (!_this.ancestors[ step ]) _this.ancestors[ step ] = {};

                                    _this.ancestors[ step ][ substep ] = doc;

                                    resolve({ step, substep, doc });
                                }
                            });
                        });
                    };

                    Promise
                        .all(subFlows.map(attachFlowProgress))
                        .then(docInfos => {
                            flowDoc.ancestors = _this.ancestors;
                            flowDoc.save(err => err
                                ? reject(err)
                                : resolve()
                            );
                        })
                    ;
                }
                else {
                    resolve();
                }

            });
        });
    }

    /**
     * This will set the steps taken for this flow to 0, meaning it has completed initialization (step 0)
     * @returns {bluebird|exports|module.exports}
     */
    function setStepsTakenToOne() {

        return new Promise((resolve, reject) => {
            _d.FlowModel.findById(_this.uuid, (err, flowDoc) => {
                if (err) {
                    Logger.error(err.stack);

                    reject(err);
                }
                else if (flowDoc) {

                    if (flowDoc.stepsTaken === -1) {
                        flowDoc.stepsTaken = 0;
                        _this.stepsTaken = 0;
                    }

                    flowDoc.save(err => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve();
                        }
                    });
                }
                else {
                    resolve();
                }
            });
        });
    }

    return new Promise((resolve, reject) => {
        // 0.
        Promise.all(_this.promised[ '0' ])

        // 1.
            .then(cleanupAncestry)

            // Set stepsTaken to 0 if they were -1 (initialization is complete)
            .then(setStepsTakenToOne)
            .then(() => {

                // 2.
                let jobHandlerPromises = _this.flowHandlers.map(promiseReturner => promiseReturner());

                // Find largest step number attached to _this.promised
                const lastStep = Math.max(...Object.keys(_this.promised).map(string => parseInt(string, 10)));

                // 3.
                Promise.all(jobHandlerPromises)
                    .then(() => {
                        //Logger.debug(`[${_this.uuid}] STARTING JOBS!`);

                        // Start running steps...
                        unpackPromises(1);
                    })
                    .catch(err => reject(err))
                ;

                /**
                 * Initiates all promises at given step, when all promises complete either:
                 * - Call itself again on the next step.
                 * OR
                 * - Finish if no more steps.
                 * OR
                 * - If flow was cancelled cancel all promised promises and stop recursion
                 * @param {number} step
                 */
                function unpackPromises(step) {
                    let stepKey = step.toString();

                    // Grab the promiseReturning functions for this step
                    let promiseReturners = _this.promised[ stepKey ];

                    // Pass current related jobs to jobs/flows
                    let currentAncestors = _this.ancestors;

                    if (promiseReturners) {
                        //Logger.debug(`PROM RETURNERS ${step}: ${promiseReturners}`);

                        // Initiate promises by calling the promise returning functions inside
                        // this.promised[step] = [func, ..., func]
                        let promiseList = promiseReturners.map(promiseReturner => promiseReturner(currentAncestors));

                        // Check if this flow is being cancelled and cancel all the promises that were just
                        // started. Also do not call unpackPromises() again to stop this recursive loop
                        if (_this.isCancelled) {
                            promiseList.forEach(promise => promise.cancel());
                            return resolve(_this);
                        }
                        else {
                            // 4.
                            // Waits for all the promises that represent jobs to complete
                            Promise.all(promiseList)

                            // After all the jobs at this step have completed
                                .then(() => {

                                    Logger.info(`${_this.loggerPrefix} FINISHED STEP: ${step}`);

                                    // Finish up this step...
                                    return _d.completeStep(_this, step);

                                })
                                .then(() => {
                                    // Start this process again for the next step
                                    return unpackPromises(step + 1);
                                })
                                .catch(err => {
                                    Logger.error('Error unpacking promises:');
                                    Logger.error(err.stack);
                                    //throw new Error(err);
                                })
                                .done()
                            ;
                        }
                    }
                    else if (step <= lastStep) {
                        //Logger.debug(`${step} was completed previously, move to next step.`);
                        return unpackPromises(step + 1);
                    }
                    else if (step > lastStep) {
                        return resolve(_this);
                    }
                }
            })
        ;
    });
}

export default Promise.method(endChain);
