const kue = require('kue');
const events = require('events');
const Promise = require('bluebird');
Promise.config({
    cancellation: true,
    longStackTraces: true
});
const redis = require('redis');
const express = require('express');

let Flough;

/**
 * Returns the FloughBuilder object, which just has one function: init(o);
 * @returns {*}
 */
export default function floughBuilder() {
    if (Flough) {
        return Flough;
    }
    else {

        return {
            // Initialize a Flough instance using the passed options
            init(o) {

                Flough = {};

                // Setup defaults
                Flough.o = setupDefaults(o);

                // Setup Kue queue
                return setupKue(Flough.o)

                // Setup and attach storage and Redis clients to Flough Class
                    .then((queue) => [ queue, setupStorage(Flough), setupRedis(Flough) ])
                    .spread((queue, storageClient, redisClient) => {

                        // Setup and attach the APIs for Flows and
                        Flough.Flow = require('./flow')(queue, storageClient, redisClient, Flough);

                        // Expose the kue library directly
                        Flough.kue = kue;

                        // Expose Kue queue
                        Flough.queue = queue;

                        return Flough;
                    });

            }
        };
    }

}


/**
 * Sets up the default parameters for the generic option fields.  Storage, Redis, and Searcher specific options are
 * handled in their respective setup functions.
 * @param o
 * @returns {*}
 */
function setupDefaults(o) {
    // Should Kue's queue be setup with search functionality enabled?
    o.searchKue = o.searchKue === true;

    // Is this application being launched for development (AKA not production mode)?
    o.devMode = o.devMode !== false;

    // Should we clean up Kue and auto-restart jobs automatically, or does the user take care of it themselves?
    o.cleanKueOnStartup = o.cleanKueOnStartup !== false;

    // Each time an event fires, should we return the entire job along with the event? (Causes a Redis lookup to occur)
    o.returnJobOnEvents = o.returnJobOnEvents !== false;

    o.kueBaseRoute = o.kueBaseRoute || '/kue';

    // TODO allow job events to be turned off
    //o.jobEvents = o.jobEvents !== false;
    o.jobEvents = true;

    // If user provides logger, but it is simple
    if (o.logger && !o.logger.advanced) {
        o.logger.func = loggerBuilder(o.devMode, o.logger.func);
    }

    // If user provides no logger
    else if (!(o.logger && o.logger.func)) {
        o.logger = { func: loggerBuilder(o.devMode), advanced: false };
    }

    // If user provides advanced logger, use user's logger exactly as is.
    else {
        if (!o.devMode) {
            o.logger.func = loggerBuilder(o.devMode, o.logger.func);
        }
    }

    return o;
}


/**
 * Setup Redis
 * @param FloughAPI
 * @returns {*}
 */
function setupRedis(FloughAPI) {
    let o = FloughAPI.o;
    FloughAPI.o.redis.type = FloughAPI.o.redis.type ? FloughAPI.o.redis.type : 'default';
    let redisClient;

    // If user has passed Redis options
    if (o.redis && o.redis.type === 'supplyOptions') {
        try {
            let socket = o.redis.socket;
            let port = socket ? null : (o.redis.port || 6379);
            let host = socket ? null : (o.redis.host || '127.0.0.1');
            redisClient = redis.createClient(socket || port, host, o.redis.options);

            if (o.redis.auth) {
                redisClient.auth(o.redis.auth);
            }

            if (o.redis.db) {
                redisClient.select(o.redis.db);
            }
        }
        catch (err) {
            throw new Error(`Supplied redis options or supplied redis client error: ${err.stack}`);
        }
    }

    // If user has passed Redis client
    else if (o.redis && o.redis.type === 'supplyClient') {
        redisClient = o.redis.client;
    }
    else if (o.redis.type === 'default') {
        try {
            let port = 6379;
            let host = '127.0.0.1';
            redisClient = redis.createClient(port, host);
        }
        catch (err) {
            throw new Error(`Supplied redis options or supplied redis client error: ${err.stack}`);
        }
    }

    // Attach redis client directly to the Flough Class
    FloughAPI.redisClient = redisClient;

    return redisClient;
}


/**
 * Setup Storage
 * Storage encompasses any persistent storage choice, eventually more than just MongoDB
 * @param FloughAPI
 * @returns {*}
 */
function setupStorage(FloughAPI) {
    let o = FloughAPI.o;

    switch (o.storage.type) {
        case 'mongoose' || 'mongodb':
        {
            FloughAPI.storageClient = require('./storage/mongodb')(o);
            return FloughAPI.storageClient;
        }

        default:
        {
            throw new Error(`Invalid storage type (options.storage.type): ${o.storage.type}`);
        }
    }
}

