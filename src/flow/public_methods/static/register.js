const _ = require('lodash');
const Promise = require('bluebird');

/**
 * @param {object} privateData - Object holding private Flow class data
 * @param type
 * @param flowOptions
 * @param flowFunc
 * @param dynamicPropFunc
 */
export default function registerFlow(privateData, type, flowOptions, flowFunc, dynamicPropFunc) {

    const _d = privateData;
    const Logger = _d.Logger;

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

    // Save the dynamic properties function for this kind of flow
    _d.dynamicPropFuncs[ type ] = dynamicPropFunc;

    // Save the job options for this kind of flow
    _d.jobOptions[ type ] = flowOptions;

    /**
     * Starts a new FlowController Instance and then wraps User's flow function in promise and injects parameters
     * into it.
     * @param {object} flowInstance - Instance of Flow class representing this flow
     * @returns {bluebird|exports|module.exports}
     */
    const flowWrapper = function(flowInstance) {

        return new Promise((resolve, reject) => {

            flowFunc(flowInstance, resolve, reject);

        });

    };


    // TODO allow the user to set the job concurrency of flows and jobs at registration time
    /**
     * This is the number of this type of job that will be run simultaneously before the next added job is queued
     * @type {number}
     */
    let jobProcessingConcurrency = 50;

    // This tells the Kue queue how to handle flow type jobs.
    _d.queue.process(`flow:${type}`, jobProcessingConcurrency, (job, done) => {

        //Logger.info(`Starting: flowInstance:${flowName}`);
        //logger.debug(job.data);

        // Setup Flow Controller
        const flowInstance = new _d.Flow(job);

        // Attach data that wasn't saved to Kue/MongoDB
        flowInstance.data = _.merge(flowInstance.data, _d.toBeAttached);

        // If in devMode do not catch errors, let process crash
        if (_d.o.devMode) {
            flowWrapper(flowInstance)
                .then(result => _d.setFlowResult(flowInstance, result))
                .tap(result => Logger.info(`[${job.type}][${flowInstance.uuid}][${job.id}] COMPLETE - RESULT: ${JSON.stringify(result, null, 2)}`))
                .then(result => done(null, result))
                .then(() => Promise.resolve(delete _d.toBeAttached[flowInstance.uuid]))
                .catch(err => {
                    if (err.stack) Logger.error(err.stack);
                    else {
                        Logger.error(JSON.stringify(err));
                    }
                    done(err);
                })
            ;
        }
        // In production mode catch errors to prevent crashing
        else {
            flowWrapper(flowInstance)
                .then(result => flowInstance.setFlowResult(result))
                .then(result => done(null, result))
                .then(() => Promise.resolve(delete _d.toBeAttached[ flowInstance.uuid ]))
                .catch(err => done(err))
            ;
        }

    });

    return Promise.resolve();

}


    // .then(kueJob => Promise.resolve(new Flow(kueJob)))
    // .then(flowInstance => {
    //     flowInstance.data = _.merge(flowInstance.data, toBeAttached);
    //     return Promise.resolve(flowInstance)
    // })