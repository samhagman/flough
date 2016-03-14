const Promise = require('bluebird');

/**
 * TODO - Make this return something more useful than just searching for the flow
 * @param {object} _d - Object holding private Flow class data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise.<object[]>}
 */
export default function status(_d, UUID) {

    // search for the flow by UUID and return it
    return _d.Flow.search(UUID);
}
