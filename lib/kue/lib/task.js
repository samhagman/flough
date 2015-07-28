let Promise = require('bluebird');
let kue = require('kue');

export default function queueTask(app, redisCon, mongoCon) {

    /*
     * Setup Task Routes
     * */
    app.get('/api/flow/:flowId/task/:jobId/action/:action', (req, res) => {

        kue.Job.get(req.query.jobId, (job) => {
            if (err) {
                console.log(`Error finding job ${req.query.jobId} on task api job complete submission.`);
            }
            else if (job.data.personHuid === req.session.cas_user) {
                EE.emit(`${req.params.jobId}-${req.params.action}`);
                res.end();
            }
            else {
                res.send('You are not authorized to submit complete this job.');
                res.end();
            }
        })
    });

    let processTask = function(job) {

        return new Promise((resolve, reject) => {

            const data = job.data;

            console.log(data.taskName);

            console.log(`Starting an alert: ${data.taskName}`);

            const taskLinkBuilder = function(taskId) {

                return `${CONFIG.SERVER.DOMAIN}${(CONFIG.SERVER.DEV_BUILD ? `:${CONFIG.SERVER.PORT}` : '')}/api/flow/${data.flowId}/task/${taskId}/action/TaskLinkClicked`;
            };

            const defaultEmail = function(taskName, taskDescription, taskLink) {
                return `
                                Task: ${taskName} <br>
                                Task Description: <br>
                                ${taskDescription}
                                <br>
                                <br>
                                ${taskLink}
                                `;
            };

            const mailOptions = {
                from:                 'noreply@seas.harvard.edu',
                to:                   data.person.email,
                subject:              `[WORKFLOW][Task] - ${data.taskName}`,
                generateTextFromHTML: true,
                html:                 `${defaultEmail(data.taskName, data.taskDescription, taskLinkBuilder(job.id))} <br><br> ${data.emailHtml}`
            };

            let mailer = new Mailer();

            mailer.connect()
                .then(() => mailer.send(mailOptions))
                .then(() => {
                    mailer.close();
                    console.log(`Sent mail for this task: ${data.taskName}`);
                })
                .then(() => {
                    console.log(`Waiting on TaskLinkClicked for ${job.id}`);
                    EE.once(`${job.id}-TaskLinkClicked`, () => {
                        resolve();
                    });
                })
                .catch((err) => reject(err))
            ;
        });
    };

    let queue = kue.createQueue({
        disableSearch: false
    });
    let queueName = 'task';
    /**
     * This is the number of this type of job that will be run simultaneously before the next added job is queued
     * @type {number}
     */
    let jobProcessingConcurrency = 50;
    queue.process(queueName, jobProcessingConcurrency, (job, done) => {

        console.log('Starting processing of task...');

        /*
         * Wrap job in domain to catch errors without shutting down node.js process.
         * This allows us to handle the error, then shutdown this worker gracefully.
         * */
        let d = require('domain').create();
        d.on('error', err => done(err));

        d.run(() => {

            console.log('Starting task job...');
            console.log(job.type);
            console.log(job.data);

            processTask(job)
                .then((result) => done(null, result))
                .catch(err => {
                    //console.log(err);
                    done(err);
                })
            ;

        });
    });
}