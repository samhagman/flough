let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;


export default function flowAPIBuilder(queue, mongoCon, options) {
    let FlowController = require('./FlowClass')(queue, mongoCon, options);

    let logger = options.logger.func;

    function registerFlow(flowName, flowFunc) {

        /**
         * Processes an EAF Funding Change
         * @param {Object} jobOptions - Options that change the way the job is processed
         * @returns {*|Promise|Promise.<T>|Thenable<U>|Promise<U>}
         */
        const flowWrapper = function(job) {

            logger.debug('Starting processing eaf_funding_change...');


            return new Promise((resolve, reject) => {

                let flow = new FlowController(job, mongoCon);

                flowFunc(flow, resolve, reject);

            });

        };


        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        let jobProcessingConcurrency = 50;

        queue.process(`flow:${flowName}`, jobProcessingConcurrency, (job, done) => {


            logger.info(`Starting: job:${flowName}`);
            //logger.debug(job.data);

            if (options.devMode) {
                flowWrapper(job)
                    .then((result) => done(null, result))
                ;
            }
            else {
                flowWrapper(job)
                    .then((result) => done(null, result))
                    .catch(err => done(err))
                ;
            }

        });

    }

    /**
     *
     * @param flowName
     * @param [data]
     * @returns {bluebird|exports|module.exports}
     */
    function startFlow(flowName, data = {}) {

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

            resolve(queue.create(`flow:${flowName}`, data));
        });


    }

    let flowAPI = {};
    flowAPI.registerFlow = registerFlow;
    flowAPI.startFlow = startFlow;

    return flowAPI;
}