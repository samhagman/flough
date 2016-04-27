const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');
const util = require('util');
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
    const static_cancel = require('./public_methods/static/static_cancel');
    const reset = require('./public_methods/static/rollback');
    const restart = require('./public_methods/static/restart');
    const rollback = require('./public_methods/static/rollback');
    const clone = require('./public_methods/static/clone');
    const status = require('./public_methods/static/status');
    const search = require('./public_methods/static/search');
    const searchKue = require('./public_methods/static/searchKue');

    // Public Instance Methods
    const begin = require('./public_methods/instance/begin');
    const build = require('./public_methods/instance/build');
    const end = require('./public_methods/instance/end');
    const execF = require('./public_methods/instance/execF');
    const flow = require('./public_methods/instance/flow');
    const instance_cancel = require('./public_methods/instance/instance_cancel');
    const save = require('./public_methods/instance/save');

    /**
     * Private Data - Internal to Flow - A.K.A. _d
     * @alias Flow~privateData
     * @protected
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
         * The data given to the Flow constructor to build this flow instance
         * @instance
         * @type {object}
         */
        givenData;

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
         * @type {number|null}
         */
        stepsTaken = null;

        /**
         * The number of substeps that have been taken at the current step
         * @instance
         * @type {Array|null}
         */
        substepsTaken = null;

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
        isParent = false;

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
         * Whether or not this flow has had flow#build called on it yet.
         * @instance
         * @default
         * @type {null|Promise.<Flow>}
         */
        buildPromise = null;

        /**
         * This will hold a counter of how many substeps have been added for a given step, which allows us to
         * dynamically assign substeps to jobs as they are called in the flow chain.
         * @type {object}
         */
        substeps = {};

        /**
         * Holds the flow information of each flow
         * @example { '1': {'1': { data: {//flow.data fields//}, result: 'STEP 1, SUBSTEP 1's RESULT STR' }, '2': {
             *     data: {//flow.data fields//}, result: 'STEP 1, SUBSTEP 2's RESULT STR' } } }
         * @type {object|null}
         */
        ancestors = null;

        /**
         * Holds jobs that are currently running for this Flow
         * @type {Array}
         */
        activeChildren = [];

        /**
         * This holds an array of functions, which return promises, which resolve when the flow has been all setup
         * and registered on the flow instance properly (in this.promised) and now are just waiting to be initiated
         * by the unpackPromises function (check .endChain() for more)
         * @type {Array}
         */
        flowHandlers = [];

        /**
         * This is the step map that is created by all the functions in this.jobHandlers.  Each key corresponds to
         * a step and holds an array of functions that when called will start the flow (by adding a flow to the Kue
         * queue)
         * @type {object.<string, function[]>}
         */
        promised = {
            '0': []
        };


        /**
         * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
         * @param {string} type - Type of flow to construct
         * @param {object} [givenData={}] - Data context to be attached to this Flow
         */
        constructor(type, givenData = {}) {
            // Apply EventEmitter3 instance properties
            super();

            const _this = this;

            const { Logger } = _d;

            //TODO explain
            _this.givenData = givenData;
            _this.type = type;

            // This is a logger that will log messages both to the flow itself (flow.log) but also to persistent storage
            this.flowLogger = require('../util/flowLogger')(mongoCon, Logger);


            // TODO implement and document
            // Listen for any cancellation event made by routes
            _this.once(`CancelFlow:${_this.uuid}`, _this.cancel.bind(_this));
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
         * @param {object} [flowOptions] - Object holding the options for registering this Flow type
         * @param {function} flowFunc - Function that will be registered to run for this type
         * @param {function} [dynamicPropFunc] - A function that returns an object whose fields will be merged into the data for each
         *      flow of this type at runtime.
         * @returns {Promise}
         */
        static register(type, flowOptions, flowFunc, dynamicPropFunc) {
            return register(_d, ...arguments);
        }

        /**
         * Cancel a particular Flow by UUID
         * @method Flow.cancel
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise}
         */
        static cancel(UUID) {
            return static_cancel(_d, ...arguments);
        }

        /**
         * Reset an active Flow instance back to a certain step
         * @method Flow.rollback
         * @memberOf Flow
         * @alias Flow.rollback
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @param {number} stepNumber - The step number to rollback to
         * @returns {Promise}
         */
        static rollback(UUID, stepNumber) {
            return rollback(_d, ...arguments);
        }

        /**
         * Completely reset a flow so that it starts all over again from the originally provided data.
         * @method Flow.reset
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise}
         */
        static reset(UUID) {
            return reset(_d, ...arguments);
        }

        /**
         * Restart a flow so it is re-initialized in memory and in Kue
         * @method Flow.restart
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<Flow>}
         */
        static restart(UUID) {
            return restart(_d, ...arguments);
        }

        /**
         * Take an existing flow and start a copy of it
         * @method Flow.clone
         * @public
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object>} - A flow instance
         */
        static clone(UUID) {
            return clone(_d, ...arguments);
        }

        /**
         * TODO - Make this return something more useful than just searching for the flow
         * @method Flow.status
         * @public
         * @alias Flow.search
         * @param {object} _d - Object holding private Flow class data
         * @param {string} UUID - The UUID of a flow
         * @returns {Promise.<object[]>}
         */
        static status(UUID) {
            return status(_d, ...arguments);
        }

        /**
         * Search for flows using MongoDB as the source of truth.
         * Results must match ALL specified parameters: jobIds, flowUUIDs, types
         * @method Flow.search
         * @public
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
         * @method Flow.searchKue
         * @public
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
         * Initializes a Flow chain
         * @method Flow#beginChain
         * @public
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {Promise[]} [promiseArray=[]] - Array of promises to resolve before first job of flow will run, not necessarily before the .beginChain() will run.
         * @returns {Flow}
         */
        beginChain() {
            return begin.call(this, _d, ...arguments);
        }

        /**
         * Adds a child flow to the flow chain
         * @method Flow#flow
         * @public
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {number} step - The step in the chain to add this flow to
         * @param {string} type - The type of flow to add
         * @param {object|function} [flowData={}]
         * @returns {Flow}
         */
        flow() {
            return flow.call(this, _d, ...arguments);
        }

        /**
         * Add an arbitrary promise function to a promise chain.
         * @method Flow#execF
         * @public
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
         * @method Flow#cancel
         * @public
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
         * @method Flow#endChain
         * @public
         * @this Flow
         * @param {object} _d - Private Flow data
         * @returns {Promise.<Flow>}
         */
        endChain() {
            return end.call(this, _d, ...arguments);
        }


        /**
         * Builds the `flow.data` and `flow.kueJob` objects in memory without saving to MongoDB and Redis, respectively.
         * @method build
         * @memberOf Flow
         * @public
         * @this Flow
         * @param {object} _d - Private Flow data
         * @returns {Promise.<Flow>}
         */
        build() {
            return build.call(this, _d, ...arguments);
        }

        /**
         * Proxy method for calling kueJob#save which makes Kue run the registered job
         * @method save
         * @memberOf Flow
         * @public
         * @this Flow
         * @param {object} _d - Private Flow data
         * @param {function} [cb] - Optional callback interface
         * @returns {Flow}
         */
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
          });

        _d.queue.on('job complete', (id, result) => {
            //privateData.Logger.info(`[${id}] - COMPLETE`);
            //privateData.Logger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);

            Flow.events.emit('job complete', ...arguments);
            kue.Job.get(id, (err, job) => {
                Flow.events.emit(`${job.data._uuid}:complete`, job);
                Flow.events.emit(`${job.type}:complete`, job);
            });
        });

        _d.queue.on('job failed', (id, errorMessage) => {
            _d.Logger.error(`[${id}] - FAILED`);
            _d.Logger.error(`[${id}] - ${errorMessage}`);

            Flow.events.emit('job failed', ...arguments);
            kue.Job.get(id, (err, job) => {
                Flow.events.emit(`${job.data._uuid}:failed`, job);
                Flow.events.emit(`${job.type}:failed`, job);
            });
        });
        _d.queue.on('job promotion', (id) => {
            Flow.events.emit('job promotion', ...arguments);
            kue.Job.get(id, (err, job) => {
                Flow.events.emit(`${job.data._uuid}:promotion`, job);
                Flow.events.emit(`${job.type}:promotion`, job);
            });
        });
        _d.queue.on('job progress', (id) => {
            Flow.events.emit('job progress', ...arguments);
            kue.Job.get(id, (err, job) => {
                Flow.events.emit(`${job.data._uuid}:progress`, job);
                Flow.events.emit(`${job.type}:progress`, job);
            });
        });
        _d.queue.on('job failed attempt', (id) => {
            Flow.events.emit('job failed attempt', ...arguments);

            kue.Job.get(id, (err, job) => {
                Flow.events.emit(`${job.data._uuid}:failed attempt`, job);
                Flow.events.emit(`${job.type}:failed attempt`, job);
            });
        });
        _d.queue.on('job remove', (id) => {
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
        _d.queue.on('job enqueue', (id, type) => {
            _d.Logger.info(`[${type}][${id}] - QUEUED`);
            Flow.events.emit('job enqueue', ...arguments);
        });
        _d.queue.on('job complete', (id, result) => {
            //privateData.Logger.info(`[${id}] - COMPLETE`);
            //privateData.Logger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);
            Flow.events.emit('job complete', ...arguments);
        });
        _d.queue.on('job failed', (id, errorMessage) => {
            _d.Logger.error(`[${id}] - FAILED`);
            _d.Logger.error(`[${id}] - ${errorMessage}`);
            Flow.events.emit('job failed', ...arguments);
        });
        _d.queue.on('job promotion', () => {
            Flow.events.emit('job promotion', ...arguments);
        });
        _d.queue.on('job progress', () => {
            Flow.events.emit('job progress', ...arguments);
        });
        _d.queue.on('job failed attempt', () => {
            Flow.events.emit('job failed attempt', ...arguments);
        });
        _d.queue.on('job remove', () => {
            Flow.events.emit('job remove', ...arguments);
        })
        ;
    }

    return Flow;
};
