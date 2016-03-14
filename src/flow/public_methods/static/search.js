const reds = require('reds');
const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');

/**
 * Search for flows using MongoDB as the source of truth.
 * Results must match ALL specified parameters: jobIds, flowUUIDs, types
 * @param {object} _d - Private Flow data
 * @param {array} [jobIds] - Array of Kue job ids to match
 * @param {array} [flowUUIDs] - Array of Flough flow UUIDs to match
 * @param {array} [types] - Array of flow types to match
 * @param {string} [isCompleted] - Whether or not to only return isCompleted flows
 * @param {string} [isCancelled] - If set, will return only either cancelled or not cancelled flows. If not set, both.
 * @param {boolean} [activeJobs] - Whether or not to return only active Kue jobs
 * @returns {Promise.<object[]>}
 */
export default function search(_d, { jobIds, flowUUIDs, types, isCompleted, isCancelled, activeJobs }) {

    const Logger = _d.Logger;
    const flowModel = _d.FlowModel;


    return new Promise((resolve, reject) => {

        if (flowUUIDs && !_.isArray(flowUUIDs)) {
            reject('flowUUIDs must be an array');
        }

        if (jobIds && !_.isArray(jobIds)) {
            reject('jobIds must be an array');
        }

        if (types && !_.isArray(types)) {
            reject('types must be an array');
        }

        // MongoDB Search Object
        let searchOptions = {};

        if (_.isBoolean(isCompleted)) {
            searchOptions.isCompleted = isCompleted;
        }

        if (_.isBoolean(isCancelled)) {
            searchOptions.isCancelled = isCancelled;
        }

        if (_.isBoolean(activeJobs)) {
            searchOptions.activeJobs = activeJobs;
        }

        if (flowUUIDs && flowUUIDs.length !== 0) {
            searchOptions[ 'data._uuid' ] = { $in: flowUUIDs };
        }

        if (jobIds && jobIds.length !== 0) {
            searchOptions.jobId = { $in: jobIds };
        }

        if (types && types.length !== 0) {
            searchOptions.type = { $in: types };
        }

        flowModel.find(searchOptions, (err, flows) => {
            if (err) {
                Logger.error(err.stack);
                reject(err);
            }
            else {
                // If they only want to return active jobs (those found in Kue) then filter out inactive jobs
                if (activeJobs) {
                    // Build promise array whose items resolve whether or not the job at the corresponding index in
                    // the jobs returned from MongoDB array (flows) is found inside Kue or not.
                    const promArray = flows.map((flow, index) => new Promise((resolve, reject) => {
                        kue.Job.get(flow.jobId, function(err, kueJob) {
                            if (err) {
                                // Not found in Kue, return false
                                resolve(false);
                            }
                            else {
                                // Found in Kue, return true if the UUIDs are the same (Job ids are recycled in Kue)
                                resolve(kueJob.data._uuid === flows[ index ].data._uuid);
                            }
                        });
                    }));

                    // After we've checked active state of all jobs returned from MongoDB, filter out jobs that were
                    // not found in Kue and resolve the resulting array
                    Promise.all(promArray)
                        .then(isActiveJobArray => {
                            resolve(flows.filter((kueJob, index) => isActiveJobArray[ index ]));
                        })
                    ;
                }
                else {
                    resolve(flows);
                }
            }
        })
        ;
    });
}
