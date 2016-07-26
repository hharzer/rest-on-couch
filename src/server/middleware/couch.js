'use strict';

const assert = require('assert');

const auth = require('./auth');
const config = require('../../config/config').globalConfig;
const getConfig = require('../../config/config').getConfig;
const Couch = require('../../index');
const debug = require('../../util/debug')('middleware:couch');
const views = require('../../design/views');

const couchNeedsParse = ['key', 'startkey', 'endkey'];

const statusMessages = {
    '404': 'not found',
    '401': 'unauthorized',
    '409': 'conflict',
    '500': 'internal server error'
};

exports.setupCouch = function*(next) {
    const dbname = this.params.dbname;
    this.state.dbName = dbname;
    this.state.userEmail = yield auth.getUserEmail(this);
    this.state.couch = Couch.get(dbname);
    processCouchQuery(this);
    yield next;
};

exports.tokenLookup = function* (next) {
    if (this.query.token) {
        this.query.token = yield this.state.couch.getToken(this.query.token);
    }
    yield next;
};

exports.getDocumentByUuid = function*() {
    try {
        const doc = yield this.state.couch.getEntryByUuid(this.params.uuid, this.state.userEmail, this.query);
        this.status = 200;
        this.body = doc;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.updateEntry = function * () {
    const body = this.request.body;
    if (body) body._id = this.params.uuid;
    try {
        const result = yield this.state.couch.insertEntry(body, this.state.userEmail, {isUpdate: true});
        assert.strictEqual(result.action, 'updated');
        this.body = result.info;
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.deleteEntry = function*() {
    try {
        yield this.state.couch.deleteEntryByUuid(this.params.uuid, this.state.userEmail);
        this.body = {
            ok: true
        };
    } catch (e) {
        onGetError(this, e);
    }
};

exports.newOrUpdateEntry = function * () {
    try {
        const options = {};
        if (this.request.body.$owners) {
            options.groups = this.request.body.$owners;
        }
        const result = yield this.state.couch.insertEntry(this.request.body, this.state.userEmail, options);
        this.body = result.info;
        if (result.action === 'created') {
            this.status = 201;
            this.set('Location', `${this.state.urlPrefix}db/${this.state.dbName}/entry/${result.info.id}`);
        } else {
            this.status = 200;
        }
    } catch (e) {
        onGetError(this, e);
    }
};

exports.deleteAttachment = function * () {
    this.body = yield this.state.couch.deleteAttachmentByUuid(this.params.uuid, this.state.userEmail, this.params.attachment);
};

exports.saveAttachment = function * () {
    try {
        this.body = yield this.state.couch.addAttachmentByUuid(this.params.uuid, this.state.userEmail, {
            name: this.params.attachment,
            data: this.request.body,
            content_type: this.get('Content-Type')
        });
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getAttachmentById = function*() {
    try {
        const stream = yield this.state.couch.getAttachmentByIdAndName(this.params.id, this.params.attachment, this.state.userEmail, true, this.query);
        this.status = 200;
        this.body = stream;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getAttachmentByUuid = function*() {
    try {
        const stream = yield this.state.couch.getAttachmentByUuidAndName(this.params.uuid, this.params.attachment, this.state.userEmail, true, this.query);
        this.status = 200;
        this.body = stream;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.allEntries = function*() {
    try {
        const right = this.query.right || 'read';
        const entries = yield this.state.couch.getEntriesByUserAndRights(this.state.userEmail, right, this.query);
        this.status = 200;
        this.body = entries;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.queryEntriesByUser = function*() {
    try {
        this.body = yield this.state.couch.queryEntriesByUser(this.state.userEmail, this.params.view, this.query);
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.queryEntriesByRight = function*() {
    try {
        this.body = yield this.state.couch.queryEntriesByRight(this.state.userEmail, this.params.view, this.query.right, this.query);
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.entriesByKindAndId = function * () {
    try {
        for (let i = 0; i < couchNeedsParse.length; i++) {
            let queryParam = this.query[couchNeedsParse[i]];
            let bodyParam = this.request.body[couchNeedsParse[i]];
            if (queryParam || bodyParam) {
                this.query[couchNeedsParse[i]] = [this.params.kind, queryParam ? queryParam : bodyParam];
            }
        }

        this.body = yield this.state.couch.queryEntriesByUser(this.state.userEmail, 'entryByKindAndId', this.query);
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};


exports.entriesByOwnerAndId = function * () {
    try {
        for (let i = 0; i < couchNeedsParse.length; i++) {
            let queryParam = this.query[couchNeedsParse[i]];
            let bodyParam = this.request.body[couchNeedsParse[i]];
            if (queryParam || bodyParam) {
                this.query[couchNeedsParse[i]] = [this.params.email, queryParam ? queryParam : bodyParam];
            }
        }
        this.body = yield this.state.couch.queryEntriesByUser(this.state.userEmail, 'entryByOwnerAndId', this.query);
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getUser = function * () {
    try {
        this.body = yield this.state.couch.getUser(this.state.userEmail);
        this.status = 200;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.editUser = function * () {
    try {
        this.body = yield this.state.couch.editUser(this.state.userEmail, this.request.body);
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getOwnersByUuid = function*() {
    try {
        const doc = yield this.state.couch.getEntryByUuid(this.params.uuid, this.state.userEmail);
        this.body = doc.$owners;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.addOwnerByUuid = function*() {
    try {
        yield this.state.couch.addGroupToEntryByUuid(this.params.uuid, this.state.userEmail, this.params.owner);
        this.body = {ok: true};
    } catch (e) {
        onGetError(this, e);
    }
};

exports.removeOwnerByUuid = function*() {
    try {
        yield this.state.couch.removeGroupFromEntryByUuid(this.params.uuid, this.state.userEmail, this.params.owner);
        this.body = {ok: true};
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getGroup = function*() {
    try {
        this.body = yield this.state.couch.getGroup(this.params.name, this.state.userEmail);
    } catch (e) {
        onGetError(this, e);
    }
};

/* todo implement it
exports.createOrUpdateGroup = function *() {
    try {
        const group = yield this.state.couch.getGroup(this.params.name, this.state.userEmail);

    } catch (e) {
        if (e.reason === 'not found') {
            try {
                yield this.state.couch.createGroup(this.params.name, this.state.userEmail, this.body.rights);
            } catch (e) {
                onGetError(this, e);
            }
        } else {
            onGetError(this, e);
        }
    }
};*/


exports.deleteGroup = function *() {
    try {
        yield this.state.couch.deleteGroup(this.params.name, this.state.userEmail);
    } catch (e) {
        onGetError(this, e);
    }
};

exports.createEntryToken = function* () {
    try {
        const token = yield this.state.couch.createEntryToken(this.state.userEmail, this.params.uuid);
        this.status = 201;
        this.body = token;
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getTokens = function* () {
    try {
        this.body = yield this.state.couch.getTokens(this.state.userEmail);
    } catch (e) {
        onGetError(this, e);
    }
};

exports.getTokenById = function* () {
    try {
        this.body = yield this.state.couch.getToken(this.params.tokenid);
    } catch (e) {
        onGetError(this, e);
    }
};

exports.deleteTokenById = function* () {
    try {
        yield this.state.couch.deleteToken(this.state.userEmail, this.params.tokenid);
        this.body = {ok: true};
    } catch (e) {
        onGetError(this, e);
    }
};

function onGetError(ctx, e, secure) {
    switch (e.reason) {
        case 'unauthorized':
            if (!secure) {
                ctx.status = 401;
                ctx.body = statusMessages[401];
                break;
            }
            // fallthrough
        case 'not found':
            ctx.status = 404;
            ctx.body = statusMessages[404];
            break;
        case 'conflict':
            ctx.status = 409;
            ctx.body = statusMessages[409];
            break;
        default:
            if (!handleCouchError(ctx, e, secure)) {
                ctx.status = 500;
                ctx.body = statusMessages[500];
                debug.error(e + e.stack);
            }
            break;
    }
    if (config.debugrest) {
        ctx.body += '\n\n' + e + '\n' + e.stack;
    }
}

function handleCouchError(ctx, e, secure) {
    if (e.scope !== 'couch') return;
    var statusCode = e.statusCode;
    if (statusCode) {
        if (statusCode === 404 && secure) {
            statusCode = 401;
        }

        if (statusCode === 500) {
            debug.error(e + e.stack);
        }

        ctx.status = statusCode;
        ctx.body = statusMessages[statusCode] || `error ${statusCode}`;
        return true;
    }
}


function processCouchQuery(ctx) {
    for (let i = 0; i < couchNeedsParse.length; i++) {
        if (ctx.query[couchNeedsParse[i]]) {
            try {
                ctx.query[couchNeedsParse[i]] = JSON.parse(ctx.query[couchNeedsParse[i]]);
            } catch (e) {
                // Keep original value if parsing failed
            }
        }
    }
    if (ctx.query.limit !== undefined) {
        ctx.query.limit = +ctx.query.limit;
        if (Number.isNaN(ctx.query.limit)) {
            ctx.query.limit = undefined;
        }
    }
    processQuery(ctx);
}

function processQuery(ctx) {
    if (!ctx.params.view || !ctx.query.query) return;

    var query = ctx.query;
    var q = query.query;
    query.key = undefined;
    query.startkey = undefined;
    query.endkey = undefined;
    var match;

    var type = getViewType(ctx);

    if ((match = q.match(/^([<>=]{1,2})([^<>=]+)$/))) {
        if (match[1] === '<') {
            query.startkey = '';
            query.endkey = match[2];
            query.inclusive_end = false;
        } else if (match[1] === '<=' || match[1] === '=<') {
            query.startkey = '';
            query.endkey = match[2];
        } else if (match[1] === '>' || match[1] === '>=' || match[1] === '=>') {
            query.startkey = match[2];
            if (type !== 'number') {
                query.endkey = '\ufff0';
            }
        } else if (match[1] === '==' || match[1] === '=') {
            query.key = match[2];
        }
    } else if ((match = q.match(/^(.+)\.\.(.+)$/))) {
        query.startkey = match[1];
        query.endkey = match[2];
    } else {
        if (type === 'string') {
            query.startkey = q;
            query.endkey = q + '\ufff0';
        } else {
            query.key = q;
        }
    }

    try {
        if (type) {
            applyType(query, type);
        }
    } catch (e) {
        debug.warn('Could not apply type to query');
    }
}

function applyType(query, type) {
    for (var i = 0; i < couchNeedsParse.length; i++) {
        if (query[couchNeedsParse[i]] !== undefined) {
            switch (type) {
                case 'string':
                    query[couchNeedsParse[i]] = String(query[couchNeedsParse[i]]);
                    break;
                case 'number':
                    query[couchNeedsParse[i]] = +query[couchNeedsParse[i]];
                    break;
            }
        }
    }
}

function getViewType(ctx) {
    var view = views[ctx.params.view];
    if (view && view.type) {
        return view.type;
    } else {
        var customDesign = getConfig(ctx.params.dbname).customDesign;
        if (customDesign && customDesign.views && customDesign.views[ctx.params.view]) {
            return customDesign.views[ctx.params.view].type;
        }
    }
}
