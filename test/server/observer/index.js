let MongoOplog = require('mongo-oplog');
let Logger = require('../lib/Logger');
let mongoose = require('mongoose');
let Promise = require('bluebird');
let recursiveStringify = require('../lib/util').recursiveStringify;
let events = require('events');

// Inherit EventEmitter into Observer class, so we can add functionality to it later if wanted.
class Observer {

    constructor() {
        events.EventEmitter.call(this);
    }
}
Observer.prototype.__proto__ = events.EventEmitter.prototype;

let observer = new Observer();


export default function startObserver(mongoClient, redisClient) {

    return new Promise((resolve, reject) => {

        // TODO how to listen to all collections at once?
        Logger.info('Initiating MongoDB oplog tail....');
        let oplog = MongoOplog(CONFIG.MONGO.OP_LOG_URI, 'workflow.flow').tail(() => {
            Logger.info('Tailing started.');

            //// Initiate rules
            require('./rules')(observer);

            resolve(observer);
        });

        oplog.on('insert', emitChangedProp);

        oplog.on('update', emitChangedProp);

        oplog.on('delete', emitChangedProp);

        oplog.on('end', function() {
            Logger.error('Mongo-oplog stream ended.');
        });

        oplog.on('error', function(error) {
            /**
             * FIXME This is fixed by a pull request to mongo-oplog: https://github.com/cayasso/mongo-oplog/pull/12
             * I manually changed what needed to be changed, when the request is merged, then remove if statement.
             * handle it (by removing the oplog.on('error'..)) the server will crash (oplog will throw a error).
             */
            if (error.message !== 'No more documents in tailed cursor') {
                Logger.error(error);
            }
        });

    });


    /**
     * On each oplog event, emit a developer friendly event instead.
     * @param {Object} opDoc - This is a operation document stored in mongo at local.oplog.rs
     */
    function emitChangedProp(opDoc) {
        //Logger.error(JSON.stringify(opDoc, null, 2));

        buildObserverEvents(opDoc)
            .then((events) => {
                events.forEach(({event, data}) => {
                    if (event.split('.').indexOf('revisionKey') === -1) {
                        Logger.debug('{{OBSERVER EVENT}}: ', event);
                        observer.emit(event, data);
                    }
                })
            })
            .catch((err) => Logger.error(`Error emit observer event: ${err}`))
        ;

    }

    /**
     * Builds the event that the Observer class will emit on mongo operations
     * @param {Object|{}} opDoc - This is a mongo doc from local.oplog.rs
     * @returns {bluebird|exports|module.exports}
     */
    function buildObserverEvents(opDoc) {

        return new Promise((resolve, reject) => {
            try {
                /**
                 * Will hold all the events we will return
                 * @type {Array}
                 */
                let events = [];

                /**
                 * This is the skeleton of the data that will be emitted with each event
                 * @type {{opDoc: Object, id: string, doc: {}, operation: {}}}
                 */
                let data = {
                    opDoc, // passed in opDoc

                    id:        '',      // the _id of the mongo doc involved in the operation
                    doc:       {},      // the actual mongo doc that was involved in the operation
                    operation: {}       // for inserts/deletes its the actual doc, for updates its the command to update old doc
                };

                // Return different event depending on operation type
                switch (opDoc.op) {
                    // insert
                    case 'i':
                    {
                        data.doc = opDoc.o;
                        data.id = opDoc.o._id;
                        data.operation = opDoc.o;
                        events.push({ data, event: eventString('insert', opDoc.ns) });
                        resolve(events);
                        break;
                    }

                    // delete
                    case 'd':
                    {
                        data.doc = opDoc.o;
                        data.id = opDoc.o._id;
                        data.operation = opDoc.o;
                        events.push({ data, event: eventString('delete', opDoc.ns) });
                        resolve(events);
                        break;
                    }

                    // update
                    case 'u':
                    {
                        data.operation = opDoc.o;
                        data.query = opDoc[ 'o2' ];
                        data.id = opDoc[ 'o2' ]._id;
                        let redisKey = `${data.id}:${data.operation.$set.revisionKey - 1}`;
                        redisClient.get(redisKey, (err, reply) => {

                            if (err) {
                                Logger.error(`Could not find redis prevdoc for key: ${data.id}:${data.operation.$set.revisionKey - 1}`);
                            }
                            else {
                                data.prevDoc = reply;
                                redisClient.del(redisKey);
                                let collectionName = opDoc.ns.split('.')[ 1 ];
                                let Model = mongoClient.connection.model(collectionName);
                                Model.findOne({ _id: data.id }, (err, newDoc) => {
                                    if (err) {
                                        Logger.error(`Could not find mongo doc for observer event with id: ${data.id}`);
                                    }
                                    else {
                                        data.doc = newDoc;

                                        // For each update command ($set, $inc, etc..) emit
                                        /**
                                         * .keys    Get the keys of the opDoc.o, which will mongo operation commands like ($set, $inc, etc..)
                                         * .map     Create new array that are the values of those keys, which represent the properties that were changed
                                         * .reduce  Reduce each of those objects into an array of changed object path strings (see buildChangedProps)
                                         * .forEach For each changed property (ex. workflow.flows.relatedJobs) add an event to be emitted with that path
                                         */
                                        Object.keys(opDoc.o)
                                            .map((key) => opDoc.o[ key ])
                                            .reduce((accumulatedPaths, object) => accumulatedPaths.concat(buildChangedProps(object)), [])
                                            .forEach((changedProp) => {
                                                events.push({
                                                    data, event: eventString('update', opDoc.ns, changedProp)
                                                });
                                            })
                                        ;

                                        resolve(events);
                                    }
                                });
                            }
                        });

                        break;
                    }

                    // some other event, do nothing
                    default:
                    {
                        break;
                    }
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * This takes an object and computes all the paths needed to reach all the non-Object values in the object
     * @param thing
     * @param path
     * @param firstRun
     * @returns {*}
     */
    function buildChangedProps(thing, path = '', firstRun = true) {


        // If 'thing' is an object...
        if (typeof thing === 'object' && thing !== null && thing.constructor === Object) {

            // Recursively call this function on each key passing the value of thing[key] and the path to get to that value
            return Object.keys(thing).reduce((prev, curr) => prev.concat(buildChangedProps(thing[ curr ], `${path}.${curr}`, false)), []);

        }
        // If this is the first run and the passed 'thing' wasn't an object, just return an empty array
        else if (firstRun) {
            return [];
        }
        // This is a non-Object 'thing'
        else {
            return [ path ];
        }
    }

    /**
     * Formats the event string that is emitted by Observer
     * @param {String} mongoOp - The operation that was done (insert, delete, update)
     * @param {String} nameSpace - The path to the collection operation occurred on ($database.$collection == workflow.flows)
     * @param {String} [changedPropPath] - The path from the collection to the property that was updated (only for updates)
     *                  (ex. workflow.flows.stepsTaken)
     * @returns {String}
     */
    function eventString(mongoOp, nameSpace, changedPropPath = '') {
        return `${mongoOp}:${nameSpace}${changedPropPath}`;
    }


}

