/**
 * TODO - Make this return something more useful than just searching for the flow
 * @method Flow.status
 * @public
 * @alias Flow.search
 * @param {Flow~privateData} _d - Private Flow data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise.<object[]>}
 */
function status(_d, UUID) {

    // search for the flow by UUID and return it
    return _d.Flow.search({ UUID });
}

export default status;
