const Logger = requireServer('lib/Logger');
const Joi = require('joi');
const Mailer = requireServer('lib/Mailer');

export default function registerAlertJob(Flough) {

    let AlertJobSchema = Joi.object().keys(CONFIG.APP.JOI_JOB_KEYS)
        .keys({
            name:        Joi.string().required(),
            description: Joi.string().required(),
            person:      Joi.object().required(),
            emailHtml:   Joi.string()
        });

    Flough.registerJob('alert', function(job, done, error) {

        const rawJobData = job.data;
        const jobLogger = job.jobLogger;

        Logger.debug(`Validating an alert alert: ${JSON.stringify(rawJobData, null, 2)}`);

        Joi.validate(rawJobData, AlertJobSchema, CONFIG.APP.JOI_OPTS, (err, jobData) => {
            if (err) {
                Logger.error('Error validating alert job info.');
                jobLogger(`Input not valid: ${err}`, jobData.uuid);
                error(err);
            }
            else {

                Logger.debug(`Starting an alert: ${jobData.name}`);

                jobLogger('Alert processing started.', jobData.uuid);

                const defaultEmail = function(taskName, taskDescription) {

                    return `
                    Alert: ${taskName} <br>
                    Alert Description: <br>
                    ${taskDescription}
                    `;
                };

                const mailOptions = {
                    from:                 'noreply@seas.harvard.edu',
                    to:                   jobData.person.email,
                    subject:              `[WORKFLOW][Alert] - ${jobData.name}`,
                    generateTextFromHTML: true,
                    html:                 `${defaultEmail(jobData.name, jobData.description)} <br><br> ${jobData.emailHtml}`
                };

                let mailer = new Mailer();

                mailer.connect()
                    .then(() => mailer.send(mailOptions))
                    .then(() => {
                        mailer.close();
                        Logger.debug(`Finished this alert: ${jobData.name}`);
                        jobLogger('Sent email without errors.', jobData.uuid);
                        done();
                    })
                    .catch((err) => {
                        jobLogger(`Error sending email: ${err}`, jobData.uuid);
                        error(err);
                    })
                ;
            }
        });


    });

}