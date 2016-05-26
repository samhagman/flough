const Promise = require('bluebird');
const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const ObjectId = require('mongoose').Types.ObjectId;

/**
 * Builds the `flow.data` and `flow.kueJob` objects in memory without saving to MongoDB and Redis, respectively.
 * @method build
 * @memberOf Flow
 * @public
 * @this Flow
 * @param {PrivateFlowData} _d - Private Flow data
 * @param {object} buildOptions - Options for building the Flow
 * @returns {Promise.<Flow>}
 */
function build(_d, buildOptions = {}) {

    // Set instance's buildPromise and start building
    this.buildPromise = new Promise((resolve, reject) => {
        const { Logger, mongoCon } = _d;
        const _this = this;

        //============================================================
        //
        //               CHECK FOR INVALID FLOWS
        //
        //============================================================

        // The 'noSave' option is only available for use with flows started with Flow#flow (unless in a test env)
        if (!_this.givenData._isChild && _d.flowOptions[ _this.type ].noSave && !buildOptions.isTest) {
            throw new Error(`Cannot use 'noSave' option with parent Flows`);
        }

        //============================================================
        //
        //                     SETUP FLOW DATA
        //
        //============================================================

        // If this is a test Flow, add that property to the data
        if (buildOptions.isTest) _this.givenData._isTest = true;

        // Get the job options that were registered to this flow type
        const flowOptions = _d.flowOptions[ _this.type ];

        // Get the field names that should not be saved into Kue (and stringified)
        const noSaveFieldNames = flowOptions.noSave || [];

        // Group data into what should be persisted to Redis/Mongo and data that shouldn't, but is attached later
        let dataToAttach = {};
        let dataToPersist = {};
        _.forOwn(_this.givenData, (value, key) => {
            if (_.includes(noSaveFieldNames, key)) {
                dataToAttach[ key ] = value;
            }
            else {
                dataToPersist[ key ] = value;
            }
        });

        // Set type of flow
        dataToPersist._type = _this.type;

        // Set flowData properties to default values if needed
        if (!dataToPersist._stepsTaken) dataToPersist._stepsTaken = -1;
        if (!dataToPersist._substepsTaken) dataToPersist._substepsTaken = [];
        if (!dataToPersist._parentUUID) dataToPersist._parentUUID = 'NoFlow';
        if (!dataToPersist._parentType) dataToPersist._parentType = 'NoFlow';
        if (!dataToPersist._ancestors) dataToPersist._ancestors = {};
        dataToPersist._isChild = !!dataToPersist._isChild;

        // Get the dynamicPropertyFunc that was registered to this flow type
        const dynamicPropFunc = _d.dynamicPropFuncs[ _this.type ];
        if (!_.isFunction(dynamicPropFunc)) {
            Logger.error(`Dynamic property passed was not a function for job type ${_this.type}`);
            Logger.error(util.inspect(dynamicPropFunc));
            reject(new Error('Dynamic property passed was not a function.'));
        }

        // Build dynamic properties and merge them into the given data
        let dynamicProperties = dynamicPropFunc(dataToPersist);
        let mergedProperties = Object.assign(dataToPersist, dynamicProperties);

        // If there is no passed UUID, then create one
        if (!mergedProperties._uuid) {

            // Set _isRestarted to false since we are creating a new UUID
            mergedProperties._isRestarted = false;

            // Create random string
            const randomStr = 'xxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = crypto.randomBytes(1)[ 0 ] % 16 | 0;
                const v = c == 'x'
                    ? r
                    : (r & 0x3 | 0x8).toString(16);
                return v.toString(16);
            });
            mergedProperties._uuid = (new ObjectId(randomStr)).toString();
        }
        else {
            // Set _isRestarted to true since there was an existing UUID that has been passed
            mergedProperties._isRestarted = true;
        }

        //============================================================
        //
        //             ASSIGN FLOW DATA TO NEEDED LOCATIONS
        //
        //============================================================

        // Set the data that should be persisted when/if flow#save is called
        _d.toBePersisted.set(_this, mergedProperties);

        // Set the data that shouldn't be saved, but should be reattached to the flowInstance after Flow#save
        _d.toBeAttached.set(_this, dataToAttach);

        let kueJob;

        if (_this.kueJob) {
            // Use the passed kueJob if this is a restart
            kueJob = _this.kueJob;
            _this.isRestarted = true;
            _d.Logger.error(kueJob);
        }
        else {
            // Construct the kueJob for this flow
            kueJob = _d.queue.create(`${_this.type}`, mergedProperties);
        }

        setupKueEventRelay(kueJob, _this);

        // Setup Flow's properties
        _this.data = _.merge(kueJob.data, _.pick(dataToPersist, noSaveFieldNames));
        _this.mongoCon = mongoCon;
        _this.kueJob = kueJob;
        _this.jobId = kueJob.id;
        _this.type = kueJob.type;
        _this.uuid = kueJob.data._uuid;
        _this.parentUUID = kueJob.data._parentUUID;
        _this.isRestarted = _this.isRestarted || kueJob.data._isRestarted;
        _this.isChild = kueJob.data._isChild;

        _d.FlowModel.findById(_this.uuid)
            .then((flowDoc, err) => {

                // Handle error
                if (err) {
                    Logger.error(`[${_this.uuid}] Error finding flowRecord in Flow#build \n\n ${err} \n\n ${flowDoc}`);
                    reject(err);
                }
                // The passed _id wasn't found, this is a new Flow
                else if (!flowDoc) {

                    resolve(_this);
                }

                // Found the _id in Mongo, we are restarting a failed Flow
                else if (flowDoc) {

                    //Logger.info(`${_this.loggerPrefix} Restarting Flow...`);

                    // Restart Flow with values that were saved to storage
                    _this.stepsTaken = flowDoc.stepsTaken;
                    _this.substepsTaken = flowDoc.substepsTaken;
                    _this.ancestors = flowDoc.ancestors;

                    resolve(_this);
                }
            })
        ;
    });

    return this.buildPromise;
}

function setupKueEventRelay(kueJob, _this) {
    //============================================================
    //
    //      SETUP PROXYING OF KUE EVENTS ONTO FLOW INSTANCE
    //
    //============================================================

    // Emit any events from the kue job on this instance as well
    kueJob.on('enqueue', function() { _this.emit('enqueue', ...arguments); });
    kueJob.on('promotion', function() { _this.emit('promotion', ...arguments); });
    kueJob.on('progress', function() { _this.emit('progress', ...arguments); });
    kueJob.on('failed attempt', function() { _this.emit('failed attempt', ...arguments); });
    kueJob.on('failed', function() { _this.emit('failed', ...arguments); });
    kueJob.on('complete', function() { _this.emit('complete', ...arguments); });
    kueJob.on('remove', function() { _this.emit('remove', ...arguments); });
}

// Wrap method in Bluebird .method function
export default Promise.method(build);
