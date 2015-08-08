const kue = require('kue');
const events = require('events');
const Promise = require('bluebird');

export default function floughBuilder(redisClient, mongoCon, expressApp = null) {


    let Flow = {
        init(o) {


            class FloughAPI {

                constructor() {
                    events.EventEmitter.call(this);
                }
            }

            FloughAPI.prototype.__proto__ = events.EventEmitter.prototype;
            FloughAPI.prototype.o = setupDefaults(o);

            return setupKue(FloughAPI.prototype.o, expressApp)
                .then((queue) => {

                    // TODO extract out redisCon and mongoCon into options argument
                    let flowAPIs = require('./lib/flowAPI')(queue, mongoCon, FloughAPI.prototype.o);
                    let jobAPIs = require('./lib/jobAPI')(queue, mongoCon, FloughAPI.prototype.o);

                    for (let api of Object.keys(flowAPIs)) {
                        FloughAPI.prototype[ api ] = flowAPIs[ api ];
                    }

                    for (let api of Object.keys(jobAPIs)) {
                        FloughAPI.prototype[ api ] = jobAPIs[ api ];
                    }

                    FloughAPI.prototype.searchKue = require('./lib/searcher')(queue, redisClient, FloughAPI.prototype.o);

                    let FloughInstance = new FloughAPI();

                    return (attachEvents(queue, FloughInstance, FloughAPI.prototype.o));
                });

        }
    };

    return Flow;

}


