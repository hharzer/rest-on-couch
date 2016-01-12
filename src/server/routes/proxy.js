"use strict";
const proxy = require('koa-proxy');
const couchUrl = require('../../config/config').globalConfig.url;

const routesNoAuth    = ['/','/_uuids'];
const router = require('koa-router')();

exports.init = function(config) {
    for(var i=0; i<routesNoAuth.length; i++) {
        router.get(routesNoAuth[i], changeHost, proxy({
            url: couchUrl + routesNoAuth[i]
        }))
    }

    function *changeHost(next) {
        this.headers.host = config.couchHost;
        yield next;
    }

    return router;
};
