export default function buildRouter(FloughAPIObject, mongoCon, kue, floughRouter) {
    const o = FloughAPIObject.o;
    const Logger = o.logger.func;
    const flowModel = mongoCon.model('flow');
    const jobModel = mongoCon.model('job');
    const expressApp = o.expressApp;

    // build flow routes
    const flowRouter = require('./flow')(o, Logger, expressApp.Router(), flowModel);
    floughRouter.use('/flow', flowRouter);

    // build job routes
    const jobRouter = require('./job')(o, Logger, expressApp.Router(), jobModel);
    floughRouter.use('./job', jobRouter);

    return floughRouter;
};