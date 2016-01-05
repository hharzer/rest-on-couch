"use strict";
const proxy = require('koa-proxy');
const _ = require('lodash');
const auth = require('./../middleware/auth');
const constants = require('../../constants');
const couch = require('../middleware/couch');

const routesNoAuth    = ['/','/_uuids'];
const router = require('koa-router')();

exports.init = function(config) {
    for(var i=0; i<routesNoAuth.length; i++) {
        router.get(routesNoAuth[i], changeHost, proxy({
            url: constants.REST_COUCH_URL + routesNoAuth[i]
        }))
    }

    function *changeHost(next) {
        this.headers.host = config.couchHost;
        yield next;
    }

    return router;
};