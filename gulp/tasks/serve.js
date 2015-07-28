let path        = require('path');
let gulp        = require('gulp');
let changed     = require('gulp-changed');
let jshint      = require('gulp-jshint');
let jscs        = require('gulp-jscs');
let nodemon     = require('gulp-nodemon');
let livereload  = require('gulp-livereload');

let CONFIG = require('../config.js');

gulp.task('server:lint', function() {
    //TODO:use build config for paths
    return gulp.src('src/server/**/*.js')
        .pipe(changed('src/server'))
        .pipe(jshint())
        .pipe(jshint.reporter('default'))
        .pipe(jscs());
});

gulp.task('serve', [ 'watch', 'server:lint' ], function() {

    let serverEntry = path.join(
        CONFIG.SOURCE_FILES.DIRECTORY,
        CONFIG.SOURCE_FILES.JS.SERVER.ENTRY
    );
    let serverFiles = path.join(
        CONFIG.SOURCE_FILES.DIRECTORY,
        CONFIG.SOURCE_FILES.JS.SERVER.ALL
    );

    return nodemon({
        script  : serverEntry,
        watch   : serverFiles,
        ext     : 'js json'/*,
        execMap : { js: 'node --harmony' }*/
    })
        .on('start', () => {
            console.log('Watching for changes to server files...');
        })
        .on('change', [ 'server:lint' ])
        .on('restart', () => {
            console.log('Changes to server files detected. Restarting server.');
            setTimeout(livereload.changed, 2000);
        });
});