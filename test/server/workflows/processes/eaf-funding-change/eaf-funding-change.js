const Logger = requireServer('lib/Logger');
const recursiveStringify = requireServer('lib/util').recursiveStringify;
const Mailer = requireServer('lib/Mailer');
const EE = requireServer('lib/EventExchange');

export default function registerEAFFundingChangeFlow(Flough, redisClient, app) {

    Flough.registerFlow('eaf_funding_change', function(flow, done, error) {

        let flowInstance = flow.init();

        flowInstance
            .job(1, 'retrieve', {
                name:        'TEST',
                description: 'testtestetstest',
                person:      { email: 'shagman@g.harvard.edu' },
                alpacaConfig: {
                    'data':       {
                        'name':     'Diego Maradona',
                        'feedback': 'Very impressive.',
                        'ranking':  'excellent'
                    },
                    'schema':     {
                        'title':       'User Feedback',
                        'description': 'What do you think about Alpaca?',
                        'type':        'object',
                        'properties':  {
                            'name':     {
                                'type':     'string',
                                'title':    'Name',
                                'required': true
                            },
                            'feedback': {
                                'type':  'string',
                                'title': 'Feedback'
                            },
                            'ranking':  {
                                'type':     'string',
                                'title':    'Ranking',
                                'enum':     [ 'excellent', 'ok', 'so so' ],
                                'required': true
                            }
                        }
                    },
                    'options':    {
                        'helper': 'Tell us what you think about Alpaca!',
                        'fields': {
                            'name':     {
                                'size':   20,
                                'helper': 'Please enter your name.'
                            },
                            'feedback': {
                                'type':   'textarea',
                                'name':   'your_feedback',
                                'rows':   5,
                                'cols':   40,
                                'helper': 'Please enter your feedback.'
                            },
                            'ranking':  {
                                'type':         'select',
                                'helper':       'Select your ranking.',
                                'optionLabels': [ 'Awesome!',
                                    'Its Ok',
                                    'Hmm...' ]
                            }
                        }
                    },
                    'postRender': function(control) {
                        control.childrenByPropertyId.name.getFieldEl().css('background-color', 'lightgreen');
                        console.log('Form rendered.');
                    }
                }
            })
            .job(1, 'alert', {
                name:        'TEST',
                description: 'testtestetstest',
                person:      { email: 'shagman@g.harvard.edu' }
            })
            .done()
            .then(flow => done())
            .catch(err => error(err))
        ;
    });

}


