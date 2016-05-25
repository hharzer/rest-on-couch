'use strict';

const LdapBindStrategy = require('./strategy');

const util = require('../../middleware/util');

exports.init = function (passport, router, config) {
    passport.use(new LdapBindStrategy(
        config,
        function (user, done) {
            done(null, {
                provider: 'ldapbind',
                email: user.mail
            });
        }
    ));

    router.post('/login/ldapbind', util.parseBody(), passport.authenticate('ldapbind', {
        successRedirect: '/auth/login',
        failureRedirect: '/auth/login'
    }));
};
