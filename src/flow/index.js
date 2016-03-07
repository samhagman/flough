let Promise = require('bluebird');
let kue = require('kue');
let _ = require('lodash');
let util = require('util');
const crypto = require('crypto');


const registerFlow = require('./methods/register');
const startFlow = require('./methods/start');
const cancelFlow = require('./methods/cancel');
const resetFlow = require('./methods/reset');
const cloneFlow = require('./methods/clone');
const getStatusOfFlow = require('./methods/status');

/**
 * @class Flow
 */
class Flow {

    constructor(queue, mongoCon, FloughInstance) {

        this.FlowController = require('./FlowController')(queue, mongoCon, FloughInstance, startFlow);
        this.queue = queue;
        this.mongoCon = mongoCon;
        this.o = FloughInstance.o;
        this.Logger = o.logger.func;
        this.FloughInstance = FloughInstance;
        this.FlowModel = mongoCon.model('flow');
        this.FloughInstance._dynamicPropFuncs = {};
    }

    /**
     * Registers a function so that it can be called by .startFlow()
     * @param {string} flowType - Name of flow (successive calls of same flowName overwrite previous Flows)
     * @param {object} [flowOptions] - Options for how to process this flow
     * @param {function} flowFunc - User passed function that is the Flow's logic
     * @param {function} [dynamicPropFunc] - This is function to be run at job start time which should return an object
     *  that will be merged into the job.data of all jobs of this type.
     */
    static register(flowType, flowOptions, flowFunc, dynamicPropFunc) { registerFlow.call(this, ...arguments) }

    /**
     * Starts a Flow by attaching extra fields to the User passed data and running Kue's queue.create()
     * @param {string} flowName - Name of Flow to start
     * @param {object} [givenData] - Data context to be attached to this Flow
     * @param {boolean} [helper] - If this is a helper flow, it will not restart on its own after a server restart.
     * @returns {bluebird|exports|module.exports}
     */
    static start(flowName, givenData, helper) { startFlow.call(this, ...arguments) }

    /**
     * Cancels a flow given a UUID
     * @param {string} UUID - The UUID of a flow
     */
    static cancel(UUID) { cancelFlow.call(this, ...arguments) }

    /**
     * Reset a flow to a given step
     * @param {string} UUID - The UUID of a flow
     * @param {number} stepNumber - The step number to reset to.
     */
    static reset(UUID, stepNumber) { resetFlow.call(this, ...arguments) }

    /**
     * Clone a flow -- take the data from a flow and start a new, separate flow with the same initial data.
     * @param {string} UUID - The UUID of a flow
     */
    static clone(UUID) { cloneFlow.call(this, ...arguments) }


    /**
     * Get a flow's current data.
     * @param {string} UUID - The UUID of a flow
     */
    static status(UUID) { getStatusOfFlow.call(this, ...arguments) }

    // TODO
    // static search() { searchFlows.call(this, ...arguments) }
}

/**
 * Builds the Flow API
 * @param {object} queue - Kue queue
 * @param {object} mongoCon - Mongoose Connection
 * @param {object} FloughInstance - Instance of Flough that is passed to the user.
 * @returns {{registerFlow, startFlow}}
 */
export default function flowAPIBuilder(queue, mongoCon, FloughInstance) {

    FloughInstance.Flow = new Flow(queue, mongoCon, FloughInstance);

    return FloughInstance;
}