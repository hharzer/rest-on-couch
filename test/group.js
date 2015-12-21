'use strict';

const data = require('./data/data');

describe('group methods', function () {
    before(data);
    it('anyone should be able to create a group', function () {
        return couch.createGroup('groupX', 'a@a.com').should.be.fulfilled();
    });

    it('cannot create if the group exists', function () {
        return couch.createGroup('groupA', 'a@a.com').should.be.rejectedWith(/already exists/);
    });

    it('cannot delete group if user is not the owner of the group', function () {
        return couch.deleteGroup('groupA', 'b@b.com').should.be.rejected();
    });

    it('should delete a group', function () {
        return couch.deleteGroup('groupA', 'a@a.com').should.be.fulfilled();
    });
});