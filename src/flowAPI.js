let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;
let util = require('util');
const crypto = require('crypto');

/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} FloughInstance - Instance of Flough that is passed to the user.
 * @returns {{registerFlow, startFlow}}
 */
export default function flowAPIBuilder(queue, mongoCon, FloughInstance) {
    let FlowController = require('./FlowClass')(queue, mongoCon, FloughInstance, startFlow);
    let o = FloughInstance.o;
    let Logger = o.logger.func;

    FloughInstance._dynamicPropFuncs = {};


    /**
     * Registers a function so that it can be called by .startFlow()
     * @param {string} flowType - Name of flow (successive calls of same flowName overwrite previous Flows)
     * @param {object} [flowOptions] - Options for how to process this flow
     * @param {function} flowFunc - User passed function that is the Flow's logic
     * @param {function} [dynamicPropFunc] - This is function to be run at job start time which should return an object
     *  that will be merged into the job.data of all jobs of this type.
     */
    function registerFlow(flowType, flowOptions, flowFunc, dynamicPropFunc) {

        // Handle optional arguments
        if (arguments.length === 2) {
            flowFunc = flowOptions;
            flowOptions = {};
            dynamicPropFunc = () => { return {}; };
        }
        else if (arguments.length === 3) {
            if (!_.isPlainObject(flowOptions)) {
                dynamicPropFunc = flowFunc;
                flowFunc = flowOptions;
                flowOptions = {};
            }
            else {
                dynamicPropFunc = (() => { return {}; });
            }
        }

        // Add the function to the dynamic properties functions list.
        FloughInstance._dynamicPropFuncs[ flowType ] = dynamicPropFunc;
        FloughInstance._jobOptions[ flowType ] = flowOptions;

        /**
         * Starts a new FlowController Instance and then wraps User's flow function in promise and injects parameters
         * into it.
         * @param {object} job - A Kue job that is used to track and restart the Flow
         * @returns {bluebird|exports|module.exports}
         */
        const flowWrapper = function(job, flow) {

            return new Promise((resolve, reject) => {

                flowFunc(flow, resolve, reject);

            });

        };


        // TODO allow the user to set the job concurrency of flows and jobs at registration time
        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        let jobProcessingConcurrency = 50;

        // This tells the Kue queue how to handle flow type jobs.
        queue.process(`flow:${flowType}`, jobProcessingConcurrency, (job, done) => {

            //Logger.info(`Starting: flow:${flowName}`);
            //logger.debug(job.data);

            // Setup Flow Controller
            let flow = new FlowController(job);

            // If in devMode do not catch errors, let process crash
            if (o.devMode) {
                flowWrapper(job, flow)
                    .then(result => flow.setFlowResult(result))
                    .tap(result => Logger.info(`[${job.type}][${flow.flowId}][${job.id}] COMPLETE - RESULT: ${JSON.stringify(result, null, 2)}`))
                    .then(result => done(null, result))
                    .catch(err => {
                        if (err.stack) Logger.error(err.stack);
                        else {
                            Logger.error(JSONIFY(err));
                        }
                        done(err);
                    })
                ;
            }
            // In production mode catch errors to prevent crashing
            else {
                flowWrapper(job, flow)
                    .then(result => flow.setFlowResult(result))
                    .then(result => done(null, result))
                    .catch(err => done(err))
                ;
            }

        });

    }


    /**
     * Create the kue job but first add any dynamic properties.
     * @param flowType
     * @param data
     * @returns {Promise.<object>}
     */
    function createFlowJob(flowType, data) {

        return new Promise((resolve, reject) => {
            const dynamicPropFunc = FloughInstance._dynamicPropFuncs[ flowType ];

            const jobOptions = FloughInstance._jobOptions[ flowType ];

            const noSaveFieldNames = jobOptions.noSave || [];

            const newData = _.omit(data, noSaveFieldNames);

            FloughInstance._toBeAttached[ data._uuid ] = _.pick(data, noSaveFieldNames);

            if (_.isFunction(dynamicPropFunc)) {
                let dynamicProperties = dynamicPropFunc(newData);
                let mergedProperties = _.merge(newData, dynamicProperties);

                resolve(queue.create(`flow:${flowType}`, mergedProperties));

            }
            else {
                Logger.error(`Dynamic property passed was not a function for job type ${flowType}`);
                Logger.error(util.inspect(dynamicPropFunc));
                reject('Dynamic property passed was not a function.');
            }
        });

    }

    /**
     * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
     * @param {string} flowName - Name of Flow to start
     * @param {object} [givenData] - Data context to be attached to this Flow
     * @param {boolean} [helper] - If this is a helper flow, it will not restart on its own after a server restart.
     * @returns {bluebird|exports|module.exports}
     */
    function startFlow(flowName, givenData = {}, helper = false) {

        return new Promise((resolve, reject) => {

            let data = _.clone(givenData);

            if (!data._stepsTaken) {
                data._stepsTaken = -1;
            }

            if (!data._substepsTaken) {
                data._substepsTaken = [];
            }

            if (!data._flowId) {
                const randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    let r = crypto.randomBytes(1)[ 0 ] % 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
                    return v.toString(16);
                });
                data._flowId = (new ObjectId(randomStr)).toString();
            }

            //if (!data._uuid) {
            //    data._uuid = new ObjectId(Date.now());
            //}

            if (!data._flowType) {
                data._flowType = flowName;
            }

            data._helper = helper;

            resolve(createFlowJob(flowName, data));
        });

    }

    // Create, attach functions to, and return Flow API object
    FloughInstance.registerFlow = registerFlow;
    FloughInstance.startFlow = startFlow;

    return FloughInstance;
}