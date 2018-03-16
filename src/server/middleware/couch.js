'use strict';

const assert = require('assert');

const compose = require('koa-compose');

const request = require('../../util/requestPromise');

const config = require('../../config/config').globalConfig;
const getConfig = require('../../config/config').getConfig;
const Couch = require('../../index');
const debug = require('../../util/debug')('middleware:couch');
const views = require('../../design/views');
const CouchError = require('../../util/CouchError');

const auth = require('./auth');
const decorateError = require('./decorateError');
const respondOk = require('./respondOk');

const couchNeedsParse = ['key', 'startkey', 'endkey'];
const invalidDbName = 'invalid database name';
exports.setupCouch = async (ctx, next) => {
  const dbname = ctx.params.dbname;
  ctx.state.dbName = dbname;
  ctx.state.userEmail = ctx.query.asAnonymous
    ? 'anonymous'
    : await auth.getUserEmail(ctx);
  try {
    ctx.state.couch = Couch.get(dbname);
  } catch (e) {
    if (e.message === invalidDbName) {
      onGetError(ctx, new CouchError(invalidDbName, 'forbidden'));
      return;
    }
  }
  processCouchQuery(ctx);
  await next();
};

exports.tokenLookup = async (ctx, next) => {
  if (ctx.query.token) {
    try {
      ctx.query.token = await ctx.state.couch.getToken(ctx.query.token);
    } catch (e) {
      if (e.reason === 'not found') {
        onGetError(ctx, new CouchError('token not found', 'unauthorized'));
      } else {
        onGetError(ctx, e);
      }
      return;
    }
  }
  await next();
};

exports.getAllDbs = async (ctx) => {
  let allDbs = await request.get(`${config.url}/_all_dbs`, { json: true });
  allDbs = allDbs.filter((dbname) => !dbname.startsWith('_'));
  const result = [];
  for (const dbname of allDbs) {
    const db = Couch.get(dbname);
    try {
      await db.open(); // eslint-disable-line no-await-in-loop
      result.push(dbname);
    } catch (e) {
      // ignore error (means that database is not handled by ROC)
    }
  }
  ctx.body = result;
};

exports.getDocument = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getEntry(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.query
  );
});

exports.updateEntry = composeWithError(async (ctx) => {
  const body = ctx.request.body;
  if (body) body._id = ctx.params.uuid;
  const result = await ctx.state.couch.insertEntry(body, ctx.state.userEmail, {
    isUpdate: true
  });
  assert.strictEqual(result.action, 'updated');
  ctx.body = result.info;
});

exports.deleteEntry = composeWithError(async (ctx) => {
  await ctx.state.couch.deleteEntry(ctx.params.uuid, ctx.state.userEmail);
  respondOk(ctx);
});

exports.newOrUpdateEntry = composeWithError(async (ctx) => {
  const options = {};
  if (ctx.request.body.$owners) {
    options.groups = ctx.request.body.$owners;
  }
  const result = await ctx.state.couch.insertEntry(
    ctx.request.body,
    ctx.state.userEmail,
    options
  );
  ctx.body = result.info;
  if (result.action === 'created') {
    ctx.status = 201;
    ctx.set(
      'Location',
      `${ctx.state.urlPrefix}db/${ctx.state.dbName}/entry/${result.info.id}`
    );
  } else {
    ctx.status = 200;
  }
});

exports.deleteAttachment = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.deleteAttachment(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.params.attachment
  );
});

exports.saveAttachment = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.addAttachment(
    ctx.params.uuid,
    ctx.state.userEmail,
    {
      name: ctx.params.attachment,
      data: ctx.request.body,
      content_type: ctx.get('Content-Type')
    }
  );
});

exports.getAttachment = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getAttachmentByName(
    ctx.params.uuid,
    ctx.params.attachment,
    ctx.state.userEmail,
    true,
    ctx.query
  );
});

exports.allEntries = composeWithError(async (ctx) => {
  const right = ctx.query.right || 'read';
  ctx.body = await ctx.state.couch.getEntriesByUserAndRights(
    ctx.state.userEmail,
    right,
    ctx.query
  );
});

exports.queryEntriesByUser = composeWithError(async (ctx) => {
  if (ctx.query.reduce) {
    ctx.body = await ctx.state.couch.queryViewByUser(
      ctx.state.userEmail,
      ctx.params.view,
      ctx.query
    );
  } else {
    ctx.body = await ctx.state.couch.queryEntriesByUser(
      ctx.state.userEmail,
      ctx.params.view,
      ctx.query
    );
  }
});

