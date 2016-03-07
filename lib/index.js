'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = floughBuilder;

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var kue = require('kue');
var events = require('events');
var Promise = require('bluebird');
var redis = require('redis');

var FloughInstance = undefined;

/**
 * Returns the FloughBuilder object, which just has one function: init(o);
 * @returns {*}
 */

function floughBuilder() {
    if (FloughInstance) {
        return FloughInstance;
    } else {

        return {
            // Initialize a Flough instance using the passed options
            init: function init(o) {

                // Base class that inherits from the event emitter class

                var Flough = function Flough() {
                    _classCallCheck(this, Flough);

                    events.EventEmitter.call(this);
                };

                Flough.prototype.__proto__ = events.EventEmitter.prototype;

                // Setup defaults
                Flough.prototype.o = setupDefaults(o);

                // Setup Kue queue
                return setupKue(Flough.prototype.o)

                // Setup and attach storage and Redis clients to Flough Class
                .then(function (queue) {
                    return [queue, setupStorage(Flough), setupRedis(Flough)];
                }).spread(function (queue, storageClient, redisClient) {

                    // Setup search functionality for Flough Class
                    var searchFunctions = require('./searcher')(queue, redisClient, Flough.prototype.o, Flough.prototype.storageClient);

                    Flough.prototype.searchJobs = searchFunctions.searchJobs;
                    Flough.prototype.searchKue = searchFunctions.searchKue;
                    Flough.prototype.searchFlows = searchFunctions.searchFlows;

                    // Create a Flough Instance
                    FloughInstance = new Flough();

                    // Setup and attach the APIs for Flows and Jobs
                    FloughInstance = require('./jobAPI')(queue, storageClient, FloughInstance);
                    FloughInstance = require('./flowAPI')(queue, storageClient, FloughInstance);

                    // Attach event functionality to Flough Instance and return the modified Flough Instance
                    FloughInstance = attachEvents(queue, FloughInstance);
                    FloughInstance = attachRoutes(FloughInstance, storageClient, kue);

                    // Attach jobLogger to Flough Instance
                    FloughInstance.jobLogger = require('./jobLogger')(storageClient, FloughInstance.o.logger.func);

                    // Expose the kue library directly
                    FloughInstance.kue = kue;

                    FloughInstance.queue = queue;

                    return FloughInstance;
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
    var o = FloughAPI.prototype.o;
    FloughAPI.prototype.o.redis.type = FloughAPI.prototype.o.redis.type ? FloughAPI.prototype.o.redis.type : 'default';
    var redisClient = undefined;

    // If user has passed Redis options
    if (o.redis && o.redis.type === 'supplyOptions') {
        try {
            var socket = o.redis.socket;
            var port = socket ? null : o.redis.port || 6379;
            var host = socket ? null : o.redis.host || '127.0.0.1';
            redisClient = redis.createClient(socket || port, host, o.redis.options);

            if (o.redis.auth) {
                redisClient.auth(o.redis.auth);
            }

            if (o.redis.db) {
                redisClient.select(o.redis.db);
            }
        } catch (err) {
            throw new Error('Supplied redis options or supplied redis client error: ' + err.stack);
        }
    }

    // If user has passed Redis client
    else if (o.redis && o.redis.type === 'supplyClient') {
            redisClient = o.redis.client;
        } else if (o.redis.type === 'default') {
            try {
                var port = 6379;
                var host = '127.0.0.1';
                redisClient = redis.createClient(port, host);
            } catch (err) {
                throw new Error('Supplied redis options or supplied redis client error: ' + err.stack);
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
    var o = FloughAPI.prototype.o;

    switch (o.storage.type) {
        case 'mongoose' || 'mongodb':
            {
                FloughAPI.prototype.storageClient = require('./storage/mongodb')(o);
                return FloughAPI.prototype.storageClient;
            }

        default:
            {
                throw new Error('Invalid storage type (options.storage.type): ' + o.storage.type);
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
                    warn: function warn(toBeLogged) {
                        passedLogger('[WARN] ' + toBeLogged);
                    },
                    info: function info(toBeLogged) {
                        passedLogger('[INFO] ' + toBeLogged);
                    },
                    error: function error(toBeLogged) {
                        passedLogger('[ERROR] ' + toBeLogged);
                    },
                    debug: function debug(toBeLogged) {
                        passedLogger('[DEBUG] ' + toBeLogged);
                    }
                };
            }

            // User passed no logger so just output to the console.
            else {
                    return {
                        warn: function warn(toBeLogged) {
                            console.log('[FLOUGH-WARN] ' + toBeLogged);
                        },
                        info: function info(toBeLogged) {
                            console.log('[FLOUGH-INFO] ' + toBeLogged);
                        },
                        error: function error(toBeLogged) {
                            console.log('[FLOUGH-ERROR] ' + toBeLogged);
                        },
                        debug: function debug(toBeLogged) {
                            console.log('[FLOUGH-DEBUG] ' + toBeLogged);
                        }
                    };
                }
    }

    // Production
    else {

            // User passed a logger that supports: .warn(), .info(), .error(), .debug()
            if (!!passedLogger) {
                return passedLogger;
            } else {
                // TODO Decide what should be logged if Flough is running in production mode.
                return {
                    warn: function warn(toBeLogged) {},
                    info: function info(toBeLogged) {},
                    error: function error(toBeLogged) {
                        console.error('[ERROR] ' + toBeLogged);
                    },
                    debug: function debug(toBeLogged) {}
                };
            }
        }
}

/**
 * Make the Flough Instance listen on Kue queue events and then emit both copies of those events and other custom
 * events.
 * @param {object} queue - Kue queue
 * @param {object} FloughInstance - An instance of the Flough Class
 * @param {boolean} returnJobOnEvents - Should Flough emit additional events (beyond Kue copies) that have full job
 *     attached?
 * @param {object} logger - Flough Internal Logging Function
 * @returns {*}
 */
function attachEvents(queue, FloughInstance) {
    var _arguments = arguments;

    var o = FloughInstance.o;
    var internalLogger = o.logger.func;

    if (o.returnJobOnEvents) {
        // Setup queue logging events
        queue.on('job enqueue', function (id, type) {
            internalLogger.info('[' + type + '][' + id + '] - QUEUED');

            // Take all of Kue's passed arguments and emit them ourselves with the same event string
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job enqueue'].concat(_toConsumableArray(args)));

            // Retrieve the job with the given id and emit custom events with the job attached
            kue.Job.get(id, function (err, job) {
                // Event prefixed by the job's uuid
                FloughInstance.emit(job.data._uuid + ':enqueue', job);

                // Event prefixed by the job's type
                FloughInstance.emit(job.type + ':enqueue', job);

                // Event prefixed by the job's Flow ID
                FloughInstance.emit(job.data._flowId + ':enqueue', job);
            });
        }).on('job complete', function (id, result) {
            //internalLogger.info(`[${id}] - COMPLETE`);
            //internalLogger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);

            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job complete'].concat(_toConsumableArray(args)));
            kue.Job.get(id, function (err, job) {
                FloughInstance.emit(job.data._uuid + ':complete', job);
                FloughInstance.emit(job.type + ':complete', job);
                FloughInstance.emit(job.data._flowId + ':complete', job);
            });
        }).on('job failed', function (id, errorMessage) {
            internalLogger.error('[' + id + '] - FAILED');
            internalLogger.error('[' + id + '] - ' + errorMessage);

            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job failed'].concat(_toConsumableArray(args)));
            kue.Job.get(id, function (err, job) {
                FloughInstance.emit(job.data._uuid + ':failed', job);
                FloughInstance.emit(job.type + ':failed', job);
                FloughInstance.emit(job.data._flowId + ':failed', job);
            });
        }).on('job promotion', function (id) {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job promotion'].concat(_toConsumableArray(args)));
            kue.Job.get(id, function (err, job) {
                FloughInstance.emit(job.data._uuid + ':promotion', job);
                FloughInstance.emit(job.type + ':promotion', job);
                FloughInstance.emit(job.data._flowId + ':promotion', job);
            });
        }).on('job progress', function (id) {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job progress'].concat(_toConsumableArray(args)));
            kue.Job.get(id, function (err, job) {
                FloughInstance.emit(job.data._uuid + ':progress', job);
                FloughInstance.emit(job.type + ':progress', job);
                FloughInstance.emit(job.data._flowId + ':progress', job);
            });
        }).on('job failed attempt', function (id) {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job failed attempt'].concat(_toConsumableArray(args)));

            kue.Job.get(id, function (err, job) {
                FloughInstance.emit(job.data._uuid + ':failed attempt', job);
                FloughInstance.emit(job.type + ':failed attempt', job);
                FloughInstance.emit(job.data._flowId + ':failed attempt', job);
            });
        }).on('job remove', function (id) {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job remove'].concat(_toConsumableArray(args)));
            kue.Job.get(id, function (err, job) {
                if (job) {

                    FloughInstance.emit(job.data._uuid + ':remove', job);
                    FloughInstance.emit(job.type + ':remove', job);
                    FloughInstance.emit(job.data._flowId + ':remove', job);
                }
            });
        });
    } else {
        queue.on('job enqueue', function (id, type) {
            internalLogger.info('[' + type + '][' + id + '] - QUEUED');
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job enqueue'].concat(_toConsumableArray(args)));
        }).on('job complete', function (id, result) {
            //internalLogger.info(`[${id}] - COMPLETE`);
            //internalLogger.debug(`[${id}] - Result: ${JSON.stringify(result, null, 2)}`);
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job complete'].concat(_toConsumableArray(args)));
        }).on('job failed', function (id, errorMessage) {
            internalLogger.error('[' + id + '] - FAILED');
            internalLogger.error('[' + id + '] - ' + errorMessage);
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job failed'].concat(_toConsumableArray(args)));
        }).on('job promotion', function () {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job promotion'].concat(_toConsumableArray(args)));
        }).on('job progress', function () {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job progress'].concat(_toConsumableArray(args)));
        }).on('job failed attempt', function () {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job failed attempt'].concat(_toConsumableArray(args)));
        }).on('job remove', function () {
            var args = Array.slice(_arguments);
            FloughInstance.emit.apply(FloughInstance, ['job remove'].concat(_toConsumableArray(args)));
        });
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
 * @param {string} [kueBaseRoute] - If user passed in express app, set the port that Kue's interface will listen on.
 * @returns {bluebird|exports|module.exports}
 */
function setupKue(_ref) {
    var logger = _ref.logger;
    var searchKue = _ref.searchKue;
    var cleanKueOnStartup = _ref.cleanKueOnStartup;
    var jobEvents = _ref.jobEvents;
    var redis = _ref.redis;
    var expressApp = _ref.expressApp;
    var kueBaseRoute = _ref.kueBaseRoute;

    return new Promise(function (resolve, reject) {
        var Logger = logger.func;

        var kueOptions = {
            disableSearch: !searchKue,
            jobEvents: jobEvents
        };

        // If the user has supplied redis options, use them instead of Kue's defaults.
        if (redis && redis.type === 'supplyOptions') {
            // Remove extra field before passing to kue to avoid any conflict
            delete redis.type;
            kueOptions.redis = redis;
        }

        // Read notice below about how important it is that this gets called here first before anywhere else in the
        // node app.
        var queue = kue.createQueue(kueOptions);

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

        var numInactiveJobs = undefined;
        var numActiveJobs = undefined;
        var numFailedJobs = undefined;

        var numInactiveJobsProcessed = 0;
        var numActiveJobsProcessed = 0;
        var numFailedJobsProcessed = 0;

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

            if (numActiveJobs === numActiveJobsProcessed && numInactiveJobs === numInactiveJobsProcessed && numFailedJobs === numFailedJobsProcessed) {
                resolve(queue);
            }
        }

        // TODO add error handling to all these err(s)
        if (cleanKueOnStartup) {

            // Get all inactive, active, and failed jobs for cleanup
            queue.inactive(function (err, inactiveJobIds) {
                queue.active(function (err, activeJobIds) {
                    queue.failed(function (err, failedJobIds) {
                        cleanupJobs(inactiveJobIds, activeJobIds, failedJobIds);
                    });
                });
            });

            // Kue currently uses client side job state management and when redis crashes in the
            // middle of that operations, some stuck jobs or index inconsistencies will happen.
            // If you are facing poor redis connections or an unstable redis service you can start
            // Kue's watchdog to fix stuck inactive jobs (if any) by calling:
            queue.watchStuckJobs();
        } else {

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
            } else {
                // Cleanup the queued jobs
                inactiveJobIds.forEach(function (id) {
                    kue.Job.get(id, function (err, job) {

                        if (job) {
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
                        } else {
                            Logger.warn('Attempted to cleanup queued job with id ' + id + ' and it was no longer in redis.');
                        }

                        jobsCleaned('inactive');
                    });
                });

                // Cleanup the active jobs
                activeJobIds.forEach(function (id) {
                    kue.Job.get(id, function (err, job) {

                        if (job) {
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
                        } else {
                            Logger.warn('Attempted to cleanup active job with id ' + id + ' and it was no longer in redis.');
                        }

                        jobsCleaned('active');
                    });
                });

                // Restart any process jobs that were failed because the Queue gracefully shutdown
                failedJobIds.forEach(function (id) {
                    kue.Job.get(id, function (err, job) {

                        if (!job) {
                            Logger.warn('Attempted to restart job with id ' + id + ', but job information was no longer in redis.');
                        }
                        /* B. */

                        // If this job represents a flow or it is a solo job, restart it by setting it be
                        // inactive.
                        else if (job._error === 'Shutdown' && (job.type.substr(0, 3) !== 'job' || job.data._flowId === 'NoFlow')) {
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

function attachRoutes(FloughAPIObject, storageClient, kue) {
    var _FloughAPIObject$o = FloughAPIObject.o;
    var expressApp = _FloughAPIObject$o.expressApp;
    var kueBaseRoute = _FloughAPIObject$o.kueBaseRoute;

    expressApp.use(kueBaseRoute + '/api', require('./routes')(FloughAPIObject, storageClient, kue));

    return FloughAPIObject;
}
module.exports = exports['default'];