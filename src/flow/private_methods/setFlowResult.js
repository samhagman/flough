const Promise = require('bluebird');

/**
 * Set the result of this Flow.
 * This is called by the flowAPI.js file when it detects the flow job is done.
 * @param result
 * @returns {Promise}
 */
export default function setFlowResult(_d, flowInstance, result) {

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
