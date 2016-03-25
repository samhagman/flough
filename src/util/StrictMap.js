const EventEmitter3 = require('eventemitter3');
const _ = require('lodash');

const privateData = new WeakMap();

/**
 * A data Map that emits events on updates to key values.
 * Restricts #set calls from overwriting an already set key; a key must be cleared before its value can be set again.
 * @class StrictMap
 * @extends EventEmitter3
 */
class StrictMap extends EventEmitter3 {

    /**
     * @constructor
     * @param {object} [initialMap={}] - Keys and values to instantiate StrictMap
     */
    constructor(initialMap) {
        // Initialize the parent constructor
        super();

        // Initialize this instance's private data
        privateData.set(this, {});

        // Set the initial keys
        Object.keys(initialMap).forEach(key => this.set(key, initialMap[ key ]));
    }

    /**
     * Set a key's value and emit that key, value pair.  Can only set a key that does not currently exist in the Map.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        if (!_.isString(key)) throw new Error('Keys of StrictMap must be strings');

        // Get this instance's private data and check if the key has already been set
        const privateDataMap = privateData.get(this);
        if (privateDataMap.has(key)) throw new Error('Keys must be cleared before being set again.');
        privateDataMap.set(key, value);
        this.emit(key, value);
    }

    /**
     * Asynchronously get the value at the given key
     * 1. If the key has already been set, return the value associated with it.
     * 2. If the key has not already been set, return when the key is set to a value.
     * @param {string} key
     * @param {callback} cb
     * @return {Promise}
     */
    get(key, cb) {
        return new Promise((resolve, reject) => {
            if (!_.isString(key)) reject(new Error('Keys of StrictMap must be strings'));

            /**
             * Setup listener that resolves with newly set value
             * @param {*} value
             */
            const getValFromEvent = value => resolve(value);

            // Listen for #set calls on this key
            this.once(key, getValFromEvent);

            // Get this instance's private data
            const privateDataMap = privateData.get(this);

            //
            if (privateDataMap.has(key)) {
                this.removeListener(key, getValFromEvent);
                return resolve(privateDataMap.get(key));
            }
        }).asCallback(cb);
    }

    /**
     * Check if a key exists in the StrictMap instance
     * @param {string} key
     * @returns {*}
     */
    has(key) {
        return privateData.get(this).has(key);
    }

    /**
     * Remove a key from the StrictMap instance.  Will error if the key doesn't currently exist.
     * @param {string} key
     * @returns {*}
     */
    remove(key) {
        if (!_.isString(key)) throw new Error('Keys of StrictMap must be strings');

        // Get this instance's private data
        const privateDataMap = privateData.get(this);

        // Check if the key currently exists, throw an error if it doesn't.
        if (!privateDataMap.has(key)) throw new Error('Cannot clear a key that was never set.');

        // Get the current value to return
        const value = privateDataMap.get(key);

        // Delete the key
        privateDataMap.delete(key);

        return value;
    }
}

export default StrictMap;
