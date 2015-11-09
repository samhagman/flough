const kue = require('kue');
const events = require('events');
const Promise = require('bluebird');
const redis = require('redis');

let FloughAPIObject;

/**
 * Returns the FloughBuilder object, which just has one function: init(o);
 * @returns {*}
 */
export default function floughBuilder() {
    if (FloughAPIObject) {
        return FloughAPIObject;
    }
    else {

        return {
            // Initialize a Flough instance using the passed options
            init(o) {

                // Base class that inherits from the event emitter class
                class FloughAPI {

                    constructor() {
                        events.EventEmitter.call(this);
                    }
                }
                FloughAPI.prototype.__proto__ = events.EventEmitter.prototype;

                // Setup defaults
                FloughAPI.prototype.o = setupDefaults(o);

                // Setup Kue queue
                return setupKue(FloughAPI.prototype.o)
                    .then((queue) => {
                        // Setup and attach storage and Redis clients to Flough Class
                        return [ queue, setupStorage(FloughAPI), setupRedis(FloughAPI) ];
                    }).spread((queue, storageClient, redisClient) => {

                        // Setup search functionality for Flough Class
                        let searchFunctions = require('./searcher')(queue, redisClient, FloughAPI.prototype.o, FloughAPI.prototype.storageClient);
                        FloughAPI.prototype.searchJobs = searchFunctions.searchJobs;
                        FloughAPI.prototype.searchKue = searchFunctions.searchKue;
                        FloughAPI.prototype.searchFlows = searchFunctions.searchFlows;

                        // Create a Flough Instance
                        let FloughInstance = new FloughAPI();

                        // Setup and attach the APIs for Flows and Jobs
                        FloughInstance = require('./jobAPI')(queue, storageClient, FloughInstance);
                        FloughInstance = require('./flowAPI')(queue, storageClient, FloughInstance);

                        // Attach event functionality to Flough Instance and return the modified Flough Instance
                        FloughAPIObject = attachEvents(queue, FloughInstance);

                        return FloughAPIObject;
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
    let o = FloughAPI.prototype.o;
    FloughAPI.prototype.o.redis.type = FloughAPI.prototype.o.redis.type ? FloughAPI.prototype.o.redis.type : 'default';
    let redisClient;

    // If user has passed Redis options
    if (o.redis && o.redis.type === 'supplyOptions') {
        try {
            let socket = o.redis.socket;
            let port = !socket ? (o.redis.port || 6379) : null;
            let host = !socket ? (o.redis.host || '127.0.0.1') : null;
            redisClient = redis.createClient(socket || port, host, o.redis.options);
            if (o.redis.auth) {
                redisClient.auth(o.redis.auth);
            }
            if (o.redis.db) {
                redisClient.select(o.redis.db);
            }
        }
        catch (e) {
            throw new Error(`Supplied redis options or supplied redis client.`);
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
        catch (e) {
            throw new Error(`Supplied redis options or supplied redis client.`);
        }
    }

    // Attach redis client directly to the Flough Class
    FloughAPI.prototype.redisClient = redisClient;

    return redisClient;
}


/**
 * Setup Storage
 * Storage encompasses any persistent storage choice, eventually more than just MongoDB
 * @param FloughAPI
 * @returns {*}
 */
function setupStorage(FloughAPI) {
    let o = FloughAPI.prototype.o;
    switch (o.storage.type) {
        case 'mongoose' || 'mongodb':
        {
            FloughAPI.prototype.storageClient = require('./storage/mongodb')(o);
            return FloughAPI.prototype.storageClient;
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

    // Production
    if (!devMode) {
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
    // User passed a logger that supports: .warn(), .info(), .error(), .debug()
    else if (!!passedLogger && advanced) {
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

/**
 * Make the Flough Instance listen on Kue queue events and then emit both copies of those events and other custom
 * events.
 * @param {object} queue - Kue queue
 * @param {object} FloughInstance - An instance of the FloughAPI Class
 * @param {boolean} returnJobOnEvents - Should Flough emit additional events (beyond Kue copies) that have full job
 *     attached?
 * @param {object} logger - Flough Internal Logging Function
 * @returns {*}
 */
function attachEvents(queue, FloughInstance) {

    let o = FloughInstance.o;
    let internalLogger = o.logger.func;

    if (o.returnJobOnEvents) {
        // Setup queue logging events
        queue
            .on('job enqueue', (id, type) => {
                internalLogger.info(`[FLOUGH][${id}][${type}] - QUEUED`);

                // Take all of Kue's passed arguments and emit them ourselves with the same event string
                const args = Array.slice(arguments);
                FloughInstance.emit('job enqueue', ...args);

                // Retrieve the job with the given id and emit custom events with the job attached
                kue.Job.get(id, (err, job) => {
                    // Event prefixed by the job's uuid
                    FloughInstance.emit(`${job.data._uuid}:enqueue`, job);

                    // Event prefixed by the job's type
                    FloughInstance.emit(`${job.type}:enqueue`, job);

                    // Event prefixed by the job's Flow ID
                    FloughInstance.emit(`${job.data._flowId}:enqueue`, job);
                });
            })
            .on('job complete', (id, result) => {
                internalLogger.info(`[FLOUGH][${id}] - COMPLETE`);
                internalLogger.debug(`[FLOUGH][${id}] - Result: ${JSON.stringify(result, null, 2)}`);

                const args = Array.slice(arguments);
                FloughInstance.emit('job complete', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data._uuid}:complete`, job);
                    FloughInstance.emit(`${job.type}:complete`, job);
                    FloughInstance.emit(`${job.data._flowId}:complete`, job);
                });
            })
            .on('job failed', (id, errorMessage) => {
                internalLogger.error(`[FLOUGH][${id}] - FAILED`);
                internalLogger.error(`[FLOUGH][${id}] - ${errorMessage}`);

                const args = Array.slice(arguments);
                FloughInstance.emit('job failed', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data._uuid}:failed`, job);
                    FloughInstance.emit(`${job.type}:failed`, job);
                    FloughInstance.emit(`${job.data._flowId}:failed`, job);
                });
            })
            .on('job promotion', (id) => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job promotion', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data._uuid}:promotion`, job);
                    FloughInstance.emit(`${job.type}:promotion`, job);
                    FloughInstance.emit(`${job.data._flowId}:promotion`, job);
                });
            })
            .on('job progress', (id) => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job progress', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data._uuid}:progress`, job);
                    FloughInstance.emit(`${job.type}:progress`, job);
                    FloughInstance.emit(`${job.data._flowId}:progress`, job);
                });
            })
            .on('job failed attempt', (id) => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job failed attempt', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data._uuid}:failed attempt`, job);
                    FloughInstance.emit(`${job.type}:failed attempt`, job);
                    FloughInstance.emit(`${job.data._flowId}:failed attempt`, job);
                });
            })
            .on('job remove', (id) => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job remove', ...args);
                kue.Job.get(id, (err, job) => {
                    if (job) {

                        FloughInstance.emit(`${job.data._uuid}:remove`, job);
                        FloughInstance.emit(`${job.type}:remove`, job);
                        FloughInstance.emit(`${job.data._flowId}:remove`, job);
                    }
                });
            })
        ;
    }
    else {
        queue
            .on('job enqueue', (id, type) => {
                internalLogger.info(`[FLOUGH][${id}][${type}] - QUEUED`);
                const args = Array.slice(arguments);
                FloughInstance.emit('job enqueue', ...args);
            })
            .on('job complete', (id, result) => {
                internalLogger.info(`[FLOUGH][${id}] - COMPLETE`);
                internalLogger.debug(`[FLOUGH][${id}] - Result: ${JSON.stringify(result, null, 2)}`);
                const args = Array.slice(arguments);
                FloughInstance.emit('job complete', ...args);
            })
            .on('job failed', (id, errorMessage) => {
                internalLogger.error(`[FLOUGH][${id}] - FAILED`);
                internalLogger.error(`[FLOUGH][${id}] - ${errorMessage}`);
                const args = Array.slice(arguments);
                FloughInstance.emit('job failed', ...args);
            })
            .on('job promotion', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job promotion', ...args);
            })
            .on('job progress', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job progress', ...args);
            })
            .on('job failed attempt', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job failed attempt', ...args);
            })
            .on('job remove', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job remove', ...args);
            })
        ;
    }

    return FloughInstance;
}

