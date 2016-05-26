
/**
 * Completely reset a flow so that it starts all over again from the originally provided data.
 * @method Flow.reset
 * @public
 * @param {Flow~privateData} _d - Private Flow data
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
function reset(_d, UUID) {

    return _d.Flow.rollback(UUID, 0);
}

export default reset;
