'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = flowAPIBuilder;
var Promise = require('bluebird');
var kue = require('kue');
var _ = require('lodash');
var ObjectId = require('mongoose').Types.ObjectId;
var util = require('util');
var crypto = require('crypto');

/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} FloughInstance - Instance of Flough that is passed to the user.
 * @returns {{registerFlow, startFlow}}
 */

function flowAPIBuilder(queue, mongoCon, FloughInstance) {
    var FlowController = require('./FlowClass')(queue, mongoCon, FloughInstance, startFlow);
    var o = FloughInstance.o;
    var Logger = o.logger.func;

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
            dynamicPropFunc = function () {
                return {};
            };
        } else if (arguments.length === 3) {
            if (!_.isPlainObject(flowOptions)) {
                dynamicPropFunc = flowFunc;
                flowFunc = flowOptions;
                flowOptions = {};
            } else {
                dynamicPropFunc = function () {
                    return {};
                };
            }
        }

        // Add the function to the dynamic properties functions list.
        FloughInstance._dynamicPropFuncs[flowType] = dynamicPropFunc;
        FloughInstance._jobOptions[flowType] = flowOptions;

        /**
         * Starts a new FlowController Instance and then wraps User's flow function in promise and injects parameters
         * into it.
         * @param {object} job - A Kue job that is used to track and restart the Flow
         * @returns {bluebird|exports|module.exports}
         */
        var flowWrapper = function flowWrapper(job, flow) {

            return new Promise(function (resolve, reject) {

                flowFunc(flow, resolve, reject);
            });
        };

        // TODO allow the user to set the job concurrency of flows and jobs at registration time
        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        var jobProcessingConcurrency = 50;

        // This tells the Kue queue how to handle flow type jobs.
        queue.process('flow:' + flowType, jobProcessingConcurrency, function (job, done) {

            //Logger.info(`Starting: flow:${flowName}`);
            //logger.debug(job.data);

            // Setup Flow Controller
            var flow = new FlowController(job);

            // If in devMode do not catch errors, let process crash
            if (o.devMode) {
                flowWrapper(job, flow).then(function (result) {
                    return flow.setFlowResult(result);
                }).tap(function (result) {
                    return Logger.info('[' + job.type + '][' + flow.flowId + '][' + job.id + '] COMPLETE - RESULT: ' + JSON.stringify(result, null, 2));
                }).then(function (result) {
                    return done(null, result);
                })['catch'](function (err) {
                    if (err.stack) Logger.error(err.stack);else {
                        Logger.error(JSONIFY(err));
                    }
                    done(err);
                });
            }
            // In production mode catch errors to prevent crashing
            else {
                    flowWrapper(job, flow).then(function (result) {
                        return flow.setFlowResult(result);
                    }).then(function (result) {
                        return done(null, result);
                    })['catch'](function (err) {
                        return done(err);
                    });
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

        return new Promise(function (resolve, reject) {
            var dynamicPropFunc = FloughInstance._dynamicPropFuncs[flowType];

            var jobOptions = FloughInstance._jobOptions[flowType];

            var noSaveFieldNames = jobOptions.noSave || [];

            var newData = _.omit(data, noSaveFieldNames);

            FloughInstance._toBeAttached[data._uuid] = _.pick(data, noSaveFieldNames);

            if (_.isFunction(dynamicPropFunc)) {
                var dynamicProperties = dynamicPropFunc(newData);
                var mergedProperties = _.merge(newData, dynamicProperties);

                resolve(queue.create('flow:' + flowType, mergedProperties));
            } else {
                Logger.error('Dynamic property passed was not a function for job type ' + flowType);
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
    function startFlow(flowName) {
        var givenData = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
        var helper = arguments.length <= 2 || arguments[2] === undefined ? false : arguments[2];

        return new Promise(function (resolve, reject) {

            var data = _.clone(givenData);

            if (!data._stepsTaken) {
                data._stepsTaken = -1;
            }

            if (!data._substepsTaken) {
                data._substepsTaken = [];
            }

            if (!data._flowId) {
                var randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = crypto.randomBytes(1)[0] % 16 | 0,
                        v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
                    return v.toString(16);
                });
                data._flowId = new ObjectId(randomStr).toString();
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

module.exports = exports['default'];