'use strict';

const co = require('co');
const LocalStrategy = require('passport-local').Strategy;
const request = require('co-request');

const auth = require('../../middleware/auth');
const couchUrl = require('../../../config/config').globalConfig.url;

exports.init = function (passport, router) {
    passport.use(new LocalStrategy({
            usernameField: 'name',
            passwordField: 'password'
        },
        function (username, password, done) {
            co(function*() {
                var res = yield request.post(couchUrl + '/' + '_session', {
                    form: {
                        name: username,
                        password: password
                    }
                });
                if (res[0] instanceof Error) {
                    return done(res[0]);
                }
                res = JSON.parse(res.body);

                if (res.error) {
                    return done(null, false, res.reason);
                }
                done(null, {
                    email: res.name,
                    provider: 'local'
                });
            });
            //done(null, false, errMessage);
        }));

    router.post('/login/couchdb', passport.authenticate('local', {}), function*() {
        var name = yield auth.getUserEmail(this);
        this.body = JSON.stringify({
            ok: true,
            name
        });
    });
};
