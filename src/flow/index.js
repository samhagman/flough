const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const EventEmitter3Class = require('eventemitter3');
const StrictMap = require('../util/StrictMap');

/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} redisClient - Redis client connection
 * @param {object} FloughInstance - Instance of Flough that is passed to the user.
 * @returns {Flow}
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
    const save = require('./public_methods/instance/save');

    /**
     * Private Data - Internal to Flow - A.K.A. _d
     * @namespace
     * @prop {object} queue
     * @prop {object} mongoCon
     * @prop {object} o
     * @prop {object} Logger
     * @prop {object} FloughInstance
     * @prop {object} FlowModel
     * @prop {object} redisClient
     * @prop {object} dynamicPropFuncs
     * @prop {object} jobOptions
     * @prop {StrictMap} flowInstances
     * @prop {WeakMap} toBePersisted
     * @prop {Flow} Flow
     * @prop {function} setFlowResult
     * @prop {function} completeChild
     * @prop {function} completeStep
     * @prop {function} handleChild
     * @prop {function} updateAncestors
     * @prop {function} updateJobId
     */
    const _d = {
        queue:            queue,
        mongoCon:         mongoCon,
        o:                FloughInstance.o,
        Logger:           this.o.logger.func,
        FloughInstance:   FloughInstance,
        FlowModel:        mongoCon.model('flow'),
        redisClient:      redisClient,
        dynamicPropFuncs: {},
        jobOptions:       {},
        flowInstances:    new StrictMap(),
        toBePersisted:    new WeakMap(),
        Flow:             Flow
    };

    _d.setFlowResult = require('./private_methods/setFlowResult').bind(null, _d);
    _d.completeChild = require('./private_methods/completeChild').bind(null, _d);
    _d.completeStep = require('./private_methods/completeStep').bind(null, _d);
    _d.handleChild = require('./private_methods/handleChild').bind(null, _d);
    _d.updateAncestors = require('./private_methods/updateAncestors').bind(null, _d);
    _d.updateJobId = require('./private_methods/updateJobId').bind(null, _d);

    /**
     * @class Flow
     * @extends EventEmitter
     */
    class Flow extends EventEmitter3Class {
        /**
         * EventEmitter for global Flow events which takes in all Flow instance events, transforms them, and emits them from
         * this static property of the class itself.
         * @static
         * @type {EventEmitter}
         */
        static events = new EventEmitter3Class();

        /**
         * Raw Mongoose Connection to MongoDB
         * @instance
         * @type {object}
         */
        mongoCon;

        /**
         * Kue job created to track the life of this flow
         * @instance
         * @type {object}
         */
        kueJob;

        /**
         * The id of the Kue job tracking this flow (kueJob.id)
         * @instance
         * @type {number}
         */
        jobId;

        /**
         * The initializer data that was given when this flow was created
         * @instance
         * @type {object}
         */
        data;

        /**
         * The type of this flow (kueJob.type)
         * @instance
         * @type {string}
         */
        type;

        /**
         * The UUID that was assigned to this flow
         * @instance
         * @type {string}
         */
        uuid;

        /**
         * The UUID of the parent of this flow if one exists
         * @instance
         * @type {string}
         */
        parentUUID;

        /**
         * The number of steps that this flow has taken so far
         * @instance
         * @type {number}
         */
        stepsTaken;

        /**
         * The number of substeps that have been taken at the current step
         * @instance
         * @type {Array}
         */
        substepsTaken;

        /**
         * The prefix to use for logging strings.
         * @instance
         * @type {string}
         */
        loggerPrefix;

        /**
         * The logging function to use to log messages pertaining to this flow instance.  Saves them to MongoDB.
         * @instance
         * @type {function}
         */
        flowLogger;

        /**
         * Whether or not this flow was started by another flow instance.
         * @instance
         * @type {boolean}
         */
        isChild;

        /**
         * Whether or not this instance has child flows that it started.
         * @instance
         * @default
         * @type {boolean}
         */
        isParent = true;

        /**
         * Whether or not this flow instance has completed.
         * @instance
         * @default
         * @type {boolean}
         */
        isCompleted = false;

        /**
         * Whether or not this flow instance is cancelled.
         * @instance
         * @default
         * @type {boolean}
         */
        isCancelled = false;

        /**
         * Whether or not this flow has been restarted
         * @instance
         * @default
         * @type {boolean}
         */
        isRestarted = false;

        /**
         * This will hold a counter of how many substeps have been added for a given step, which allows us to
         * dynamically assign substeps to jobs as they are called in the flow chain.
         * @type {object}
         */
        substeps = {};

        /**
         * Holds the flowJob information of each flowJob
         * @example { '1': {'1': { data: {//flowJob.data fields//}, result: 'STEP 1, SUBSTEP 1's RESULT STR' }, '2': {
             *     data: {//flowJob.data fields//}, result: 'STEP 1, SUBSTEP 2's RESULT STR' } } }
         * @type {object}
         */
        ancestors = {};

        /**
         * Holds jobs that are currently running for this Flow
         * @type {Array}
         */
        activeChildren = [];

        /**
         * This holds an array of functions, which return promises, which resolve when the flowJob has been all setup
         * and registered on the flow instance properly (in this.promised) and now are just waiting to be initiated
         * by the unpackPromises function (check .endChain() for more)
         * @type {Array}
         */
        flowHandlers = [];

        /**
         * This is the step map that is created by all the functions in this.jobHandlers.  Each key corresponds to
         * a step and holds an array of functions that when called will start the flowJob (by adding a flowJob to the Kue
         * queue)
         * @type {object.<string, function[]>}
         */
        promised = {
            '0': []
        };


        /**
         * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
         * @param {string} flowType - Type of flow to construct
         * @param {object} [givenData={}] - Data context to be attached to this Flow
         */
        constructor(flowType, givenData = {}) {
            // Apply EventEmitter3 instance properties
            super();

            const Logger = _d.Logger;

            //============================================================
            //
            //                     SETUP FLOW DATA
            //
            //============================================================

            // Clone the given data to modify
            let flowData = _.clone(givenData);

            // Set flowData properties to default values if needed
            if (!flowData._stepsTaken) flowData._stepsTaken = -1;
            if (!flowData._substepsTaken) flowData._substepsTaken = [];
            if (!flowData._parentUUID) flowData._parentUUID = 'NoFlow';
            if (!flowData._parentType) flowData._parentType = 'NoFlow';
            if (!flowData._type) flowData._type = flowType;
            flowData._isChild = !!flowData._isChild;

            // Get the job options that were registered to this flow type
            const jobOptions = _d.jobOptions[ flowType ];

            // Get the field names that should not be saved into Kue (and stringified)
            const noSaveFieldNames = jobOptions.noSave || [];

            // Remove the fields we shouldn't save to get data we should persist
            const dataToBePersisted = _.omit(flowData, noSaveFieldNames);

            // Get the dynamicPropertyFunc that was registered to this flow type
            const dynamicPropFunc = _d.dynamicPropFuncs[ flowType ];
            if (!_.isFunction(dynamicPropFunc)) {
                Logger.error(`Dynamic property passed was not a function for job type ${flowType}`);
                Logger.error(util.inspect(dynamicPropFunc));
                throw new Error('Dynamic property passed was not a function.');
            }

            // Build dynamic properties and merge them into the given data
            let dynamicProperties = dynamicPropFunc(dataToBePersisted);
            let mergedProperties = _.merge(dataToBePersisted, dynamicProperties);

            // If there is no passed UUID, then create one
            if (!mergedProperties._uuid) {

                // Set _isRestarted to false since we are creating a new UUID
                mergedProperties._isRestarted = false;

                const randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    let r = crypto.randomBytes(1)[ 0 ] % 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
                    return v.toString(16);
                });
                mergedProperties._uuid = (new ObjectId(randomStr)).toString();
            }
            else {
                // Set _isRestarted to true since there was an existing UUID that has been passed
                mergedProperties._isRestarted = true;
            }

            //============================================================
            //
            //             ASSIGN FLOW DATA TO NEEDED LOCATIONS
            //
            //============================================================

            // Save the instance of this flow so the register function can inject this instance that was created here
            _d.flowInstances.set(mergedProperties._uuid, this);

            // Set the data that should be persisted when/if flow#save is called
            _d.toBePersisted.set(this, mergedProperties);

            // Construct the kueJob for this flow
            const kueJob = _d.queue.create(`flow:${flowType}`, mergedProperties);

            // Setup Flow's properties
            this.data = _.merge(kueJob.data, _.pick(flowData, noSaveFieldNames));
            this.mongoCon = mongoCon;
            this.kueJob = kueJob;
            this.jobId = kueJob.id;
            this.type = kueJob.type;
            this.uuid = kueJob.data._uuid;
            this.parentUUID = kueJob.data._parentUUID;
            this.stepsTaken = kueJob.data._stepsTaken;
            this.substepsTaken = kueJob.data._substepsTaken;
            this.isRestarted = kueJob.data._isRestarted;
            this.isChild = kueJob.data._isChild;
            this.loggerPrefix = `[${this.type}][${this.uuid}][${this.kueJob.id}]`;

            // This is a logger that will log messages both to the flowJob itself (flowJob.log) but also to persistent storage
            this.flowLogger = require('../util/flowLogger')(mongoCon, Logger);

            //============================================================
            //
            //      SETUP PROXYING OF KUE EVENTS ONTO FLOW INSTANCE
            //
            //============================================================

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
         * Register a new type of Flow
         * @method Flow.register
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} type - The name of the flow type to register
         * @param {object} flowOptions - Object holding the options for registering this Flow type
         * @param {function} flowFunc - Function that will be registered to run for this type
         * @param {function} dynamicPropFunc - A function that returns an object whose fields will be merged into the data for each
         *      flow of this type at runtime.
         * @returns {Promise}
         */
        static register(type, flowOptions, flowFunc, dynamicPropFunc) {
            return register(_d, ...arguments);
        }

        /**
         * Cancels a flow given a UUID
         * @method Flow#cancel
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise} - Resolves when cancellation event has been sent
         */
        static cancel(UUID) {
            return static_cancel(_d, ...arguments);
        }

        /**
         * Reset a flow to a given step
         * @method Flow#reset
         * @param {string} UUID - The UUID of a flow
         * @param {number} stepNumber - The step number to reset to.
         * @returns {Promise} - Resolves when the flow has been reset
         */
        static reset(UUID, stepNumber) {
            return reset(_d, ...arguments)
        }

        /**
         * Clone a flow -- take the data from a flow and start a new, separate flow with the same initial data.
         * @method Flow#clone
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object>} - Resolves with a flowJob object
         */
        static clone(UUID) {
            return clone(_d, ...arguments);
        }


        /**
         * Get a flow's current data.
         * @method Flow#status
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object>} - Resolves with an object with all of the flow's data stored in MongoDB
         */
        static status(UUID) {
            return status(_d, ...arguments);
        }

        /**
         * Search for flows using MongoDB as the source of truth.
         * Results must match ALL specified parameters: jobIds, flowUUIDs, types
         * @param {object} _d - Private Flow data
         * @param {Array} [jobIds] - Array of Kue job ids to match
         * @param {Array} [flowUUIDs] - Array of Flough flow UUIDs to match
         * @param {Array} [types] - Array of flow types to match
         * @param {string} [isCompleted] - Whether or not to only return isCompleted flows
         * @param {string} [isCancelled] - If set, will return only either cancelled or not cancelled flows. If not set, both.
         * @param {boolean} [activeJobs] - Whether or not to return only active Kue jobs
         * @returns {Promise.<object[]>}
         */
        static search() {
            return search(_d, ...arguments);
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
            return searchKue(_d, ...arguments);
        }

        //============================================================
        //
        //                    INSTANCE FUNCTIONS
        //
        //============================================================

        /**
         * Initializes the Flow, needed to finish construction of Flow instance
         * @method Flow.beginChain
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {Promise[]} [promiseArray] - Array of promises to resolve before first job of flow will run, not necessarily before the .beginChain() will run.
         * @returns {Flow}
         */
        beginChain() {
            return begin.call(this, _d, ...arguments);
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
            return flow.call(this, _d, ...arguments);
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
            return execF.call(this, _d, ...arguments);
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
            return instance_cancel.call(this, _d, ...arguments);
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
         * Once endChain resolves, the flow function using this flow will call `done(result)` which will pass the result back
         * to the flowAPI.js file which will then call `.setFlowResult` on an instance of this class which will both set
         * this flow as complete and update the result the user passed inside of Mongo.
         * @method Flow.endChain
         * @this Flow
         * @param {object} _d - Private Flow data
         * @returns {Promise.<Flow>}
         */
        endChain() {
            return end.call(this, _d, ...arguments)
        }


        save() {
            return save.call(this, _d, ...arguments);
        }

    }

    //============================================================
    //
    //             SETUP FLOW'S GLOBAL EVENTS EMITTER
    //
    //============================================================

    if (_d.o.returnJobOnEvents) {
        // Setup queue logging events
        _d.queue
            .on('job enqueue', (id, type) => {
                _d.Logger.info(`[${type}][${id}] - QUEUED`);

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
                _d.Logger.error(`[${id}] - FAILED`);
                _d.Logger.error(`[${id}] - ${errorMessage}`);

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
        _d.queue
            .on('job enqueue', (id, type) => {
                _d.Logger.info(`[${type}][${id}] - QUEUED`);
                Flow.events.emit('job enqueue', ...arguments);
            })
            .on('job complete', (id, result) => {
                //privateData.Logger.info(`[${id}] - COMPLETE`);
                //privateData.Logger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);
                Flow.events.emit('job complete', ...arguments);
            })
            .on('job failed', (id, errorMessage) => {
                _d.Logger.error(`[${id}] - FAILED`);
                _d.Logger.error(`[${id}] - ${errorMessage}`);
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