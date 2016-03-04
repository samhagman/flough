'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = jobAPIBuilder;
var Promise = require('bluebird');
var kue = require('kue');
var _ = require('lodash');
var ObjectId = require('mongoose').Types.ObjectId;
var crypto = require('crypto');

/**
 * Builds the Jobs APIs
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose connection
 * @param {object} FloughInstance - Flough instance that is eventually passed to the user.
 * @returns {{registerJob, startJob}}
 */

function jobAPIBuilder(queue, mongoCon, FloughInstance) {

    var o = FloughInstance.o;
    var Logger = o.logger.func;
    var JobModel = mongoCon.model('job');
    var jobLogger = require('./jobLogger')(mongoCon, Logger);

    FloughInstance._dynamicPropFuncs = {};
    FloughInstance._jobOptions = {};
    FloughInstance._toBeAttached = {};

    /**
     * Allows a User to register a job function for repeated use by .startJob()
     * @param {string} jobType - The string that this job should be registered under
     * @param {object} [jobOptions] - Options for the job
     * @param {function} jobFunc - The User passed function that holds the job's logic
     * @param {function} [dynamicPropFunc] - This is function to be run at job start time which should return an object
     *  that will be merged into the job.data of all jobs of this type.
     */
    function registerJob(jobType, jobOptions, jobFunc, dynamicPropFunc) {

        // Handle optional arguments
        if (arguments.length === 2) {
            jobFunc = jobOptions;
            jobOptions = {};
            dynamicPropFunc = function () {
                return {};
            };
        } else if (arguments.length === 3) {
            if (!_.isPlainObject(jobOptions)) {
                dynamicPropFunc = jobFunc;
                jobFunc = jobOptions;
                jobOptions = {};
            } else {
                dynamicPropFunc = function () {
                    return {};
                };
            }
        }

        // Add the function to the dynamic properties functions list.
        FloughInstance._dynamicPropFuncs[jobType] = dynamicPropFunc;
        FloughInstance._jobOptions[jobType] = jobOptions;

        /**
         * Take a job instance and cancel it.
         * @param {object} job - A Kue job object
         * @param {object} data - Data about cancellation
         */
        var cancelJob = function cancelJob(job) {
            var data = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

            FloughInstance.emit('CancelFlow:' + job.data._flowId, data);
            Logger.error('[' + job.type + '][' + job.data._uuid + '][' + job.id + '] Cancelling job.');
            job.log('Job cancelled by parent flow.');
            job.failed();
        };

        /**
         * Wraps the user-given job in a promise,
         * then attaches some required Flough fields to the data,
         * then runs the job.
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        var jobWrapper = function jobWrapper(job) {
            //Logger.info(`Starting: ${jobType}`);
            //Logger.debug(`Job's data:`, job.data);

            return new Promise(function (resolve, reject) {

                job.data._stepsTaken = job.data._stepsTaken ? job.data._stepsTaken : 0;
                job.data._substepsTaken = job.data._substepsTaken ? job.data._substepsTaken : 0;
                _.merge(job.data, FloughInstance._toBeAttached[job.data._uuid]);
                delete FloughInstance._toBeAttached[job.data._uuid];
                job.jobLogger = jobLogger;
                job.cancel = function (data) {
                    cancelJob(job, data);
                };

                jobFunc(job, resolve, reject);
            });
        };

        /**
         * Updates the job's document with the job's Kue id
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        var updateJobInMongo = function updateJobInMongo(job) {
            return new Promise(function (resolve, reject) {
                JobModel.findById(job.data._uuid, function (err, jobDoc) {
                    if (err) {
                        Logger.error(err.stack);
                        reject(err);
                    } else if (jobDoc) {
                        jobDoc.jobId = job.id;
                        jobDoc.data = job.data;
                        jobDoc.save();
                        resolve(job);
                    } else {
                        // TODO If the document wasn't found in persistent storage, maybe make a new job?
                    }
                });
            });
        };

        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        var jobProcessingConcurrency = 50;

        /**
         * This tells Kue how to process Flough jobs.
         */
        queue.process('job:' + jobType, jobProcessingConcurrency, function (job, done) {

            // If in devMode, do not catch errors let the process crash
            if (o.devMode) {
                updateJobInMongo(job).tap(function (job) {
                    return FloughInstance.once('CancelJob:' + job.data._uuid, function (data) {
                        return cancelJob(job, data);
                    });
                }).then(jobWrapper).done(function (result) {
                    return done(null, result);
                });
            }

            // If in production mode, catch errors to prevent crashing
            else {
                    updateJobInMongo(job).tap(function (job) {
                        return FloughInstance.once('CancelJob:' + job.data._uuid, function (data) {
                            return cancelJob(job);
                        });
                    }).then(jobWrapper).then(function (result) {
                        return done(null, result);
                    })['catch'](function (err) {
                        Logger.error(err.stack);

                        // TODO setup softShutdown(blah, blah, done, err)
                        done(err);
                    });
                }
        });
    }

    /**
     * Create the kue job but first add any dynamic properties.
     * @param jobType
     * @param data
     * @returns {bluebird|exports|module.exports}
     */
    function createJob(jobType, data) {

        return new Promise(function (resolve, reject) {

            var dynamicPropFunc = FloughInstance._dynamicPropFuncs[jobType];

            var jobOptions = FloughInstance._jobOptions[jobType];

            var noSaveFieldNames = jobOptions.noSave || [];

            var newData = _.omit(data, noSaveFieldNames);

            FloughInstance._toBeAttached[data._uuid] = _.pick(data, noSaveFieldNames);

            if (_.isFunction(dynamicPropFunc)) {
                var dynamicProperties = dynamicPropFunc(newData);
                var mergedProperties = _.merge(newData, dynamicProperties);

                resolve(queue.create('job:' + jobType, mergedProperties));
            } else {
                Logger.error('Dynamic property passed was not a function for job type ' + jobType);
                Logger.error(JSONIFY(dynamicPropFunc));
                reject('Dynamic property passed was not a function.');
            }
        });
    }

    /**
     * Starts a job that had been previously registered with Flough
     * @param {string} jobType - Type of job to start
     * @param [givenData] - Data context to be attached to the job
     * @returns {bluebird|exports|module.exports}
     */
    function startJob(jobType) {
        var givenData = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

        return new Promise(function (resolve, reject) {

            /**
             * NOTE:
             * jobFields === Object to be stored in MongoDb
             * data === Object to be attached to Kue job
             */

            var data = _.clone(givenData);

            // Generate a new UUID for the job if no UUID is passed.
            var alreadyPersisted = false;

            if (!data._uuid) {
                var randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = crypto.randomBytes(1)[0] % 16 | 0,
                        v = c == 'x' ? r : (r & 0x3 | 0x8).toString(16);
                    return v.toString(16);
                });
                data._uuid = new ObjectId(randomStr);
            } else {
                alreadyPersisted = true;
            }

            var jobFields = {
                _id: data._uuid,
                jobId: -1,
                type: jobType,
                title: data.title,
                step: data._step ? data._step : 0,
                substep: data._substep ? data._substep : 0,
                data: data,
                jobLogs: []
            };

            // If a flowId was passed then this is a helper job inside a flow
            if (data._flowId) {
                jobFields._flowId = data._flowId;
            }

            // If no flowId was passed then set the flowId to 'NoFlow' to signify this is a solo job
            else {
                    jobFields._flowId = 'NoFlow';
                    data._flowId = 'NoFlow';
                    data._flowType = 'NoFlow';
                }

            // If no title was passed, set title to the job's type
            if (!data.title) {
                jobFields.title = jobType;
                data.title = jobType;
            }
            // Create record in mongo
            if (!alreadyPersisted) {
                JobModel.create(jobFields, function (err, jobDoc) {

                    if (err) {
                        Logger.error(err.stack);
                        reject(err);
                    } else {
                        // Resolve with a Kue job that still needs to be .save()'d for it to run.
                        resolve(createJob(jobType, data));
                    }
                });
            } else {
                resolve(createJob(jobType, data));
            }
        });
    }

    // Setup, attach to, and return Job API object
    FloughInstance.registerJob = registerJob;
    FloughInstance.startJob = startJob;

    return FloughInstance;
}

module.exports = exports['default'];