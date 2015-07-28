let Promise = require('bluebird');
let Flow = require('../../../flow/index.js');
let kue = require('kue');

export default function(app, mongoCon) {

    /**
     * Processes an EAF Funding Change
     * @param {Object} jobOptions - Options that change the way the job is processed
     * @returns {*|Promise|Promise.<T>|Thenable<U>|Promise<U>}
     */
    const processEafFundingChange = function(jobOptions) {

        console.log('Starting processing eaf_funding_change...');


        return new Promise((resolve, reject) => {

            let flow = new Flow(jobOptions, mongoCon);

            flow.init()
                .alert(1, [], 'ALERT ALERT', 'THIS IS AN ALERT')
                .task(2, [], 'TASK TASK', 'THIS IS A TASK')
                //.retrieve(1, [], 'RETRIEVE JOB', 'TIGER TIGER TIGER', {
                //    'data':       {
                //        'name':     'Diego Maradona',
                //        'feedback': 'Very impressive.',
                //        'ranking':  'excellent'
                //    },
                //    'schema':     {
                //        'title':       'User Feedback',
                //        'description': 'What do you think about Alpaca?',
                //        'type':        'object',
                //        'properties':  {
                //            'name':     {
                //                'type':     'string',
                //                'title':    'Name',
                //                'required': true
                //            },
                //            'feedback': {
                //                'type':  'string',
                //                'title': 'Feedback'
                //            },
                //            'ranking':  {
                //                'type':     'string',
                //                'title':    'Ranking',
                //                'enum':     [ 'excellent', 'ok', 'so so' ],
                //                'required': true
                //            }
                //        }
                //    },
                //    'options':    {
                //        'helper': 'Tell us what you think about Alpaca!',
                //        'fields': {
                //            'name':     {
                //                'size':   20,
                //                'helper': 'Please enter your name.'
                //            },
                //            'feedback': {
                //                'type':   'textarea',
                //                'name':   'your_feedback',
                //                'rows':   5,
                //                'cols':   40,
                //                'helper': 'Please enter your feedback.'
                //            },
                //            'ranking':  {
                //                'type':         'select',
                //                'helper':       'Select your ranking.',
                //                'optionLabels': [ 'Awesome!',
                //                    'Its Ok',
                //                    'Hmm...' ]
                //            }
                //        }
                //    },
                //    'postRender': function(control) {
                //        control.childrenByPropertyId.name.getFieldEl().css('background-color', 'lightgreen');
                //        console.log('Form rendered.');
                //    }
                //})
                .done()
                .then(() => resolve())
                .catch((err) => {
                    reject(err);
                })
            ;
        });

    };

    let queue = kue.createQueue({
        disableSearch: false
    });
    let queueName = 'eaf_funding_change';

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
        d.on('error', err => {
            softShutdown(err, done);
        });
        d.run(() => {

            console.log('Starting EAF_FUNDING_CHANGE:');
            console.log(job.type);
            console.log(job.data);

            let processParams = {
                jobData: job.data,
                jobType: job.type
            };

            if (job.data.stepsTaken) {
                processParams.stepsTaken = job.data.stepsTaken;
            }
            else {
                processParams.stepsTaken = 0;
            }
            processEafFundingChange(processParams)
                .then((result) => done(null, result))
                .catch(err => done(err))
            ;

        });
    });
}