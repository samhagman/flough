let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;
let recursiveStringify = requireServer('lib/util').recursiveStringify;


export default function jobAPIBuilder(queue, storageClient, options) {

    let Logger = options.logger.func;
    let JobModel = storageClient.model('job');
    let jobLogger = require('./jobLogger')(storageClient, Logger);

    function registerJob(jobName, jobFunc) {

        /**
         * Wraps the user-given job in a promise, then runs the job.
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        const jobWrapper = function(job) {
            Logger.info(`Starting: ${jobName}`);
            Logger.debug(job.type);
            Logger.debug(job.data);

            return new Promise((resolve, reject) => {

                job.data._stepsTaken = job.data._stepsTaken ? job.data._stepsTaken : 0;
                job.data._substepsTaken = job.data._substepsTaken ? job.data._substepsTaken : 0;
                job.jobLogger = jobLogger;

                jobFunc(job, resolve, reject);

            });

        };

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

        queue.process('job:' + jobName, jobProcessingConcurrency, (job, done) => {

            if (options.devMode) {
                storeJobId(job)
                    .then(jobWrapper)
                    .then((result) => done(null, result));
            }
            else {
                Logger.error('GOT HERE');

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
     *
     * @param jobName
     * @param [data]
     * @returns {bluebird|exports|module.exports}
     */
    function startJob(jobName, data = {}) {

        return new Promise((resolve, reject) => {

            let jobUUID = new ObjectId(Date.now());
            data._uuid = jobUUID;

            let jobFields = {
                _id:     jobUUID,
                jobId:   -1,
                type:    jobName,
                step:    data._step ? data._step : 0,
                substep: data._substep ? data._substep : 0,
                data:    data,
                jobLogs: []
            };

            if (data._flowId) {
                jobFields._flowId = data._flowId;
            }
            else {
                jobFields._flowId = 'NoFlow';
                data._flowId = 'NoFlow';
            }

            if (!data.title) {
                jobFields.title = jobName;
                data.title = jobName;
            }

            JobModel.create(jobFields, (err, jobDoc) => {

                if (err) {
                    Logger.error(err);
                    reject(err);
                }
                else {
                    let newJob = queue.create(`job:${jobName}`, data);
                    resolve(newJob);
                }
            });
        });
    }

    let jobAPI = {};
    jobAPI.registerJob = registerJob;
    jobAPI.startJob = startJob;

    return jobAPI;
}