let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;
let recursiveStringify = requireServer('lib/util').recursiveStringify;

/**
 * Builds the Jobs APIs
 * @param {Object} queue - Kue queue
 * @param {Object} mongoCon - Mongoose connection
 * @param {Object} o - User passed options to Flough
 * @returns {{registerJob, startJob}}
 */
export default function jobAPIBuilder(queue, mongoCon, o) {

    let Logger = o.logger.func;
    let JobModel = mongoCon.model('job');
    let jobLogger = require('./jobLogger')(mongoCon, Logger);

    /**
     * Allows a User to register a job function for repeated use by .startJob()
     * @param {String} jobType - The string that this job should be registered under
     * @param {Function} jobFunc - The User passed function that holds the job's logic
     */
    function registerJob(jobType, jobFunc) {

        /**
         * Wraps the user-given job in a promise,
         * then attaches some required Flough fields to the data,
         * then runs the job.
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        const jobWrapper = function(job) {
            Logger.info(`Starting: ${jobType}`);
            Logger.debug(job.type);
            Logger.debug(job.data);

            return new Promise((resolve, reject) => {

                job.data._stepsTaken = job.data._stepsTaken ? job.data._stepsTaken : 0;
                job.data._substepsTaken = job.data._substepsTaken ? job.data._substepsTaken : 0;
                job.jobLogger = jobLogger;

                jobFunc(job, resolve, reject);

            });

        };

        /**
         * Updates the job's document with the job's Kue id
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        const storeJobId = function(job) {
            return new Promise((resolve, reject) => {
                JobModel.findById(job.data._uuid, (err, jobDoc) => {
                    if (err) {
                        Logger.error(err);
                        reject(err);
                    }
                    else if (jobDoc) {
                        jobDoc.jobId = job.id;
                        if (jobDoc.jobLogs.length !== 0) {
                            jobLogger('Job restarted.', job.data._uuid);
                        }
                        jobDoc.save();
                        resolve(job);
                    }
                    else {
                        // TODO If the document wasn't found in persistent storage, maybe make a new job?
                    }
                });
            });
        };

        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        let jobProcessingConcurrency = 50;

        /**
         * This tells Kue how to process Flough jobs.
         */
        queue.process('job:' + jobType, jobProcessingConcurrency, (job, done) => {

            // If in devMode, do not catch errors let the process crash
            if (o.devMode) {
                storeJobId(job)
                    .then(jobWrapper)
                    .then((result) => done(null, result));
            }
            // If in production mode, catch errors to prevent crashing
            else {
                storeJobId(job)
                    .then(jobWrapper)
                    .then((result) => done(null, result))
                    .catch(err => {
                        Logger.error(err.stack);
                        // TODO setup softShutdown(blah, blah, done, err)
                        done(err);
                    })
                ;
            }
        });

    }

    /**
     * Starts a job that had been previously registered with Flough
     * @param {String} jobType - Type of job to start
     * @param [data] - Data context to be attached to the job
     * @returns {bluebird|exports|module.exports}
     */
    function startJob(jobType, data = {}) {

        return new Promise((resolve, reject) => {

            // Generate a new UUID for the job if no UUID is passed.
            if (!data._uuid) {
                data._uuid = new ObjectId(Date.now());
            }

            // jobFields === Object to be stored in MongoDb
            // data === Object to be attached to Kue job

            let jobFields = {
                _id:     data._uuid,
                jobId:   -1,
                type:    jobType,
                step:    data._step ? data._step : 0,
                substep: data._substep ? data._substep : 0,
                data:    data,
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
            }

            // If no title was passed, set title to the job's type
            if (!data.title) {
                jobFields.title = jobType;
                data.title = jobType;
            }

            // Create record in mongo
            JobModel.create(jobFields, (err, jobDoc) => {

                if (err) {
                    Logger.error(err);
                    reject(err);
                }
                else {
                    // Resolve with a Kue job that still needs to be .save()'d for it to run.
                    resolve(queue.create(`job:${jobType}`, data));
                }
            });
        });
    }

    // Setup, attach to, and return Job API object
    let jobAPI = {};
    jobAPI.registerJob = registerJob;
    jobAPI.startJob = startJob;

    return jobAPI;
}