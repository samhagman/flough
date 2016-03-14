const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const EventEmitter3 = require('eventemitter3');


// Private methods


/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} redisClient - Redis client connection
 * @param {object} FloughInstance - Instance of Flough that is passed to the user.
 * @returns {{registerFlow, startFlow}}
 */
export default function flowAPIBuilder(queue, mongoCon, redisClient, FloughInstance) {

    // Public Static Methods
    const register = require('./public_methods/static/register');
    const start = require('./public_methods/static/start');
    const static_cancel = require('./public_methods/static/static_cancel');
    const reset = require('./public_methods/static/reset');
    const clone = require('./public_methods/static/clone');
    const status = require('./public_methods/static/status');
    const search = require('./public_methods/static/search');
    const searchKue = require('./public_methods/static/searchKue');

    // Public Instance Methods
    const begin = require('./public_methods/instance/begin');
    const end = require('./public_methods/instance/end');
    const execF = require('./public_methods/instance/execF');
    const flow = require('./public_methods/instance/flow');
    const instance_cancel = require('./public_methods/instance/instance_cancel');


    // Private Data - Internal to Flow - A.K.A. _d
    const privateData = {
        FlowController:   require('./FlowController')(queue, mongoCon, FloughInstance, start),
        queue:            queue,
        mongoCon:         mongoCon,
        o:                FloughInstance.o,
        Logger:           this.o.logger.func,
        FloughInstance:   FloughInstance,
        FlowModel:        mongoCon.model('flow'),
        redisClient:      redisClient,
        dynamicPropFuncs: {},
        jobOptions:       {},
        toBeAttached:     new WeakMap(),
        Flow:             Flow

    };
    privateData.setFlowResult = require('./private_methods/setFlowResult').bind(null, privateData);
    privateData.completeChild = require('./private_methods/completeChild').bind(null, privateData);
    privateData.completeStep = require('./private_methods/completeStep').bind(null, privateData);
    privateData.handleChild = require('./private_methods/handleChild').bind(null, privateData);
    privateData.updateAncestors = require('./private_methods/updateAncestors').bind(null, privateData);
    privateData.updateJobId = require('./private_methods/updateJobId').bind(null, privateData);


    /**
     * @class Flow
     */
    class Flow extends EventEmitter3 {

        constructor(kueJob) {

            // Setup Flow's properties
            this.mongoCon = mongoCon;
            this.kueJob = kueJob;
            this.jobId = kueJob.id;
            this.data = kueJob.data;
            this.type = kueJob.type;
            this.uuid = kueJob.data._uuid;
            this.parentUUID = kueJob.data._parentUUID;
            this.stepsTaken = kueJob.data._stepsTaken;
            this.substepsTaken = kueJob.data._substepsTaken;
            this.isCompleted = false;
            this.isCancelled = false;
            this.isParent = true;
            this.isChild = kueJob.data._isChild;
            this.loggerPrefix = `[${this.type}][${this.uuid}][${this.kueJob.id}]`;

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


            // Emit any events from the kue job on this instance as well
            kueJob.on('enqueue', () => this.emit('enqueue', ...arguments));
            kueJob.on('promotion', () => this.emit('promotion', ...arguments));
            kueJob.on('progress', () => this.emit('progress', ...arguments));
            kueJob.on('failed attempt', () => this.emit('failed attempt', ...arguments));
            kueJob.on('failed', () => this.emit('failed', ...arguments));
            kueJob.on('complete', () => this.emit('complete', ...arguments));
            kueJob.on('remove', () => this.emit('remove', ...arguments));
        }

        //============================================================
        //
        //               STATIC FLOW CONTROL FUNCTIONS
        //
        //============================================================

        /**
         * Registers a function so that it can be called by .start()
         * @method Flow#register
         * @param {string} type - Name of flow (successive calls of same flowName overwrite previous Flows)
         * @param {object} [flowOptions] - Options for how to process this flow
         * @param {function} flowFunc - User passed function that is the Flow's logic
         * @param {function} [dynamicPropFunc] - This is function to be run at job start time which should return an object
         *  that will be merged into the job.data of all jobs of this type.
         *  @returns {Promise} - Resolves when flow has been registered
         */
        static register(type, flowOptions, flowFunc, dynamicPropFunc) {
            return register(privateData, ...arguments);
        }

        /**
         * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
         * @method Flow#start
         * @param {string} flowName - Name of Flow to start
         * @param {object} [givenData] - Data context to be attached to this Flow
         * @param {boolean} [isParent] - If this is a helper flow, it will not restart on its own after a server restart.
         * @returns {Promise.<object>} - Resolves with a flowJob object
         */
        static start(flowName, givenData, isParent) {
            return start(privateData, ...arguments);
        }

        /**
         * Cancels a flow given a UUID
         * @method Flow#cancel
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise} - Resolves when cancellation event has been sent
         */
        static cancel(UUID) {
            return static_cancel(privateData, ...arguments);
        }

        /**
         * Reset a flow to a given step
         * @method Flow#reset
         * @param {string} UUID - The UUID of a flow
         * @param {number} stepNumber - The step number to reset to.
         * @returns {Promise} - Resolves when the flow has been reset
         */
        static reset(UUID, stepNumber) {
            return reset(privateData, ...arguments)
        }

        /**
         * Clone a flow -- take the data from a flow and start a new, separate flow with the same initial data.
         * @method Flow#clone
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object>} - Resolves with a flowJob object
         */
        static clone(UUID) {
            return clone(privateData, ...arguments);
        }


        /**
         * Get a flow's current data.
         * @method Flow#status
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object>} - Resolves with an object with all of the flow's data stored in MongoDB
         */
        static status(UUID) {
            return status(privateData, ...arguments);
        }

        /**
         * Search for flows using MongoDB as the source of truth.
         * Results must match ALL specified parameters: jobIds, flowUUIDs, types
         * @param {object} _d - Private Flow data
         * @param {array} [jobIds] - Array of Kue job ids to match
         * @param {array} [flowUUIDs] - Array of Flough flow UUIDs to match
         * @param {array} [types] - Array of flow types to match
         * @param {string} [isCompleted] - Whether or not to only return isCompleted flows
         * @param {string} [isCancelled] - If set, will return only either cancelled or not cancelled flows. If not set, both.
         * @param {boolean} [activeJobs] - Whether or not to return only active Kue jobs
         * @returns {Promise.<object[]>}
         */
        static search() {
            return search(privateData, ...arguments);
        }

        /**
         * Takes space separated query string and performs full text search on the Kue queue with them.
         * @param {object} _d - Private Flow object
         * @param {string} query - Text to search within job keys and values
         * @param {boolean} [union=false] - If true, call .type('or') on search query, this changes default of "and" for
         * multiple items.
         * @returns {Promise.<object[]>}
         */
        static searchKue() {
            return searchKue(privateData, ...arguments);
        }

        //============================================================
        //
        //                    INSTANCE FUNCTIONS
        //
        //============================================================

        /**
         * Initializes the Flow, needed to finish construction of Flow instance
         * @method Flow.begin
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {Promise[]} [promiseArray] - Array of promises to resolve before first job of flow will run, not necessarily before the .begin() will run.
         * @returns {Flow}
         */
        begin() {
            return begin.call(this, privateData, ...arguments);
        }

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
        flow() {
            return flow.call(this, privateData, ...arguments);
        }

        /**
         * Add an arbitrary promise function to a promise chain.
         * @method Flow.execF
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {number} step - The step in the flow chain to add this function to
         * @param {function} promReturningFunc - Function to add to flow chain -- must return a Promise
         * @returns {Flow}
         */
        execF() {
            return execF.call(this, privateData, ...arguments);
        }

        /**
         * Cancels this flow, cancels all currently running jobs related to this Flow.
         * @method Flow.cancel
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {object} [cancellationData] - Data to be sent along with the cancellation event
         * @returns {Promise.<Flow>}
         */
        cancel() {
            return instance_cancel.call(this, privateData, ...arguments);
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
         * @method Flow.end
         * @this Flow
         * @param {object} _d - Private Flow data
         * @returns {Promise.<Flow>}
         */
        end() {
            return end.call(this, privateData, ...arguments)
        }

    }

    //============================================================
    //
    //             SETUP FLOW'S GLOBAL EVENTS EMITTER
    //
    //============================================================

    /**
     * EventEmitter for global Flow events which takes in all Flow instance events, transforms them, and emits them from
     * this static property of the class itself.
     * @static
     * @type {EventEmitter}
     */
    Flow.events = new EventEmitter3();

    if (privateData.o.returnJobOnEvents) {
        // Setup queue logging events
        privateData.queue
            .on('job enqueue', (id, type) => {
                privateData.Logger.info(`[${type}][${id}] - QUEUED`);

                // Take all of Kue's passed arguments and emit them ourselves with the same event string
                Flow.events.emit('job enqueue', ...arguments);

                // Retrieve the job with the given id and emit custom events with the job attached
                kue.Job.get(id, (err, job) => {
                    // Event prefixed by the job's uuid
                    Flow.events.emit(`${job.data._uuid}:enqueue`, job);

                    // Event prefixed by the job's type
                    Flow.events.emit(`${job.type}:enqueue`, job);
                });
            })
            .on('job complete', (id, result) => {
                //privateData.Logger.info(`[${id}] - COMPLETE`);
                //privateData.Logger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);

                Flow.events.emit('job complete', ...arguments);
                kue.Job.get(id, (err, job) => {
                    Flow.events.emit(`${job.data._uuid}:complete`, job);
                    Flow.events.emit(`${job.type}:complete`, job);
                });
            })
            .on('job failed', (id, errorMessage) => {
                privateData.Logger.error(`[${id}] - FAILED`);
                privateData.Logger.error(`[${id}] - ${errorMessage}`);

                Flow.events.emit('job failed', ...arguments);
                kue.Job.get(id, (err, job) => {
                    Flow.events.emit(`${job.data._uuid}:failed`, job);
                    Flow.events.emit(`${job.type}:failed`, job);
                });
            })
            .on('job promotion', (id) => {
                Flow.events.emit('job promotion', ...arguments);
                kue.Job.get(id, (err, job) => {
                    Flow.events.emit(`${job.data._uuid}:promotion`, job);
                    Flow.events.emit(`${job.type}:promotion`, job);
                });
            })
            .on('job progress', (id) => {
                Flow.events.emit('job progress', ...arguments);
                kue.Job.get(id, (err, job) => {
                    Flow.events.emit(`${job.data._uuid}:progress`, job);
                    Flow.events.emit(`${job.type}:progress`, job);
                });
            })
            .on('job failed attempt', (id) => {
                Flow.events.emit('job failed attempt', ...arguments);

                kue.Job.get(id, (err, job) => {
                    Flow.events.emit(`${job.data._uuid}:failed attempt`, job);
                    Flow.events.emit(`${job.type}:failed attempt`, job);
                });
            })
            .on('job remove', (id) => {
                Flow.events.emit('job remove', ...arguments);
                kue.Job.get(id, (err, job) => {
                    if (job) {

                        Flow.events.emit(`${job.data._uuid}:remove`, job);
                        Flow.events.emit(`${job.type}:remove`, job);
                    }
                });
            })
        ;
    }
    else {
        privateData.queue
            .on('job enqueue', (id, type) => {
                privateData.Logger.info(`[${type}][${id}] - QUEUED`);
                Flow.events.emit('job enqueue', ...arguments);
            })
            .on('job complete', (id, result) => {
                //privateData.Logger.info(`[${id}] - COMPLETE`);
                //privateData.Logger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);
                Flow.events.emit('job complete', ...arguments);
            })
            .on('job failed', (id, errorMessage) => {
                privateData.Logger.error(`[${id}] - FAILED`);
                privateData.Logger.error(`[${id}] - ${errorMessage}`);
                Flow.events.emit('job failed', ...arguments);
            })
            .on('job promotion', () => {
                Flow.events.emit('job promotion', ...arguments);
            })
            .on('job progress', () => {
                Flow.events.emit('job progress', ...arguments);
            })
            .on('job failed attempt', () => {
                Flow.events.emit('job failed attempt', ...arguments);
            })
            .on('job remove', () => {
                Flow.events.emit('job remove', ...arguments);
            })
        ;
    }

    return Flow;
}
