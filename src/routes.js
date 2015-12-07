const express = require('express');
const router = express.Router();


export default function buildRouter(FloughAPIObject, mongoCon, kue) {
    const o = FloughAPIObject.o;
    const Logger = o.logger.func;
    const flowRoute = router.route('/flow/:flowUUID');
    const jobRoute = router.route('/job/:flowUUID');
    const flowModel = mongoCon.model('flow');

    flowRoute.delete((req, res, next) => {

        const flowUUID = req.params.flowUUID;
        const errorResponse = err => res.json({ error: err, success: false });

        flowModel.findById(flowUUID, (err, flow) => {
            if (err) {
                Logger.error('Error finding flow by UUID to delete.');
                Logger.error(err.stack);
                return errorResponse('Error finding flow by UUID to delete.', res);
            }
            else {
                kue.Job.get(flow.jobId, (err, job) => {
                    if (err) {
                        Logger.error('Error find kue job by ID to delete');
                        Logger.error(err.stack);
                        return errorResponse('Error finding kue job by ID to be deleted.', res);
                    }
                    else {
                        try {
                            FloughAPIObject.emit(`CancelFlow:${flowUUID}`);
                            res.json({ result: { success: true } });
                        }
                        catch (err) {
                            Logger.error('Error emitting flow cancellation event from route.');
                            Logger.error(err.stack);
                            return errorResponse('Error emitting cancellation event.');
                        }
                    }
                })
            }
        })

    });

    return router;
};