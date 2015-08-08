export default function(app, cas, mongo) {

    let connection = mongo.connection;

    // Protect all API requests with the CAS blocker. Unauthorized users will
    // receive a 401 Unauthorized response.
    app.use('/api', cas.block);
    app.use('/app', cas.block);

    app.get('/api/user', (req, res) => {
        connection.model('user').getOne(req.session.cas_user, (data) => { res.json(data); });
    });

    app.get('/api/items', (req, res) => {
        connection.model('item').getAll((data) => { res.json(data); });
    });

    app.get('/api/items/:itemId', (req, res) => {
        connection.model('item').getOne(req.params.itemId, (data) => { res.json(data); });
    });
}
