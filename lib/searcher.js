const reds = require('reds');
const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');

let search;
/**
 * Function that creates a single instance of a reds searcher
 * @param redisClient
 * @returns {*}
 */
function getSearch(redisClient) {
    if (search) {
        return search;
    }

    reds.client = redisClient;

    // This is the key that Kue uses internally to store search indexes.
    search = reds.createSearch('q:search');
    return search;
}

/**
 * Returns a search function for the Kue queue.
 * @param {object} queue - Kue queue
 * @param {object} redisClient
 * @param {object} logger - Internal Flough logger
 * @returns {searchKue}
 */
function setupKueSearcher(queue, redisClient, { logger }, storageClient) {

    const Logger = logger.func;

    /**
     * Takes space separated query string and performs full text search on the Kue queue with them.
     * @param {string} query
     * @param {boolean} [union] - If true, call .type('or') on search query, this changes default of "and" for
     * multiple items.
     * @returns {bluebird|exports|module.exports}
     */
    function searchKue(query, union = false) {

        if (query === '') {

            return new Promise((resolve, reject) => {

                kue.Job.range(0, -1, '', (err, jobs) => {

                    if (err) {
                        Logger.error('Error searching for and returning all Kue jobs.');
                        Logger.error(err.stack);
                        reject(err);
                    } else {
                        resolve(jobs);
                    }
                });
            });
        } else {

            // TODO modify query to only return active jobs in the queue
            return new Promise((resolve, reject) => {
                let searcher = getSearch(redisClient).query(query);

                if (union) {
                    searcher.type('union');
                }

                searcher.end(function (err, ids) {
                    if (err) {
                        Logger.error(err.stack);
                        reject(err);
                    } else {

                        let promArray = [];

                        // Create array of promises that return the Jobs with the found ids
                        ids.forEach(jobId => {
                            promArray.push(new Promise((resolve, reject) => {
                                kue.Job.get(jobId, (err, job) => {
                                    if (err) {
                                        Logger.error(`[ERROR SEARCHING KUE] ${ job }`);
                                        reject(err);
                                    }

                                    resolve(job);
                                });
                            }));
                        });

                        // When all jobs are retrieved, resolve with all the jobs.
                        Promise.all(promArray).then(jobs => {
                            resolve(jobs);
                        }).catch(err => reject(err));
                    }
                });
            });
        }
    }

    return searchKue;
}

function setupJobSearcher(queue, redisClient, { logger }, storageClient) {

    const Logger = logger.func;
    const jobModel = storageClient.model('job');

    /**
     * Search for jobs using MongoDB as the source of truth.
     * Results must match ALL specified parameters: jobIds, jobUUIDs, jobTypes
     * @param {Array} [jobIds] - Array of Kue job ids to match
     * @param {Array} [jobUUIDs] - Array of Flough job UUIDs to match
     * @param {Array} [jobTypes] - Array of job types to match
     * @param {string} [completed] - Whether or not to only return completed jobs
     * @param {boolean} [_activeJobs] - Whether or not to return only active jobs
     * @returns {bluebird|exports|module.exports}
     */
    function searchJobs({ jobIds, jobUUIDs, jobTypes, completed, _activeJobs = true }) {

        return new Promise((resolve, reject) => {

            if (jobUUIDs && !_.isArray(jobUUIDs)) {
                reject('jobUUIDs must be an array');
            }

            if (jobIds && !_.isArray(jobIds)) {
                reject('jobIds must be an array');
            }

            if (jobTypes && !_.isArray(jobTypes)) {
                reject('jobTypes must be an array');
            }

            // MongoDB Search Object
            let searchOptions = {};

            if (completed !== undefined) {
                searchOptions.completed = completed;
            }

            if (jobUUIDs && jobUUIDs.length !== 0) {
                searchOptions['data._uuid'] = { $in: jobUUIDs };
            }

            if (jobIds && jobIds.length !== 0) {
                searchOptions.jobId = { $in: jobIds };
            }

            if (jobTypes && jobTypes.length !== 0) {
                searchOptions.type = { $in: jobTypes };
            }

            jobModel.find(searchOptions, (err, jobs) => {
                if (err) {
                    Logger.error(err.stack);
                    reject(err);
                } else {
                    // If they only want to return active jobs (those found in Kue) then filter out inactive jobs
                    if (_activeJobs) {
                        // Build promise array whose items resolve whether or not the job at the corresponding index in
                        // the jobs returned from MongoDB array (jobs) is found inside Kue or not.
                        const promArray = jobs.map((job, index) => new Promise((resolve, reject) => {
                            kue.Job.get(job.jobId, function (err, job) {
                                if (err) {
                                    // Not found in Kue, return false
                                    resolve(false);
                                } else {
                                    // Found in Kue, return true if the UUIDs are the same (Job ids are recycled in Kue)
                                    resolve(job.data._uuid === jobs[index].data._uuid);
                                }
                            });
                        }));

                        // After we've checked active state of all jobs returned from MongoDB, filter out jobs that were
                        // not found in Kue and resolve the resulting array
                        Promise.all(promArray).then(isActiveJobArray => {
                            resolve(jobs.filter((job, index) => isActiveJobArray[index]));
                        });
                    } else {
                        resolve(jobs);
                    }
                }
            });
        });
    }

    return searchJobs;
}

function setupFlowSearcher(queue, redisClient, { logger }, storageClient) {

    const Logger = logger.func;
    const flowModel = storageClient.model('flow');

    function searchFlows(flowUUID) {
        return new Promise((resolve, reject) => {

            flowModel.findById(flowUUID, (err, flow) => {
                if (err) {
                    Logger.error(err.stack);
                    reject(err);
                } else {
                    resolve(flow);
                }
            });
        });
    }

    return searchFlows;
}

export default function setupSearchers(queue, redisClient, options, storageClient) {

    return {
        searchKue: setupKueSearcher(queue, redisClient, options, storageClient),
        searchJobs: setupJobSearcher(queue, redisClient, options, storageClient),
        searchFlows: setupFlowSearcher(queue, redisClient, options, storageClient)
    };
}