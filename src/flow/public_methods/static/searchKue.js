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

    reds.client = redisClient;

    // This is the key that Kue uses internally to store search indexes.
    search = reds.createSearch('q:search');
    return search;
}


/**
 * Takes space separated query string and performs full text search on the Kue queue with them.
 * @method Flow.searchKue
 * @public
 * @param {object} _d - Private Flow object
 * @param {string} query - Text to search within job keys and values
 * @param {boolean} [union=false] - If true, call .type('or') on search query, this changes default of "and" for
 * multiple items.
 * @returns {Promise.<object[]>}
 */
function searchKue(_d, query, union = false) {

    const Logger = _d.Logger;

    if (query === '') {

        return new Promise((resolve, reject) => {

            kue.Job.range(0, -1, '', (err, jobs) => {

                if (err) {
                    Logger.error('Error searching for and returning all Kue jobs.');
                    Logger.error(err.stack);
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
            let searcher = getSearch(_d.redisClient).query(query);

            if (union) {
                searcher.type('union');
            }

            searcher.end(function(err, ids) {
                if (err) {
                    Logger.error(err.stack);
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

export default searchKue;
