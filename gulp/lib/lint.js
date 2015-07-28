let gulp   = require('gulp');
let jshint = require('gulp-jshint');
//let jscs   = require('gulp-jscs');

/**
 * Lints the given glob with JSHint and JSCS. Returns the stream.
 * @param {string} glob
 * @returns {*}
 */
export default function lint(glob) {

    return gulp.src(glob)
        .pipe(jshint())
        .pipe(jshint.reporter('default'));
        //.pipe(jscs());
}
