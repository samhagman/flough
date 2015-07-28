let Promise = require('bluebird');
let kue = require('kue');
let ObjectId = require('mongoose').Types.ObjectId;
let mongoose = require('mongoose');


/**
 * queueRetrieve handles the full processing of the Retrieve job type
 * @param app - Express app
 * @param redisClient - the Redis client
 * @param mongoCon - the Mongoose connection
 */
export default function queueRetrieve(app, redisClient, mongoCon) {

    // Sets up the routes and attaches the processRetrieve function to the Kue 'retrieve' job type
    setupRoutes();
    setupProcess();
    /**
     * Sets up the routes that are used to interact with this type of job
     */
    function setupRoutes() {

        // This route receives some action to take on a certain jobId
        app.post('/api/flow/:flowId/retrieve/:jobId/action/:action', (req, res) => {
            kue.Job.get(req.query.jobId, (err, job) => {
                if (err) {
                    console.log(`Error finding job ${req.query.jobId} on retrieve api job complete submission.`);
                }
                else if (job.data.personHuid === req.session.cas_user) {
                    EE.emit(`${req.params.jobId}-${req.params.action}`, req.body);
                    res.end();
                }
                else {
                    res.send('You are not authorized to submit complete this job.');
                    res.end();
                }
            });
        });

        // This route will build the form that is stored in redis, using the redis key that was passed in URL
        app.get('/api/flow/:flowId/retrieve/form/:redisKey', (req, res) => {
            let redisKey = req.params.redisKey;
            redisClient.get(redisKey, (err, reply) => {
                if (err) {
                    //TODO Handle this error
                    const keyParts = redisKey.split(':');
                    console.log(`[${keyParts[ 2 ]}--${keyParts[ 1 ]}] Retrieve form API received bad redis key: ${redisKey}`)
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


    function setupProcess() {
        let queue = kue.createQueue();
        let queueName = 'retrieve';
        /**
         * This is the number of this type of job that will be run simultaneously before the next added job is queued
         * @type {number}
         */
        let jobProcessingConcurrency = 50;
        queue.process(queueName, jobProcessingConcurrency, (job, done) => {


            /*
             * Wrap job in domain to catch errors without shutting down node.js process.
             * This allows us to handle the error, then shutdown this worker gracefully.
             * */
            let d = require('domain').create();
            d.on('error', err => done(err));
            d.run(() => {

                console.log('Starting processing of retrieve...');
                console.log(job.data);

                processRetrieve(job)
                    .then((result) => done(null, result))
                    .catch(err => {
                        console.log(err);
                        done(err);
                    })
                ;

            });
        });
    }

    /**
     * This fully processes the Retrieve job
     * @param {Object} job - The job object to process
     * */
    function processRetrieve(job) {

        return new Promise((resolve, reject) => {

            const data = job.data;

            //console.log(data.formName);

            //console.log(`Starting a retrieve: ${JSON.stringify(data)}`);

            const mailOptions = {
                from:                 'noreply@seas.harvard.edu',
                to:                   data.person.email,
                subject:              `[WORKFLOW][Task] - ${data.formName}`,
                generateTextFromHTML: true,
                html:                 `${defaultEmail(data.formName, data.formDescription, formLinkBuilder(data, job.id))} <br><br> ${data.emailHtml}`
            };

            let mailer = new Mailer();

            //console.log(mailOptions);

            mailer.connect()
                .then(() => mailer.send(mailOptions))
                .then(() => {
                    mailer.close();
                    console.log(`[${job.data.flowId}--${job.id}] Sent mail for this retrieve: ${data.formName}`);
                })
                .then(() => {
                    console.log(`[${job.data.flowId}--${job.id}] Waiting on RetrieveFormSubmit...`);

                    // Setup EventListener to wait for form submit to complete the job.
                    EE.once(`${job.id}-RetrieveFormSubmit`, (POSTBody) => {
                        console.log(`[${job.data.flowId}--${job.id}] Got back retrieve form:`);
                        console.log(`[${job.data.flowId}--${job.id}] ${POSTBody}`);
                        resolve(POSTBody);
                    });
                })
                .catch((err) => reject(err))
            ;
        });

        /**
         * This builds the URL that will be used to grab this
         * @param jobData - job.data
         * @param jobId - job.id
         * */
        function formLinkBuilder(jobData, jobId) {

            // Inject Form Submit Button Options
            jobData.alpacaConfig.options.form = {
                'attributes': {
                    'action': `${CONFIG.EXPRESS.API_URL}/api/flow/${jobData.flowId}/retrieve/${jobId}/action/RetrieveFormSubmit`,
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

            const redisKey = `form:${jobId}:${jobData.flowId}`;
            const formDataString = recursiveStringify(jobData.alpacaConfig);

            redisClient.set(redisKey, formDataString);


            //console.log(`SET REDIS KEY: ${redisKey}`);
            return `${CONFIG.SERVER.DOMAIN}${(CONFIG.SERVER.DEV_BUILD ? `:${CONFIG.SERVER.PORT}` : '')}/app/form/${redisKey}`;
        }


        /**
         * This is the default email that is used for this type of job if no custom email is passed in job creation call.
         * @param {string} formName
         * @param {string} formDescription
         * @param {string} formLink
         * */
        function defaultEmail(formName, formDescription, formLink) {
            //console.log('building default email');
            return `
                    Form: ${formName} <br>
                    Form Description: <br>
                    ${formDescription} <br><br>

                    ${formLink}
                    `;
        }
    }
}
