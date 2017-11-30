'use strict';

const request = require('../setup').getFileDropAgent();
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const homedir = path.join(__dirname, '../homedir');

describe('drop file server', function () {
    afterEach(() => {
        rimraf.sync(path.join(homedir, 'test/kind1'));
    });
    it('api endpoint using query strings', function () {
        const buffer = new Buffer('test with query strings');
        return request.post('/upload?kind=kind1&database=test&filename=test 123')
            .send(buffer)
            .expect(200)
            .then(() => {
                const content = fs.readFileSync(path.join(homedir, 'test/kind1/to_process/test 123'), 'utf-8');
                content.should.equal('test with query strings');
            });
    });

    it('api endpoint using path paramaters', function () {
        const buffer = new Buffer('test with params');
        return request.post('/upload/test/kind1/test123')
            .send(buffer)
            .expect(200)
            .then(() => {
                const content = fs.readFileSync(path.join(homedir, 'test/kind1/to_process/test123'), 'utf-8');
                content.should.equal('test with params');
            });
    });

    it('sending a file twice should rename it with an incremental part', function () {
        const buffer = new Buffer('test conflict');
        return request.post('/upload?kind=kind1&database=test&filename=testConflict.txt')
            .send(buffer)
            .expect(200)
            .then(() => {
                return request.post('/upload?kind=kind1&database=test&filename=testConflict.txt')
                    .send(buffer)
                    .expect(200);
            }).then(() => {
                const content1 = fs.readFileSync(path.join(homedir, 'test/kind1/to_process/testConflict.txt'), 'utf-8');
                const content2 = fs.readFileSync(path.join(homedir, 'test/kind1/to_process/testConflict.txt.1'), 'utf-8');
                content1.should.equal('test conflict');
                content2.should.equal('test conflict');
            });
    });
});
