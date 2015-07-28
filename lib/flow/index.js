let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');


class Flow {

    /**
     * Constructs an instance of the Flow object
     * @param {Object} flowOptions
     * @param {Object} mongoCon - Connection to Mongo
     */
    constructor(flowOptions, mongoCon) {
        this.jobData = flowOptions.jobData;
        this.jobType = flowOptions.jobType;
        this.stepsTaken = flowOptions.stepsTaken;
        this.mongoCon = mongoCon;
        this.FlowModel = this.mongoCon.model('flow');
        this.mongoId = this.jobData.mongoId;
        this.lastAddedJob = {};
        this.relatedJobs = [];
        this.activeJobs = [];
        this.completed = false;
        this.jobHandlers = [];

        this.promised = {
            '0': []
        };
    }

    /**
     * Initializes the Flow, needed to finish construction of Flow instance
     * @param {bluebird[]|exports[]|module.exports[]} [promiseArray] - Array of promises to resolve before first job of flow will run, not necessarily before the .init() will run.
     * @returns {bluebird|exports|module.exports|Flow}
     */
    init(promiseArray = []) {

        console.log(`[${this.mongoId}] Starting init flow`);

        let _this = this;

        _this.promised[ '0' ].concat(promiseArray);
        _this.promised[ '0' ].push(new Promise((resolve, reject) => {

            try {

                // Validate this is a valid MongoId
                if (_this.FlowModel.isObjectId(_this.mongoId)) {

                    _this.FlowModel.findById(_this.mongoId)
                        .then((flowDoc, err) => {

                            // Handle error
                            if (err) {
                                console.log(`[${_this.mongoId}] Error finding flowRecord in Flow constructor`);
                                console.log(`[${_this.mongoId}] ${err}`);
                                console.log(`[${_this.mongoId}] ${flowDoc}`);
                                reject(err);
                            }
                            // The passed _id wasn't found, this is a new Flow
                            else if (!flowDoc) {

                                console.log(`[${_this.mongoId}] Creating new Flow in Mongo...`);
                                this.FlowModel.create(
                                    {
                                        _id: _this.mongoId,
                                        stepsTaken: _this.stepsTaken,
                                        jobData: _this.jobData,
                                        jobType: _this.jobType,
                                        relatedJobs: [],
                                        jobLogs: []
                                    })
                                    .then((flowDoc, err) => {
                                        if (err) {
                                            console.log(err, '1');
                                            reject(err);
                                        }
                                        else {
                                            //console.log('Correctly made mongo doc');
                                            console.log(`[${_this.mongoId}] New Flow created. Flow.init() complete.`);
                                            resolve(_this);
                                        }
                                    })
                                ;
                            }
                            // Found the _id in Mongo, we are restarting a failed Flow
                            else if (flowDoc) {

                                console.log(`[${_this.mongoId}] Restarting Flow...`);
                                // TODO maybe put more stuff into instance
                                this.stepsTaken = flowDoc.stepsTaken;

                                this.relatedJobs = flowDoc.relatedJobs;

                                console.log(`[${_this.mongoId}] Flow restarted.`);
                                resolve(_this);

                            }
                            else {
                                reject(new Error(`[${_this.mongoId}] Something went very very wrong when init()ing Flow...`));
                            }
                        });
                }
                else {
                    reject(new Error(`[${_this.mongoId}] mongoId passed to Flow.init() is not a valid ObjectId.`));
                }

            } catch (e) {
                console.log(e, '3');

                reject(e);
            }
        }));

        return this;
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
                        // TODO
                        break;
                    }
                    default:
                    {
                        reject(new Error(`[${this.mongoId}] Incorrect job type for canceling job.`));
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
            type: job.type,
            step: job.data.step,
            data: job.data
        };

        //console.log(`Relating job:`);
        //console.log(jobData);

