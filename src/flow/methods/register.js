const _ = require('lodash');
const Promise = require('bluebird');

/**
 * @this Flow
 * @param flowType
 * @param flowOptions
 * @param flowFunc
 * @param dynamicPropFunc
 */
export default Promise.method(function registerFlow(flowType, flowOptions, flowFunc, dynamicPropFunc) {

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
    this.FloughInstance._dynamicPropFuncs[ flowType ] = dynamicPropFunc;
    this.FloughInstance._jobOptions[ flowType ] = flowOptions;

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
    this.queue.process(`flow:${flowType}`, jobProcessingConcurrency, (job, done) => {

        //Logger.info(`Starting: flow:${flowName}`);
        //logger.debug(job.data);

        // Setup Flow Controller
        let flow = new this.FlowController(job);

        // If in devMode do not catch errors, let process crash
        if (o.devMode) {
            flowWrapper(job, flow)
                .then(result => flow.setFlowResult(result))
                .tap(result => this.Logger.info(`[${job.type}][${flow.flowId}][${job.id}] COMPLETE - RESULT: ${JSON.stringify(result, null, 2)}`))
                .then(result => done(null, result))
                .catch(err => {
                    if (err.stack) this.Logger.error(err.stack);
                    else {
                        this.Logger.error(JSON.stringify(err));
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

});