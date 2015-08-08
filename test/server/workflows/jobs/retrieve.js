const Logger = require('../../lib/Logger');
const recursiveStringify = require('../../lib/util').recursiveStringify;
const Mailer = require('../../lib/Mailer');
const EE = require('../../lib/EventExchange');
const Joi = require('joi');
const once = require('once');

export default function registerRetrieveJob(Flough, redisClient, app) {

    const RetrieveJobSchema = Joi.object().keys(CONFIG.APP.JOI_JOB_KEYS)
        .keys({
            name:         Joi.string().required(),
            description:  Joi.string().required(),
            person:       Joi.object().required(),
            emailHtml:    Joi.string(),
            // This job will inject the correct submit button into the form, just include the fields you need.
            alpacaConfig: Joi.object().required()
        });



    Flough.registerJob('retrieve', function(job, done, error) {

        const rawJobData = job.data;
        const jobLogger = job.jobLogger;
        const setupOnce = once(setupRoutes);
        setupOnce();


        Joi.validate(rawJobData, RetrieveJobSchema, CONFIG.APP.JOI_OPTS, (err, jobData) => {

            if (err) {
                Logger.error('Error validating retrieve job:', err);
                error(err);
            }
            else {

                Logger.debug(`Starting a retrieve: ${jobData.name}`);

                jobLogger(`Retrieve processing started.`, jobData.uuid);

                const formLink = formLinkBuilder(jobData, job.id);

                Logger.debug(jobData);

                const mailOptions = {
                    from:                 'noreply@seas.harvard.edu',
                    to:                   jobData.person.email,
                    subject:              `[WORKFLOW][Form] - ${jobData.name}`,
                    generateTextFromHTML: true,
                    html:                 `${defaultEmail(jobData.name, jobData.description, formLink)} <br><br> ${jobData.emailHtml}`
                };

                let mailer = new Mailer();

                //Logger.debug(mailOptions);

                mailer.connect()
                    .then(() => mailer.send(mailOptions))
                    .then(() => {
                        mailer.close();
                        Logger.debug(`[${jobData.uuid}--${job.id}] Sent mail for this retrieve: ${jobData.name}`);
                        jobLogger(`Email sent without errors`, jobData.uuid);
                    })
                    .then(() => {
                        Logger.debug(`[${jobData.uuid}--${job.id}] Waiting on RetrieveFormSubmit...`);
                        jobLogger(`Waiting on form submission by user.`, jobData.uuid);

                        // Setup EventListener to wait for form submit to complete the job.
                        EE.once(`${jobData.uuid}:${job.id}:RetrieveFormSubmit`, (POSTBody) => {
                            Logger.debug(`[${jobData.uuid}--${job.id}] Got back retrieve form:`);
                            Logger.debug(`[${jobData.uuid}--${job.id}] ${POSTBody}`);
                            jobLogger(`Form submitted by user.`, jobData.uuid);

                            done(POSTBody);
                        });
                    })
                    .catch((err) => {
                        jobLogger(`Error processing retrieve: ${err}`, jobData.uuid);
                        error(err);
                    })
                ;

                /**
                 * This builds the URL that will be used to grab this
                 * @param jobData - job.data
                 * @param jobId - job.id
                 * */
                function formLinkBuilder(jobData, jobId) {

                    // Inject Form Submit Button Options
                    jobData.alpacaConfig.options.form = {
                        'attributes': {
                            'action': `${CONFIG.EXPRESS.API_URL}/api/job/${jobData.uuid}/retrieve/${jobId}/action/RetrieveFormSubmit`,
                            'method': 'post'
                        },
                        'buttons':    {
                            'submit': {
                                'title': 'Send Form Data',
                                'click': function() {
                                    var val = this.getValue();
                                    if (this.isValid(true)) {
                                        alert('Valid value: ' + JSON.stringify(val, null, '  '));
                                        this.ajaxSubmit().done(function() {
                                            alert('Posted!');
                                        });
                                    } else {
                                        alert('Invalid value: ' + JSON.stringify(val, null, '  '));
                                    }
                                }
                            }
                        }
                    };

                    const redisKey = `form:${jobId}:${jobData.uuid}`;
                    const formDataString = recursiveStringify(jobData.alpacaConfig);

                    redisClient.set(redisKey, formDataString);


                    const builtLink = `${CONFIG.EXPRESS.API_URL}/app/#/form/${redisKey}`;
                    Logger.debug(`RETRIEVE FORM LINK: ${builtLink}`);
                    return builtLink;
                }


                /**
                 * This is the default email that is used for this type of job if no custom email is passed in job creation call.
                 * @param {string} formName
                 * @param {string} formDescription
                 * @param {string} formLink
                 * */
                function defaultEmail(formName, formDescription, formLink) {
                    //Logger.debug('building default email');
                    return `
                    Form: ${formName} <br>
                    Form Description: <br>
                    ${formDescription} <br><br>

                    ${formLink}
                    `;
                }
            }
        });

        /**
         * Sets up the routes that are used to interact with this type of job
         */
        function setupRoutes() {

            // This route receives some action to take on a certain jobId
            app.post('/api/job/:jobUUID/retrieve/:jobId/action/:action', (req, res) => {
                kue.Job.get(req.query.jobId, (err, job) => {

                    const jobData = job.data;

                    if (err) {
                        Logger.error(`Error finding kue job ${req.query.jobId} with UUID ${req.query.jobUUID} on retrieve api job complete submission.`);
                    }
                    else if (jobData.person.huid === req.session.cas_user) {
                        const jobState = job.state();
                        const {jobId, jobUUID, action} = req.query;

                        // If this is the first time this form was submitted, send out the event for completing it.
                        if (jobState === 'active') {
                            EE.emit(`${jobUUID}:${jobId}:${action}`);
                        }
                        // TODO otherwise return some useful info to the user.
                        else {

                            //const flowModel = mongoCon.model('flow');
                            //flowModel.findById(jobData.flowId)
                            //    .then((flowDoc, err) => {
                            //
                            //        if (err) {
                            //            Logger.error(`Error finding flowModel`);
                            //        }
                            //
                            //        const {jobLogs, stepsTaken, totalSteps} = flowDoc;
                            //
                            //        if (jobState === 'complete') {
                            //
                            //            // TODO Compile job data and send
                            //            res.send(`THIS SHOULD BE INFO ABOUT JOB'S STATUS`);
                            //        }
                            //        else if (jobState === 'failed') {
                            //
                            //            // TODO write good message for when a job failed
                            //            res.send(`THIS SHOULD BE ABOUT HOW JOB FAILED AND TO WAIT FOR ANOTHER EMAIL LINK.`);
                            //
                            //        }
                            //        else {
                            //            Logger.error(`Task couldn't be completed via api submit. jobState: ${jobState}, jobId: ${job.id}, flowId: ${jobData.flowId}`);
                            //        }
                            //    })
                            //;
                        }
                        res.end();

                    }
                    else {
                        jobLogger(`Attempted form submission by unauthorized user: ${req.session.cas_user}`, jobData.uuid);
                        res.send('You are not authorized to submit complete this job.');
                        res.end();
                    }
                });
            });

            // This route will build the form that is stored in redis, using the redis key that was passed in URL
            app.get('/api/job/:jobUUID/retrieve/form/:redisKey', (req, res) => {
                let redisKey = req.params.redisKey;
                redisClient.get(redisKey, (err, reply) => {
                    if (err) {
                        // TODO Handle this error
                        const keyParts = redisKey.split(':');
                        Logger.error(`[${keyParts[ 2 ]}--${keyParts[ 1 ]}] Retrieve form API received bad redis key: ${redisKey}`);
                    }
                    else {
                        res.type('.js').send(`
                        $('#alpacaForm').alpaca(${reply});
                        console.log('Form Injected');
                    `);
                    }
                });
            });
        }
    });


}


