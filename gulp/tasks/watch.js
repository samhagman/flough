let path        = require('path');
let gulp        = require('gulp');
let livereload  = require('gulp-livereload');

let CONFIG = require('../config.js');

let bundle = require('../lib/bundle.js');

gulp.task('watch', function() {

    // Start listening for live reload.
    livereload.listen({ quiet: true });

    // Watch source assets. If an asset is changed or removed, be sure to delete
    // it before the build:assets task runs.
    let assetsPath = path.join(
        CONFIG.SOURCE_FILES.DIRECTORY
    );
    gulp.watch(assetsPath)
        .on('change', function(event) {
            if (event.type === 'renamed' || event.type === 'deleted') {
                let pathParts = (event.old || event.path).split(path.sep);
                let deletePath = pathParts
                    .slice(pathParts.indexOf('src') + 1)
                    .join(path.sep);
                gulp.src(deletePath, { cwd: CONFIG.BUILD_DIRECTORY })
                    .pipe(rimraf());
            }
        });

    console.log('Watching for changes to application files...');
});