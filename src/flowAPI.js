let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;

/**
 * Builds the Flow API
 * @param {Object} queue - Kue queue
 * @param {Object} mongoCon - Mongoose Connection
 * @param {Object} o - Options passed by user to Flough
 * @returns {{registerFlow, startFlow}}
 */
export default function flowAPIBuilder(queue, mongoCon, o) {
    let FlowController = require('./FlowClass')(queue, mongoCon, o, startFlow);

    let Logger = o.logger.func;

    /**
     * Registers a function so that it can be called by .startFlow()
     * @param {String} flowName - Name of flow (successive calls of same flowName overwrite previous Flows)
     * @param {Function} flowFunc - User passed function that is the Flow's logic
     */
    function registerFlow(flowName, flowFunc) {

        /**
         * Starts a new FlowController Instance and then wraps User's flow function in promise and injects parameters
         * into it.
         * @param {Object} job - A Kue job that is used to track and restart the Flow
         * @returns {bluebird|exports|module.exports}
         */
        const flowWrapper = function(job) {

            return new Promise((resolve, reject) => {

                let flow = new FlowController(job);

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

            // If in devMode do not catch errors, let process crash
            if (o.devMode) {
                flowWrapper(job)
                    .then((result) => done(null, result))
                ;
            }
            // In production mode catch errors to prevent crashing
            else {
                flowWrapper(job)
                    .then((result) => done(null, result))
                    .catch(err => done(err))
                ;
            }

        });

    }

    /**
     * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
     * @param {String} flowName - Name of Flow to start
     * @param {Object} [data] - Data context to be attached to this Flow
     * @param {Boolean} [helper] - If this is a helper flow, it will not restart on its own after a server restart.
     * @returns {bluebird|exports|module.exports}
     */
    function startFlow(flowName, data = {}, helper = false) {

        return new Promise((resolve, reject) => {

            if (!data._stepsTaken) {
                data._stepsTaken = 0;
            }

            if (!data._substepsTaken) {
                data._substepsTaken = [];
            }

            if (!data._flowId) {
                data._flowId = new ObjectId(Date.now());
            }

            data._helper = helper;

            resolve(queue.create(`flow:${flowName}`, data));
        });


    }

    // Create, attach functions to, and return Flow API object
    let flowAPI = {};
    flowAPI.registerFlow = registerFlow;
    flowAPI.startFlow = startFlow;

    return flowAPI;
}