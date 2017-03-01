'use strict';

const Couch = require('../..');
const nanoPromise = require('../../src/util/nanoPromise');
const insertDocument = require('./insertDocument');

function destroy(nano, name) {
    return nanoPromise.destroyDatabase(nano, name);
}

function populate(db) {
    const prom = [];

    prom.push(insertDocument(db, {
        $type: 'entry',
        $owners: ['b@b.com', 'groupA', 'groupB'],
        $id: 'A',
        $content: {}
    }));

    return Promise.all(prom);
}

module.exports = function () {
    global.couch = new Couch({database: 'test3'});
    return global.couch.open()
        .then(() => destroy(global.couch._nano, global.couch._databaseName))
        .then(() => {
            global.couch = new Couch({
                database: 'test3',
                rights: {
                    create: ['anyuser']
                }
            });
            return global.couch.open();
        })
        .then(() => populate(global.couch._db));
};