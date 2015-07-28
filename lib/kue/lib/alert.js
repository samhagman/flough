let Promise = require('bluebird');
let kue = require('kue');

export default function queueAlert(app, redisCon, mongoCon) {

    let processAlert = function(job) {

        return new Promise((resolve, reject) => {
            const data = job.data;

            console.log(data.alertName);

            console.log(`Starting an alert: ${data.alertName}`);

            const defaultEmail = function(taskName, taskDescription) {

                return `
                                Alert: ${taskName} <br>
                                Alert Description: <br>
                                ${taskDescription}
                                `;
            };

            const mailOptions = {
                from:                 'noreply@seas.harvard.edu',
                to:                   data.person.email,
                subject:              `[WORKFLOW][Alert] - ${data.alertName}`,
                generateTextFromHTML: true,
                html:                 `${defaultEmail(data.alertName, data.alertDescription)} <br><br> ${data.emailHtml}`
            };


            let mailer = new Mailer();

            mailer.connect()
                .then(() => mailer.send(mailOptions))
                .then(() => {
                    mailer.close();
                    console.log(`Finished this alert: ${data.alertName}`);
                    resolve();
                })
                .catch((err) => reject(err))
            ;
        });
    };

    let queue = kue.createQueue({
        disableSearch: false
    });
    let queueName = 'alert';
    /**
     * This is the number of this type of job that will be run simultaneously before the next added job is queued
     * @type {number}
     */
    let jobProcessingConcurrency = 50;
    queue.process(queueName, jobProcessingConcurrency, (job, done) => {

        console.log('Starting processing of alert...');

        /*
         * Wrap job in domain to catch errors without shutting down node.js process.
         * This allows us to handle the error, then shutdown this worker gracefully.
         * */
        let d = require('domain').create();
        d.on('error', err => done(err));
        d.run(() => {

            console.log('Starting alert job...');
            console.log(job.type);
            console.log(job.data);

            processAlert(job)
                .then((result) => done(null, result))
                .catch(err => {
                    //console.log(err);
                    done(err);
                })
            ;

        });
    });


}