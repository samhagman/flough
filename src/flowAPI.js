let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;

/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} FloughInstance - Instance of FloughAPI that is passed to the user.
 * @returns {{registerFlow, startFlow}}
 */
export default function flowAPIBuilder(queue, mongoCon, FloughInstance) {
    let FlowController = require('./FlowClass')(queue, mongoCon, FloughInstance, startFlow);
    let o = FloughInstance.o;
    let Logger = o.logger.func;

    FloughInstance._dynamicPropFuncs = {};


    /**
     * Registers a function so that it can be called by .startFlow()
     * @param {string} flowName - Name of flow (successive calls of same flowName overwrite previous Flows)
     * @param {function} flowFunc - User passed function that is the Flow's logic
     * @param {function} dynamicPropFunc - This is function to be run at job start time which should return an object
     *  that will be merged into the job.data of all jobs of this type.
     */
    function registerFlow(flowName, flowFunc, dynamicPropFunc = () => {
        return {};
    }) {

        // Add the function to the dynamic properties functions list.
        FloughInstance._dynamicPropFuncs[ flowName ] = dynamicPropFunc;

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
        queue.process(`flow:${flowName}`, jobProcessingConcurrency, (job, done) => {


            Logger.info(`Starting: flow:${flowName}`);
            //logger.debug(job.data);

            // Setup Flow Controller
            let flow = new FlowController(job);

            // If in devMode do not catch errors, let process crash
            if (o.devMode) {
                flowWrapper(job, flow)
                    .then(result => flow.setFlowResult(result))
                    .then(result => done(null, result))
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

    function updateFlowResult(result) {

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
                    }
                    else {
                        _this.completed = true;
                    }
                })
            ;
    }


    /**
     * Create the kue job but first add any dynamic properties.
     * @param flowName
     * @param data
     * @returns {bluebird|exports|module.exports}
     */
    function createFlowJob(flowName, data) {

        let dynamicProperties = FloughInstance._dynamicPropFuncs[ flowName ](data);
        let mergedProperties = _.merge(data, dynamicProperties);

        return Promise.resolve(queue.create(`flow:${flowName}`, mergedProperties));
    }

    /**
     * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
     * @param {string} flowName - Name of Flow to start
     * @param {object} [data] - Data context to be attached to this Flow
     * @param {boolean} [helper] - If this is a helper flow, it will not restart on its own after a server restart.
     * @returns {bluebird|exports|module.exports}
     */
    function startFlow(flowName, data = {}, helper = false) {

        return new Promise((resolve, reject) => {

            if (!data._stepsTaken) {
                data._stepsTaken = -1;
            }

            if (!data._substepsTaken) {
                data._substepsTaken = [];
            }

            if (!data._flowId) {
                data._flowId = new ObjectId(Date.now());
            }

            if (!data._uuid) {
                data._uuid = new ObjectId(Date.now());
            }

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