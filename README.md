# Flough - A job orchestration framework.
=========

## About

Flough was created as a way to quickly build, update, and maintain chains of jobs.  Flough uses [Kue](https://github.com/Automattic/kue) and MongoDB under the hood.  More information about the internal workings of Flough can be found in [STRUCTURE.md](https://github.com/samhagman/flough/blob/master/STRUCTURE.md).

## Table of Contents

### ["Quick" Start](https://github.com/samhagman/flough#quick-start-1)
- [Basic Initialization](https://github.com/samhagman/flough#basic-initialization)
- [Jobs](https://github.com/samhagman/flough#jobs)
- [Flows](https://github.com/samhagman/flough#flows)
- [execF](https://github.com/samhagman/flough#execF)

### [Additional Features](https://github.com/samhagman/flough#additional-features-1)
- [Substeps](https://github.com/samhagman/flough#substeps)
- [Flow/Job Cancellation](https://github.com/samhagman/flough#flowjob-cancellation)
- [Flow/Job Restarts](https://github.com/samhagman/flough#flowjob-restarts)
- [Flough Events](https://github.com/samhagman/flough#flough-events)
- [Flough Searching](https://github.com/samhagman/flough#flough-searching)

### [Initializing A Flough Instance](https://github.com/samhagman/flough#initializing-a-flough-instance-1)
[Initialization Options](https://github.com/samhagman/flough#flough-initialization-options)
- [searchKue](https://github.com/samhagman/flough#searchkue)
- [devMode](https://github.com/samhagman/flough#devmode)
- [cleanKueOnStartup](https://github.com/samhagman/flough#cleankueonstartup)
- [returnJobOnEvents](https://github.com/samhagman/flough#returnjobonevents)
- [logger](https://github.com/samhagman/flough#logger)
- [redis](https://github.com/samhagman/flough#redis)
- [storage](https://github.com/samhagman/flough#storage)



### ~~[Tests](https://github.com/samhagman/flough#tests-1)~~
- TODO


## "Quick" Start

There are two main building blocks to Flough: Jobs and Flows.
*Jobs* are functions that are queued into [Kue](https://github.com/Automattic/kue) and are generally single purpose.
*Flows* are chains of jobs that are grouped into steps and substeps.

### Installation

Flough is available as an [NPM module](https://www.npmjs.com/package/flough).

`npm install --save flough`

### Basic Initialization

Before beginning to build Jobs and Flows we need to initialize a Flough instance.  I assume that you have already installed MongoDB, that it is running, that you have created a database called `flough`, and have created a user that has 'readWrite' access to it.  This also crucially assumes that Redis is installed and is using the Redis default settings. With all that said, here is the most basic initialization:

```node
    FloughBuilder.init({
        storage: {
            type: 'mongo',
            uri: 'mongodb://127.0.0.1:27017/flough', // Default_MongoDB_URL/flough
            options: {
                db:     { native_parser: true },
                server: { poolSize: 5 },
                user:   'baseUser', // Whatever the user you made
                pass:   'basePwd'
            }
        }
    })
    .then(function(Flough) {
        // Flough === Flough Instance
    });
```

Once you have a `Flough` instance created you can begin building!  Checkout [Initializing A Flough Instance](https://github.com/samhagman/flough#initializing-a-flough-instance-1) for more initialization options.

### Jobs

A job is started like so:

```node
// Assuming Flough has been initialized
Flough.startJob('get_website_html', { url: 'samhagman.com' }).then(function(job) { job.save(); }));
```
Yeah I know the usage here is a little wonky but it is what it is for now.  

`job` here is a *slightly modified* Kue job object.

The above code would start a job with a type of `get_website_html` which had been _previously_ registered like so:

```node
// Assuming Flough has been initialized
Flough.registerJob('get_website_html', function(job, done, error) {

    console.log(job.data.url); // Prints "samhagman.com"

    Website.getAsync(job.data.url, function(err, html) {
        
        if (error) {
            error(err);
        }
        else {
            console.log({ result: html });
            done({html: html});
        }
    });
});
```

As you can see creating and starting single jobs is easy enough.
When registering a job you get three parameters injected into your function: `job`, `done`, and `error`.

`job` is a slightly modified [Kue](https://github.com/Automattic/kue) job and still retains all functions available to that object; look at the [Kue](https://github.com/Automattic/kue) documentation for more about job events, job progress, job priorities, etc.

The big differences are the automatic injection of several fields onto the `job.data` object and the addition of the `job.jobLogger()` function.

`done` is a function that is called to let Flough know that your job has completed.  Any JSON-_able_ object passed to this function will
be inserted into the `job.data._relatedJobs` object and the previous step's result(s) will be easily reachable at `job.data._lastStepResult`.
  
`error` is a function that lets Flough know that your job has failed. Currently passing an error instance or a string to `error` does nothing but will eventually be passed to the next job as well and/or trigger another cleanup job to run.


### Flows
A Flow is a chain of Jobs and/or Flows that contains steps and optionally [substeps](https://github.com/samhagman/flough#substeps).

I am going to use a completely useful example of wanting to get a website's HTML and then tweet that (or at least what will fit in a tweet) at me.

Before showing off a flow lets register another job so we can chain them together in a flow:

```node
// Assuming Flough has been initialized and you are NOT REQUIRING MONGOOSE IN YOUR APPLICATION
Flough.registerJob('tweet_something', function(job, done, error) {
    
    Twitter.tweet({
        message: job.data._lastStepResult.html, // Equals the previous jobs returned html
        handle: job.data.handle                 // Equals '@hagmansam'
    }, function(err) {
        
        if (err) {
            error(err);
        }
        else {
            done();
        }
    });
    
});
```
All this job does is take a twitter handle plus the previous job's returned JSON object and then tweets the `.result` field of that JSON object.

With that out of the way...

A flow is started like so:

```node
// Assuming Flough has been initialized
Flough.startFlow('get_html_and_tweet_it', { url: 'samhagman.com' }).then(function(flowJob) { flowJob.save(); }));
```

Which will start the flow with a type of `get_html_and_tweet_it` that was registered like so:

```node
// Assuming Flough has been initialized
Flough.registerFlow('get_html_and_tweet_it', function(flow, done, error) {

    flow.start()
        .job(1, 'get_website_html', { url: flow.data.url })
        .job(2, 'tweet_something', { handle: '@hagmansam' })
        .flow(3, 'star_flough_repo', { repo: 'samhagman/flough'})
        .end()
        .then(function(flow) {
            done();
        })
        .catch(function(err) {
            error(err);
        });

});
```
Several things to note about this flow:

- You can pass options to a flow as the second parameter to `.startFlow()` which are accessible inside the flow at `flow.data` very similarly to `job.data`.

- The injected `flow` must be initialized with `.start()` and then ended with a `.end()` after all `.job()`s,  `.flow()`s, and `.execF()`s have been called on the flow.

- `flow.job()` is the same as `.startJob()` except it takes a number as its first parameter which is its *step* number.  More on this later.

- `flow.flow()` is the same as `.startFlow()` except it takes a number as its first parameter which is its *step* number.  This entire flow (all steps, [substeps](https://github.com/samhagman/flough#substeps), `.job()`s, `.flow()`s and `.execF()`s) will have to be completed before it is considered finished.

- `.end()` returns a promise which will resolve when all the jobs have completed and injects the flow instance into the callback it takes as its only argument.

- Because `.end()` returns a promise, `.catch()` is also callable off of it, the error that appears here will be _any_ error that is not handled in the jobs or was explicitly returned by calling `error()` inside of a job.


### execF()

The `execF(Function([relatedJobs]))` function does what it says, it executes an arbitrary function.  Sometimes you don't want to go through all the trouble of registering a job or flow for something simple you want to do between two steps.  This allows you to do that.  **The function must return a Promise.** I recommend [Bluebird](http://bluebirdjs.com/docs/getting-started.html).
 
 Here is an example of `execF()` using our previous flow example:

```node
// Assuming Flough has been initialized
Flough.registerFlow('get_html_and_tweet_it', function(flow, done, error) {

    flow.start()
        .job(1, 'get_website_html', { url: flow.data.url })
        .job(2, 'tweet_something', { handle: '@hagmansam' })
        .flow(3, 'star_flough_repo', { repo: 'samhagman/flough'})
        .execF(2, function(relatedJobs) {
            return new Promise((resolve, reject) => {
            
                // If step 1, substep 1's result has an html field equal to '<h1> My Site </h1>' do nothing
                if (relatedJobs.1.1.html === '<h1> My Site </h1>') {
                    resolve();
                }
                else { // Otherwise cancel the flow
                    flowInstance.cancel();  // Asynchronous function
                    resolve();
                }
            });
        })
        .end()
        .then(function(flow) {
            done();
        })
        .catch(function(err) {
            error(err);
        });

});
```

## Additional Features

### Substeps

Example:
```node
flow.start()
    .job(1, 'read_a_file')
    .job(1, 'send_an_email)
    .job(2, 'write_a_file')
    .flow(3, 'restart_a_server')
    .end()
```
_Note: `.job()` and `.startJob()` do not require a data object to be passed in._

In the above example both of the jobs with a step of 1 (`read_a_file` and `send_an_email`)  will be run in parallel.  When both of these jobs are complete then `write_a_file` will start.  And finally when `write_a_file` is done, `restart_a_server` will run.  There can be any number of steps and substeps in a flow.

To emphasize, **steps run in series while substeps (`.job()` and/or `.flow()`s with same step number) run in parallel.**

Even fairly complex processes should be able to be modelled with steps, substeps, jobs and flows.


### Flow/Job Cancellation

In the [execF()](https://github.com/samhagman/flough#execF) example we showed an example of cancelling a flow.  Calling `flow.cancel()` will cancel the entire flow, and calling `job.cancel()` will cancel that particular job and any flow that it belonged to.  Currently, you cannot cancel a single step/job in a flow and continue the flow.

Cancelling a flow will do the following:

- Mark the flow as cancelled in MongoDB by setting the `isCancelled` field to `true`.

- Stop any further steps or substeps from running that haven't already started.

- Cancel any currently running asynchronous jobs using [Bluebird's cancellation feature](http://bluebirdjs.com/docs/api/cancellation.html#cancellation).


### Flow/Job Restarts

If for some reason (on purpose or otherwise) the node server is restarted, all the Flows that were sitting in memory will be gone!  But don't fear!  All the Flows and the Solo Jobs (jobs started with `.startJob()`) that were in progress (AKA not complete) will be restarted automatically.

But even better is that Flows have some special tricks when they restart:
- Flows will restart but they will skip all the steps that have already completed.  So in the above example if step 1 was done, but step 2 was not, then the Flow would restart and jump straight to step 2 without redoing step 1.

- Substeps will also not be repeated on Flow restart.  So if in the above example `read_a_file` had completed but `send_an_email` had not, then on Flow restart `read_a_file` would not be run again and `send_an_email` would be retried.


### Flough Events

The `Flough` instance, once initialized, will emit two categories of events:

1. `Flough` will emit all events that the [Kue queue](https://github.com/Automattic/kue#queue-events) would emit.

2. `Flough` will also emit a bunch of special events that allow you to listen for specific jobs, specific types of jobs, or specific flows:

These special events are emitted in the following format: `some_identifier:some_event` where `some_identifier` can be `job.data._uuid`, `job.type` or `job.data._flowId` and `some_event` can be one of [Kue's job events](https://github.com/Automattic/kue#job-events).


### Flough Searching

If when initializing `Flough` you pass the option `searchKue: true`, then some search promise functions will become available.
  
There are 3 search functions:

- `Flough.searchKue()`

This function uses [reds](https://github.com/tj/reds) under the hood and exposes just the `.query()` method of that library.

To use `Flough.searchKue()` you do something like this:

```node

// Assuming Flough has been initialized
Flough.search('term1 term2 term3')
        .then(function(jobsArray) {
                console.log(jobsArray) // Prints an array of job objects
        })
        .catch(function(err) {
                console.log(err) // Prints an error from .searchKue()
        });

```

What `.searchKue()` does is takes a string with space-separated search terms inside and looks for jobs that contain **ALL** of the search terms.  Note that the terms don't all need to appear in the same field, just at least once somewhere in the job.

To perform a search where you want all jobs that **contain at least one of the search terms** you can pass `true` as the second argument like so:
`Flough.search(string, true)`
This will use the `.type('or')` functionality of [reds](https://github.com/tj/reds).

- `Flough.searchJobs({ [jobIds], [jobUUIDs], [jobTypes], [completed = false], [_activeJobs = true]})`

This function will search the MongoDB collection directly.  It takes an object with several different possible fields that all search in an additive way (eg. jobIds && jobTypes).

Additionally there are the `completed` and `_activeJobs` fields which are set to default settings which return only completed jobs that are active in Kue.

- `Flough.searchFlows(flowUUID)`

This function will also search MongoDB and only accepts a single parameter which is the UUID of a flow.


### Job Logger

Signature: `job.jobLogger('My job log message', job.data._uuid, [job.id])`

The job logger is similar to [Kue's](https://github.com/Automattic/kue) `job.log('My message')` but it instead will persist logs to both redis and MongoDB.  This logger is attached to both the `job` and `flow` objects.  The first parameter is your message, the second parameter is the UUID of the job and the third is an optional parameter that takes the exact `job.id` of the job.  This third parameter can be useful when a job can not be found in MongoDB yet at the time of you calling this function.


### Dynamic Default Properties for Jobs and ~~Flows~~

*Note: Flows do not currently support this feature.*

Since jobs and flows are built to be reusable there is probably some default information that you want every job or flow to have rather than having to enter it every time you want to start a job or flow.  Dynamic Default Properties give you this option by allowing you to specify a function that will be run at job start time that returns an object to be merged with the data object you provided in the `.job('job_type', data_object)` call.  

This has two main benefits:

- Allows you to attach dynamic data to the job **before** it is put into queue.  This means that this data will be indexed and therefore searchable by `Flough.searchKue()` and that it will automatically get persisted to MongoDB without you having to manually put it there inside the job you register.

Also because you have access to the `job.data` **before** it is put into the queue, you have access to `job.data._uuid` which is the unique identification string that has been assigned to the job.  This allows you to use that UUID for whatever purposes you want for properties that you want to attach to `job.data`.

- Allows you to attach default properties to `job.data` that can be overridden by passing in that field in your data object in your `.job('job_type', data_object)`.

Here is an example:

```node
// Assuming Flough has been initialized
Flough.registerJob('tweet_job_uuid', function(job, done, error) {

    console.log(job.data.message)
    console.log(job.data.handle)
    Twitter.tweet({
        message: job.data.message
        handle: job.data.handle
    }, function(err) {

        if (err) {
            error(err);
        }
        else {
            done();
        }
    });

}, function(jobData) {
    return {
        message: 'This is job UUID, ' + jobData._uud,
        handle: '@nasa'
    };
});
```

```node

// Assuming Flough has been initialized
Flough.startJob('tweet_job_uuid', { handle: '@hagmansam' }).then(function(job) { job.save(); }));

// When the job starts the two console.log()s would print the following:
// Prints 'This is job UUID, 9d9f8g7d9df0f6s6d9f80`
// Prints '@hagmansam'
```
Here you can see that the default message was used and includes the job's UUID and the default handle of `@nasa` was overridden with the handle `@samhagman`.

Some things to note:

- The dynamic property function must be passed as the third argument of `Flough.registerJob()` like `Flough.registerJob('job_type', jobFunction, objectReturningFunction)`.

- The dynamic property function must return a JSONable object.



## Initializing a Flough Instance

Here is an example of fully setting up a Flough instance:

```node
// Require flough and get FloughBuilder
var FloughBuilder = require('flough')();

// Initialize express, redis, mongo, and mongoose
var app = require('express')();
var redisClient = require('redis').createClient();
var mongoose = require('mongoose');
var mongoConn = mongoose.createConnection(CONFIG.MONGO.URI, CONFIG.MONGO.OPTIONS);

// Create flough initialization options
var floughOptions = {
    redis:      {
        type:   'supplyClient',
        client: redisClient
    },
    storage:    {
        type:       'mongoose',
        connection: mongoConn,
        mongoose:   mongoose
    },
    expressApp: app,
    logger:     {
        func:     Logger,
        advanced: true
    },
    devMode:    true,
    searchKue:  true
};
    
// Initialize Flough
FloughBuilder.init(floughOptions)
    .then(Flough => {
    
        // Flough.registerJob(...)
        // Flough.registerFlow(...)
        // Flough.searchJobs(...)
        // Flough.searchFlows(...)
        // etc...
        
    });
```

Here is an example of a full `floughOptions` object with **the defaults shown**:

```node
var floughOptions = {
    searchKue: false,
    devMode: true,
    cleanKueOnStartup: true,
    returnJobOnEvents: true,

    logger: {
        func: console.log,
        advanced: false
    },
    
    redis: {
        type: 'default',
        host: '127.0.0.1',
        port: 6379
    },
    
    storage: {
        type: 'mongo',
        uri: 'mongodb://127.0.0.1:27017/flough', // Default_MongoDB_URL/flough
        options: {
            db:     { native_parser: true },
            server: { poolSize: 5 },
            user:   'baseUser', // Whatever the user you made
            pass:   'basePwd'
        }
    }
}
```

## Flough Initialization Options

### searchKue

`searchKue` is off by default. Turning on this option will allow you to search for jobs and flows that are in the Kue queue.  It is off by default because it can cause some problems if you have a high number of jobs and don't manually clean Redis often.  [Read more about the downsides here](https://github.com/Automattic/kue/issues/412).

### devMode

`devMode` is on by default.  `devMode` being on has two side effects:

1. Flough will generate logs using the [logger](https://github.com/samhagman/flough/#logger).
2. Errors thrown by user registered jobs/flows will not be caught, which will cause the process to crash and allow you to debug your jobs/flows much easier.

The flip-side is that if `devMode` is turned off Flough will generate only generate error logs and errors will be caught and logged, but the process will not crash.

### cleanKueOnStartup

`cleanKueOnStartup` is on by default.  This option is highly recommended to keep on.  On server startup this option does two things:
1. Solo jobs (jobs not started by a flow) and flow jobs (jobs that represent a flow) are restarted if they failed or did not complete before the server was shutdown previously.
2. Helper jobs (jobs started by a flow) of any status are removed from the queue because they will be restarted by the flow when the flow is restarted.

Unless you want to tweak which jobs are removed and which jobs are restarted after digging into the code a bit, then keep this option on.

### returnJobOnEvents

`returnJobOnEvents` is on by default.  When turned on, the custom events emitted by Flough (no the Kue events) will also attach the entire Job itself to the event.  You might want to turn this off if you don't need the entire job and if you are listening to these events on a large scale.

### logger

`logger` is optional and has two fields.  The first field is `func` which allows you to inject your own logger to be used by Flough.  This will allow you to handle log messages (single argument, always a string) in whatever way you want.  The second field is `advanced` which lets you tell Flough whether or not your logger function supports ALL four of these functions:
- `logger.info()`
- `logger.debug()`
- `logger.warn()`
- `logger.error()`

which Flough will to help give more useful and intuitive log messages when developing.  Also `logger.error` is used even when `devMode` is turned off to log errors thrown by user registered jobs/flows.

### redis

`redis` allows you to control the redis connetion Flough will use and has two types. (The `'default'` type will be used if you don't choose a type and attempts to connect to Redis using its defaults)
1. `redis.type = 'supplyClient'` is where you create your own Redis connection and pass it directly to Flough onto `options.redis.client`.

2. `redis.type = 'supplyOptions'` is where you supply Flough with the connection options to connect to Redis.  The available options can be found [here](https://github.com/Automattic/kue#redis-connection-settings).

### storage

`storage` allows you to give Flough the persistent storage options you want to use for Flough.  Right now only MongoDB is supported.

`storage` types:

- 'options.storage.type = 'mongo'` looks exactly like what's shown in the [full options example](https://github.com/samhagman/flough#intializing-a-flough-instance).

- `options.storage.type = 'mongoose'` allows you to hand a mongoose connection (via `mongoose.createConnection()`) directly to Flough on `options.storage.connection`.  **Also important to note is that you should attach your mongoose library instance (`var mongoose = require('mongoose');`) to `options.storage.mongoose` because there are problems with mongoose where requiring mongoose in a npm module causes problems when creating Schemas inside the npm module, which is the case with Flough.**

# Tests

TODO

# License

**MIT License**

Copyright (c) 2015 Sam Hagman <https://www.samhagman.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.