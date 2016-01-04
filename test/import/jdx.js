'use strict';

const imp = require('../../src/import/import');
const dbconfig = require('../../src/util/dbconfig');
const path = require('path');

describe('import', function () {
    it.only('import jdx file', function () {
        var config = dbconfig.import('jdx/import.js');
        var file = path.resolve(__dirname, '../homedir/jdx/data/104-55-2_zg.jdx');
        return imp.import(config, file);
    });
});