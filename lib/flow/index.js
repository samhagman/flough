let Promise = require('bluebird');
let kue = require('kue');
let EE = require('../lib/EventExchange');
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

        //function buildPrevPromises(promised) {
        //
        //    return new Promise((resolve, reject) => {
        //
        //        let prevPromised = [];
        //
        //        function series(stepKey) {
        //            let stepStr = stepKey.toString();
        //
        //            if (stepKey > step) {
        //                console.log(`[${_this.mongoId}][${_this.jobType}] Steps are probably entered out of order.`);
        //            }
        //
        //            if (promised[ stepStr ] && (stepKey < step)) {
        //                addPromisesToArray(promised[ stepStr ], function() {
        //                    return series(stepKey += 1);
        //                });
        //            }
        //            else {
        //                return final();
        //            }
        //        }
        //
        //        series(0);
        //
        //        function addPromisesToArray(promArray, callback) {
        //            console.log(`PROM ARRAY TO CONCAT: ${promArray}`);
        //            prevPromised.concat(promArray);
        //            console.log(``);
        //            callback();
        //
        //        }
        //
        //        // Called after processing all lines.
        //        function final() {
        //            console.log(`THIS IS AMOUNT OF PROMISES TO RESOLVE FIRST: ${prevPromised.length}`);
        //            resolve(prevPromised);
        //        }
        //    });
        //}
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
                        EE.removeAllListeners(`${job.id}-TaskLinkClicked`);
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
     * Sends an alert to the positions
     * @param {number} step - The step in the flow this call represents
     * @param {String[]} positions
     * @param {string} alertName
     * @param {string} alertDescription
     * @param {string} [emailHtml] - Optional additional HTML that will be appended to the task email.
     * @returns {Flow}
     */
    alert(step, positions, alertName, alertDescription, emailHtml = '') {

        let _this = this;

        // TODO remove  && false, check this path works
        if (positions.length !== 1 && false) {
            console.log('huh1?');
            positions.forEach((position) => {
                console.log('huh?');
                this.alert(step, [ position ], alertName, alertDescription, emailHtml)
            });
        }
        else {
            _this.jobHandlers.push(() => {
                return _this.handleJob(step, () => {
                    return new Promise((jobResolve, jobReject) => {
                        try {

                            console.log(`[${_this.mongoId}] Starting alert in Flow...`);

                            let queue = kue.createQueue({
                                disableSearch: false
                            });

                            // TODO create more descriptive title for display in job UI
                            let title = 'test-title';


                            const Position = _this.mongoCon.model('position');
                            Position.getPersons(positions)
                                .then((persons) => {

                                    let person = {};

                                    // DEBUGGING STATEMENT!
                                    if (CONFIG.EXPRESS.DEV_BUILD) {
                                        person.email = 'shagman@g.harvard.edu';
                                    }

                                    // TODO for now only one person will ever be for one task, but eventually jobs could
                                    // have multiple persons
                                    if (persons.length === 1) {
                                        person = persons[ 0 ];
                                    }
                                    else {
                                        console.log(`[${_this.mongoId}] Error finding person for the given positionId: ${positions}`);
                                    }

                                    // NOTE: Job should have as much data as possible encapsulated inside of it so if we
                                    // want to search for active jobs it's easiest if the jobs have everything we need
                                    // right inside them.
                                    let job = queue.create('alert', {
                                        title,
                                        step,
                                        alertName,
                                        alertDescription,
                                        emailHtml,
                                        person,

                                        personHuid: person.huid,
                                        positionId: positions[ 0 ],
                                        flowId: _this.mongoId
                                    });


                                    job.on('enqueue', () => {
                                        _this.relateJob(job)
                                            .catch((err) => jobReject(err))
                                        ;
                                    });


                                    job.on('complete', () => {
                                        //console.log('COMPLETE EVENT TRIGGERED');
                                        jobResolve(job);
                                    });

                                    // TODO do error handling on the .save((err)=>{}) method
                                    job.save();

                                })
                                .catch((err) => jobReject(err))
                            ;

                        }
                        catch (e) {
                            jobReject(e);
                        }
                    })
                });
            });
        }

        return this;
    }

    /**
     * Sends a Task to the positions
     * @param {number} step
     * @param {String[]} positions
     * @param {string} taskName - The name of the task
     * @param {string} taskDescription - The description of the task
     * @param {string} [emailHtml] - Optional additional HTML that will be appended to the task email.
     * @returns {Flow}
     */
    task(step, positions, taskName, taskDescription, emailHtml = '') {

        // TODO remove  && false, check this path works
        if (positions.length !== 1 && false) {
            positions.forEach((position) => {
                this.task(step, [ position ], taskName, taskDescription, emailHtml)
            });
        }
        else {
            this.jobHandlers.push(() => {
                return this.handleJob(step, () => {
                    return new Promise((jobResolve, jobReject) => {
                        try {
                            console.log(`[${this.mongoId}] Starting task in Flow...`);

                            let queue = kue.createQueue({
                                disableSearch: false
                            });

                            // TODO create more descriptive title for display in job UI
                            let title = 'test-title';

                            const Position = this.mongoCon.model('position');
                            Position.getPersons(positions)
                                .then((persons) => {

                                    let person = {};

                                    // DEBUGGING STATEMENT!
                                    if (CONFIG.EXPRESS.DEV_BUILD) {
                                        person.email = 'shagman@g.harvard.edu';
                                    }

                                    // TODO for now only one person will ever be for one task, but eventually jobs could
                                    // have multiple persons
                                    if (persons.length === 1) {
                                        person = persons[ 0 ];
                                    }
                                    else {
                                        console.log(`[${this.mongoId}] Error finding person for the given positionId: ${positions}`);
                                    }

                                    // NOTE: Job should have as much data as possible encapsulated inside of it so if we
                                    // want to search for active jobs it's easiest if the jobs have everything we need
                                    // right inside them.
                                    let job = queue.create('task', {
                                        title,
                                        step,
                                        taskName,
                                        taskDescription,
                                        emailHtml,
                                        person,

                                        personHuid: person.huid,
                                        positionId: positions[ 0 ],
                                        flowId: this.mongoId
                                    });


                                    job.on('enqueue', () => {
                                        this.relateJob(job)
                                            .catch((err) => jobReject(err))
                                        ;
                                    });


                                    job.on('complete', () => {
                                        //console.log('COMPLETE EVENT TRIGGERED');
                                        jobResolve(job);
                                    });

                                    // TODO do error handling on the .save((err)=>{}) method
                                    job.save();
                                })
                                .catch((err) => jobReject(err))
                            ;


                        }
                        catch (e) {
                            jobReject(e);
                        }
                    })
                })
            });
        }
        return this;
    }

    /**
     * Sends a Task to the positions
     * @param {number} step
     * @param {String[]} positions
     * @param {string} formName
     * @param {string} formDescription
     * @param {Object} alpacaConfig
     * @param {string} [emailHtml] - Optional additional HTML that will be appended to the task email.
     * @returns {Flow}
     */
    retrieve(step, positions, formName, formDescription, alpacaConfig, emailHtml = '') {

        // TODO remove  && false, check this path works
        if (positions.length !== 1 && false) {
            positions.forEach((position) => {
                this.retrieve(step, [ position ], formName, formDescription, alpacaConfig, emailHtml)
            });
        }
        else {
            this.jobHandlers.push(() => {
                return this.handleJob(step, () => {
                    return new Promise((jobResolve, jobReject) => {
                        try {
                            console.log(`[${this.mongoId}] Starting retrieve in Flow...`);

                            let queue = kue.createQueue({
                                disableSearch: false
                            });

                            // TODO create more descriptive title for display in job UI
                            let title = 'test-title';


                            const Position = this.mongoCon.model('position');
                            Position.getPersons(positions)
                                .then((persons) => {

                                    let person = {};

                                    // DEBUGGING STATEMENT!
                                    if (CONFIG.EXPRESS.DEV_BUILD) {
                                        person.email = 'shagman@g.harvard.edu';
                                    }

                                    // TODO for now only one person will ever be for one task, but eventually jobs could
                                    // have multiple persons
                                    if (persons.length === 1) {
                                        person = persons[ 0 ];
                                    }
                                    else {
                                        console.log(`[${this.mongoId}] Error finding person for the given positionId: ${positions}`);
                                    }
                                    // NOTE: Job should have as much data as possible encapsulated inside of it so if we
                                    // want to search for active jobs it's easiest if the jobs have everything we need
                                    // right inside them.
                                    let job = queue.create('retrieve',
                                        {
                                            title,
                                            step,
                                            formName,
                                            formDescription,
                                            emailHtml,

                                            personHuid: person.huid,
                                            positionId: positions[ 0 ],
                                            alpacaConfig: alpacaConfig,
                                            flowId: this.mongoId
                                        });

                                    job.on('enqueue', () => {
                                        this.relateJob(job)
                                            .catch((err) => jobReject(err))
                                        ;
                                    });

                                    job.on('complete', (result) => {
                                        this.FlowModel.findById(this.mongoId)
                                            .then((flowDoc, err) => {

                                                // Find this job in this flow's relatedJobs and update result in mongo.
                                                return new Promise((resolve, reject) => {

                                                    let resultAttached = false;
                                                    let numRelatedJobs = flowDoc.relatedJobs.length;

                                                    // If no related jobs, this job was never related, this is an error.
                                                    if (numRelatedJobs === 0) {
                                                        reject(new Error(`[${this.mongoId}] No related jobs to attach result of retrieve too.`));
                                                    }
                                                    else {
                                                        // Find this job in the Flow's related jobs...
                                                        for (let i = 0; i < numRelatedJobs; i += 1) {
                                                            let relJob = flowDoc.relatedJobs[ i ];
                                                            if (relJob.jobId === job.id && relJob.step === step) {

                                                                // Update job in Mongo with the job's result, mark completed.
                                                                relJob.result = result;
                                                                relJob.complete = true;
                                                                flowDoc.save();
                                                                resultAttached = true;
                                                                break;
                                                            }
                                                        }

                                                        if (resultAttached === false) {
                                                            reject(new Error(`[${this.mongoId}] Tried to append result of retrieve to mongo relatedJob, but couldn't find document.`));
                                                        }
                                                        else {
                                                            resolve();
                                                        }
                                                    }
                                                })
                                            })
                                            .then(() => {
                                                jobResolve(job);
                                            })
                                            .catch((err) => {
                                                jobReject(err)
                                            })
                                        ;
                                    });

                                    // TODO do error handling on the .save((err)=>{}) method
                                    job.save();

                                }).catch((err) => jobReject(err))
                            ;

                        }
                        catch (e) {
                            jobReject(e);
                        }
                    })
                })
            });
        }

        return this;
    }
}

export default Flow