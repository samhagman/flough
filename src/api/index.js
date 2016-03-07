export default function buildRouter(FloughAPIObject, mongoCon, kue, floughRouter) {

    // Require routes
    floughRouter = require('./index')(FloughAPIObject, mongoCon, kue, floughRouter);
    
    return floughRouter;
};