# Workflow Engine

A workflow engine.



## Setup

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