let express = require('express');

export default function(app, cas, mongo) {

    // Set up CAS routes.
    app.get('/logout', cas.logout);
    app.get('/authenticate', cas.bounce_redirect);

    // Set up static file serving.
    app.use('/app', express.static(CONFIG.EXPRESS.STATIC_DIR));

    //// Set up application index.
    //app.get('/', (req, res) => {
    //    res.redirect('app/');
    //});
    app.get('/app', (req, res) => {
        res.redirect('app/index.html');
    });

    // Set up API.
    require('./api')(app, cas, mongo);
}
