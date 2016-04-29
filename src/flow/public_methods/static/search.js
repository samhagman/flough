const reds = require('reds');
const Promise = require('bluebird');
const kue = require('kue');
const _ = require('lodash');
const Joi = require('joi');

/**
 * Search for flows using MongoDB as the source of truth.
 * Results must match ALL specified parameters: jobId, UUID, type
 * @method Flow.search
 * @public
 * @param {Flow~privateData} _d - Private Flow data
 * @param {Array} [jobId] - Array of Kue job ids to match
 * @param {Array} [UUID] - Array of Flough flow UUIDs to match
 * @param {Array} [type] - Array of flow type to match
 * @param {string} [isCompleted] - Whether or not to only return isCompleted flows
 * @param {string} [isCancelled] - If set, will return only either cancelled or not cancelled flows. If not set, both.
 * @param {boolean} [kueActive] - Whether or not to return only active Kue jobs
 * @returns {Promise.<object[]>}
 */
export default function search(_d, { jobId, UUID, type, isCompleted, isCancelled, kueActive }) {

    const { Logger, FlowModel } = _d;

    return new Promise((resolve, reject) => {

        const searchSchema = Joi.object().keys({
            jobId:       Joi.array().items(Joi.number()).single(),
            UUID:        Joi.array().items(Joi.string()).single(),
            type:        Joi.array().items(Joi.string()).single(),
            isCompleted: Joi.bool(),
            isCancelled: Joi.bool(),
            kueActive:   Joi.bool()
        });

        const validResult = Joi.validate([ ...arguments ][ 1 ], searchSchema, { abortEarly: false, convert: false });

        if (validResult.error) {
            Logger.error('Error with Flow.search: \n' + validResult.error);
            return reject(new Error('Invalid search parameters for Flow.search'));
        }

        // MongoDB Search Object
        let searchOptions = {};

        if (isCompleted !== undefined) {
            searchOptions.isCompleted = isCompleted;
        }

        if (isCancelled !== undefined) {
            searchOptions.isCancelled = isCancelled;
        }

        if (UUID) {
            searchOptions[ 'data._uuid' ] = { $in: castToArray(UUID) };
        }

        if (jobId) {
            searchOptions.jobId = { $in: castToArray(jobId) };
        }

        if (type) {
            searchOptions.type = { $in: castToArray(type) };
        }

        FlowModel.find(searchOptions, (err, flows) => {
            if (err) {
                Logger.error(err.stack);
                reject(err);
            }
            else {
                // If they only want to return active jobs (those found in Kue) then filter out inactive jobs
                if (kueActive) {
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
};

function castToArray(value) {
    if (value) {
        return _.isArray(value)
            ? value
            : [ value ];
    }
    else {
        return [];
    }
}
