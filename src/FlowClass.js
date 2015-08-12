let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');

/**
 * Builds the Flow class.
 * The Flow class handles chains of Kue jobs so that they are executed only once and at the right time.
 * @param {Object} queue - Kue queue
 * @param {Object} mongoCon - Mongoose connection
 * @param {Object} o - User passed options
 */
export default function flowClassBuilder(queue, mongoCon, o) {
    let Logger = o.logger.func;

    // Grabs the Job APIs so that Flow can start jobs
    let jobAPI = require('./jobAPI')(queue, mongoCon, o);

    class Flow {

        /**
         * Constructs an instance of the Flow object
         * @param {Object} job - A Kue job that is used to track the progress of the Flow itself
         */
        constructor(job) {
            // Setup Flow's properties
            this.mongoCon = mongoCon;
            this.kueJob = job;
            this.data = job.data;
            this.jobType = job.type;
            this.flowId = job.data._flowId;
            this.stepsTaken = job.data._stepsTaken;
            this.substepsTaken = job.data._substepsTaken;
            this.completed = false;


            // These are the Mongoose models for Flows and Jobs, used for searching and updating records.
            this.FlowModel = this.mongoCon.model('flow');
            this.JobModel = this.mongoCon.model('job');

            // This is a logger that will log messages both to the job itself (job.log) but also to persistent storage
            this.jobLogger = require('./jobLogger')(mongoCon, Logger);

            /**
             * This will hold a counter of how many substeps have been added for a given step, which allows us to dynamically
             * assign substeps to jobs as they are called in the flow chain.
             * @type {Object}
             */
            this.substeps = {};

            /**
             * Holds the results of each job
             * @example { '1': {'1': 'STEP 1, SUBSTEP 1's RESULT STR', '2': 'STEP 1, SUBSTEP 2's RESULT STR' } }
             * @type {{}}
             */
            this.results = {};

            this.relatedJobs = [];
            this.activeJobs = [];

            /**
             * This holds an array of functions, which return promises, which resolve when the job has been all setup and
             * registered on the flow instance properly (in this.promised) and now are just waiting to be initiated by the
             * unpackPromises function (check .end() for more)
             * @type {Array}
             */
            this.jobHandlers = [];

            /**
             * This is the step map that is created by all the functions in this.jobHandlers.  Each key corresponds to a step
             * and holds an array of functions that when called will start the job (by adding a job to the Kue queue)
             * @type {{String: Array}}
             */
            this.promised = {
                '0': []
            };
        }

        /**
         * Initializes the Flow, needed to finish construction of Flow instance
         * @param {bluebird[]|exports[]|module.exports[]} [promiseArray] - Array of promises to resolve before first job of flow will run, not necessarily before the .start() will run.
         * @returns {bluebird|exports|module.exports|Flow}
         */
        start(promiseArray = []) {

            Logger.debug(`[${this.flowId}] Starting init flow`);

            let _this = this;

            // Attach User passed promises to resolve before any flow.job()s run.
            _this.promised[ '0' ].concat(promiseArray);
            // Attach Flow's initialization function that either creates a new Flow record in storage or restarts itself from a previous record.
            _this.promised[ '0' ].push(new Promise((resolve, reject) => {

                try {
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

                                    Logger.info(`[${_this.flowId}] Creating new Flow in Mongo...`);
                                    _this.FlowModel.create(
                                        {
                                            _id:           _this.flowId,
                                            stepsTaken:    _this.stepsTaken,
                                            substepsTaken: _this.substepsTaken,
                                            jobData:       _this.data,
                                            jobType:       _this.jobType,
                                            relatedJobs:   [],
                                            jobLogs:       [],
                                            results:       {}
                                        })
                                        .then((flowDoc, err) => {
                                            if (err) {
                                                Logger.error(err, '1');
                                                reject(err);
                                            }
                                            else {
                                                //Logger.debug('Correctly made mongo doc');
                                                Logger.info(`[${_this.flowId}] New Flow created. Flow.start() complete.`);
                                                resolve(_this);
                                            }
                                        })
                                    ;
                                }
                                // Found the _id in Mongo, we are restarting a failed Flow
                                else if (flowDoc) {

                                    Logger.info(`[${_this.flowId}] Restarting Flow...`);
                                    // Restart Flow with values that were saved to storage
                                    _this.stepsTaken = flowDoc.stepsTaken;
                                    _this.substepsTaken = flowDoc.substepsTaken;
                                    _this.relatedJobs = flowDoc.relatedJobs;
                                    _this.results = flowDoc.results;

                                    Logger.info(`[${_this.flowId}] Flow restarted.`);
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

                } catch (e) {
                    Logger.error(e, '3');

                    reject(e);
                }
            }));

            return _this;
        }

        /**
         * Registers a Job of a certain type with this Flow to be run at the given step with the given data.
         * @param {number} step - The step for the job to run at
         * @param {string} jobType - The type of job to run (jobs registered with Flough.registerJob())
         * @param {object} jobData - The data to attach to the job.
         */
        job(step, jobType, jobData) {

            let _this = this;
            let substep;

            // If we already have substeps at this step, increase substeps by 1 and set substep to the result
            if (_this.substeps[ step ]) {
                _this.substeps[ step ] += 1;
                substep = _this.substeps[ step ];

                // Initialize the results holder for just this SUBSTEP to hold the eventual result for this job.
                _this.results[ step ][ substep ] = null;
            }
            // If no substeps at this step, set them to 1 and set substep to 1
            else {
                _this.substeps[ step ] = 1;
                substep = 1;

                // Initialize the results holder for this STEP and SUBSTEP to hold the eventual result for this job.
                _this.results[ step ] = { '1': null };
            }

            // Attach step and substep information to the job.
            jobData._step = step;
            jobData._substep = substep;
            jobData._flowId = _this.flowId;

            Logger.debug(`Step: ${step}, Substep: ${substep}`);

            // Push job handler for this function into the job handler's array to be eventually handled by .end().
            // I never want to type job handler again...
            _this.jobHandlers.push(() => {
                return _this.handleJob(step, substep, () => {
                    return new Promise((jobResolve, jobReject) => {
                        try {

                            // Lookup this Flow in Mongo to see latest results of past jobs.
                            _this.FlowModel.findById(_this.flowId, (error, flowDoc) => {
                                if (error) {
                                    jobReject(new Error(`Could not find Flow with ID ${_this.flowId} to get past results from for new job.`));
                                }
                                else {

                                    // Attach past results to job's data before starting it, so users can access these.
                                    jobData._results = flowDoc.results ? flowDoc.results : null;

                                    // Grab the previous step's results
                                    if (step > 1) {
                                        jobData._lastResult = flowDoc.results[ (step - 1).toString() ];
                                    }
                                    // There was no previous step
                                    else {
                                        jobData._lastResult = null;
                                    }

                                    Logger.error(jobData);

                                    jobAPI.startJob(jobType, jobData)
                                        .then(job => {
                                            let relateJobPromise;
                                            job.on('enqueue', () => {
                                                relateJobPromise = _this.relateJob(job);
                                            });


                                            job.on('complete', (result) => {
                                                relateJobPromise
                                                    .then(() => {
                                                        jobResolve([ job, (result ? result : null) ]);
                                                    })
                                                    .catch((err) => jobReject(err))
                                                ;
                                            });

                                            // TODO do error handling on the .save((err)=>{}) method
                                            job.save();
                                        })
                                    ;
                                }
                            });
                        }
                        catch (e) {
                            jobReject(e);
                        }
                    });
                });
            });

            return _this;
        }


        /**
         * Handles storing promise returning functions for a job at correct step in Flow instance
         * @param {number} step - The step the job was asked to run at by the user
         * @param {number} substep - The substep that Flow assigned to this job
         * @param {Function} jobRunner - Function that will run the job
         * @param {Function} [restartJob] - TODO Optional function to be called if this job is being restarted
         * @returns {bluebird|exports|module.exports}
         */
        handleJob(step, substep, jobRunner, restartJob = (()=> Logger.debug(`[${this.flowId}] No restartJob() passed.`))) {

            let _this = this;
            Logger.debug(`[${_this.flowId}] Handling step ${step}, substep ${substep}`);

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
                     * runJob is a function that when run will call the passed job's logic function (which is a promise),
                     * then upon completion of that job will pass the job to .completeJob(),
                     * then will resolve.
                     *
                     * Essentially runJob is the function that once called will...run the job.
                     * @returns {bluebird|exports|module.exports}
                     */
                    let runJob = () => {
                        return new Promise((resolve, reject) => {

                            // Run the job...
                            jobRunner()
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
                        Logger.debug(`[${_this.flowId}] Added job for step: ${step}`);
                        handleJobResolve();
                    }
                    else {
                        Logger.debug(`[${_this.flowId}] Added job for step: ${step}`);
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
         * @param {Object} job - A Kue job object
         * @returns {bluebird|exports|module.exports|Job}
         */
        relateJob(job) {

            let _this = this;

            let jobData = {
                jobId: job.id,
                type:  job.type,
                step:  job.data._step,
                data:  job.data
            };

            //Logger.debug(`Relating job:`);
            //Logger.debug(job.data);

            return new Promise((resolve, reject) => {
                this.FlowModel.findByIdAndUpdate(_this.flowId, { $addToSet: { relatedJobs: jobData } }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(`[${_this.flowId}] Error relating job to Flow`);
                            Logger.error(`[${this.flowId}] ${err}`);
                            reject(err);
                        }
                        else {
                            _this.activeJobs.push[ job ];
                            _this.relatedJobs = flowDoc.relatedJobs;

                            resolve(job);
                        }
                    })
                ;
            });
        }

        /**
         * Completes this Flow
         * 0. Waits for start() to finish, which includes any promises passed to start() by the user
         * 1. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
         * 2. Waits for all of the jobHandler promises to be done, that were just created.
         * 3. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls itself
         *      once all the promises it initiated at a step are complete.
         * 4. Update Mongo and this instance of Flow that this flow has finished, once there are no more steps to call.
         * @returns {bluebird|exports|module.exports|Flow}
         */
        end() {

            let _this = this;

            return new Promise((resolve, reject) => {

                // 0.
                Promise.all(_this.promised[ '0' ])
                    .then(() => {
                        // 1.
                        let jobHandlerPromises = _this.jobHandlers.map((promiseReturner) => promiseReturner());

                        // 2.
                        Promise.all(jobHandlerPromises)
                            .then(() => {
                                Logger.info(`[${this.flowId}] STARTING JOBS!`);
                                // Start running steps...
                                unpackPromises(1, resolve, reject);
                            })
                            .catch((err) => {
                                reject(err);
                            })
                        ;

                        /**
                         * Initiates all promises at given step, when all promises complete either:
                         * - Call itself again on the next step
                         * OR
                         * - Finish if no more steps
                         * @param {Number} step
                         * @param resolve - Outer ()'s resolve()
                         * @param reject - Outer ()'s reject()
                         */
                        function unpackPromises(step, resolve, reject) {
                            let stepKey = step.toString();

                            // Grab the promiseReturning functions for this step
                            let promiseReturners = _this.promised[ stepKey ];
                            if (promiseReturners) {
                                //Logger.debug(`PROM RETURNERS ${step}: ${promiseReturners}`);


                                // 3.
                                // Waits for all the promises that represent jobs to complete
                                Promise.all(
                                    // Initiate promises by calling the promise returning functions inside this.promised[step] = [func, ..., func]
                                    promiseReturners.map((promiseReturner) => {
                                        return promiseReturner();
                                    }))
                                    // After all the jobs at this step have completed
                                    .then(() => {

                                        Logger.debug(`[${_this.flowId}] ~~~~~FINISHED STEP: ${step}`);

                                        // Finish up this step...
                                        return _this.completeStep()
                                            .then(() => {
                                                // Start this process again for the next step
                                                unpackPromises(step += 1, resolve, reject);
                                            });

                                    })
                                    .catch((err) => {
                                        Logger.error(err.stack);
                                        //throw new Error(err);
                                    })
                                ;
                            }
                            // User put steps out of order in their flow chain
                            else if (!promiseReturners && _this.promised[ (step += 1).toString() ]) {
                                Logger.error(`[${_this.flowId}][${_this.jobType}] STEPS OUT OF ORDER AT STEP: ${step}`);
                                reject(new Error(`[${_this.flowId}][${_this.jobType}] STEPS OUT OF ORDER AT STEP: ${step}`));
                            }
                            else {
                                // 4.
                                _this.FlowModel.findByIdAndUpdate(_this.flowId, { completed: true }, { new: true })
                                    .then((flowDoc, err) => {
                                        if (err) {
                                            Logger.error(`[${_this.flowId}] Error ending flow.`);
                                            Logger.error(`[ ${_this.flowId} ] ${err}`);
                                            reject(err);
                                        }
                                        else {
                                            _this.completed = true;
                                            resolve(_this);
                                        }
                                    })
                                ;
                            }
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
                if (!job) {
                    resolve(null);
                }
                else {
                    // Attach this job's result to the Flow Instance
                    _this.results[ job.data._step ][ job.data._substep ] = jobResult;

                    // Find this Flow's doc in Mongo and update the substeps taken
                    this.FlowModel.findByIdAndUpdate(_this.flowId, {
                        $addToSet: { substepsTaken: job.data._substep },
                        results:   _this.results
                    }, { new: true })
                        .then((flowDoc, err) => {
                            if (err) {
                                Logger.error(`[${_this.flowId}] Error incrementing Flow step.`);
                                reject(err);
                            }
                            else {

                                // Remove job from activeJobs
                                _.remove(_this.activeJobs, (activeJob) => {
                                    return activeJob.id === job.id;
                                });

                                // Update the substeps taken on this flow instance
                                _this.substepsTaken = flowDoc.substepsTaken;

                                // Update the Job in Mongo to be complete.
                                this.JobModel.findOneAndUpdate({ _id: job.data._uuid }, {
                                    complete: true,
                                    result:   jobResult
                                }, { new: true })
                                    .then((jobDoc, err) => {
                                        if (err) {
                                            reject(err);
                                        }
                                        else {
                                            resolve(job);
                                        }
                                    })
                                ;
                            }
                        })


                    ;
                }
            });
        }

        /**
         * This increments the stepsTaken of this Flow on both the mongo doc and flow instance,
         * also resets the substepsTaken to [] on both the Mongo doc and the flow instance as well.
         * @returns {bluebird|exports|module.exports}
         */
        completeStep() {
            let _this = this;

            return new Promise((resolve, reject) => {

                // Update the mongo doc's stepsTaken and substepsTaken
                this.FlowModel.findByIdAndUpdate(_this.flowId, {
                    stepsTaken:    _this.stepsTaken + 1,
                    substepsTaken: []
                }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            Logger.error(`[${_this.flowId}] Error incrementing Flow step.`);
                            reject(err);
                        }
                        else {

                            // Update the flow instance
                            _this.stepsTaken = flowDoc.stepsTaken;
                            _this.substepsTaken = [];
                            resolve();
                        }
                    })
                ;
            });
        }

        /**
         * TODO - This doesn't do anything, currently a NoOp.
         * Cancels this flow, cancels all currently running jobs related to this Flow.
         * @returns {bluebird|exports|module.exports|Flow}
         */
        cancel() {


            return new Promise((resolve, reject) => {

                // TODO actually cancel stuff
                resolve(this);

                this.activeJobs.forEach((job) => {

                    // TODO add more canceling stuff
                    switch (job.type) {
                        case 'task':
                        {
                            resolve(this);
                            break;
                        }
                        default:
                        {
                            reject(new Error(`[${this.flowId}] Incorrect job type for canceling job.`));
                            break;
                        }
                    }
                });
            });
        }
    }

    return Flow;
}