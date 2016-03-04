'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = buildRouter;
var express = require('express');
var router = express.Router();

function buildRouter(FloughAPIObject, mongoCon, kue) {
    var o = FloughAPIObject.o;
    var Logger = o.logger.func;
    var flowRoute = router.route('/flow/:flowUUID');
    var jobRoute = router.route('/job/:flowUUID');
    var flowModel = mongoCon.model('flow');

    flowRoute['delete'](function (req, res, next) {

        var flowUUID = req.params.flowUUID;
        var errorResponse = function errorResponse(err) {
            Logger.error('Error find kue job by ID to delete');
            Logger.error(err.stack);
            res.json({ error: err, success: false });
        };

        flowModel.findById(flowUUID, function (err, flow) {
            if (err) {
                Logger.error('Error finding flow by UUID to delete.');
                Logger.error(err.stack);
                return errorResponse('Error finding flow by UUID to delete.', res);
            } else {
                if (flow.isCancelled) {
                    return res.json({ error: 'Flow already cancelled.' });
                } else {
                    kue.Job.get(flow.jobId, function (err, job) {
                        if (err) {
                            return errorResponse('Error finding kue job by ID to be deleted.', err);
                        } else {
                            try {
                                FloughAPIObject.emit('CancelFlow:' + flowUUID);
                                res.json({ result: { success: true } });
                            } catch (err) {
                                Logger.error('Error emitting flow cancellation event from route.');
                                Logger.error(err.stack);
                                return errorResponse('Error emitting cancellation event.', err);
                            }
                        }
                    });
                }
            }
        });
    });

    return router;
}

;
module.exports = exports['default'];