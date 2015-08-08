let express = require('express');
let bodyParser = require('body-parser');
let cookieParser = require('cookie-parser');
let multer = require('multer');
let session = require('express-session');
let morgan = require('morgan');
let CASAuthentication = require('cas-authentication');

export default function(mongo, redisClient) {

    let app = express();

    // Set up third party Express middleware.
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());
    app.use(cookieParser('secret'));
    app.use(multer({ dest: CONFIG.EXPRESS.TEMP_DIR }));
    app.use(session({
        resave:            false,
        saveUninitialized: true,
        secret:            CONFIG.EXPRESS.SESSION_SECRET,
        store:             mongo.store
    }));
    app.use(morgan('combined', { stream: CONFIG.LOGGER.ACCESS }));

    morgan.token('remote-user', (req) => req.session.cas_user);

    // Set up CAS.
    var devUrl = 'https://im-dev.seas.harvard.edu';
    var prodUrl = CONFIG.EXPRESS.CAS_SERVICE_URL;
    var cas = new CASAuthentication({
        cas_version:     '1.0',
        cas_url:         'https://www.pin1.harvard.edu/cas',
        service_url:     CONFIG.EXPRESS.CAS_DEV_MODE ? devUrl : prodUrl,
        is_dev_mode:     CONFIG.EXPRESS.CAS_DEV_MODE,
        dev_mode_user:   CONFIG.EXPRESS.CAS_DEV_USER,
        session_name:    'cas_user',
        destroy_session: true
    });

    // Set up custom Express middleware.
    /*app.use(errorHandler);*/
    /*app.use(validateSession);*/

    // More Express configuration.
    app.enable('trust proxy');
    app.disable('etag');
    app.set('host', CONFIG.SERVER.HOST);
    app.set('port', CONFIG.SERVER.PORT);

    // Set up app routes.
    require('./routes')(app, cas, mongo);

    return app;
}

/*
 //------------------------------------------------------------------------------
 // Helper Functions
 //------------------------------------------------------------------------------

 function errorHandler(req, res, next) {

 var d = domain.create();

 d.add(req);
 d.add(res);

 d.on('error', (err) => {

 try {

 // Disconnect worker if it is connected.
 if(cluster.worker.isConnected()) {
 cluster.worker.disconnect();
 }

 // Try to close the server, but we can't wait forever. Force process
 // to quit after 5 minutes if the server has not closed yet.
 var forceQuit = setTimeout( process.exit, 1000 * 60 * 60 * 5 );

 // Try to close the server to allow the app to complete any open
 // requests and then quit the process.
 if( server ) {
 server.close( function () {
 clearTimeout( forceQuit );
 process.exit();
 });
 }

 // Try to send an error to the request that triggered the problem.
 res.statusCode = 500;
 res.setHeader( 'content-type', 'text/plain' );
 res.end( 'The server encountered a problem when attempting to fulfill your request!\n' );

 } catch ( err ) {

 console.error( 'Error sending 500!', err.stack );
 }
 });

 d.run( next );
 }

 function validateSession ( req, res, next ) {
 var openPaths = [ '/login','/login/','/','/logout','/logout/','/abounce','/abounce/' ];
 if( !req.session.cas_user && openPaths.indexOf( req.path ) < 0 ) {
 res.statusCode = 401;
 res.end( 'Unauthorized' );
 } else if( !req.session.userData && openPaths.indexOf( req.path ) < 0 ) {
 var user = require(__dirname + '/lib/user.js' )();
 user.getUserObject( req, res, function ( req, res, err, userObj ) {
 // Set all user data into cache is data was about currently logged in user.
 if( req.session.cas_user == userObj.huid ){
 req.session.userData = userObj;
 }
 next();
 });
 } else {
 next();
 }
 }*/