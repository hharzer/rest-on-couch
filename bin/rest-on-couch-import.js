#!/usr/bin/env node

/* eslint-disable no-await-in-loop */

'use strict';

const path = require('path');

const delay = require('delay');
const fs = require('fs-extra');
const klaw = require('klaw');
const program = require('commander');

const connect = require('../src/connect');
const debug = require('../src/util/debug')('bin:import');
const die = require('../src/util/die');
const { getHomeDir } = require('../src/config/home');
const { importFile } = require('../src/index');
const { getImportConfig } = require('../src/config/config');
const tryMove = require('../src/util/tryMove');

program
  .usage('<file> <database> <kind>')
  .option('-l, --limit <number>', 'Limit of files to import', Number)
  .option(
    '--continuous',
    'Continuous mode. When import is finished, wait for some time and then import again'
  )
  .option(
    '--wait <time>',
    'Wait time in seconds between imports for continuous mode (default: 60)',
    Number,
    60
  )
  .option(
    '--sort <order>',
    'Sorting order of the files when to_processed is walked (default: asc)',
    String,
    'asc'
  )
  .option('--dry-run', 'Do all the steps without updating the database')
  .parse(process.argv);

if (program.sort !== 'asc' && program.sort !== 'desc') {
  throw new Error('sort order must be "asc" or "desc"');
}
const sortWalk = program.sort === 'asc' ? 'shift' : 'pop';

async function doContinuous(waitTime) {
  while (true) {
    debug('starting full import');
    await importAll();
    debug('now waiting %d seconds', waitTime / 1000);
    await delay(waitTime);
  }
}

async function importAll() {
  const homeDir = getHomeDirOrDie();
  const limit = program.limit || 0;
  debug('limit is %d. Searching files...', limit);
  const files = await findFiles(homeDir, limit);
  debug('found %d files to import', files.length);
  const waitingFiles = [];
  const readyFiles = [];
  for (const file of files) {
    const waitTime = getWaitTime(file);
    if (waitTime > 0) {
      waitingFiles.push({
        waitTime,
        sizeBefore: 0,
        waiting: false,
        file
      });
    } else {
      readyFiles.push(file);
    }
  }

  // Start by importing files that don't need to wait
  for (const readyFile of readyFiles) {
    await processFile(readyFile);
  }

  if (waitingFiles.length === 0) {
    return;
  }

  // Get initial size for every waiting file
  try {
    const sizes = await Promise.all(
      waitingFiles.map((waitingFile) => getFileSize(waitingFile))
    );
    waitingFiles.forEach((waitingFile, i) => {
      waitingFile.sizeBefore = sizes[i];
    });
  } catch (e) {
    debug.error('error while getting waiting file size', e);
    return;
  }

  // Start waiting for each file
  for (const waitingFile of waitingFiles) {
    waitingFile.waiting = wait(waitingFile);
  }

  let remainingWaitingFiles = waitingFiles.slice();
  do {
    await Promise.race(
      remainingWaitingFiles.map(
        (remainingWaitingFile) => remainingWaitingFile.waiting
      )
    );
    remainingWaitingFiles = await importNonWaitingFilesOrExtend(
      remainingWaitingFiles
    );
  } while (remainingWaitingFiles.length > 0);
}

async function importNonWaitingFilesOrExtend(waitingFiles) {
  const remainingWaitingFiles = [];
  for (const waitingFile of waitingFiles) {
    if (!waitingFile.waiting) {
      let size;
      try {
        size = await getFileSize(waitingFile);
      } catch (e) {
        debug.error('error while getting waiting file size', e);
        continue;
      }
      if (size !== waitingFile.sizeBefore) {
        waitingFile.sizeBefore = size;
        waitingFile.waiting = wait(waitingFile);
        remainingWaitingFiles.push(waitingFile);
      } else {
        await processFile(waitingFile.file);
      }
    } else {
      remainingWaitingFiles.push(waitingFile);
    }
  }
  return remainingWaitingFiles;
}

function getWaitTime(file) {
  const importConfig = getImportConfig(file.database, file.importName);
  return importConfig.fileSizeChangeDelay || 0;
}

async function getFileSize(waitingFile) {
  const stat = await fs.stat(waitingFile.file.path);
  return stat.size;
}

function wait(waitingFile) {
  return new Promise((resolve) =>
    setTimeout(function waitCallback() {
      waitingFile.waiting = false;
      resolve(waitingFile);
    }, waitingFile.waitTime)
  );
}

