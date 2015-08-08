const Logger = require('../../lib/Logger');
const recursiveStringify = require('../../lib/util').recursiveStringify;
const Mailer = require('../../lib/Mailer');
const EE = require('../../lib/EventExchange');

export default function registerTaskJob(Flough, redisClient, app) {

    setupTaskRoutes();

    Flough.registerJob('task', function(job, done, error) {
        const data = job.data;
        const jobLogger = job.jobLogger;

        Logger.debug(`Starting an task: ${data.taskName}`);
        jobLogger(job.id, job.data.flowId, 'Started processing task.');

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
                Logger.debug(`Sent mail for this task: ${data.taskName}`);
                jobLogger(job.id, job.data.flowId, 'Sent email without errors.');
            })
            .then(() => {
                Logger.debug(`Waiting on TaskLinkClicked for ${job.id}`);
                jobLogger(job.id, job.data.flowId, 'Waiting for user to complete task.');
                EE.once(`${job.data.flowId}:${job.id}:TaskLinkClicked`, () => {
                    jobLogger(job.id, job.data.flowId, 'Task completed by user.');
                    done();
                });
            })
            .catch((err) => {
                jobLogger(job.id, job.data.flowId, `Error sending email: ${err}`);
                error(err);
            })
        ;
    });


    /**
     * Setup the Task Job's Express Routes
     */
    function setupTaskRoutes() {
        app.get('/api/flow/:flowId/task/:jobId/action/:action', (req, res) => {

            // TODO maybe also check mongo for job info?
            kue.Job.get(req.query.jobId, (job) => {
                if (err) {
                    Logger.error(`Error finding job ${req.query.jobId} on task api job complete submission.`);
                }
                else if (job.data.personHuid === req.session.cas_user) {
                    const jobState = job.state();
                    const {jobId, flowId, action} = req.query;

                    if (jobState === 'active') {
                        EE.emit(`${flowId}:${jobId}:${action}`);
                    }
                    else {

                        const flowModel = mongoCon.model('flow');
                        flowModel.findById(jobId)
                            .then((flowDoc, err) => {

                                // TODO report back something useful with this stuff to client
                                const {jobLogs, stepsTaken, totalSteps} = flowDoc;

                                if (jobState === 'complete') {

                                    // TODO Compile job data and send
                                    res.send(`THIS SHOULD BE INFO ABOUT JOB'S STATUS`);
                                }
                                else if (jobState === 'failed') {

                                    // TODO write good message for when a job failed
                                    res.send(`THIS SHOULD BE ABOUT HOW JOB FAILED AND TO WAIT FOR ANOTHER EMAIL LINK.`);

                                }
                                else {
                                    Logger.error(`Task couldn't be completed via api submit. jobState: ${jobState}, jobId: ${job.id}, flowId: ${req.query.flowId}`);
                                }
                            })
                        ;

                    }
                    res.end();
                }
                else {
                    jobLogger(job.id, job.data.flowId, `Attempted form submission by unauthorized user: ${req.session.cas_user}`);
                    res.send('You are not authorized to submit complete this job.');
                    res.end();
                }
            })
        });

    }
}