/**
 * Builds a logger function for use within Flough.
 * This logger will be used mostly for development purposes so that Jobs and Flows can be tracked throughout their
 * lifetime.
 * @param {boolean} devMode - If devMode is off, disable Logger.
 * @param {function} [passedLogger] - A function to be used for logging inside of Flough
 * @param {boolean} [advanced] - A logger is advanced if it supports separate functions for .warn(), .info(), .error(),
 *     and .debug()
 * @returns {{warn, info, error, debug}}
 */
function loggerBuilder(devMode, passedLogger, advanced) {

    // devMode
    if (devMode) {
        if (!!passedLogger && advanced) {
            return passedLogger;
        }

        // User passed a logger, but that logger does not support different logging functions.
        else if (!!passedLogger && !advanced) {

            return {
                warn(toBeLogged) {
                    passedLogger(`[WARN] ${toBeLogged}`);
                },
                info(toBeLogged) {
                    passedLogger(`[INFO] ${toBeLogged}`);
                },
                error(toBeLogged) {
                    passedLogger(`[ERROR] ${toBeLogged}`);
                },
                debug(toBeLogged) {
                    passedLogger(`[DEBUG] ${toBeLogged}`);
                }
            };
        }

        // User passed no logger so just output to the console.
        else {
            return {
                warn(toBeLogged) {
                    console.log(`[FLOUGH-WARN] ${toBeLogged}`);
                },
                info(toBeLogged) {
                    console.log(`[FLOUGH-INFO] ${toBeLogged}`);
                },
                error(toBeLogged) {
                    console.log(`[FLOUGH-ERROR] ${toBeLogged}`);
                },
                debug(toBeLogged) {
                    console.log(`[FLOUGH-DEBUG] ${toBeLogged}`);
                }
            };
        }
    }

    // Production
    else {

        // User passed a logger that supports: .warn(), .info(), .error(), .debug()
        if (!!passedLogger) {
            return passedLogger;
        }
        else {
            // TODO Decide what should be logged if Flough is running in production mode.
            return {
                warn(toBeLogged) {
                },
                info(toBeLogged) {
                },
                error(toBeLogged) {
                    console.error(`[ERROR] ${toBeLogged}`);
                },
                debug(toBeLogged) {
                }
            };
        }
    }

}

/**
 * Setup the Kue queue.
 * @param {object} logger - internal logging function
 * @param {boolean} searchKue - Should the Kue queue be searchable? (Adds overhead to Kue queue)
 * @param {boolean} cleanKueOnStartup - Should the Kue queue be cleaned on server restart?
 * @param {boolean} jobEvents - Should the Kue queue create jobs that emit events, or only rely on the queue's events?
 * @param {object} [redis] - If the user supplied Redis options, use them for setting up Kue queue
 * @param {object} [expressApp] - If user passed in an express app, then use it to enable Kue's interface
 * @param {string} [kueBaseRoute] - If user passed in express app, set the port that Kue's interface will listen on.
 * @returns {bluebird|exports|module.exports}
 */
