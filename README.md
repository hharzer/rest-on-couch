# rest-on-couch

  [![NPM version][npm-image]][npm-url]
  [![build status][travis-image]][travis-url]
  [![David deps][david-image]][david-url]
  [![npm download][download-image]][download-url]

Interface to CouchDB that allows the control of permissions on the documents.

## Installation

`npm install rest-on-couch`

## Documentation

You can specify some options in the config file or using environment variables:

* config.url (REST_ON_COUCH_URL): URL of the database server
* config.database (REST_ON_COUCH_DATABASE): Name of the database
* config.username (REST_ON_COUCH_USERNAME): Username (needs admin access to the DB)
* config.password (REST_ON_COUCH_PASSWORD): Password
* config.logLevel (REST_ON_COUCH_LOG_LEVEL)

### Configuration file
 
### Node.js API

TODO

### CLI

#### Import a file

| Command | Description |
| ------ | ----------- |
| ```rest-on-couch import``` | Import files |
| ```rest-on-couch server``` | Launch server |
| ```rest-on-couch config``` | get/set home configuration |
| ```rest-on-couch log``` | get/set log entries |

```rest-on-couch <command> --help``` for more details

## License

  [MIT](./LICENSE)

[npm-image]: https://img.shields.io/npm/v/rest-on-couch.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/rest-on-couch
[travis-image]: https://img.shields.io/travis/cheminfo/rest-on-couch/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/cheminfo/rest-on-couch
[david-image]: https://img.shields.io/david/cheminfo/rest-on-couch.svg?style=flat-square
[david-url]: https://david-dm.org/cheminfo/rest-on-couch
[download-image]: https://img.shields.io/npm/dm/rest-on-couch.svg?style=flat-square
[download-url]: https://www.npmjs.com/package/rest-on-couch