/**
 * Setup the Kue queue.
 * @param {object} logger - internal logging function
 * @param {boolean} searchKue - Should the Kue queue be searchable? (Adds overhead to Kue queue)
 * @param {boolean} cleanKueOnStartup - Should the Kue queue be cleaned on server restart?
 * @param {boolean} jobEvents - Should the Kue queue create jobs that emit events, or only rely on the queue's events?
 * @param {object} [redis] - If the user supplied Redis options, use them for setting up Kue queue
 * @param {object} [expressApp] - If user passed in an express app, then use it to enable Kue's interface
 * @returns {bluebird|exports|module.exports}
 */
function setupKue({ logger, searchKue, cleanKueOnStartup, jobEvents, redis, expressApp}) {

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
            expressApp.use(kue.app);
        }

        let numInactiveJobs;
        let numActiveJobs;
        let numFailedJobs;

        let numInactiveJobsProcessed = 0;
        let numActiveJobsProcessed = 0;
        let numFailedJobsProcessed = 0;

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
            /**
             * This handles bootstrapping the Queue when the server is restarted by
             * A. Removing helper jobs (inside Flows), they will be restarted by the Flow they belong to.
             * B. Setting leftover solo jobs (NOT inside Flows) and Flow jobs (jobs that track a Flow) as inactive,
             * which will cause Kue to restart them
             */
            queue.inactive((err, inactiveJobIds) => {
                queue.active((err, activeJobIds) => {
                    queue.failed((err, failedJobIds) => {
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

                                    /* A. */
                                    // If this job is a helper job and is still queued and it was part of a flow,
                                    // remove it.
                                    if (job.type.substr(0, 3) === 'job' && job.data._flowId !== 'NoFlow') {
                                        job.remove();
                                    }
                                    /* A. */
                                    // Or if a job was specifically marked as a helper job also remove it.
                                    else if (job.data._helper) {
                                        job.remove();
                                    }
                                    jobsCleaned('inactive');
                                });
                            });

                            // Cleanup the active jobs
                            activeJobIds.forEach((id) => {
                                kue.Job.get(id, (err, job) => {

                                    /* A. */
                                    // If this job is a helper job of a flow, remove it.
                                    if (job.type.substr(0, 3) === 'job' && job.data._flowId !== 'NoFlow') {
                                        job.remove();
                                    }
                                    /* A. */
                                    // Or if a job was specifically marked as a helper job also remove it.
                                    else if (job.data._helper) {
                                        job.remove();
                                    }
                                    /* B. */
                                    // If this job represents a process, restart it.
                                    else {
                                        job.inactive();
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
                                    else if (job._error === 'Shutdown' && (job.type.substr(0, 3) !== 'job' || job.data._flowId === 'NoFlow')) {
                                        Logger.info(`Restarting job: ${job.id}`);
                                        job.inactive();
                                    }
                                    jobsCleaned('failed');
                                });
                            });
                        }
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


        /*
         TODO
         The below code allows you to restore the queue from Mongo, would only be needed if Redis db was completely wiped
         away while there were still active jobs that were running.  Not sure where to place this code.
         */
        //let FlowModel = mongoCon.model('Flow');
        //
        //FlowModel
        //    .find({ completed: false }, { lean: true })
        //    .sort({ date: -1 })
        //    .exec((FlowDocs) => {
        //
        //        FlowDocs.forEach((doc) => {
        //            // TODO do error handling on the .save((err)=>{}) method
        //            let jobParams = doc.jobData;
        //            jobParams.stepsTaken = doc.stepsTaken;
        //            queue.create(doc.jobType, jobParams).save();
        //        });
        //    })
        //;

    });

}
