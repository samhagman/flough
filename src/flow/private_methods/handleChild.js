const Promise = require('bluebird');
const _ = require('lodash');

/**
 * Handles storing promise returning functions for a child flow at correct step in Flow instance
 * @memberOf Flow
 * @protected
 * @param {object} _d - Private Flow data
 * @param {Flow} flowInstance - The Flow instance to act upon
 * @param {number} step - The step the child flow was asked to run at by the user
 * @param {number} substep - The substep that the parent flow assigned to this child flow
 * @param {function} flowRunner - Function that will run the flow
 * @param {function} [restartFlow] - TODO Optional function to be called if this job is being restarted
 * @returns {Promise}
 */
function handleChild(_d, flowInstance, step, substep, flowRunner, restartFlow) {

    return new Promise((handleFlowResolve, handleFlowReject) => {
        const Logger = _d.Logger;

        restartFlow = restartFlow ? restartFlow : (()=> Logger.debug(`${flowInstance.loggerPrefix} No restartFlow() passed.`));

        //Logger.debug(`[${_this.uuid}] Handling step ${step}, substep ${substep}`);


        if (step < 1) {
            handleFlowReject(new Error('Cannot use a step that is less than 1'));
        }
        /**
         * True if:
         * 1. Step is the current step being processed AND this substep has not already been isCompleted
         * OR
         * 2. Step is any step past the current step
         */
        else if ((step === (flowInstance.stepsTaken + 1) && !_.includes(flowInstance.substepsTaken, substep)) || (step > flowInstance.stepsTaken + 1)) {

            let promised = flowInstance.promised;

            let stepStr = step.toString();

            /**
             * runFlow is a function that when run will call the passed job's logic function (which is a
             * promise), then upon completion of that job will pass the job to .completeChild(), then will
             * resolve.
             *
             * Essentially runFlow is the function that once called will...run the job.
             * @returns {bluebird|exports|module.exports}
             */
            let runFlow = (currentAncestors) => {
                return new Promise((resolve, reject) => {
                    // Run the job...
                    flowRunner(currentAncestors)

                    // Complete the job...
                        .spread((job, result) => {
                            return _d.completeChild(flowInstance, job, result);
                        })

                        // Resolve.
                        .then(resolve)
                        .catch((err) => reject(err))
                    ;
                });
            };

            // Add this job to the promisedArray, initialize if first job at this step
            if (promised[ stepStr ]) {
                flowInstance.promised[ stepStr ].push(runFlow);

                //Logger.debug(`[${_this.uuid}] Added job for step: ${step}`);
                handleFlowResolve();
            }
            else {
                //Logger.debug(`[${_this.uuid}] Added job for step: ${step}`);
                flowInstance.promised[ stepStr ] = [ runFlow ];
                handleFlowResolve();
            }

        }

        // Don't handle job, it was isCompleted before
        else {
            // Run the job's restart function
            restartFlow();
            handleFlowResolve();
        }
    });
}

export default handleChild;
