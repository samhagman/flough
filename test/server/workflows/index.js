let Logger = require('../lib/Logger');
let ObjectId = require('mongoose').Types.ObjectId;


export default function setupWorkflows(redisClient, mongoCon, app) {

    let FloughBuilder = require('../flough')(redisClient, mongoCon, app);
    let PromisedFlow = FloughBuilder.init({
        logger:  {
            func:     Logger,
            advanced: true
        },
        devMode: CONFIG.APP.DEV_BUILD
    });

    PromisedFlow
        .then(Flough => {

            // Register Flough Jobs and their Express Routes
            require('./jobs/alert')(Flough);
            require('./jobs/task')(Flough, redisClient, app);
            require('./jobs/retrieve')(Flough, redisClient, app);

            // Register Flough Flows and their Express Routes
            require('./processes/eaf-funding-change/eaf-funding-change')(Flough, redisClient, app);


            //let alertJob = Flough.startJob('alert', {
            //    name:        'TEST',
            //    description: 'testtestetstest',
            //    person:      { email: 'shagman@g.harvard.edu' }
            //});

            //alertJob.save();

            //let retrieveJob = Flough.startJob('retrieve', {
            //    title: 'search here',
            //    name:         'RETRIEVE TEST',
            //    description:  'RETRIEVE RETRIEVE RETRIEVE',
            //    person:       { email: 'shagman@g.harvard.edu', huid: 10953529 },
            //    alpacaConfig: {
            //        'data':       {
            //            'name':     'Diego Maradona',
            //            'feedback': 'Very impressive.',
            //            'ranking':  'excellent'
            //        },
            //        'schema':     {
            //            'title':       'User Feedback',
            //            'description': 'What do you think about Alpaca?',
            //            'type':        'object',
            //            'properties':  {
            //                'name':     {
            //                    'type':     'string',
            //                    'title':    'Name',
            //                    'required': true
            //                },
            //                'feedback': {
            //                    'type':  'string',
            //                    'title': 'Feedback'
            //                },
            //                'ranking':  {
            //                    'type':     'string',
            //                    'title':    'Ranking',
            //                    'enum':     [ 'excellent', 'ok', 'so so' ],
            //                    'required': true
            //                }
            //            }
            //        },
            //        'options':    {
            //            'helper': 'Tell us what you think about Alpaca!',
            //            'fields': {
            //                'name':     {
            //                    'size':   20,
            //                    'helper': 'Please enter your name.'
            //                },
            //                'feedback': {
            //                    'type':   'textarea',
            //                    'name':   'your_feedback',
            //                    'rows':   5,
            //                    'cols':   40,
            //                    'helper': 'Please enter your feedback.'
            //                },
            //                'ranking':  {
            //                    'type':         'select',
            //                    'helper':       'Select your ranking.',
            //                    'optionLabels': [ 'Awesome!',
            //                        'Its Ok',
            //                        'Hmm...' ]
            //                }
            //            }
            //        },
            //        'postRender': function(control) {
            //            control.childrenByPropertyId.name.getFieldEl().css('background-color', 'lightgreen');
            //            console.log('Form rendered.');
            //        }
            //    }
            //});

            //retrieveJob.then(job => job.save());

            Flough.startFlow('eaf_funding_change', {}).then(flowJob => flowJob.save());

        });

    return PromisedFlow;

}
