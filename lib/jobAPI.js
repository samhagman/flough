let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let ObjectId = require('mongoose').Types.ObjectId;
let recursiveStringify = requireServer('lib/util').recursiveStringify;


export default function jobAPIBuilder(queue, mongoCon, options) {

    let logger = options.logger.func;
    let JobModel = mongoCon.model('job');
    let jobLogger = require('./jobLogger')(mongoCon, logger);

    function registerJob(jobName, jobFunc) {

        /**
         * Wraps the user-given job in a promise, then runs the job.
         * @param job
         * @returns {bluebird|exports|module.exports}
         */
        const jobWrapper = function(job) {
            logger.info(`Starting: ${jobName}`);
            logger.debug(job.type);
            logger.debug(job.data);

            return new Promise((resolve, reject) => {

                job.data.stepsTaken = job.data.stepsTaken ? job.data.stepsTaken : 0;
                job.data.substepsTaken = job.data.substepsTaken ? job.data.substepsTaken : 0;
                job.jobLogger = jobLogger;

                jobFunc(job, resolve, reject);

            });

        };

        const storeJobId = function(job) {
            return new Promise((resolve, reject) => {
                JobModel.findById(job.data.uuid, (err, jobDoc) => {
                    if (err) {
                        logger.error(err);
                        reject(err);
                    }
                    else if (jobDoc) {
                        jobDoc.jobId = job.id;
                        if (jobDoc.jobLogs.length !== 0) {
                            jobLogger('Job restarted.', job.data.uuid);
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
                logger.error('GOT HERE');

                storeJobId(job)
                    .then(jobWrapper)
                    .then((result) => done(null, result))
                    .catch(err => {
                        logger.error(err.stack);
                        // TODO setup softShutdown(blah, blah, done, err)
                        done(err);
                    })
                ;
            }
        });

    }

    function startJob(jobName, data) {

        return new Promise((resolve, reject) => {

            let jobUUID = new ObjectId(Date.now());
            data.uuid = jobUUID;

            let jobFields = {
                _id:     jobUUID,
                jobId:   -1,
                type:    jobName,
                step:    data.step ? data.step : 0,
                substep: data.substep ? data.substep : 0,
                data:    data,
                jobLogs: []
            };

            if (data.flowId) {
                jobFields.flowId = data.flowId;
            }
            else {
                jobFields.flowId = 'NoFlow';
                data.flowId = 'NoFlow';
            }

            if (!data.title) {
                jobFields.title = jobName;
                data.title = jobName;
            }

            JobModel.create(jobFields, (err, jobDoc) => {

                if (err) {
                    logger.error(err);
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