function setupKue({ logger, searchKue, cleanKueOnStartup, jobEvents, redis, expressApp, kueBaseRoute }) {

    return new Promise((resolve, reject) => {
        let Logger = logger.func;

        let kueOptions = {
            disableSearch: !searchKue,
            jobEvents:     jobEvents
        };

        // If the user has supplied redis options, use them instead of Kue's defaults.
        if (redis && redis.type === 'supplyOptions') {
            // Remove extra field before passing to kue to avoid any conflict
            delete redis.type;
            kueOptions.redis = redis;
        }

        // Read notice below about how important it is that this gets called here first before anywhere else in the
        // node app.
        let queue = kue.createQueue(kueOptions);

        /**
         * ****IMPORTANT NOTICE****
         * For the Express route that searches Kue to be turned on it is important that kue.createQueue({disableSearch:
         * false}) be called FIRST before calling expressApp.use(kue.app).  That is why if a Flough user wishes to use
         * this functionality they should pass in both the express app and the kue app into the Flough.init() call so
         * that Flough can explicitly make sure that this function call order is correct.
         *
         * Also important to note is that ANY non-default Kue options for kue.createQueue() (not just the search
         * option) must be included in the first kue.createQueue() call before the expressApp.use(kue.app) call for any
         * of it to take effect.
         */
        if (expressApp) {
            // Allow you to set port of Kue interface
            expressApp.use(kueBaseRoute, kue.app);
        }

        let numInactiveJobs;
        let numActiveJobs;
        let numFailedJobs;

        let numInactiveJobsProcessed = 0;
        let numActiveJobsProcessed = 0;
        let numFailedJobsProcessed = 0;

        /**
         * Track the number of jobs cleaned of each type and resolve when all types of jobs have been cleaned
         * @param {string} type - Type of job
         */
        function jobsCleaned(type) {

            switch (type) {
                case 'inactive':
                {
                    numInactiveJobsProcessed += 1;
                    break;
                }

                case 'active':
                {
                    numActiveJobsProcessed += 1;
                    break;
                }

                case 'failed':
                {
                    numFailedJobsProcessed += 1;
                    break;
                }

                default:
                {
                    resolve(queue);
                    break;
                }
            }

            if (numActiveJobs === numActiveJobsProcessed &&
                numInactiveJobs === numInactiveJobsProcessed &&
                numFailedJobs === numFailedJobsProcessed
            ) {
                resolve(queue);
            }

        }

        // TODO add error handling to all these err(s)
        if (cleanKueOnStartup) {

            // Get all inactive, active, and failed jobs for cleanup
            queue.inactive((err, inactiveJobIds) => {
                queue.active((err, activeJobIds) => {
                    queue.failed((err, failedJobIds) => {
                        cleanupJobs(inactiveJobIds, activeJobIds, failedJobIds)
                    });
                });

            });

            // Kue currently uses client side job state management and when redis crashes in the
            // middle of that operations, some stuck jobs or index inconsistencies will happen.
            // If you are facing poor redis connections or an unstable redis service you can start
            // Kue's watchdog to fix stuck inactive jobs (if any) by calling:
            queue.watchStuckJobs();
        }
        else {


            // Kue currently uses client side job state management and when redis crashes in the
            // middle of that operations, some stuck jobs or index inconsistencies will happen.
            // If you are facing poor redis connections or an unstable redis service you can start
            // Kue's watchdog to fix stuck inactive jobs (if any) by calling:
            queue.watchStuckJobs();
            resolve(queue);
        }

        /**
         * This handles bootstrapping the Queue when the server is restarted by
         * A. Removing helper jobs (inside Flows), they will be restarted by the Flow they belong to.
         * B. Setting leftover solo jobs (NOT inside Flows) and Flow jobs (jobs that track a Flow) as inactive,
         * which will cause Kue to restart them
         * @param {number[]} inactiveJobIds
         * @param {number[]} activeJobIds
         * @param {number[]} failedJobIds
         */
        function cleanupJobs(inactiveJobIds, activeJobIds, failedJobIds) {
            numInactiveJobs = inactiveJobIds.length;
            numActiveJobs = activeJobIds.length;
            numFailedJobs = failedJobIds.length;

            if (numActiveJobs === 0 && numInactiveJobs === 0 && numFailedJobs === 0) {
                jobsCleaned();
            }
            else {
                // Cleanup the queued jobs
                inactiveJobIds.forEach((id) => {
                    kue.Job.get(id, (err, job) => {

                        if (job) {
                            /* A. */

                            // If this job represents a child flow, remove it
                            if (job.data._isChild) {
                                job.remove();
                            }
                        }
                        else {
                            Logger.warn(`Attempted to cleanup queued job with id ${id} and it was no longer in redis.`);
                        }

                        jobsCleaned('inactive');
                    });
                });

                // Cleanup the active jobs
                activeJobIds.forEach((id) => {
                    kue.Job.get(id, (err, job) => {

                        if (job) {
                            /* A. */

                            // Or if a job was specifically marked as a child job also remove it.
                            if (job.data._isChild) {
                                job.remove();
                            }
                            /* B. */

                            // If this job represents a process, restart it.
                            else {
                                job.inactive();
                            }
                        }
                        else {
                            Logger.warn(`Attempted to cleanup active job with id ${id} and it was no longer in redis.`);
                        }

                        jobsCleaned('active');
                    });
                });

                // Restart any process jobs that were failed because the Queue gracefully shutdown
                failedJobIds.forEach((id) => {
                    kue.Job.get(id, (err, job) => {

                        if (!job) {
                            Logger.warn(`Attempted to restart job with id ${id}, but job information was no longer in redis.`);
                        }
                        /* B. */

                        // If this job represents a flow or it is a solo job, restart it by setting it be
                        // inactive.
                        else if (job._error === 'Shutdown' && !job.data._isChild) {
                            //Logger.info(`Restarting job: ${job.id}`);
                            job.inactive();
                        }

                        jobsCleaned('failed');
                    });
                });
            }
        }

        /*
         TODO
         The below code allows you to restore the queue from Mongo, would only be needed if Redis db was completely wiped
         away while there were still active jobs that were running.  Not sure where to place this code.
         */

        //let FlowModel = mongoCon.model('Flow');
        //
        //FlowModel
        //    .find({ isCompleted: false }, { lean: true })
        //    .sort({ date: -1 })
        //    .exec((FlowDocs) => {
        //
        //        FlowDocs.forEach((doc) => {
        //            // TODO do error handling on the .save((err)=>{}) method
        //            let jobParams = doc.jobData;
        //            jobParams.stepsTaken = doc.stepsTaken;
        //            queue.create(doc.type, jobParams).save();
        //        });
        //    })
        //;

    });
}
