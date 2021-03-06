let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let setPath = require('./util/setPath');
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


    class Flow {

        /**
         * Constructs an instance of the Flow object
         * @param {object} job - A Kue job that is used to track the progress of the Flow itself
         */
        constructor(job) {
            let _this = this;

            // Setup Flow's properties
            _this.mongoCon = mongoCon;
            _this.kueJob = job;
            _this.jobId = job.id;
            _this.data = job.data;
            _this.jobType = job.type;
            _this.flowId = job.data._flowId;
            _this.parentFlowId = job.data._parentFlowId;
            _this.stepsTaken = job.data._stepsTaken;
            _this.substepsTaken = job.data._substepsTaken;
            _this.completed = false;
            _this.isCancelled = false;
            _this.loggerPrefix = `[${_this.jobType}][${_this.flowId}][${_this.kueJob.id}]`;


            // These are the Mongoose models for Flows and Jobs, used for searching and updating records.
            _this.FlowModel = _this.mongoCon.model('flow');
            _this.JobModel = _this.mongoCon.model('job');

            // This is a logger that will log messages both to the job itself (job.log) but also to persistent storage
            _this.jobLogger = require('./jobLogger')(mongoCon, Logger);

            /**
             * This will hold a counter of how many substeps have been added for a given step, which allows us to
             * dynamically assign substeps to jobs as they are called in the flow chain.
             * @type {object}
             */
            _this.substeps = {};

            /**
             * Holds the job information of each job
             * @example { '1': {'1': { data: {//job.data fields//}, result: 'STEP 1, SUBSTEP 1's RESULT STR' }, '2': {
             *     data: {//job.data fields//}, result: 'STEP 1, SUBSTEP 2's RESULT STR' } } }
             * @type {{}}
             */
            _this.relatedJobs = {};

            /**
             * Holds jobs that are currently running for this Flow
             * @type {Array}
             */
            _this.activeJobs = [];

            /**
             * This holds an array of functions, which return promises, which resolve when the job has been all setup
             * and registered on the flow instance properly (in this.promised) and now are just waiting to be initiated
             * by the unpackPromises function (check .end() for more)
             * @type {Array}
             */
            _this.jobHandlers = [];

            /**
             * This is the step map that is created by all the functions in this.jobHandlers.  Each key corresponds to
             * a step and holds an array of functions that when called will start the job (by adding a job to the Kue
             * queue)
             * @type {{String: Array}}
             */
            _this.promised = {
                '0': []
            };
        }

        /**
         * Initializes the Flow, needed to finish construction of Flow instance
         * @param {bluebird[]|exports[]|module.exports[]} [promiseArray] - Array of promises to resolve before first
         *     job of flow will run, not necessarily before the .start() will run.
         * @returns {bluebird|exports|module.exports|Flow}
         */
        start(promiseArray = []) {

            let _this = this;

            Logger.info(`${_this.loggerPrefix} - START FLOW`);

            // Attach User passed promises to resolve before any flow.job()s run.
            _this.promised[ '0' ].concat(promiseArray);

            // Attach Flow's initialization function that either creates a new Flow record in storage or restarts
            // itself from a previous record.
            _this.promised[ '0' ].push(new Promise((resolve, reject) => {

                try {

                    // Listen for any cancellation event made by routes
                    FloughInstance.once(`CancelFlow:${_this.flowId}`, _this.cancel.bind(_this));

                    // Validate this is a valid MongoId
                    if (_this.FlowModel.isObjectId(_this.flowId)) {

                        // Look for the passed flowId, if found => restart flow, if not => create a new flow record
                        _this.FlowModel.findById(_this.flowId)
                            .then((flowDoc, err) => {

                                // Handle error
                                if (err) {
                                    Logger.error(`[${_this.flowId}] Error finding flowRecord in Flow constructor`);
                                    Logger.error(`[${_this.flowId}] ${err}`);
                                    Logger.error(`[${_this.flowId}] ${flowDoc}`);
                                    reject(err);
                                }

                                // The passed _id wasn't found, this is a new Flow
                                else if (!flowDoc) {

                                    //Logger.info(`${_this.loggerPrefix} Creating new Flow in Mongo...`);
                                    _this.FlowModel.create(
                                        {
                                            _id:           _this.flowId,
                                            stepsTaken:    _this.stepsTaken,
                                            substepsTaken: _this.substepsTaken,
                                            jobData:       _this.data,
                                            jobType:       _this.jobType,
                                            jobId:         _this.jobId,

                                            // Reinitialize with related jobs if this is a helper flow
                                            relatedJobs: _this.data._relatedJobs || {},
                                            jobLogs:     [],
                                            flowLogs:    []
                                        })
                                        .then((flowDoc, err) => {
                                            if (err) {
                                                Logger.error(err.stack);
                                                reject(err);
                                            }
                                            else {
                                                //Logger.debug('Correctly made mongo doc');
                                                //Logger.info(`[${_this.flowId}] New Flow created. Flow.start() complete.`);
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
                                    _this.relatedJobs = flowDoc.relatedJobs;
                                    resolve(_this);
                                }
                                else {
                                    reject(new Error(`[${_this.flowId}] Something went very very wrong when start()ing Flow...`));
                                }
                            })
                        ;
                    }
                    else {
                        reject(new Error(`[${_this.flowId}] flowId passed to Flow.start() is not a valid ObjectId.`));
                    }

                } catch (err) {
                    Logger.error(err.stack);

                    reject(err);
                }
            }));

            return _this;
        }

        /**
         * Registers a Job of a certain type with this Flow to be run at the given step with the given data.
         * @param {number} step - The step for the job to run at
         * @param {string} jobType - The type of job to run (jobs registered with Flough.registerJob())
         * @param {object|function} jobData - The data to attach to the job or a function returning the data.
         */
        job(step, jobType, jobData = {}) {

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

                    //Logger.debug(`Step: ${step}, Substep: ${substep}`);

                    /* Push job handler for this function into the job handler's array to be eventually handled by .end(). */

                    // I never want to type job handler again...
                    _this.jobHandlers.push(() => {

                        // .handleJob() will eventually determine when and if to run this job based on step, substep,
                        // and previous completion
                        return _this.handleJob(step, substep, (currentRelatedJobs) => {
                            return new Promise((jobResolve, jobReject) => {
                                try {

                                    // Build finalJobData from either passed object or passed function.
                                    let finalJobData;

                                    if (_.isFunction(jobData)) {
                                        finalJobData = jobData(currentRelatedJobs);
                                    }
                                    else if (_.isObject(jobData)) {
                                        finalJobData = jobData;
                                    }
                                    else {
                                        _this.jobLogger(`Step ${step} was a job that was not passed either an object or function for it's job data.`);
                                        Logger.error(`[FLOW][${_this.flowId}][STEP][${step}][SUBSTEP]${substep}] was passed a bad job data.`);
                                        Logger.error(`Bad Job data: ${JSON.stringify(jobData)}`);
                                        jobReject(`Bad Job data: ${JSON.stringify(jobData)}`);
                                    }


                                    //Logger.debug('relatedJobs in job: ', JSONIFY(relatedJobs));
                                    let jobUUID = _.get(currentRelatedJobs, `${step}.${substep}.data._uuid`, null);

                                    /* Build data to attach to the Kue job's data. */

                                    // Attach step and substep information to the job.
                                    finalJobData._step = step;
                                    finalJobData._substep = substep;
                                    finalJobData._flowId = _this.flowId;
                                    finalJobData._flowType = _this.data._flowType;

                                    // Attach past results to job's data before starting it, so users can
                                    // access these.
                                    finalJobData._relatedJobs = _.get(currentRelatedJobs, `${step - 1}`, {});

                                    // Grab the previous step's results (if there are any)
                                    let lastStepResult = {};

                                    for (let key of Object.keys(finalJobData._relatedJobs)) {
                                        lastStepResult[ `${key}` ] = finalJobData._relatedJobs[ key ].result;
                                    }

                                    finalJobData._lastStepResult = lastStepResult;


                                    // Reuse the previous UUID if there is one
                                    finalJobData._uuid = jobUUID;


                                    /**
                                     * Start the job.
                                     */

                                    FloughInstance.startJob(jobType, finalJobData)
                                        .then(job => {

                                            // When job is enqueued into Kue, relate the job to this flow.
                                            let relateJobPromise;
                                            let updateJobInMongoPromise;
                                            job.on('enqueue', () => {
                                                relateJobPromise = _this.relateJob(job, step, substep);
                                                updateJobInMongoPromise = _this.updateJob(job, step, substep);
                                            });

                                            // When job is complete, resolve with job and result.
                                            job.on('complete', (result) => {
                                                Promise.join(relateJobPromise, updateJobInMongoPromise)
                                                    .then(() => {
                                                        _this.jobLogger('Job logic complete.', job.data._uuid, job.id);
                                                        jobResolve([ job, (result ? result : null) ]);
                                                    })
                                                    .catch((err) => jobReject(err))
                                                ;
                                            });

                                            // Actually start this job inside Kue.
                                            job.save(err => {
                                                if (err) {
                                                    Logger.error(err.stack);
                                                }
                                            });
                                        })
                                    ;
                                }
                                catch (err) {
                                    jobReject(err);
                                }
                            });
                        });
                    });
                })
            ;

            return this;
        }

        updateJob(job, step, substep) {
            const _this = this;

            return new Promise((resolve, reject) => {

                let updateInterval;
                let numTries = 0;
                const maxTries = 2;

                const updateTheJob = () => {
                    numTries += 1;
                    _this.JobModel.findOneAndUpdate({ 'data._uuid': job.data._uuid }, { jobId: job.id }, { new: true }, function(err, jobDoc) {
                        if (err && numTries > maxTries) {
                            clearInterval(updateInterval);
                            _this.jobLogger(`Error updating job in MongoDB with new job id: ${err}`, job.data._uuid, job.id);
                            Logger.error('Error updating job in MongoDB with new job id');
                            Logger.error(err.stack);
                            reject(err);
                        }
                        else if (!jobDoc && numTries > maxTries) {
                            clearInterval(updateInterval);
                            const errorMsg = `Error updating job in MongoDB with new job id ${job.id}: Could not find job UUID of ${job.data._uuid} in MongoDB`;
                            _this.jobLogger(errorMsg, job.data._uuid, job.id);
                            Logger.error(errorMsg);
                            reject(new Error(errorMsg));
                        }
                        else {
                            clearInterval(updateInterval);
                            resolve();
                        }
                    });
                };

                updateInterval = setInterval(updateTheJob, 1000);

            });
        }

        /**
         *
         * @param step
         * @param flowType
         * @param {object|function} [jobData]
         * @returns {Flow}
         */
        flow(step, flowType, jobData = {}) {

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

                    //let initialRelatedJobs = promised[ 0 ].relatedJobs;
                    //const flowId = _.get(initialRelatedJobs, `${step}.${substep}.data._uuid`, null);


                    //Logger.debug(`Step: ${step}, Substep: ${substep}`);

                    /* Push job handler for this function into the job handler's array to be eventually handled by .end(). */

                    // I never want to type job handler again...
                    _this.jobHandlers.push(() => {

                        // .handleJob() will eventually determine when and if to run this job based on step, substep,
                        // and previous completion
                        return _this.handleJob(step, substep, (currentRelatedJobs) => {
                            return new Promise((jobResolve, jobReject) => {
                                try {

                                    /* Build data to attach to the Kue job's data. */

                                    // Build finalJobData from either passed object or passed function.
                                    let finalJobData;

                                    if (_.isFunction(jobData)) {
                                        finalJobData = jobData(currentRelatedJobs);
                                    }
                                    else if (_.isObject(jobData)) {
                                        finalJobData = jobData;
                                    }
                                    else {
                                        _this.jobLogger(`Step ${step} was a flow that was not passed either an object or function for it's job data.`);
                                        Logger.error(`[FLOW][${_this.flowId}][STEP][${step}][SUBSTEP]${substep}] was passed a bad job data.`);
                                        Logger.error(`Bad flow data: ${JSON.stringify(jobData)}`);
                                        jobReject(`Bad flow data: ${JSON.stringify(jobData)}`);
                                    }

                                    // Attach step and substep information to the job.
                                    finalJobData._step = step;
                                    finalJobData._substep = substep;
                                    finalJobData._flowType = flowType;

                                    // UNLIKE IN .job(), reuse the previous flowId if there is one.
                                    finalJobData._flowId = _.get(currentRelatedJobs, `${step}.${substep}.jobData._flowId`, null);

                                    // Reinitialize flow with the correct steps/substeps taken.
                                    finalJobData._stepsTaken = _.get(currentRelatedJobs, `${step}.${substep}._stepsTaken`, null);
                                    finalJobData._substepsTaken = _.get(currentRelatedJobs, `${step}.${substep}._substepsTaken`, null);

                                    // Attach past results to job's data before starting it, so users can
                                    // access these.
                                    finalJobData._relatedJobs = _.get(currentRelatedJobs, `${step - 1}`, {});

                                    // Grab the previous step's results (if there are any)
                                    let lastStepResult = {};

                                    for (let key of Object.keys(finalJobData._relatedJobs)) {
                                        lastStepResult[ `${key}` ] = finalJobData._relatedJobs[ key ].result;
                                    }

                                    finalJobData._lastStepResult = lastStepResult;


                                    // Reuse the previous UUID if there is one
                                    //finalJobData._uuid = jobUUID;
                                    finalJobData._parentFlowId = _this.flowId;

                                    /**
                                     * Start the job.
                                     */

                                    startFlow(flowType, finalJobData, true)
                                        .then(flowJob => {

                                            // When job is enqueued into Kue, relate the job to this flow.
                                            let relateJobPromise;
                                            flowJob.on('enqueue', () => {

                                                // TODO? Maybe have to also update flow's jobId lke in job function
                                                relateJobPromise = _this.relateJob(flowJob, step, substep);
                                            });

                                            // When job is complete, resolve with job and result.
                                            flowJob.on('complete', (result) => {
                                                relateJobPromise
                                                    .then(() => {
                                                        jobResolve([ flowJob, (result ? result : null) ]);
                                                    })
                                                    .catch((err) => jobReject(err))
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
                                    jobReject(err);
                                }
                            });
                        });
                    });

                })
            ;
            return _this;
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
         * @returns {Flow}
         */

        execF(step, promReturningFunc) {
            let _this = this;

            if (_this.stepsTaken < step) {

                const promFunc = function() {

                    let relatedJobs = _this.relatedJobs;

                    return promReturningFunc(relatedJobs);
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
         * Handles storing promise returning functions for a job at correct step in Flow instance
         * @param {number} step - The step the job was asked to run at by the user
         * @param {number} substep - The substep that Flow assigned to this job
         * @param {function} jobRunner - Function that will run the job
         * @param {function} [restartJob] - TODO Optional function to be called if this job is being restarted
         * @returns {bluebird|exports|module.exports}
         */
        handleJob(step, substep, jobRunner, restartJob = (()=> Logger.debug(`${this.loggerPrefix} No restartJob() passed.`))) {

            let _this = this;

            //Logger.debug(`[${_this.flowId}] Handling step ${step}, substep ${substep}`);

            return new Promise((handleJobResolve, handleJobReject) => {
                if (step < 1) {
                    handleJobReject(new Error('Cannot use a step that is less than 1'));
                }
                /**
                 * True if:
                 * 1. Step is the current step being processed AND this substep has not already been completed
                 * OR
                 * 2. Step is any step past the current step
                 */
                else if ((step === (_this.stepsTaken + 1) && !_.includes(_this.substepsTaken, substep)) || (step > _this.stepsTaken + 1)) {

                    let promised = _this.promised;

                    let stepStr = step.toString();

                    /**
                     * runJob is a function that when run will call the passed job's logic function (which is a
                     * promise), then upon completion of that job will pass the job to .completeJob(), then will
                     * resolve.
                     *
                     * Essentially runJob is the function that once called will...run the job.
                     * @returns {bluebird|exports|module.exports}
                     */
                    let runJob = (currentRelatedJobs) => {
                        return new Promise((resolve, reject) => {
                            // Run the job...
                            jobRunner(currentRelatedJobs)

                            // Complete the job...
                                .spread((job, result) => {
                                    return _this.completeJob(job, result);
                                })

                                // Resolve.
                                .then(resolve)
                                .catch((err) => reject(err))
                            ;
                        });
                    };

                    // Add this job to the promisedArray, initialize if first job at this step
                    if (promised[ stepStr ]) {
                        _this.promised[ stepStr ].push(runJob);

                        //Logger.debug(`[${_this.flowId}] Added job for step: ${step}`);
                        handleJobResolve();
                    }
                    else {
                        //Logger.debug(`[${_this.flowId}] Added job for step: ${step}`);
                        _this.promised[ stepStr ] = [ runJob ];
                        handleJobResolve();
                    }

                }

                // Don't handle job, it was completed before
                else {
                    // Run the job's restart function
                    restartJob();
                    handleJobResolve();
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
        relateJob(job, step, substep) {

            let _this = this;

            return new Promise((resolve, reject) => {
                // Push job on to the activeJobs stack
                //Logger.error(')()()()(BEFOREEEEE RElating job here is activeJobs', _this.activeJobs);
                //Logger.error(_this);

                _this.activeJobs.push[ job ];

                //Logger.error(')()()()(AFTER RElating job here is activeJobs', _this.activeJobs);


                _this.FlowModel.findOneAndUpdate({ _id: _this.flowId }, {
                    $set: {
                        [`relatedJobs.${step}.${substep}`]: {
                            data:   job.data,
                            result: null
                        }
                    }
                }, { new: true }, (err, flowDoc) => {
                    if (err) {
                        Logger.error(`Error updating relatedJobs: ${err.stack}`);
                        Logger.debug(util.inspect(flowDoc, {depth: null, colors: true}));
                        reject(job);
                    }

                    // If this job is part of a helper flow, update parent flows relatedJobs with this info
                    else {

                        _this.relatedJobs = flowDoc.relatedJobs;

                        if (_this.parentFlowId) {

                            _this.FlowModel.findOneAndUpdate({ _id: _this.parentFlowId }, {
                                $set: {
                                    [`relatedJobs.${_this.data._step}.${_this.data._substep}.data._relatedJobs`]: flowDoc.relatedJobs
                                }
                            }, { new: true, upsert: true }, (err, parentFlowDoc) => {
                                if (err) {
                                    Logger.error(`Error updating parent flow's relatedJobs: ${err}`);
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
         * 1. Cleans up the relatedJobs that were not completed if this flow restarted otherwise is a noop
         * 2. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
         * 3. Waits for all of the jobHandler promises to be done, that were just created.
         * 4. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls
         * itself once all the promises it initiated at a step are complete.
         *
         * Once end resolves, the flow function using this flow will call `done(result)` which will pass the result back
         * to the flowAPI.js file which will then call `.setFlowResult` on an instance of this class which will both set
         * this flow as complete and update the result the user passed inside of Mongo.
         * @returns {bluebird|exports|module.exports|Flow}
         */
        end() {

            let _this = this;

            /**
             * Removes related jobs that were not completed before.  This is run inside of end() because jobs use their
             * uncompleted related jobs to reuse their UUIDs and/or flowIds.
             * @returns {bluebird|exports|module.exports}
             */
            function cleanupRelatedJobs() {

                return new Promise((resolve, reject) => {

                    _this.FlowModel.findById(_this.flowId, (err, flowDoc) => {
                        if (err) {
                            reject(err);
                        }
                        else if (flowDoc) {

                            // Flows to get
                            let subFlows = [];

                            // Remove relatedJobs that were added but their step/substep never completed
                            _this.relatedJobs = _(_this.relatedJobs)
                                .pick(_.range(1, _this.stepsTaken + 2))
                                .mapValues((substepsObj, step, obj) => {
                                    const stepNum = parseInt(step, 10);

                                    if (stepNum < _this.stepsTaken) {
                                        return substepsObj;
                                    }
                                    else {
                                        _.forOwn(substepsObj, (flowData, substep) => {
                                            if (!_.get(flowData, '.data._uuid', false)) {
                                                subFlows.push({ step, substep, flowId: flowData.data._flowId });
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

                            const attachFlowProgress = ({ step, substep, flowId }) => {
                                return new Promise((resolve, reject) => {
                                    _this.FlowModel.findOne(flowId, (err, doc) => {
                                        if (err) {
                                            Logger.error(err.stack);
                                            reject(err);
                                        }
                                        else {

                                            if (!_this.relatedJobs[ step ]) _this.relatedJobs[ step ] = {};

                                            _this.relatedJobs[step][substep] = doc;

                                            resolve({step, substep, doc});
                                        }
                                    });
                                });
                            };

                            Promise
                                .all(subFlows.map(attachFlowProgress))
                                .then((docInfos) => {
                                    flowDoc.relatedJobs = _this.relatedJobs;
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
                    _this.FlowModel.findById(_this.flowId, (err, flowDoc) => {
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
                    .then(cleanupRelatedJobs)

                    // Set stepsTaken to 0 if they were -1 (initialization is complete)
                    .then(setStepsTakenToOne)
                    .then(() => {

                        // 2.
                        let jobHandlerPromises = _this.jobHandlers.map((promiseReturner) => promiseReturner());

                        // Find largest step number attached to _this.promised
                        const lastStep = Math.max(...Object.keys(_this.promised).map(string => parseInt(string, 10)));

                        // 3.
                        Promise.all(jobHandlerPromises)
                            .then(() => {
                                //Logger.debug(`[${_this.flowId}] STARTING JOBS!`);

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
                            let currentRelatedJobs = _this.relatedJobs;

                            if (promiseReturners) {
                                //Logger.debug(`PROM RETURNERS ${step}: ${promiseReturners}`);

                                // Initiate promises by calling the promise returning functions inside
                                // this.promised[step] = [func, ..., func]
                                let promiseList = promiseReturners.map((promiseReturner) => {
                                    return promiseReturner(currentRelatedJobs);
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
                _this.FlowModel.findByIdAndUpdate(_this.flowId, {
                        completed: true,
                        result:    result
                    }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(`[${_this.kueJob.type}][${_this.flowId}] Error updating complete flow in MongoDB. \n
                                        $set complete => true \n\n
                                        $set result => ${JSON.stringify(result)}`);
                            Logger.error(`[ ${_this.flowId} ] ${err.stack}`);
                            reject(err);
                        }
                        else {
                            _this.completed = true;
                            resolve(result);
                        }
                    })
                ;
            });
        }

        /**
         * Increments the substeps taken by the Flow on the instance and in Mongo,
         * sets the Job record in mongo as complete,
         * and adds the job's results to the Flow instance, Flow mongodb record, and Job mongodb record.
         * @returns {bluebird|exports|module.exports|Job|null}
         */
        completeJob(job, jobResult) {
            let _this = this;
            return new Promise((resolve, reject) => {
                if (job) {
                    // Create field to update
                    const relatedJobResultField = `relatedJobs.${job.data._step}.${job.data._substep}.result`;

                    // Update instance with this result
                    setPath(_this, relatedJobResultField, jobResult);

                    // Find this Flow's doc in Mongo and update the substeps taken
                    _this.FlowModel.findByIdAndUpdate(_this.flowId, {
                            $addToSet: { substepsTaken: job.data._substep },
                            $set:      { [relatedJobResultField]: jobResult }
                        }, { new: true })
                        .then((flowDoc, err) => {
                            if (err) {
                                Logger.error(`[${_this.flowId}] Error incrementing Flow step.`);
                                reject(err);
                            }
                            else {

                                // Remove job from activeJobs
                                _this.activeJobs = _.remove(_this.activeJobs, (activeJob) => {
                                    return activeJob.id === job.id;
                                });

                                // Update the substeps taken on this flow instance
                                _this.substepsTaken = flowDoc.substepsTaken;

                                if (job.data._uuid) {
                                    // Update the Job in Mongo to be complete.
                                    _this.JobModel.findByIdAndUpdate(job.data._uuid, {
                                        completed: true,
                                        result:    jobResult
                                    }, { new: true }, (err, jobDoc) => {
                                        if (err) {
                                            reject(err);
                                        }
                                        else {
                                            _this.jobLogger('Job cleanup complete.', job.data._uuid, job.id);
                                            resolve(job);
                                        }
                                    });
                                }
                                else {
                                    resolve(job);
                                }
                            }
                        })
                    ;
                } else {
                    resolve(null);
                }
            });
        }

        /**
         * This increments the stepsTaken of this Flow on both the mongo doc and flow instance,
         * also resets the substepsTaken to [] on both the Mongo doc and the flow instance as well.
         * @returns {bluebird|exports|module.exports}
         */
        completeStep(step) {
            let _this = this;

            return new Promise((resolve, reject) => {

                // Update the mongo doc's stepsTaken and substepsTaken
                _this.FlowModel.findByIdAndUpdate(_this.flowId, {
                        stepsTaken:    step,
                        substepsTaken: []
                    }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(`[${_this.flowId}] Error incrementing Flow step.`);
                            reject(err);
                        }
                        else {
                            // Update the flow instance
                            _this.stepsTaken = step;
                            _this.substepsTaken = [];
                            resolve();
                        }
                    })
                ;
            });
        }

        /**
         * Cancels this flow, cancels all currently running jobs related to this Flow.
         * @params {object} [cancellationData] - TODO what should be here?
         * @returns {bluebird|exports|module.exports|Flow}
         */
        cancel(cancellationData) {
            const _this = this;

            return Promise.all(_this.promised[ '0' ]).then(() => {

                return new Promise((resolve, reject) => {
                    //Logger.debug(`activeJobs:`);
                    //Logger.debug(_this.activeJobs);

                    _this.isCancelled = true;

                    const cancelFlowJob = () => {
                        _this.kueJob.log('Flow was cancelled.');
                        _this.jobLogger('Flow was cancelled', _this.flowId, _this.kueJob.id);
                        _this.kueJob.failed();
                    };

                    _this.activeJobs.forEach((job) => {

                        if (job.data._flowId !== 'NoFlow') {
                            FloughInstance.emit(`CancelFlow:${job.data._flowId}`, cancellationData);
                        }
                        else if (job.data._flowId) {
                            FloughInstance.emit(`CancelJob:${job.data._uuid}`, cancellationData);
                        }
                        else {
                            Logger.error('ACTIVE JOB HAD NO FLOWID, DON"T KNOW HOW TO CANCEL IT');
                        }
                    });

                    _this.FlowModel.findByIdAndUpdate(_this.flowId, { isCancelled: true }, { new: true }, (err, flowDoc) => {
                        if (err) {
                            Logger.error(`Error setting flow as cancelled in MongoDB. Flow ${_this.flowId} still has 'isCancelled' as false.`);
                            Logger.error(err.stack);
                            cancelFlowJob();
                            reject(err);
                        }
                        else if (!flowDoc) {
                            const errorMsg = `FlowId of ${_this.flowId} is not in MongoDB and could not be set to cancelled.`;
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

    return Flow;
}