async function findFiles(homeDir, limit) {
  let files = [];

  const databases = await fs.readdir(homeDir);
  for (const database of databases) {
    if (shouldIgnore(database)) continue;
    const databasePath = path.join(homeDir, database);
    const stat = await fs.stat(databasePath);
    if (!stat.isDirectory()) continue;

    const importNames = await fs.readdir(databasePath);
    for (const importName of importNames) {
      if (shouldIgnore(importName)) continue;
      const importNamePath = path.join(databasePath, importName);
      const stat = await fs.stat(importNamePath);
      if (!stat.isDirectory()) continue;

      try {
        const importConfigPath = path.join(importNamePath, 'import');
        // eslint-disable-next-line import/no-dynamic-require
        const importConfig = require(importConfigPath);
        if (importConfig && Array.isArray(importConfig.source)) {
          for (const source of importConfig.source) {
            try {
              const sourcePath = path.resolve(importNamePath, source);
              const sourceToProcessPath = path.join(sourcePath, 'to_process');
              const stat = await fs.stat(sourceToProcessPath);
              if (stat.isDirectory()) {
                const maxElements = limit > 0 ? limit - files.length : 0;
                const fileList = await getFilesToProcess(
                  sourceToProcessPath,
                  maxElements
                );
                const objFiles = fileList.map((file) => ({
                  database,
                  importName,
                  path: file
                }));
                files = files.concat(objFiles);
                if (limit > 0 && files.length >= limit) {
                  return files;
                }
              }
            } catch (e) {
              // ignore
            }
          }
        }
      } catch (e) {
        // ignore
      }

      try {
        const toProcessPath = path.join(importNamePath, 'to_process');
        const stat = await fs.stat(toProcessPath);
        if (stat.isDirectory()) {
          const maxElements = limit > 0 ? limit - files.length : 0;
          const fileList = await getFilesToProcess(toProcessPath, maxElements);
          const objFiles = fileList.map((file) => ({
            database,
            importName,
            path: file
          }));
          files = files.concat(objFiles);
          if (limit > 0 && files.length >= limit) {
            return files;
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  return files;
}

function getFilesToProcess(directory, maxElements) {
  return new Promise((resolve, reject) => {
    const items = [];
    const walkStream = klaw(directory, { queueMethod: sortWalk });
    walkStream
      .on('data', function (item) {
        if (item.stats.isFile()) {
          items.push(item.path);
          if (maxElements > 0 && items.length >= maxElements) {
            this.pause();
            resolve(items);
          }
        }
      })
      .on('end', () => resolve(items))
      .on('error', function (err) {
        this.close();
        reject(err);
      });
  });
}

function getHomeDirOrDie() {
  let homeDir = getHomeDir();
  if (!homeDir) {
    die('homeDir must be set to import all');
  }
  return homeDir;
}

async function processFile(file) {
  const { database, importName, path: filePath } = file;
  debug.debug('process file %s', filePath);
  const parsedPath = path.parse(filePath);
  const splitParsedPath = parsedPath.dir.split('/');
  const toProcess = splitParsedPath.indexOf('to_process');
  if (toProcess === -1) {
    throw new Error('to_process not found in path. This should not happen');
  }

  try {
    const importResult = await importFile(database, importName, filePath);
    if (importResult.ok) {
      // success, move to processed
      await moveFile(
        filePath,
        parsedPath.base,
        splitParsedPath,
        toProcess,
        'processed'
      );
    } else if (importResult.skip) {
      debug.debug('skipped import (%s)', importResult.skip);
    } else {
      debug.error('unexpected import result: %o', importResult);
    }
  } catch (e) {
    if (e.skip) return;
    // error, move to errored
    if (e.message.startsWith('no import config')) {
      debug.warn('no import configuration found, skipping this file');
      return;
    }
    debug.error('import error: %o, %s', e, e.stack);
    await moveFile(
      filePath,
      parsedPath.base,
      splitParsedPath,
      toProcess,
      'errored'
    );
  }
}

async function moveFile(filePath, fileName, splitParsedPath, toProcess, dest) {
  const base = splitParsedPath.slice(0, toProcess).join('/');
  let subdir;
  if (splitParsedPath.length - toProcess > 1) {
    subdir = splitParsedPath.slice(toProcess + 1).join('/');
  } else {
    subdir = getDatePath();
  }
  const destination = path.join(base, dest, subdir, fileName);
  await tryMove(filePath, destination);
}

function getDatePath() {
  const now = new Date();
  return `${now.getUTCFullYear()}/${`0${now.getUTCMonth() + 1}`.slice(
    -2
  )}/${`0${now.getUTCDate()}`.slice(-2)}`;
}

function shouldIgnore(name) {
  return name === 'node_modules' || name.startsWith('.');
}

(async () => {
  if (program.args[0]) {
    if (program.args.length !== 3) {
      program.help();
    }
    debug('import with arguments: %o', program.args);
    const filePath = path.resolve(program.args[0]);
    const database = program.args[1];
    const importName = program.args[2];
    await importFile(database, importName, filePath, {
      dryRun: program.dryRun
    });
    if (program.dryRun) {
      debug('dry run finished without errors');
    } else {
      debug('imported successfully');
    }
  } else if (program.continuous) {
    const waitTime = program.wait * 1000;
    debug('continuous import. Wait time is %d s', program.wait);
    await doContinuous(waitTime);
  } else {
    await importAll();
    debug('finished import');
  }
})()
  .then(() => connect.close())
  .catch((err) => {
    connect.close();
    die(err.message || err);
  });
