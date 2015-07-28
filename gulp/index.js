let gulp = require('gulp');

require('./tasks/watch');
require('./tasks/serve');
require('./tasks/test');

gulp.task('default', ['watch']);