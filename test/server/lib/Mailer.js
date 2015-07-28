var nodemailer = require('nodemailer');
var Logger = require('../lib/Logger.js');

class Mailer {
    constructor() {
        this.transport = null;
    }

    /**
     * Connects to SMTP server, you should clean up this connection when done with it by calling close()
     */
    connect() {

        return new Promise((resolve, reject) => {

            try {
                if (!this.transport) {
                    this.transport = nodemailer.createTransport('SMTP', {
                        host:             'smtp-outbound.seas.harvard.edu', // hostname
                        secureConnection: false, // use SSL
                        port:             25 // port for secure SMTP,
                    });
                }
                resolve();
            } catch (e) {
                reject(e);
            }
        })
    }

    /**
     * Sends email using SMTP server
     * @param mailOptions - Accepts mailOptions from the nodemailer NPM module
     * @returns {Promise}
     */
    send(mailOptions) {

        return new Promise((resolve, reject) => {
            Logger.debug('****SENT MAIL****');
            //Logger.debug(mailOptions);
            resolve();
            //if (this.transport) {
            //    this.transport.sendMail(mailOptions, (error, info) => {
            //        if (error) {
            //            Logger.error(`[MAIL] Error sending: ${error}`);
            //            reject(error);
            //        }
            //        else {
            //            Logger.debug(`[MAIL] Success sending: ${info}`);
            //            resolve();
            //        }
            //    });
            //}
            //else {
            //    reject(new Error('Cannot send mail without connecting to SMTP server first.  Use .connect() first.'));
            //}
        });
    }

    /**
     * Closes the connection to the SMTP server
     */
    close() {
        if (this.transport) {
            this.transport.close();
        }
    }

    /**
     * Sends a test email.
     */
    sendTestEmail() {
        const mailOptions = {
            from:                 'noreply@seas.harvard.edu',
            to:                   'shagman@g.harvard.edu',
            subject:              'TEST EMAIL',
            generateTextFromHTML: true,
            html:                 'Dear ,' + '<br>' +
                                  'A job was initiated in the Scientific Instrumentation Shop with the following information:'
        };
        this.connect();
        this.send(mailOptions)
            .then(() => Logger.debug('****TEST EMAIL SENT SUCCESSFULLY****'))
            .catch((err) => Logger.debug(`ERROR SENDING TEST EMAIL: ${err}`))
        ;
        this.close();
    }

}

export default Mailer