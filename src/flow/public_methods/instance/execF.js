/*
 * the exec function
 * Finished
 * - Should be able to define an arbitrary function to be run that isn't tracked as a job.
 *
 * TODO
 * - The function will be passed (resolve, reject) to finish itself
 * - The function's running should be logged to the Flow job
 * - The data it returns (eg. resolve(data) ) should be saved to Mongo under related jobs or something
 * */

/**
 * Add an arbitrary promise function to a promise chain.
 * @method Flow#execF
 * @public
 * @this Flow
 * @param {object} _d - Private Flow data
 * @param {number} step - The step in the flow chain to add this function to
 * @param {function} promReturningFunc - Function to add to flow chain -- must return a Promise
 * @returns {Flow}
 */
function execF(_d, step, promReturningFunc) {
    let _this = this;

    if (!_this.buildPromise) throw new Error('Cannot call `Flow#execF` before `Flow#save`.');
    if (!_this.isParent) throw new Error('Cannot call `Flow#execF` before `Flow#beginChain`.');

    if (_this.stepsTaken < step) {

        const promFunc = function() {

            let ancestors = _this.ancestors;

            return promReturningFunc(ancestors);
        };

        const stepStr = step.toString();

        if (_this.promised[ stepStr ]) {
            _this.promised[ stepStr ].push(promFunc);
        }
        else {
            _this.promised[ stepStr ] = [ promFunc ];
        }

    }

    return _this;
}

export default execF;
