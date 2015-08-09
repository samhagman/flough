# Flough - A job orchestration framework.


## About

Flough was created as a way to quickly build, update, and maintain chains of jobs.  Flough uses [Kue](https://github.com/Automattic/kue) and MongoDB under the hood (MongoDB will be replaceable with any other persistent storage in a future version).  More information about the internal workings of Flough can be found in [STRUCTURE.md](https://github.com/samhagman/flough/blob/master/STRUCTURE.md).

## Usage

There are two main building blocks to Flough: Jobs and Flows.
*Jobs* are functions that are queued into [Kue](https://github.com/Automattic/kue) and are generally single purpose.
*Flows* are chains of jobs that are grouped into steps and substeps.

### Jobs

A job is started like so:

```js
// Assuming Flough has been initialized
Flough.startJob('get_website_html', { url: 'samhagman.com' }).then(function(job) { job.save(); }));
```
Yeah I know the usage here is a little wonky but it is what it is for now.  `job` here is a *non-modified* Kue job.

This would start a job with a type of `get_website_html` which had been _previously_ registered like so:

```js
// Assuming Flough has been initialized
Flough.registerJob('get_website_html', function(job, done, error) {

    console.log(job.data.url); // Prints "samhagman.com"

    Website.getAsync(job.data.url, function(err, html) {
        
        if (error) {
            error(err);
        }
        else {
            console.log({ result: html });
            done(html);
        }
    });
});
```

As you can see creating and starting single jobs is easy enough.
When registering a job you get three parameters injected into your function: `job`, `done`, and `error`.

`job` is a slightly modified [Kue](https://github.com/Automattic/kue) job and still retains all functions available to that object; look at the [Kue](https://github.com/Automattic/kue) documentation for more about job events, job progress, job priorities, etc.

The big differences are the automatic injection of several fields onto the `job.data` object and the addition of the `job.jobLogger(job.data.uuid, 'My job log message')` function which is an upgraded version `job.log('My message')` that will save messages to both Redis and MongoDB.  More information can be found in [Structure.md](https://github.com/samhagman/flough/blob/master/STRUCTURE.md).

`done` is a function that is called to let Flough know that your job has completed.  Any JSON-_able_ object passed to this function will
be inserted into the `job.data._results` object and the previous job's result will be easily reachable at `job.data._lastResult`.
  
`error` is a function that lets Flough know that your job has failed. Currently passing an error instance or a string to `error` does nothing but will eventually be passed to the next job as well and/or trigger another cleanup job to run.


### Flows
I am going to use a completely useful example of wanting to get a website's HTML and then tweet that (or at least what will fit in a tweet) at me.

Before showing off a flow lets register another job so we can chain them together in a flow:

```js
// Assuming Flough has been initialized
Flough.registerJob('tweet_something', function(job, done, error) {
    
    Twitter.tweet({
        message: job.data._lastResult.result, // Equals the previous jobs returned html
        handle: job.data.handle               // Equals '@hagmansam'
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

```js
// Assuming Flough has been initialized
Flough.startFlow('get_html_and_tweet_it', { url: 'samhagman.com' }).then(function(flowJob) { flowJob.save(); }));
```

Which will start the flow with a type of `get_html_and_tweet_it` that was registered like so:

```js
// Assuming Flough has been initialized
Flough.registerFlow('get_html_and_tweet_it', function(flow, done, error) {

    flow.init()
        .job(1, 'get_website_html', { url: flow.data.url })
        .job(2, 'tweet_something', { handle: '@hagmansam' })
        .done()
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

- The injected `flow` must be initialized with `.init()` and then ended with a `.done()` after all `.job()`s have been called on the flow.

- `flow.job()` is the same as `.startJob()` except it takes a number as its first parameter which is its *step* number.  More on this later.

- `.done()` returns a promise which will resolve when all the jobs have completed and injects the flow instance itself into the function.

- Because `.done()` returns a promise, `.catch()` is also callable off of it, the error that appears here will be _any_ error that is not handled in the jobs or was explicitly returned by calling `error()` inside of a job.


### Initializing a Flough Instance

TODO

## Additional Features

### Substeps

Example:
```js
flow.init()
    .job(1, 'read_a_file')
    .job(1, 'send_an_email)
    .job(2, 'write_a_file')
    .done()
```
_Note: `.job()` and `.startJob()` do not require a data object to be passed in._

In the above example both of the jobs with a step of 1 (`read_a_file` and `send_an_email`)  will be run in parallel.  When both of these jobs are complete then `write_a_file` will start.  There can be any number of steps and substeps in a flow.


### Flow/Job Restarts

If for some reason (on purpose or otherwise) the node server is restarted, all the Flows that were sitting in memory will be gone!  But don't fear!  All the Flows and the Solo Jobs (jobs started with `.startJob()`) that were in progress (AKA not complete) will be restarted automatically.

But even better is that Flows have some special tricks when they restart:
- Flows will restart but they will skip all the steps that have already completed.  So in the above example if step 1 was done, but step 2 was not, then the Flow would restart and jump straight to step 2 without redoing step 1.

- Substeps will also not be repeated on Flow restart.  So if in the above example `read_a_file` had completed but `send_an_email` had not, then on Flow restart `read_a_file` would not be run again and `send_an_email` would be retried.


### Flough Events

The `Flough` instance, once initialized, will emit some events.

1. `Flough` will emit all events that the [Kue queue](https://github.com/Automattic/kue#queue-events) would emit.

2. `Flough` will also emit a bunch of special events that allow you to listen for specific jobs, specific types of jobs, or specific flows:

These special events are emitted in the following format: `some_identifier:some_event` where `some_identifier` can be `job.data.uuid`, `job.type` or `job.data.flowId` and `some_event` can be one of [Kue's job events](https://github.com/Automattic/kue#job-events).



## Running Tests 
- Install [Node.js](http://nodejs.org/).

- Install [Bower](http://bower.io/) and [Gulp](http://gulpjs.com/) globally:

```sh
npm install -g bower gulp
```

- Clone the Git repository and install the dependencies:

```sh
$ git clone git@bitbucket.org:harvardseasdev/workflow-engine.git
$ cd seas-node-angular-base
$ npm install
$ bower install
```

- Install [Redis](http://redis.io/).

- Install [MongoDB](https://www.mongodb.org/).

- Setup MongoDB users:

Run MongoDB using a replica set:
```sh
mongod --replSet test
```

Open a new terminal tab/window and run:
```sh
mongo
> var config = {_id: "test", members: [{_id: 0, host: "127.0.0.1:27017"}]}
> rs.initiate(config)
> use workflow
> use local
> use admin
> db.createUser({
  user: "baseUser",
  pwd: "basePwd",
  roles: [ { role: "userAdminAnyDatabase", db: "admin" }, {role: "root", db: "admin"}, {role: "clusterAdmin", db: "admin"}, { role: "readWrite", db: "workflow"} ]
 })
```

This concludes initial setup. Read on for how to build the project and run the server.

### Build Process

This project uses [Gulp](http://gulpjs.com/) to run its build process. All build-related files are located in the `gulp` folder. The configuration for the build process is `gulp/config.js`. Whenever vendor files are installed with Bower and are needed by the project, they should be added to the *VENDOR_FILES* object in the configuration file.

The build process exposes the following commands:

```
npm run build
npm run dev
npm run compile
```

`build`: Builds the project for development and puts it in the *BUILD_DIRECTORY* (`build` by default).
`dev`: Builds the project for development and launches the server. If any changes are made to client files, those files are rebuilt and a LiveReload is triggered. If any changes are made to server files, the server is relaunched.
`compile`: Builds the project for production and puts it in the *COMPILE_DIRECTORY* (`compile` by default).

### Running the Server

To run the server, simply use the following command:

```
npm run start
```

The server will be started and logs will be stored in `src/server/logs`.


## Development

Before running `npm run dev` make sure MongoDB and Redis are both running.  To run them open two terminal windows and type in each one respectively:
```sh
mongod --replSet test
```
```sh
redis-server
```

These two will need to be running while you are developing. (And obviously in production.)

This project compiles client code using [Browserify](http://browserify.org/) and transpiles the source with [Babel](https://babeljs.io/). The server is also run under Babel, so feel free to modularize and use ES6 features throughout.

### Linting / Code Style

Code is linted with JSHint, the settings for which can be found in .jshintrc. There is also a .jscsrc file. This can be used to check code style with JSCS (either from the command line or with an IDE). It is recommended but not enforced by the build process.

### Documentation

Documentation is not strictly enforced and no documentation generator is currently used but it is recommended that everything be documented following the conventions of [JSDoc](http://usejsdoc.org/). For Angular-specific conventions, see [ngDoc](http://www.chirayuk.com/snippets/angularjs/ngdoc).

### Testing

...