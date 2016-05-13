const _ = require('lodash');
const Promise = require('bluebird');
const util = require('util');
/**
 * Register a new type of Flow
 * @method Flow.register
 * @public
 * @param {PrivateFlowData} _d - Private Flow data
 * @param {string} type - The name of the flow type to register
 * @param {object} [flowOptions] - Object holding the options for registering this Flow type
 * @param {function} flowFunc - Function that will be registered to run for this type
 * @param {function} [dynamicPropFunc] - A function that returns an object whose fields will be merged into the data for each
 *      flow of this type at runtime.
 * @returns {Promise}
 */
function register(_d, type, flowOptions, flowFunc, dynamicPropFunc) {

    const { Logger } = _d;

    // Handle optional arguments
    if (arguments.length === 3) {
        flowFunc = flowOptions;
        flowOptions = {};
        dynamicPropFunc = () => { return {}; };
    }
    else if (arguments.length === 4) {
        if (_.isPlainObject(flowOptions)) {
            dynamicPropFunc = (() => { return {}; });
        }
        else {
            dynamicPropFunc = flowFunc;
            flowFunc = flowOptions;
            flowOptions = {};
        }
    }

    // Save the dynamic properties function for this kind of flow
    _d.dynamicPropFuncs[ type ] = dynamicPropFunc || (() => { return {}; });

    // Save the job options for this kind of flow
    _d.flowOptions[ type ] = flowOptions;

    // TODO allow the user to set the job concurrency of flows and jobs at registration time
    /**
     * This is the number of this type of job that will be run simultaneously before the next added job is queued
     * @type {number}
     */
    let jobProcessingConcurrency = 50;

    // This tells the Kue queue how to handle flow type jobs.
    _d.queue.process(`${type}`, jobProcessingConcurrency, (kueJob, done) => {

        const flowUUID = kueJob.data._uuid;
        const flowType = kueJob.data._type;
        Logger.info(`Starting: flowInstance:${kueJob.type}`);

        const runFlowProm = runFlow(_d, kueJob, flowFunc);

        runFlowProm
            .then(result => {
                return Promise.try(() => done(null, result)).return(result);
            })
            .catch(err => {
                if (err.stack) Logger.error(err.stack);
                else {
                    Logger.error(JSON.stringify(err));
                }

                done(err);

                return runFlowProm.cancel();
            })
            .then(result => {
                Logger.info(`[${flowType}][${flowUUID}][${kueJob.id}] COMPLETE - RESULT: ${JSON.stringify(result, null, 2)}`);
            })
        ;

    });

    return Promise.resolve();

}

/**
 * Startup a Flow by either retrieving its already initialized instance and running the registered function, or by
 * creating a new Flow instance and then running the registered function.
 * @param {PrivateFlowData} _d - Object holding private Flow class data
 * @param {Job} kueJob - Job created by the Kue library
 * @param {function} flowFunc - The function that was registered for this job
 * @returns {Promise.<*>}
 */
function runFlow(_d, kueJob, flowFunc) {

    const { Logger } = _d;
    const flowUUID = kueJob.data._uuid;
    const flowType = kueJob.data._type;
    let flowInstance;

    const flowInstanceProm = _d.flowInstances.has(flowUUID)
            ? _d.flowInstances.get(flowUUID)
            : new _d.Flow(flowType, kueJob.data).save({ isTest: kueJob.data._isTest });

    return flowInstanceProm
        .then((intFlowInstance) => {
            flowInstance = intFlowInstance;

            return _d.FlowModel.findByIdAndUpdate(flowUUID, { isStarted: true});
        })
        .then(() => {
            return new Promise((resolve, reject) => {
                flowFunc(flowInstance, resolve, reject);
            });
        })
        .then(result => _d.setFlowResult(flowInstance, result))
        .then(result => Promise.try(() => _d.flowInstances.remove(flowUUID)).return(result));

}

export default register;
