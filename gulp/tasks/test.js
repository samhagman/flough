const gulp = require('gulp');
const shell = require('gulp-shell');
const CONFIG = require('../config.js');
const runSequence = require('run-sequence');


gulp.task('test:server', shell.task([
    './node_modules/.bin/babel-node ./test/server/initServerTests.js | faucet'
]));

gulp.task('test:client', shell.task([
    'browserify ./test/client/**/*.js | testling | faucet'
]));

gulp.task('test', () => {

    runSequence(
        'test:server',
        'test:client',
        () => {
            console.log('--------------');
            console.log('FINISHED TESTS');
            console.log('--------------');
        }
    );

});
