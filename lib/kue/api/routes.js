const kue = require('kue');
const Promise = require('bluebird');

export default function setupRoutes(app, mongoCon, redisClient) {

    let searchKue = require('../lib/search')(redisClient);
    //
    //setTimeout(() => {
    //    searchKue('TASK')
    //        .then((jobs) => console.log(jobs))
    //        .catch((err) => console.log(err));
    //
    //}, 7000);

    app.get('/api/kue/jobs', (req, res) => {
        searchKue('').then((results) => res.json(results));
    });

    app.get('/api/kue/jobs/position/:positionControlId', (req, res) => {
        searchKue(req.query.positionControlID).then((results) => {
            res.json(results)
        });
    });

    app.post('/api/kue/jobs/position', (req, res) => {
        searchKue(req.params.positionControlIDs.join(' ')).then((results) => res.json(results));
    });

    app.post('/api/kue/jobs/position/union', (req, res) => {
        searchKue(req.params.positionControlIDs.join(' '), true).then((results) => res.json(results));
    });

    app.get('/api/kue/jobs/person/:huid', (req, res) => {
        searchKue(req.query.huid).then((results) => res.json(results));
    });

    app.post('/api/kue/jobs/person', (req, res) => {
        searchKue(req.params.persons.join(' ')).then((results) => res.json(results));
    });

    app.post('/api/kue/jobs/person/union', (req, res) => {
        searchKue(req.params.persons.join(' '), true).then((results) => res.json(results));
    });


    //app.get('/api/kue/flow', (req, res) => {
    //    mongoCon.model('flow').getAll(req.session.cas_user, (data) => {
    //        res.json(data);
    //    });
    //});
    //
    //app.get('/api/kue/flow/position/:positionControlID', (req, res) => {
    //    mongoCon.model('flow').getAllByPosition(req.params.positionControlID, () => {
    //        res.json(data);
    //    });
    //});
    //
    //app.get('/api/kue/flow/person/:huid', (req, res) => {
    //    mongoCon.model('flow').getAllByPerson(req.params.huid, () => {
    //        res.json(data);
    //    });
    //});

}