        return new Promise((resolve, reject) => {
            this.FlowModel.findByIdAndUpdate(_this.mongoId, { $addToSet: { relatedJobs: jobData } }, { new: true })
                .then((flowDoc, err) => {
                    if (err) {
                        console.log(`[${_this.mongoId}] Error relating job to Flow`);
                        console.log(`[${this.mongoId}] ${err}`);
                        reject(err);
                    }
                    else {
                        _this.activeJobs.push[ job ];
                        _this.relatedJobs = flowDoc.relatedJobs;
                        //console.log(`[${_this.mongoId}] Related job ${job.id}.`);
                        resolve(job);
                    }
                })
            ;
        });
    }

    /**
     * Increments the number of steps that this flow has taken by 1
     * @returns {bluebird|exports|module.exports|Job|null}
     */
    completeJob(job) {
        let _this = this;

        return new Promise((resolve, reject) => {
            if (!job) {
                resolve(null)
            }
            else {
                this.FlowModel.findByIdAndUpdate(_this.mongoId, { stepsTaken: _this.stepsTaken + 1 }, { new: true })
                    .then((flowDoc, err) => {
                        if (err) {
                            console.log(`[${_this.mongoId}] Error incrementing Flow step.`);
                            reject(err);
                        }
                        else {

                            // Remove job from activeJobs
                            _.remove(_this.activeJobs, (activeJob) => {
                                return activeJob.id === job.id;
                            });

                            _this.stepsTaken = flowDoc.stepsTaken;
                            resolve(job);
                        }
                    })
                ;
            }
        });
    }

    /**
     * 1. Creates kue job
     * 2. Attaches
     * @param {number} step
     * @param data
     * @param op
     * @returns {Flow}
     */
    job(step, data, op) {

        this.jobHandlers.push(() => {
            return this.handleJob(step, () => {
                return new Promise((jobResolve, jobReject) => {

                    if (_.isString(op)) {
                        try {
                            console.log(`[${this.mongoId}] Starting job in Flow...`);

                            let queue = kue.createQueue({
                                disableSearch: false
                            });

                            // TODO create more descriptive title for display in job UI
                            let title = 'test-title';

                            let job = queue.create(op, {
                                title,
                                step,
                                data,

                                flowId: this.mongoId
                            });


                            job.on('enqueue', () => {
                                this.relateJob(job)
                                    .catch((err) => jobReject(err))
                                ;
                            });


                            job.on('complete', () => {
                                jobResolve(job);
                            });

                            // TODO do error handling on the .save((err)=>{}) method
                            job.save();

                        }
                        catch (e) {
                            jobReject(e);
                        }
                    }
                    else if (_.isFunction) {
                        op(step, data, jobResolve, jobReject);
                    }


                })
            })
        });

        return this;
    }

    /**
     * Handles storing promise returning functions for a job at correct step in Flow instance
     * @param {number} step
     * @param {Function} asyncJobReturner
     * @param {Function} [restartJob]
     * @returns {bluebird|exports|module.exports}
     */
    handleJob(step, asyncJobReturner, restartJob = (()=> console.log(`[${this.mongoId}] No restartJob() passed.`))) {

        //console.log(`[${this.mongoId}] Handling step ${step}`);

        let _this = this;

        return new Promise((handleJobResolve, handleJobReject) => {
            if (step < 1) {
                handleJobReject(new Error('Cannot use a step that is less than 1'));
            }
            else if (step > _this.stepsTaken) {

                let promised = _this.promised;

                //console.log(`PROMISED LENGTH at ${step - 1}: ${promised[ (step - 1).toString() ].length}`);
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
                    console.log(`[${this.mongoId}] Added job for step: ${step}`);
                    handleJobResolve();
                }
                else {
                    console.log(`[${this.mongoId}] Added job for step: ${step}`);
                    _this.promised[ stepStr ] = [ runJob ];
                    handleJobResolve();
                }

            }
            // Don't handle job, it was completed before
            else {
                restartJob();
                handleJobResolve()
            }
        });
    }


    /**
     * Completes this Flow
     * 1. Initiates the jobHandler promises by calling all jobHandler functions (which return promises)
     * 2. Waits for all of the jobHandler promises to be done, that were just created.
     * 3. Then starts to run the steps of the Flow, one step at a time, using a recursive function that only calls itself
     *      once all the promises it initiated are complete.  Very similar to the first step.
     * 4. Update Mongo and this instance of Flow that this flow has finished, once there are no more steps to call.
     * @returns {bluebird|exports|module.exports|Flow}
     */
    done() {

        let _this = this;

        return new Promise((resolve, reject) => {

            // 1.
            let jobHandlerPromises = _this.jobHandlers.map((promiseReturner) => promiseReturner());

            // 2. (Also waits for the special step 0 promises to be done, just in case)
            Promise.all(jobHandlerPromises.concat(_this.promised[ '0' ]))
                .then(() => {
                    console.log(`[${this.mongoId}] STARTING JOBS!`);
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
                    //console.log(`PROM RETURNERS ${step}: ${promiseReturners}`);

                    // Initiate promises by calling the promise returning functions inside this.promised[step] = [func, ..., func]
                    let promiseArray = promiseReturners.map((promiseReturner) => {
                        return promiseReturner();
                    });

                    //console.log(`PromArray: ${promiseArray}`);

                    // 3.
                    // Waits for all the promises that we just started to finish
                    Promise.all(promiseArray)
                        .then(() => {
                            // All of this steps promises have completed, this step is finished.
                            console.log(`[${_this.mongoId}] ~~~~~FINISHED STEP: ${step}`);

                            // Start this process again for the next step
                            unpackPromises(step += 1, resolve, reject);
                        })
                        .catch((err) => {
                            throw new Error(err)
                        })
                    ;
                }
                else if (!promiseReturners && _this.promised[ (step += 1).toString() ]) {
                    console.log(`[${_this.mongoId}][${_this.jobType}] STEPS OUT OF ORDER AT STEP: ${step}`);
                    reject(new Error(`[${_this.mongoId}][${_this.jobType}] STEPS OUT OF ORDER AT STEP: ${step}`));
                }
                else {
                    // 4.
                    _this.FlowModel.findByIdAndUpdate(_this.mongoId, { completed: true }, { new: true })
                        .then((flowDoc, err) => {
                            if (err) {
                                console.log(`[${_this.mongoId}] Error ending flow.`);
                                console.log(`[ ${_this.mongoId} ] ${err}`);
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
        });
    }

}

export default Flow