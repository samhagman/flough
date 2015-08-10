let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');


export default function flowClassBuilder(queue, mongoCon, options) {
    let Logger = options.logger.func;

    let jobAPI = require('./jobAPI')(queue, mongoCon, options);

    class Flow {

        /**
         * Constructs an instance of the Flow object
         * @param {Object} flowOptions
         * @param {Object} mongoCon - Connection to Mongo
         */
        constructor(job) {
            this.mongoCon = mongoCon;
            this.kueJob = job;
            this.data = job.data;
            this.jobType = job.type;
            this.flowId = job.data._flowId;
            this.stepsTaken = job.data._stepsTaken;
            this.substepsTaken = job.data._substepsTaken;
            this.FlowModel = this.mongoCon.model('flow');
            this.JobModel = this.mongoCon.model('job');
            this.jobLogger = require('./jobLogger')(mongoCon, Logger);

            /**
             * This will hold a counter of how many substeps have been added for a given step, which allows us to dynamically
             * assign substeps to jobs as they are called in the flow chain.
             * @type {Object}
             */
            this.substeps = {};

            this.lastAddedJob = {};
            this.relatedJobs = [];
            this.activeJobs = [];
            this.completed = false;

            /**
             * This holds an array of functions, which return promises, which resolve when the job been all setup and
             * registered on the flow instance properly (in this.promised) and just waiting to be initiated by the
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

            _this.promised[ '0' ].concat(promiseArray);
            _this.promised[ '0' ].push(new Promise((resolve, reject) => {

                try {

                    // Validate this is a valid MongoId
                    if (_this.FlowModel.isObjectId(_this.flowId)) {

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
                                            jobLogs:       []
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
                                    // TODO maybe put more stuff into instance
                                    _this.stepsTaken = flowDoc.stepsTaken;
                                    _this.substepsTaken = flowDoc.substepsTaken;

                                    Logger.error(_this.substepsTaken);

                                    _this.relatedJobs = flowDoc.relatedJobs;

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
         * Handles storing promise returning functions for a job at correct step in Flow instance
         * @param {number} step
         * @param {number} substep
         * @param {Function} asyncJobReturner
         * @param {Function} [restartJob]
         * @returns {bluebird|exports|module.exports}
         */
        handleJob(step, substep, asyncJobReturner, restartJob = (()=> Logger.debug(`[${this.flowId}] No restartJob() passed.`))) {

            let _this = this;
            Logger.debug(`[${_this.flowId}] Handling step ${step}, substep ${substep}`);
            Logger.error(_this.substepsTaken);


            return new Promise((handleJobResolve, handleJobReject) => {
                if (step < 1) {
                    handleJobReject(new Error('Cannot use a step that is less than 1'));
                }
                else if ((step === (_this.stepsTaken + 1) && !_.includes(_this.substepsTaken, substep)) || (step > _this.stepsTaken + 1)) {

                    let promised = _this.promised;

                    let stepStr = step.toString();

                    let runJob = () => {
                        return new Promise((resolve, reject) => {

                            // Wait on all the previously promised jobs to run, then run this job.
                            asyncJobReturner()
                                .then((job) => {
                                    return _this.completeJob(job);
                                })
                                .then(resolve)
                                .catch((err) => reject(err))
                            ;
                        });
                    };

                    // Add this job to the promisedArray, initialize if needed
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
                    restartJob();
                    handleJobResolve();
                }
            });
        }


        /**
         * Completes this Flow
         * 0. Waits for start() to finish, which includes any promises passed to start() by the user
         * 1. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
         * 2. Waits for all of the jobHandler promises to be done, that were just created.
         * 3. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls itself
         *      once all the promises it initiated are complete.  Very similar to the first step.
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

                        // 2. (Also waits for the special step 0 promises to be done, just in case)
                        Promise.all(jobHandlerPromises)
                            .then(() => {
                                Logger.info(`[${this.flowId}] STARTING JOBS!`);
                                unpackPromises(1, resolve, reject);
                            })
                            .catch((err) => {
                                reject(err);
                            })
                        ;

                        /**
                         * Initiates all promises at given step, when all promises complete either:
                         * - Call itself for the step
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

                                // Initiate promises by calling the promise returning functions inside this.promised[step] = [func, ..., func]
                                let promiseArray = promiseReturners.map((promiseReturner) => {
                                    return promiseReturner();
                                });

                                //Logger.debug(`PromArray: ${promiseArray}`);

                                // 3.
                                // Waits for all the promises that we just started to finish
                                Promise.all(promiseArray)
                                    .then(() => {
                                        // All of this steps promises have completed, this step is finished.
                                        Logger.debug(`[${_this.flowId}] ~~~~~FINISHED STEP: ${step}`);
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
         * Increments the substeps taken by the Flow on the instance and in Mongo,
         * also sets the Job record in mongo as complete.
         * @returns {bluebird|exports|module.exports|Job|null}
         */
        completeJob(job) {
            let _this = this;

            return new Promise((resolve, reject) => {
                if (!job) {
                    resolve(null);
                }
                else {

                    // Find this Flow's doc in Mongo and update the substeps taken
                    this.FlowModel.findByIdAndUpdate(_this.flowId, { $addToSet: { substepsTaken: job.data._substep } }, { new: true })
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
                                this.JobModel.findOneAndUpdate({ _id: job.data._uuid }, { complete: true }, { new: true })
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
         * also resets the substeps to 0 on both the Mongo doc and the flow instance as well.
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
         * Sends an alert to the positions
         * @param {number} step - The step in the flow this call represents
         * @param {string} jobName
         * @param {object} jobData
         */
        job(step, jobName, jobData) {

            let _this = this;
            let substep;

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

            // Attach step and substep information to the job.
            jobData._step = step;
            jobData._substep = substep;
            jobData._flowId = _this.flowId;

            Logger.debug(`Step: ${step}, Substep: ${substep}`);
            _this.jobHandlers.push(() => {
                return _this.handleJob(step, substep, () => {
                    return new Promise((jobResolve, jobReject) => {
                        try {

                            // NOTE: Job should have as much data as possible encapsulated inside of it so if we
                            // want to search for active jobs it's easiest if the jobs have everything we need
                            // right inside them.
                            jobAPI.startJob(jobName, jobData)
                                .then(job => {
                                    let relateJobPromise;
                                    job.on('enqueue', () => {
                                        relateJobPromise = _this.relateJob(job);
                                    });


                                    job.on('complete', () => {
                                        relateJobPromise
                                            .then(() => {
                                                jobResolve(job);
                                            })
                                            .catch((err) => jobReject(err))
                                        ;
                                    });

                                    // TODO do error handling on the .save((err)=>{}) method
                                    job.save();
                                })
                            ;

                        }
                        catch (e) {
                            jobReject(e);
                        }
                    });
                });
            });

            return _this;
        }
    }


    return Flow;
}
