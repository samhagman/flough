let path       = require('path');
let gulp       = require('gulp');
let gutil      = require('gulp-util');
let browserify = require('browserify');
let babelify   = require('babelify');
let watchify   = require('watchify');
let source     = require('vinyl-source-stream');
let buffer     = require('vinyl-buffer');
let sourcemaps = require('gulp-sourcemaps');

let CONFIG = require('../config.js');

let lint = require('./lint.js');

/**
 * Runs Browserify on the client JS. If the watchify option is true, the files
 * are watched and updated when changes are made. Returns the stream.
 * @param {Object}  options
 * @param {boolean} options.watchify
 * @returns {*}
 */
export default function bundle(options) {

    let sourceDirectory = path.join(
        __dirname,
        '../..',
        CONFIG.SOURCE_FILES.DIRECTORY
    );
    let entryPath = path.join(
        sourceDirectory
    );

    // Set up the bundler.
    let bundler = browserify({
        entries: [ entryPath ],
        // This allows source files to be required without relative filepaths.
        paths: [ sourceDirectory ],
        transform: [ babelify ],
        debug: true,
        cache: {},
        packageCache: {},
        fullPaths: true
    });
    bundler.on('log', gutil.log);

    // If the watchify option is set, wrap the bundler with watchify.
    if (options.watchify) {
        bundler = watchify(bundler);
    }

    let bundle = function(changedFiles) {

        // If changed files are provided, only lint those.
        if (changedFiles) {
            lint(changedFiles);
        }
        // Otherwise, lint all client files.
        else {
            lint(path.join(sourceDirectory));
        }

        // Bundle the client files and return the stream.
        return bundler
            .bundle()
            .on('error', (err) => {
                gutil.log(gutil.colors.red('Browserify Error\n', err.message));
            })
            .pipe(source(`${CONFIG.FILENAME}.js`))
            .pipe(buffer())
            .pipe(sourcemaps.init({ loadMaps: true }))
            /*TODO: in production, uglify, etc. here*/
            .pipe(sourcemaps.write())
            .pipe(gulp.dest(CONFIG.BUILD_DIRECTORY));
    };

    // If the watchify option is set, rebundle on update.
    if (options.watchify) {
        bundler.on('update', bundle);
    }

    return bundle();
}
