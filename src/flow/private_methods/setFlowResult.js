const Promise = require('bluebird');

/**
 * Set the result of an instance of Flow
 * @memberOf Flow
 * @protected
 * @param {object} _d - The Private Flow data
 * @param {Flow} flowInstance - The instance of Flow to act upon
 * @param {*} result - The result of the child flow
 * @returns {Promise.<*>}
 */
function setFlowResult(_d, flowInstance, result) {

    return new Promise((resolve, reject) => {
        _d.FlowModel.findByIdAndUpdate(flowInstance.uuid, {
                isCompleted: true,
                result:      result
            }, { new: true })
            .then((flowDoc, err) => {
                if (err) {
                    _d.Logger.error(`[${flowInstance.kueJob.type}][${flowInstance.uuid}] Error updating complete flow in MongoDB. \n
                                        $set complete => true \n\n
                                        $set result => ${JSON.stringify(result)}`);
                    _d.Logger.error(`[ ${flowInstance.uuid} ] ${err.stack}`);
                    return reject(err);
                }
                else {
                    flowInstance.isCompleted = true;
                    return resolve(result);
                }
            })
        ;
    });
}

export default setFlowResult;
