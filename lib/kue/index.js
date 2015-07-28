const kue = require('kue');
let ObjectId = require('mongoose').Types.ObjectId;
let _ = require('lodash');


export default function(app, mongoCon, redisClient) {

    let queue = kue.createQueue({
        disableSearch: false
    });
    let queueName = 'TEST';

    //Require all the queues
    let alerts = require('./lib/alert')(app, redisClient, mongoCon);
    let tasks = require('./lib/task')(app, redisClient, mongoCon);
    let retrieve = require('./lib/retrieve')(app, redisClient, mongoCon);

    //Require the Kue API Routes
    let apiRoutes = require('./api/routes')(app, mongoCon, redisClient);

    // These are the names of the job.type(s) used by processes to do their work.
    // A.K.A. NOT processes but rather sub-steps of them.
    let helperJobTypes = [
        'alert',
        'task',
        'retrieve'
    ];

    // TODO add error handling to all these err(s)
    /**
     * This handles bootstrapping the Queue when the server is restarted
     */
    // First get all the inactive (queued) and active jobs
    queue.inactive((err, inactiveJobIds) => {
        queue.active((err, activeJobIds) => {
            queue.failed((err, failedJobs) => {

                // Cleanup the queued jobs
                inactiveJobIds.forEach((id) => {
                    kue.Job.get(id, (err, job) => {
                        // If this job is a helper job and is still queued, remove it.
                        if (_.includes(helperJobTypes, job.type) && job.state() === 'inactive') {
                            job.remove();
                        }
                    })
                });

                // Cleanup the active jobs
                activeJobIds.forEach((id) => {
                    kue.Job.get(id, (err, job) => {
                        // If this job is a helper job, remove it.
                        if (_.includes(helperJobTypes, job.type)) {
                            job.remove();
                        }
                        // If this job represents a process, restart it.
                        else {
                            job.inactive();
                        }
                    })
                });

                // Restart any process jobs that were failed because the Queue gracefully shutdown
                failedJobs.forEach((id) => {
                    kue.Job.get(id, (err, job) => {
                        if (!job) {
                            console.log(`Attempted to restart job with id ${id}, but job information was no longer in redis.`);
                        }
                        else if (job._error === 'Shutdown' && !_.includes(helperJobTypes, job.type)) {
                            console.log(`Restarting job: ${job.id}`);
                            job.inactive();
                        }
                    })
                })

            });
        });

    });

    /*
     The below code allows you to restore the queue from Mongo, would only be needed if Redis db was completely wiped
     away while there were still active jobs that were running.  Not sure where to place this code.
     */
    //let FlowModel = mongoCon.model('Flow');
    //
    //FlowModel
    //    .find({ completed: false }, { lean: true })
    //    .sort({ date: -1 })
    //    .exec((FlowDocs) => {
    //
    //        FlowDocs.forEach((doc) => {
    //            // TODO do error handling on the .save((err)=>{}) method
    //            let jobParams = doc.jobData;
    //            jobParams.stepsTaken = doc.stepsTaken;
    //            queue.create(doc.jobType, jobParams).save();
    //        });
    //    })
    //;

    // Setup queue logging events
    queue
        .on('job enqueue', (id) => {
            console.log(`[JOB][${id}][${queueName}] - QUEUED`);
        })
        .on('job complete', (id, result) => {
            console.log(`[JOB][${id}][${queueName}] - COMPLETE`);
            console.log(`[JOB][${id}][${queueName}] - Result:`);
            console.log(result);
        })
        .on('job failed', (id, errorMessage) => {
            console.log(`[JOB][${id}][${queueName}] - FAILED`);
            console.log(`[JOB][${id}][${queueName}] - ${errorMessage}`);
        })
    ;

    // Kue currently uses client side job state management and when redis crashes in the
    // middle of that operations, some stuck jobs or index inconsistencies will happen.
    // If you are facing poor redis connections or an unstable redis service you can start
    // Kue's watchdog to fix stuck inactive jobs (if any) by calling:
    queue.watchStuckJobs();

    app.use(kue.app);

    // TODO do error handling on the .save((err)=>{}) method
    queue.create('eaf_funding_change', { title: 'thing', mongoId: new ObjectId() }).save();

    return [ kue.app, queue ];
}
