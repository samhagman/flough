let pkg = require('../package.json');

const CONFIG = {

    SOURCE_FILES: {
        DIRECTORY: 'test',
        JS: {
            ALL: '**/*.js',
            SERVER: {
                ALL: 'server/**/*.js',
                ENTRY: 'server/index.js'
            }
        }
    },

    CLIENT_TEST_DIR: 'test/client/**/*.js',
    SERVER_TEST_DIR: 'test/server/**/*.js',

    FILENAME: `${pkg.name}-${pkg.version}`
};

export default CONFIG;