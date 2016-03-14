const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');
const setPath = require('../util/setPath');
const util = require('util');

/**
 * Builds the Flow class.
 * The Flow class handles chains of Kue jobs so that they are executed only once and at the right time.
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose connection
 * @param {object} FloughInstance - The instance of the Flough that will be passed to the user.
 * @param {function} startFlow - The Flough.startFlow() API function
 */
export default function flowClassBuilder(queue, mongoCon, FloughInstance, startFlow) {
    let o = FloughInstance.o;
    let Logger = o.logger.func;


    class FlowController {

        /**
         * Constructs an instance of the Flow object
         * @param {object} flowJob - A Kue flowJob that is used to track the progress of the Flow itself
         */
        constructor(flowJob) {

            // Setup Flow's properties
            this.mongoCon = mongoCon;
            this.kueJob = flowJob;
            this.jobId = flowJob.id;
            this.data = flowJob.data;
            this.type = flowJob.type;
            this.uuid = flowJob.data._uuid;
            this.parentUUID = flowJob.data._parentUUID;
            this.stepsTaken = flowJob.data._stepsTaken;
            this.substepsTaken = flowJob.data._substepsTaken;
            this.isCompleted = false;
            this.isCancelled = false;
            this.isParent = true;
            this.isChild = flowJob.data._isChild;
            this.loggerPrefix = `[${this.type}][${this.uuid}][${this.kueJob.id}]`;

            // These are the Mongoose models for Flows and Jobs, used for searching and updating records.
            this.FlowModel = this.mongoCon.model('flow');

            // This is a logger that will log messages both to the flowJob itself (flowJob.log) but also to persistent storage
            this.flowLogger = require('../util/flowLogger')(mongoCon, Logger);

            /**
             * This will hold a counter of how many substeps have been added for a given step, which allows us to
             * dynamically assign substeps to jobs as they are called in the flow chain.
             * @type {object}
             */
            this.substeps = {};

            /**
             * Holds the flowJob information of each flowJob
             * @example { '1': {'1': { data: {//flowJob.data fields//}, result: 'STEP 1, SUBSTEP 1's RESULT STR' }, '2': {
             *     data: {//flowJob.data fields//}, result: 'STEP 1, SUBSTEP 2's RESULT STR' } } }
             * @type {{}}
             */
            this.ancestors = {};

            /**
             * Holds jobs that are currently running for this Flow
             * @type {array}
             */
            this.activeChildren = [];

            /**
             * This holds an array of functions, which return promises, which resolve when the flowJob has been all setup
             * and registered on the flow instance properly (in this.promised) and now are just waiting to be initiated
             * by the unpackPromises function (check .end() for more)
             * @type {array}
             */
            this.flowHandlers = [];

            /**
             * This is the step map that is created by all the functions in this.jobHandlers.  Each key corresponds to
             * a step and holds an array of functions that when called will start the flowJob (by adding a flowJob to the Kue
             * queue)
             * @type {{string: Array}}
             */
            this.promised = {
                '0': []
            };
        }

        /**
         * Initializes the Flow, needed to finish construction of Flow instance
         * @param {bluebird[]|exports[]|module.exports[]} [promiseArray] - Array of promises to resolve before first
         *     job of flow will run, not necessarily before the .begin() will run.
         * @returns {bluebird|exports|module.exports|FlowController}
         */
        begin(promiseArray = []) {

            let _this = this;

            Logger.info(`${_this.loggerPrefix} - START FLOW`);

            // Attach User passed promises to resolve before any flow.job()s run.
            _this.promised[ '0' ].concat(promiseArray);

            // Attach Flow's initialization function that either creates a new Flow record in storage or restarts
            // itself from a previous record.
            _this.promised[ '0' ].push(new Promise((resolve, reject) => {

                try {

                    // Listen for any cancellation event made by routes
                    FloughInstance.once(`CancelFlow:${_this.uuid}`, _this.cancel.bind(_this));

                    // Validate this is a valid MongoId
                    if (_this.FlowModel.isObjectId(_this.uuid)) {

                        // Look for the passed uuid, if found => restart flow, if not => create a new flow record
                        _this.FlowModel.findById(_this.uuid)
                            .then((flowDoc, err) => {

                                // Handle error
                                if (err) {
                                    Logger.error(`[${_this.uuid}] Error finding flowRecord in Flow constructor`);
                                    Logger.error(`[${_this.uuid}] ${err}`);
                                    Logger.error(`[${_this.uuid}] ${flowDoc}`);
                                    reject(err);
                                }

                                // The passed _id wasn't found, this is a new Flow
                                else if (!flowDoc) {

                                    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                                    _this.FlowModel.create(
                                        {
                                            _id:           _this.uuid,
                                            type:          _this.type,
                                            jobId:         _this.jobId,
                                            stepsTaken:    _this.stepsTaken,
                                            substepsTaken: _this.substepsTaken,
                                            jobData:       _this.data,
                                            isParent:      true,

                                            // Reinitialize with related jobs if this is a helper flow
                                            ancestors: _this.data._ancestors || {},
                                            logs:      [],
                                            childLogs: []
                                        })
                                        .then((flowDoc, err) => {
                                            if (err) {
                                                Logger.error(err.stack);
                                                reject(err);
                                            }
                                            else {
                                                //Logger.debug('Correctly made mongo doc');
                                                //Logger.info(`[${_this.uuid}] New Flow created. Flow.start() complete.`);
                                                resolve(_this);
                                            }
                                        })
                                    ;
                                }

                                // Found the _id in Mongo, we are restarting a failed Flow
                                else if (flowDoc) {

                                    //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                                    // Restart Flow with values that were saved to storage
                                    _this.stepsTaken = flowDoc.stepsTaken;
                                    _this.substepsTaken = flowDoc.substepsTaken;
                                    _this.ancestors = flowDoc.ancestors;
                                    resolve(_this);
                                }
                                else {
                                    reject(new Error(`[${_this.uuid}] Something went very very wrong when start()ing Flow...`));
                                }
                            })
                        ;
                    }
                    else {
                        reject(new Error(`[${_this.uuid}] uuid passed to Flow.start() is not a valid ObjectId.`));
                    }

                } catch (err) {
                    Logger.error(err.stack);

                    reject(err);
                }
            }));

            return _this;
        }

        /**
         *
         * @param step
         * @param type
         * @param {object|function} [flowData]
         * @returns {FlowController}
         */
        flow(step, type, flowData = {}) {

            let _this = this;

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

                    //let initialancestors = promised[ 0 ].ancestors;
                    //const uuid = _.get(initialancestors, `${step}.${substep}.data._uuid`, null);


                    //Logger.debug(`Step: ${step}, Substep: ${substep}`);

                    /* Push job handler for this function into the job handler's array to be eventually handled by .end(). */

                    // I never want to type job handler again...
                    _this.flowHandlers.push(() => {

                        // .handleChild() will eventually determine when and if to run this job based on step, substep,
                        // and previous completion
                        return _this.handleChild(step, substep, (currentAncestors) => {
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

                                    startFlow(type, finalJobData, true)
                                        .then(flowJob => {

                                            // When job is enqueued into Kue, relate the job to this flow.
                                            let updateAncestorsPromise;
                                            let updateJobIdPromise;
                                            flowJob.on('enqueue', () => {

                                                // TODO? Maybe have to also update flow's jobId lke in job function
                                                updateAncestorsPromise = _this.updateAncestors(flowJob, step, substep);
                                                updateJobIdPromise = _this.updateJobId(job, step, substep);
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


        updateJobId(flowJob, step, substep) {
            const _this = this;

            return new Promise((resolve, reject) => {

                let updateInterval;
                let numTries = 0;
                const maxTries = 4;
                const clearTheInterval = () => clearInterval(updateInterval);

                const updateTheJob = () => {
                    numTries += 1;
                    _this.FlowModel.findOneAndUpdate({ _id: flowJob.data._uuid }, { jobId: flowJob.id }, /*{new: true}, */function(err, flowDoc) {
                        if (err && maxTries > 4) {
                            clearTheInterval();
                            _this.flowLogger(`Error updating job in MongoDB with new job id: ${err}`, flowJob.data._uuid, flowJob.id);
                            Logger.error('Error updating job in MongoDB with new job id');
                            Logger.error(err.stack);
                            reject(err);
                        }
                        else if (!flowDoc && maxTries > 4) {
                            clearTheInterval();
                            const errorMsg = `Error updating job in MongoDB with new job id: Could not find job UUID of ${flowJob.data._uuid} in MongoDB`;
                            _this.flowLogger(errorMsg, flowJob.data._uuid, flowJob.id);
                            Logger.error(errorMsg);
                            reject(new Error(errorMsg));
                        }
                        else {
                            clearTheInterval();
                            resolve();
                        }
                    });
                };

                setInterval(updateTheJob, 1000);

            });
        }

        /*
         * the exec function
         * Finished
         * - Should be able to define an arbitrary function to be run that isn't tracked as a job.
         *
         * TODO
         * - The function will be passed (resolve, reject) to finish itself
         * - The function's running should be logged to the Flow job
         * - The data it returns (eg. resolve(data) ) should be saved to Mongo under related jobs or something
         * */

        /**
         * Execute a function as a step.
         * @param step
         * @param promReturningFunc
         * @returns {FlowController}
         */

        execF(step, promReturningFunc) {
            let _this = this;

            if (_this.stepsTaken < step) {

                const promFunc = function() {

                    let ancestors = _this.ancestors;

                    return promReturningFunc(ancestors);
                };

                const stepStr = step.toString();

                if (_this.promised[ stepStr ]) {
                    _this.promised[ stepStr ].push(promFunc);
                }
                else {
                    _this.promised[ stepStr ] = [ promFunc ];
                }

            }

            return _this;
        }

        /**
         * Handles storing promise returning functions for a child flow at correct step in Flow instance
         * @param {number} step - The step the flow was asked to run at by the user
         * @param {number} substep - The substep that Flow assigned to this flow
         * @param {function} flowRunner - Function that will run the flow
         * @param {function} [restartFlow] - TODO Optional function to be called if this job is being restarted
         * @returns {bluebird|exports|module.exports}
         */
        handleChild(step, substep, flowRunner, restartFlow = (()=> Logger.debug(`${this.loggerPrefix} No restartFlow() passed.`))) {

            let _this = this;

            //Logger.debug(`[${_this.uuid}] Handling step ${step}, substep ${substep}`);

            return new Promise((handleFlowResolve, handleFlowReject) => {
                if (step < 1) {
                    handleFlowReject(new Error('Cannot use a step that is less than 1'));
                }
                /**
                 * True if:
                 * 1. Step is the current step being processed AND this substep has not already been isCompleted
                 * OR
                 * 2. Step is any step past the current step
                 */
                else if ((step === (_this.stepsTaken + 1) && !_.includes(_this.substepsTaken, substep)) || (step > _this.stepsTaken + 1)) {

                    let promised = _this.promised;

                    let stepStr = step.toString();

                    /**
                     * runFlow is a function that when run will call the passed job's logic function (which is a
                     * promise), then upon completion of that job will pass the job to .completeChild(), then will
                     * resolve.
                     *
                     * Essentially runFlow is the function that once called will...run the job.
                     * @returns {bluebird|exports|module.exports}
                     */
                    let runFlow = (currentAncestors) => {
                        return new Promise((resolve, reject) => {
                            // Run the job...
                            flowRunner(currentAncestors)

                            // Complete the job...
                                .spread((job, result) => {
                                    return _this.completeChild(job, result);
                                })

                                // Resolve.
                                .then(resolve)
                                .catch((err) => reject(err))
                            ;
                        });
                    };

                    // Add this job to the promisedArray, initialize if first job at this step
                    if (promised[ stepStr ]) {
                        _this.promised[ stepStr ].push(runFlow);

                        //Logger.debug(`[${_this.uuid}] Added job for step: ${step}`);
                        handleFlowResolve();
                    }
                    else {
                        //Logger.debug(`[${_this.uuid}] Added job for step: ${step}`);
                        _this.promised[ stepStr ] = [ runFlow ];
                        handleFlowResolve();
                    }

                }

                // Don't handle job, it was isCompleted before
                else {
                    // Run the job's restart function
                    restartFlow();
                    handleFlowResolve();
                }
            });
        }

        /**
         * Takes information about a job and persists it to mongo and updates instance
         * @param {object} job - A Kue job object
         * @param {Number} step - the step this job is occurring on.
         * @param {Number} substep - the substep this job is occurring on.
         * @returns {bluebird|exports|module.exports|Job}
         */
        updateAncestors(job, step, substep) {

            let _this = this;

            return new Promise((resolve, reject) => {
                // Push job on to the activeChildren stack
                //Logger.error(')()()()(BEFOREEEEE RElating job here is activeChildren', _this.activeChildren);
                //Logger.error(_this);

                _this.activeChildren.push[ job ];

                //Logger.error(')()()()(AFTER RElating job here is activeChildren', _this.activeChildren);


                _this.FlowModel.findOneAndUpdate({ _id: _this.uuid }, {
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

                        _this.ancestors = flowDoc.ancestors;

                        if (_this.isChild) {

                            _this.FlowModel.findOneAndUpdate({ _id: _this.parentUUID }, {
                                $set: {
                                    [`ancestors.${_this.data._step}.${_this.data._substep}.data._ancestors`]: flowDoc.ancestors
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

        /**
         * Completes this Flow
         * 0. Waits for start() to finish, which includes any promises passed to start() by the user
         * 1. Cleans up the ancestors that were not completed if this flow restarted otherwise is a noop
         * 2. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
         * 3. Waits for all of the jobHandler promises to be done, that were just created.
         * 4. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls
         * itself once all the promises it initiated at a step are complete.
         *
         * Once end resolves, the flow function using this flow will call `done(result)` which will pass the result back
         * to the flowAPI.js file which will then call `.setFlowResult` on an instance of this class which will both set
         * this flow as complete and update the result the user passed inside of Mongo.
         * @returns {bluebird|exports|module.exports|FlowController}
         */
        end() {

            let _this = this;

            /**
             * Removes related jobs that were not completed before.  This is run inside of end() because jobs use their
             * uncompleted related jobs to reuse their UUIDs and/or uuids.
             * @returns {bluebird|exports|module.exports}
             */
            function cleanupAncestry() {

                return new Promise((resolve, reject) => {

                    _this.FlowModel.findById(_this.uuid, (err, flowDoc) => {
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
                                    _this.FlowModel.findOne(uuid, (err, doc) => {
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
                                .then((docInfos) => {
                                    flowDoc.ancestors = _this.ancestors;
                                    flowDoc.save((err) => {
                                        if (err) {
                                            reject(err);
                                        }
                                        else {
                                            resolve();
                                        }
                                    });
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
                    _this.FlowModel.findById(_this.uuid, (err, flowDoc) => {
                        if (err) {
                            Logger.error(err.stack);

                            reject(err);
                        }
                        else if (flowDoc) {

                            if (flowDoc.stepsTaken === -1) {
                                flowDoc.stepsTaken = 0;
                                _this.stepsTaken = 0;
                            }

                            flowDoc.save((err) => {
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
                        let jobHandlerPromises = _this.flowHandlers.map((promiseReturner) => promiseReturner());

                        // Find largest step number attached to _this.promised
                        const lastStep = Math.max(...Object.keys(_this.promised).map(string => parseInt(string, 10)));

                        // 3.
                        Promise.all(jobHandlerPromises)
                            .then(() => {
                                //Logger.debug(`[${_this.uuid}] STARTING JOBS!`);

                                // Start running steps...
                                unpackPromises(1);
                            })
                            .catch((err) => {
                                reject(err);
                            })
                        ;

                        /**
                         * Initiates all promises at given step, when all promises complete either:
                         * - Call itself again on the next step.
                         * OR
                         * - Finish if no more steps.
                         * OR
                         * - If flow was cancelled cancel all promised promises and stop recursion
                         * @param {Number} step
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
                                let promiseList = promiseReturners.map((promiseReturner) => {
                                    return promiseReturner(currentAncestors);
                                });

                                // Check if this flow is being cancelled and cancel all the promises that were just
                                // started. Also do not call unpackPromises() again to stop this recursive loop
                                if (_this.isCancelled) {
                                    promiseList.forEach(promise => promise.cancel());
                                    resolve(_this);
                                }
                                else {
                                    // 4.
                                    // Waits for all the promises that represent jobs to complete
                                    Promise.all(promiseList)

                                        // After all the jobs at this step have completed
                                        .then(() => {

                                            Logger.info(`${_this.loggerPrefix} FINISHED STEP: ${step}`);

                                            // Finish up this step...
                                            return _this.completeStep(step);

                                        })
                                        .then(() => {
                                            // Start this process again for the next step
                                            return unpackPromises(step + 1);
                                        })
                                        .catch((err) => {
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
                                resolve(_this);
                            }
                        }
                    })
                ;
            });
        }

        /**
         * Set the result of this Flow.
         * This is called by the flowAPI.js file when it detects the flow job is done.
         * @param result
         * @returns {bluebird|exports|module.exports}
         */
        setFlowResult(result) {
            let _this = this;

            return new Promise((resolve, reject) => {
                _this.FlowModel.findByIdAndUpdate(_this.uuid, {
                        isCompleted: true,
                        result:      result
                    }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(`[${_this.kueJob.type}][${_this.uuid}] Error updating complete flow in MongoDB. \n
                                        $set complete => true \n\n
                                        $set result => ${JSON.stringify(result)}`);
                            Logger.error(`[ ${_this.uuid} ] ${err.stack}`);
                            reject(err);
                        }
                        else {
                            _this.isCompleted = true;
                            resolve(result);
                        }
                    })
                ;
            });
        }

        /**
         * Increments the substeps taken by the Flow on the instance and in Mongo,
         * sets the Job record in mongo as complete,
         * and adds the flowJob's results to the Flow instance, Flow mongodb record, and Job mongodb record.
         * @returns {bluebird|exports|module.exports|Job|null}
         */
        completeChild(flowJob, jobResult) {
            let _this = this;
            return new Promise((resolve, reject) => {
                if (flowJob) {
                    // Create field to update
                    const relatedJobResultField = `ancestors.${flowJob.data._step}.${flowJob.data._substep}.result`;

                    // Update instance with this result
                    setPath(_this, relatedJobResultField, jobResult);

                    // Find this Flow's doc in Mongo and update the substeps taken
                    _this.FlowModel.findByIdAndUpdate(_this.uuid, {
                            $addToSet: { substepsTaken: flowJob.data._substep },
                            $set:      { [relatedJobResultField]: jobResult }
                        }, { new: true })
                        .then((flowDoc, err) => {
                            if (err) {
                                Logger.error(`[${_this.uuid}] Error incrementing Flow step.`);
                                reject(err);
                            }
                            else {

                                // Remove flowJob from activeChildren
                                _this.activeChildren = _.remove(_this.activeChildren, (activeJob) => {
                                    return activeJob.id === flowJob.id;
                                });

                                // Update the substeps taken on this flow instance
                                _this.substepsTaken = flowDoc.substepsTaken;

                                resolve(flowJob);
                            }
                        })
                    ;
                }
                else {

                    resolve(null);
                }
            });
        }

        /**
         * Cancels this flow, cancels all currently running jobs related to this Flow.
         * @params {object} [cancellationData] - TODO what should be here?
         * @returns {Promise.<FlowController>}
         */
        cancel(cancellationData) {
            const _this = this;

            return Promise.all(_this.promised[ '0' ]).then(() => {

                return new Promise((resolve, reject) => {
                    //Logger.debug(`activeChildren:`);
                    //Logger.debug(_this.activeChildren);

                    _this.isCancelled = true;

                    const cancelFlowJob = () => {
                        _this.kueJob.log('Flow was cancelled.');
                        _this.flowLogger('Flow was cancelled', _this.uuid, _this.kueJob.id);
                        _this.kueJob.failed();
                    };

                    _this.activeChildren.forEach((job) => {

                        FloughInstance.emit(`CancelFlow:${job.data._uuid}`, cancellationData);

                    });

                    _this.FlowModel.findByIdAndUpdate(_this.uuid, { isCancelled: true }, { new: true }, (err, flowDoc) => {
                        if (err) {
                            Logger.error(`Error setting flow as cancelled in MongoDB. Flow ${_this.uuid} still has 'isCancelled' as false.`);
                            Logger.error(err.stack);
                            cancelFlowJob();
                            reject(err);
                        }
                        else if (!flowDoc) {
                            const errorMsg = `UUID of ${_this.uuid} is not in MongoDB and could not be set to cancelled.`;
                            Logger.error(errorMsg);
                            cancelFlowJob();
                            reject(errorMsg);
                        }
                        else {
                            Logger.info(`${_this.loggerPrefix} cancelled successfully.`);
                            cancelFlowJob();
                            resolve(_this);
                        }
                    });
                });

            });
        }
    }

    return FlowController;
}
