let Logger = require('../lib/Logger');

export default function rules(observer) {

    /**
     * The observer is an instance of a node EventEmitter that emits very specific events.
     * Events are emitted in the following pattern: $operation$:$changed path$
     *
     * There are 3 kinds of $operation$s: insert, update, and delete.
     *
     * The $changed path$ treats mongo databases as giant JSON documents.
     *      For example, if a new document is inserted into a mongoDB database named 'develop' within the
     *      'persons' collection the $changed path$ would be == 'develop.persons' and the full event == 'insert:develop.persons'
     *
     *      A more realistic example is if we are adding a job to the 'relatedJobs' array field of a document in
     *      the 'flows' collection inside the 'workflow' database.  The event emitted here is 'update:workflow.flows.relatedJobs'
     *
     *      Currently $changed path$ only looks at properties that have changed, and where that makes sense.  For example,
     *      observing on the first item of an array is not possible, only the whole array itself as a single property.
     *
      */


    // This rule works.
    //observer.on('update:workflow.flows.relatedJobs', (eventData) => {
    //
    //})

}