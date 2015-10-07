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
 * @param {Object} queue - Kue queue
 * @param {Object} redisClient
 * @param {Object} logger - Internal Flough logger
 * @returns {searchKue}
 */
function setupKueSearcher(queue, redisClient, {logger}, storageClient) {

    const Logger = logger.func;

    /**
     * Takes space separated query string and performs full text search on the Kue queue with them.
     * @param {String} query
     * @param {Boolean} [union] - If true, call .type('or') on search query, this changes default of "and" for
     * multiple items.
     * @returns {bluebird|exports|module.exports}
     */
    function searchKue(query, union = false) {

        if (query === '') {

            return new Promise((resolve, reject) => {

                kue.Job.range(0, -1, '', (err, jobs) => {

                    if (err) {
                        Logger.error('Error searching for and returning all Kue jobs.');
                        Logger.error(err);
                        reject(err);
                    }
                    else {
                        resolve(jobs);
                    }

                });
            });
        }
        else {

            // TODO modify query to only return active jobs in the queue
            return new Promise((resolve, reject) => {
                let searcher = getSearch(redisClient).query(query);

                if (union) {
                    searcher.type('union');
                }

                searcher.end(function(err, ids) {
                    if (err) {
                        Logger.error(err);
                        reject(err);
                    }
                    else {

                        let promArray = [];

                        // Create array of promises that return the Jobs with the found ids
                        ids.forEach((jobId) => {
                            promArray.push(new Promise((resolve, reject) => {
                                kue.Job.get(jobId, (err, job) => {
                                    if (err) {
                                        Logger.error(`[ERROR SEARCHING KUE] ${job}`);
                                        reject(err);
                                    }
                                    resolve(job);
                                });
                            }));
                        });

                        // When all jobs are retrieved, resolve with all the jobs.
                        Promise.all(promArray).then((jobs) => {
                            resolve(jobs)
                        }).catch((err) => reject(err));
                    }
                })
                ;
            });
        }
    }


    return searchKue;
}

function setupJobSearcher(queue, redisClient, {logger}, storageClient) {

    const Logger = logger.func;
    const jobModel = storageClient.model('job');

    function searchJobs(searchParameters) {

        return new Promise((resolve, reject) => {

            let {jobIds, jobUUIDs, jobTypes, completed} = searchParameters;

            if (jobUUIDs && !_.isArray(jobUUIDs)) {
                reject('jobUUIDs must be an array');
            }
            if (jobIds && !_.isArray(jobIds)) {
                reject('jobIds must be an array');
            }
            if (jobTypes && !_.isArray(jobTypes)) {
                reject('jobTypes must be an array');
            }

            let searchOptions = {};

            if (jobUUIDs && jobUUIDs.length !== 0) {

                searchOptions['data._uuid'] = {
                    $in: jobUUIDs
                };
            }
            if (jobIds && jobIds.length !== 0) {

                searchOptions.jobId = {
                    $in: jobIds
                };
            }
            if (jobTypes && jobTypes.length !== 0) {

                searchOptions.type = {
                    $in: jobTypes
                };
            }
            if (_.has(searchParameters, 'completed')) {
                searchOptions.completed = completed;
            }

            jobModel.find(searchOptions, (err, jobs) => {
                    if (err) {
                        Logger.error(err);
                        reject(err);
                    }
                    else {
                        resolve(jobs);
                    }
                })
            ;
        });

    }

    return searchJobs;
}

function setupFlowSearcher(queue, redisClient, options, storageClient) {

    function searchFlows() {
        return new Promise((resolve, reject) => {
            resolve();
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