function setupDefaults(o) {
    o.queueName = o.queueName || 'Flough';
    o.searchKue = o.searchKue !== false;
    o.devMode = o.devMode !== false;
    o.cleanKueOnStartup = o.cleanKueOnStartup !== false;
    o.returnJobOnEvents = o.returnJobOnEvents !== false;
    o.jobEvents = o.jobEvents !== false;

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
 *
 * @param devMode
 * @param [passedLogger]
 * @param [advanced]
 * @returns {{warn, info, error, debug}}
 */
function loggerBuilder(devMode, passedLogger, advanced) {

    if (!devMode) {
        return {
            warn(toBeLogged) {
            },
            info(toBeLogged) {
            },
            error(toBeLogged) {
            },
            debug(toBeLogged) {
            }
        };
    }
    else if (!!passedLogger && advanced) {
        return passedLogger;
    }
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
    else {
        return {
            warn(toBeLogged) {
                console.log(`[WARN] ${toBeLogged}`);
            },
            info(toBeLogged) {
                console.log(`[INFO] ${toBeLogged}`);
            },
            error(toBeLogged) {
                console.log(`[ERROR] ${toBeLogged}`);
            },
            debug(toBeLogged) {
                console.log(`[DEBUG] ${toBeLogged}`);
            }
        };
    }

}

function attachEvents(queue, FloughInstance, {returnJobOnEvents, logger}) {

    let internalLogger = logger.func;

    if (returnJobOnEvents) {
        // Setup queue logging events
        queue
            .on('job enqueue', (id, type) => {
                internalLogger.info(`[FLOUGH][${id}][${type}] - QUEUED`);

                const args = Array.slice(arguments);
                FloughInstance.emit('job enqueue', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:enqueue`, job);
                    FloughInstance.emit(`${job.type}:enqueue`, job);
                    FloughInstance.emit(`${job.data.flowId}:enqueue`, job);
                });
            })
            .on('job complete', (id, result) => {
                internalLogger.info(`[FLOUGH][${id}] - COMPLETE`);
                internalLogger.debug(`[FLOUGH][${id}] - Result: ${JSON.stringify(result, null, 2)}`);

                const args = Array.slice(arguments);
                FloughInstance.emit('job complete', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:complete`, job);
                    FloughInstance.emit(`${job.type}:complete`, job);
                    FloughInstance.emit(`${job.data.flowId}:complete`, job);
                });
            })
            .on('job failed', (id, errorMessage) => {
                internalLogger.error(`[FLOUGH][${id}] - FAILED`);
                internalLogger.error(`[FLOUGH][${id}] - ${errorMessage}`);

                const args = Array.slice(arguments);
                FloughInstance.emit('job failed', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:failed`, job);
                    FloughInstance.emit(`${job.type}:failed`, job);
                    FloughInstance.emit(`${job.data.flowId}:failed`, job);
                });
            })
            .on('job promotion', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job promotion', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:promotion`, job);
                    FloughInstance.emit(`${job.type}:promotion`, job);
                    FloughInstance.emit(`${job.data.flowId}:promotion`, job);
                });
            })
            .on('job progress', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job progress', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:progress`, job);
                    FloughInstance.emit(`${job.type}:progress`, job);
                    FloughInstance.emit(`${job.data.flowId}:progress`, job);
                });
            })
            .on('job failed attempt', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job failed attempt', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:failed attempt`, job);
                    FloughInstance.emit(`${job.type}:failed attempt`, job);
                    FloughInstance.emit(`${job.data.flowId}:failed attempt`, job);
                });
            })
            .on('job remove', () => {
                const args = Array.slice(arguments);
                FloughInstance.emit('job remove', ...args);
                kue.Job.get(id, (err, job) => {
                    FloughInstance.emit(`${job.data.uuid}:remove`, job);
                    FloughInstance.emit(`${job.type}:remove`, job);
                    FloughInstance.emit(`${job.data.flowId}:remove`, job);
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
 *
 * @param FloughInstance
 * @param queueName
 * @param logger
 * @param searchKue
 * @param devMode
 * @param cleanKueOnStartup
 * @param [expressApp]
 */
function setupKue({queueName, logger, searchKue, devMode, cleanKueOnStartup, returnJobOnEvents, jobEvents}, expressApp) {

    return new Promise((resolve, reject) => {
        let internalLogger = logger.func;

        // Read notice below about how important it is that this gets called here first before anywhere else in the node app.
        let queue = kue.createQueue({
            disableSearch: !searchKue,
            jobEvents:     jobEvents
        });

        /**
         * ****IMPORTANT NOTICE****
         * For the Express route that searches Kue to be turned on it is important that kue.createQueue({disableSearch: false})
         * be called FIRST before calling expressApp.use(kue.app).  That is why if a Flough user wishes to use this functionality
         * they should pass in both the express app and the kue app into the initial require('flough') call so that Flough can
         * explicitly make sure that this function call order is correct.
         *
         * Also important to note is that ANY non-default Kue options for kue.createQueue() (not just the search option) must
         * be included in the first kue.createQueue() call before the expressApp.use(kue.app) call for any of it to take effect.
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
             * This handles bootstrapping the Queue when the server is restarted
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

                                    // TODO remove this stuff
                                    //internalLogger.error(`INACTIVE*&*&*&*&*&*&`);
                                    //internalLogger.error(job.data);
                                    // If this job is a helper job and is still queued and it was part of a flow, remove it.
                                    if (job.type.substr(0, 3) === 'job' && job.state() === 'inactive' && job.data.flowId !== 'NoFlow') {
                                        job.remove();
                                    }
                                    jobsCleaned('inactive');
                                });
                            });

                            // Cleanup the active jobs
                            activeJobIds.forEach((id) => {
                                kue.Job.get(id, (err, job) => {
                                    // TODO remove this stuff
                                    //internalLogger.error(`ACTIVE*&*&*&*&*&*&`);
                                    //internalLogger.error(job.data);
                                    // If this job is a helper job of a flow, remove it.
                                    if (job.type.substr(0, 3) === 'job' && job.data.flowId !== 'NoFlow') {
                                        job.remove();
                                    }
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
                                    // TODO remove this stuff
                                    //internalLogger.error(`FAILED*&*&*&*&*&*&`);
                                    //internalLogger.error(job.data);
                                    if (!job) {
                                        internalLogger.warn(`Attempted to restart job with id ${id}, but job information was no longer in redis.`);
                                    }
                                    // If this job represents a flow or it is a solo job, restart it by setting it be inactive.
                                    else if (job._error === 'Shutdown' && (job.type.substr(0, 3) !== 'job' || job.data.flowId === 'NoFlow')) {
                                        internalLogger.info(`Restarting job: ${job.id}`);
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
