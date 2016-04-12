const _ = require('lodash');
const Promise = require('bluebird');

/**
 * Register a new type of Flow
 * @method Flow.register
 * @public
 * @param {Flow~privateData} _d - Private Flow data
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

    // TODO allow the user to set the job concurrency of flows and jobs at registration time
    /**
     * This is the number of this type of job that will be run simultaneously before the next added job is queued
     * @type {number}
     */
    let jobProcessingConcurrency = 50;

    // This tells the Kue queue how to handle flow type jobs.
    _d.queue.process(`flow:${type}`, jobProcessingConcurrency, (kueJob, done) => {

        Logger.info(`Starting: flowInstance:${kueJob.type}`);
        Logger.debug(kueJob.data);

        // If in devMode do not catch errors, let process crash
        if (_d.o.devMode) {
            runFlow(_d, kueJob, flowFunc)
                .catch(err => {
                    if (err.stack) Logger.error(err.stack);
                    else {
                        Logger.error(JSON.stringify(err));
                    }

                    done(err);
                })
                .then(result => done(null, result))
            ;

        }
        // In production mode catch errors to prevent crashing
        else {
            runFlow(_d, kueJob, flowFunc)
                .catch(err => done(err))
                .then(result => done(null, result))
            ;
        }

    });

    return Promise.resolve();

}

/**
 * Startup a Flow by either retrieving its already initialized instance and running the registered function, or by
 * creating a new Flow instance and then running the registered function.
 * @param {object} _d - Object holding private Flow class data
 * @param {Job} kueJob - Job created by the Kue library
 * @param {function} flowFunc - The function that was registered for this job
 * @returns {Promise.<*>}
 */
function runFlow(_d, kueJob, flowFunc) {

    const flowUUID = kueJob.data._uuid;
    const flowType = kueJob.data._type;

    const flowInstanceProm = _d.flowInstances.has(flowUUID)
        ? _d.flowInstances.get(flowUUID)
        : new _d.Flow(flowType, kueJob.data).save()
    ;

    return flowInstanceProm
        .then(() => {
            return new Promise((resolve, reject) => {
                flowFunc(flowInstanceProm, resolve, reject);
            });
        })
        .then(result => _d.setFlowResult(flowInstanceProm, result))
        .tap(() => _d.flowInstances.remove(flowUUID))
        .tap(result => {
            _d.Logger.info(`[${flowType}][${flowInstanceProm.uuid}][${kueJob.id}] COMPLETE - RESULT: ${JSON.stringify(result, null, 2)}`);
        });
}

export default register;
