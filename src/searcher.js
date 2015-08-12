const reds = require('reds');
const Promise = require('bluebird');
const kue = require('kue');


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
    reds.createClient = redisClient;
    // This is the key that Kue uses internally to store search indexes.
    return search = reds.createSearch('q:search');
}


/**
 * Returns a search function for the Kue queue.
 * @param {Object} queue - Kue queue
 * @param {Object} redisClient
 * @param {Object} logger - Internal Flough logger
 * @returns {searchKue}
 */
export default function setupKueSearcher(queue, redisClient, {logger}) {

    const Logger = logger.func;

    /**
     * Takes space separated query string and performs full text search on the Kue queue with them.
     * @param {String} query
     * @param {Boolean} [union] - If true, call .type('or') on search query, this changes default of "and" for
     * multiple items.
     * @returns {bluebird|exports|module.exports}
     */
    function searchKue(query, union = false) {

        // TODO modify query to only return active jobs in the queue
        return new Promise((resolve, reject) => {
            let searcher = getSearch(redisClient).query(query);

            if (union) {
                searcher.type('union');
            }

            searcher.end(function(err, ids) {
                if (err) {
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
                    Promise.all(promArray).then((jobs) => resolve(jobs)).catch((err) => reject(err));
                }
            })
            ;
        });
    }


    return searchKue;
}
