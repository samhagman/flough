
/**
 * @this Flow
 * @param {string} UUID - The UUID of a flow
 * @returns {Promise}
 */
export default function getStatusOfFlow(UUID) {
    return this.FloughInstance.searchFlows(UUID);
}