exports.queryEntriesByRight = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.queryEntriesByRight(
    ctx.state.userEmail,
    ctx.params.view,
    ctx.query.right,
    ctx.query
  );
});

exports.entriesByKindAndId = composeWithError(async (ctx) => {
  for (let i = 0; i < couchNeedsParse.length; i++) {
    let queryParam = ctx.query[couchNeedsParse[i]];
    let bodyParam = ctx.request.body[couchNeedsParse[i]];
    if (queryParam || bodyParam) {
      ctx.query[couchNeedsParse[i]] = [
        ctx.params.kind,
        queryParam ? queryParam : bodyParam
      ];
    }
  }

  ctx.body = await ctx.state.couch.queryEntriesByUser(
    ctx.state.userEmail,
    'entryByKindAndId',
    ctx.query
  );
});

exports.entriesByOwnerAndId = composeWithError(async (ctx) => {
  for (let i = 0; i < couchNeedsParse.length; i++) {
    let queryParam = ctx.query[couchNeedsParse[i]];
    let bodyParam = ctx.request.body[couchNeedsParse[i]];
    if (queryParam || bodyParam) {
      ctx.query[couchNeedsParse[i]] = [
        ctx.params.email,
        queryParam ? queryParam : bodyParam
      ];
    }
  }
  ctx.body = await ctx.state.couch.queryEntriesByUser(
    ctx.state.userEmail,
    'entryByOwnerAndId',
    ctx.query
  );
});

exports.getUser = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getUser(ctx.state.userEmail);
});

exports.editUser = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.editUser(
    ctx.state.userEmail,
    ctx.request.body
  );
});

exports.getUserInfo = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getUserInfo(ctx.state.userEmail);
});

exports.getOwners = function (type) {
  return composeWithError(async (ctx) => {
    const doc = await ctx.state.couch.getDocByRights(
      ctx.params.uuid,
      ctx.state.userEmail,
      'read',
      type
    );
    ctx.body = doc.$owners;
  });
};

exports.addOwner = function (type) {
  return composeWithError(async (ctx) => {
    await ctx.state.couch.addOwnersToDoc(
      ctx.params.uuid,
      ctx.state.userEmail,
      ctx.params.owner,
      type
    );
    respondOk(ctx);
  });
};

exports.removeOwner = function (type) {
  return composeWithError(async (ctx) => {
    await ctx.state.couch.removeOwnersFromDoc(
      ctx.params.uuid,
      ctx.state.userEmail,
      ctx.params.owner,
      type
    );
    respondOk(ctx);
  });
};

exports.getGroup = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGroup(
    ctx.params.name,
    ctx.state.userEmail
  );
});

exports.createGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.createGroup(
    ctx.params.name,
    ctx.state.userEmail,
    null,
    ctx.query.type
  );
  respondOk(ctx);
});

exports.getGroups = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGroups(ctx.state.userEmail);
});

exports.getGroupUsers = composeWithError(async (ctx) => {
  const group = await ctx.state.couch.getDocByRights(
    ctx.params.uuid,
    ctx.state.userEmail,
    'read',
    'group'
  );
  ctx.body = group.users;
});

exports.getUserGroups = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getUserGroups(ctx.state.userEmail);
});

exports.addUserToGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.addUsersToGroup(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.params.username
  );
  respondOk(ctx);
});

exports.removeUserFromGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.removeUsersFromGroup(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.params.username
  );
  respondOk(ctx);
});

exports.getGroupRights = composeWithError(async (ctx) => {
  const group = await ctx.state.couch.getDocByRights(
    ctx.params.uuid,
    ctx.state.userEmail,
    'read',
    'group'
  );
  ctx.body = group.rights;
});

exports.addRightToGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.addRightsToGroup(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.params.right
  );
  respondOk(ctx);
});

exports.removeRightFromGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.removeRightsFromGroup(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.params.right
  );
  respondOk(ctx);
});

exports.getRights = composeWithError(async (ctx) => {
  const right = ctx.params.right;
  const uuid = ctx.params.uuid;
  ctx.body = await ctx.state.couch.hasRightForEntry(
    uuid,
    ctx.state.userEmail,
    right,
    ctx.query
  );
});

exports.deleteGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.deleteGroup(ctx.params.name, ctx.state.userEmail);
  respondOk(ctx);
});

exports.setGroupProperties = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.setGroupProperties(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.request.body
  );
});

exports.setLdapGroupProperties = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.setLdapGroupProperties(
    ctx.params.uuid,
    ctx.state.userEmail,
    ctx.request.body
  );
});

