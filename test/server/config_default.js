let path = require('path');

let CONFIG = {
    MONGO:   {
        URI:           'mongodb://127.0.0.1:27017/workflow',
        OP_LOG_URI:    'mongodb://127.0.0.1:27017/local',
        OPTIONS:       {
            db:     { native_parser: true },
            server: { poolSize: 5 },
            user:   'baseUser',
            pass:   'basePwd'
        },
        STORE_OPTIONS: {
            collection: 'sessions',
            stringify:  true
        }
    },
    EXPRESS: {
        DOMAIN:          'localhost',
        DEV_BUILD:       true,
        SESSION_SECRET:  'my super secret',
        TEMP_DIR:        '/var/tmp/'
    },
    SERVER:  {
        PROCESS_TITLE: 'seas-angular-base',
        HOST:          'localhost',
        PORT:          3020,
        LOG_LEVEL:     'DEBUG',
        LOG_DIR:       path.join(__dirname, 'logs'),
        APP_LOG:       path.join(__dirname, 'logs/app.log'),
        ERROR_LOG:     path.join(__dirname, 'logs/error.log'),
        PID_FILE:      path.join(__dirname, 'app.pid')
    },
    APP:     {
        DEFAULT_ROLE: {}
    },
    LOGGER:  {}
};

// Dynamic settings.
CONFIG.EXPRESS.API_URL = `http://${CONFIG.EXPRESS.DOMAIN}${(CONFIG.EXPRESS.DEV_BUILD ? `:${CONFIG.SERVER.PORT}` : '')}`;


export default CONFIG;