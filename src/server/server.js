'use strict';

const http = require('http');
const path = require('path');

const compress = require('koa-compress');
const cors = require('kcors');
const Koa = require('koa');
const koaStatic = require('koa-static');
const passport = require('koa-passport');
const responseTime = require('koa-response-time');
const session = require('koa-session');
const hbs = require('koa-hbs');

const config = require('../config/config').globalConfig;
const debug = require('../util/debug')('server');
const initCouch = require('../initCouch');

const api = require('./routes/api');
const auth = require('./routes/auth');

const app = new Koa();

let _started;

app.use(async function (ctx, next) {
  debug.trace('Method: %s; Path: %s', ctx.method, ctx.path);
  await next();
});

app.use(compress());
app.use(responseTime());

// trust X-Forwarded- headers
app.proxy = config.proxy;

// support proxyPrefix in this.redirect()
let proxyPrefix = config.proxyPrefix;
debug('proxy prefix: %s', proxyPrefix);
if (proxyPrefix !== '') {
  const _redirect = app.context.redirect;
  app.context.redirect = function (url, alt) {
    if (typeof url === 'string' && url.startsWith('/')) {
      url = proxyPrefix + url;
    }
    return _redirect.call(this, url, alt);
  };
}

app.use(
  hbs.middleware({
    viewPath: path.join(__dirname, '../../views')
  })
);

app.use(koaStatic(path.resolve(__dirname, '../../public')));

const allowedOrigins = config.allowedOrigins;
debug('allowed cors origins: %o', allowedOrigins);
app.use(
  cors({
    origin: (ctx) => {
      const origin = ctx.get('Origin');
      for (var i = 0; i < allowedOrigins.length; i++) {
        if (allowedOrigins[i] === origin) {
          return origin;
        }
      }
      return '*';
    },
    credentials: true
  })
);

app.keys = config.keys;
app.use(
  session(
    {
      key: config.sessionKey,
      maxAge: config.sessionMaxAge,
      path: config.sessionPath,
      domain: config.sessionDomain,
      secure: config.sessionSecure,
      httpOnly: true,
      signed: config.sessionSigned
    },
    app
  )
);
app.use(passport.initialize());
app.use(passport.session());

app.use(async (ctx, next) => {
  await next();
  // Force a session change to renew the cookie
  ctx.session.time = Date.now();
});

app.use(async (ctx, next) => {
  ctx.state.pathPrefix = proxyPrefix;
  ctx.state.urlPrefix = ctx.origin + proxyPrefix;
  await next();
});

app.on('error', printError);

// Unhandled errors
if (config.debugrest) {
  // In debug mode, show unhandled errors to the user
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      ctx.status = err.status || 500;
      ctx.body = `${err.message}\n${err.stack}`;
      printError(err);
    }
  });
}

// Authentication
app.use(auth.routes());
// ROC API
app.use(api.routes());

module.exports.start = function () {
  if (_started) return _started;
  _started = new Promise(function (resolve, reject) {
    initCouch().then(
      () => {
        http.createServer(app.callback()).listen(config.port, function () {
          debug.warn('running on localhost: %d', config.port);
          resolve(app);
        });
      },
      (e) => {
        reject(e);
        process.nextTick(() => {
          debug.error('initialization failed');
          throw e;
        });
      }
    );
  });
  return _started;
};

module.exports.app = app;

function printError(err) {
  debug.error('unexpected error', err.stack || err);
}