exports.syncLdapGroup = composeWithError(async (ctx) => {
  await ctx.state.couch.syncLdapGroup(ctx.params.uuid, ctx.state.userEmail);
  respondOk(ctx);
});

exports.getGlobalRights = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGlobalRights(ctx.state.userEmail);
});

exports.getGlobalRightsDoc = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGlobalRightsDocument(ctx.state.userEmail);
});

exports.getGlobalRightsDocUsers = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGlobalRightUsers(
    ctx.state.userEmail,
    ctx.params.right
  );
});

exports.addGlobalRightsDocUser = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.addGlobalRight(
    ctx.state.userEmail,
    ctx.params.right,
    ctx.params.user
  );
});

exports.removeGlobalRightsDocUser = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.removeGlobalRight(
    ctx.state.userEmail,
    ctx.params.right,
    ctx.params.user
  );
});

exports.getGlobalDefaultGroups = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getGlobalDefaultGroups(ctx.state.userEmail);
});

exports.setGlobalDefaultGroups = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.setGlobalDefaultGroups(
    ctx.state.userEmail,
    ctx.request.body
  );
});

exports.addGlobalDefaultGroup = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.addGlobalDefaultGroup(
    ctx.state.userEmail,
    ctx.params.user,
    ctx.params.group
  );
});

exports.removeGlobalDefaultGroup = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.removeGlobalDefaultGroup(
    ctx.state.userEmail,
    ctx.params.user,
    ctx.params.group
  );
});

exports.createEntryToken = composeWithError(async (ctx) => {
  const token = await ctx.state.couch.createEntryToken(
    ctx.state.userEmail,
    ctx.params.uuid
  );
  ctx.status = 201;
  ctx.body = token;
});

exports.createUserToken = composeWithError(async (ctx) => {
  const rights = ctx.query.rights ? ctx.query.rights.split(',') : undefined;
  const token = await ctx.state.couch.createUserToken(
    ctx.state.userEmail,
    rights
  );
  ctx.status = 201;
  ctx.body = token;
});

exports.getTokens = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getTokens(ctx.state.userEmail);
});

exports.getTokenById = composeWithError(async (ctx) => {
  ctx.body = await ctx.state.couch.getToken(ctx.params.tokenid);
});

exports.deleteTokenById = composeWithError(async (ctx) => {
  await ctx.state.couch.deleteToken(ctx.state.userEmail, ctx.params.tokenid);
  respondOk(ctx);
});

function onGetError(ctx, e, secure) {
  switch (e.reason) {
    case 'unauthorized':
      if (!secure) {
        decorateError(ctx, 401, e.message);
        break;
      }
    // fallthrough
    case 'not found':
      decorateError(ctx, 404, e.message);
      break;
    case 'conflict':
      decorateError(ctx, 409, e.message);
      break;
    case 'invalid':
      decorateError(ctx, 400, e.message);
      break;
    case 'forbidden':
      decorateError(ctx, 403, e.message);
      break;
    default:
      if (!handleCouchError(ctx, e, secure)) {
        decorateError(ctx, 500, e.message);
        debug.error(e + e.stack);
      }
      break;
  }
  if (config.debugrest) {
    ctx.body.stack = e.stack;
  }
}

function handleCouchError(ctx, e, secure) {
  if (e.scope !== 'couch') {
    return false;
  }
  var statusCode = e.statusCode;
  if (statusCode) {
    if (statusCode === 404 && secure) {
      statusCode = 401;
    }

    if (statusCode === 500) {
      debug.error(e + e.stack);
    }

    decorateError(ctx, statusCode, e.message);
    return true;
  }
  return false;
}

function processCouchQuery(ctx) {
  for (let i = 0; i < couchNeedsParse.length; i++) {
    if (ctx.query[couchNeedsParse[i]]) {
      try {
        ctx.query[couchNeedsParse[i]] = JSON.parse(
          ctx.query[couchNeedsParse[i]]
        );
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
      query.endkey = `${q}\ufff0`;
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
        default:
          throw new Error(`unexpected type: ${type}`);
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
    if (
      customDesign &&
      customDesign.views &&
      customDesign.views[ctx.params.view]
    ) {
      return customDesign.views[ctx.params.view].type;
    }
  }
  return 'unknown';
}

async function errorMiddleware(ctx, next) {
  try {
    await next();
  } catch (e) {
    onGetError(ctx, e);
  }
}

function composeWithError(middleware) {
  return compose([errorMiddleware, middleware]);
}
