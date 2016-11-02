'use strict';

var fs = require('fs');
var path = require('path');

var semver = require('semver');
var colors = require('colors');
var wrench = require('wrench');

/**
 * Flatten node_modules
 * 
 * Get all package.json, find and delete duplicates
 *
 * @param {String} dir Directory name
 * @param {Object} options Options available: info and verbose. verbose is always true 
 * @param {Function} callback return status
 */
module.exports = function(dir, options, callback) {
  //TODO: Clean the ---- up
  
  options.verbose = true;
  
  let bound;
  let ignore = false;
  let resolvedDir = path.resolve(dir);
  let target = path.join(resolvedDir, 'node_modules')
  options.force = options.force || false
  
  if (options.root){
    target = resolvedDir
    bound = (depth) => {
      return depth >= 0;
    };
  } else {
    bound = (depth) => {
      return depth > 0;
    };
  }

  if (options.target){
    target = options.target
  }

  if (options.ignore){
    ignore = new RegExp(options.ignore)
    console.log(`Using ignore regex = ${ignore}`)
  }
  
  target = path.resolve(target);
  if (options.verbose) {
    console.log('processing directory ' + resolvedDir.green);
  }
  
  if (fs.existsSync(resolvedDir)) {

    // find modules
    rootWalk(resolvedDir, function(err, modules) {
      if (err) return callback(err);
      else {
        
        if (options.verbose) {
          console.log('there are', colors.cyan(modules.length), 'total packages');
        }

        var seenData = [];
        var duplicateData = [];
        var moduleCount = {};
        
        // for each package
        for (let module of modules) {

          try {
            let packageJson = require(module.packageJson);
            module.name = packageJson.name || module.dirname;
            module.dir = path.dirname(module.packageJson);
            module.version = packageJson.version || '0.0.0';
            
            if(typeof(module.name) === 'undefined')
              continue;
              //throw 'Name is not specified in ' + modules[i];
            if(typeof(module.version) === 'undefined')
              continue;
              //throw 'Version is not specified in ' + modules[i];
          }
          catch(err) {
            return callback(err);
          }
          
          moduleCount[module.depth] = (moduleCount[module.depth] || 0) + 1

          console.log('processing ' + module.name + ' ver. ' + module.version + ' in ' + module.dir);

          // start acculumate seen and duplicate
          if (seenData.length == 0) {
            seenData.push(module);
          } else {

            var currentExist = false;
            var currentExistIndex = -1;
            var currentExistData = {};
            for (var j = 0; j < seenData.length; j++) {
              if (seenData[j].name === module.name) {
                currentExist = true;
                currentExistIndex = j;
                currentExistData = seenData[j];
                break;
              }
            }

            if (!currentExist) {
              seenData.push(module);
              module.dup = false;
            } else {
              if (options.verbose) {
                console.log(' duplicate:'.magenta, module.name, module.version.cyan, 'existing version:', currentExistData.version.cyan);
              }

              // if seen version is older, swap seen with most current version
              if (semver.lt(currentExistData.version, module.version)) {
                if (options.verbose) {
                  console.log('  ', module.name, 'existing version is older. do swap');
                }
                seenData[currentExistIndex] = module;
                duplicateData.push(currentExistData);
                currentExistData.dup = true
                module.dup = false;
              } else {
                duplicateData.push(module);  
                module.dup = true;
              }
            }
          }
        }

        if (options.verbose) {
          console.log('node_modules iteration complete'.green);
          console.log('there are', colors.cyan(seenData.length), 'unique packages');
          console.log('         ', colors.cyan(duplicateData.length), 'duplicate packages');
          for (var key in moduleCount) {
            var str = key == 1 ? 'there are' : '         ';
            console.log(str, colors.cyan(moduleCount[key]), 'packages in node_modules level', colors.cyan(key));
          }
        }

        if (options.info) {
          callback(null, 'node_modules info complete'.green);  
        }
        else {
          
          try {

            // move seen packages
            
            let rmsModules = new Set()
            let rmsPackages = new Set()
            for (module of modules) {
              let dest = path.join(target, module.relPath);
              if (module.dup && !options.copy){
                  console.log('deleting duplicate module'.magenta, module.dir);
                  if(!options.dry){
                    wrench.rmdirSyncRecursive(module.dir, true);
                  }
              } else if (module.dir != dest) {
                if (options.verbose) {
                  console.log('copying directory'.cyan, module.dir, 'to'.cyan, dest);
                }
                if(!options.dry){
                  wrench.copyDirSyncRecursive(module.dir, dest, { forceDelete: options.force });
                }
                if (!options.copy){
                  rmsModules.add(module.location)
                  rmsPackages.add(module.dir)
                }
              } else {
                if (options.verbose) {
                  console.log('no need to move '.cyan, module.dir);
                }
              }
            }

            if (!options.copy){
              for(let loc of rmsPackages){
                  if (options.verbose) {
                    console.log('deleting package'.yellow, loc);
                  }
                  if(!options.dry){
                    wrench.rmdirSyncRecursive(loc);
                  }
              }
              for(let loc of rmsModules){
                if (fs.existsSync(loc)) {
                  fs.readdir(loc, (err, files) => {
                    if (files.length == 0){
                      if (options.verbose) {
                        console.log('deleting empty module folder'.magenta, loc);
                      }
                      if(!options.dry){
                        fs.rmdirSync(loc)
                      }
                    } else {
                      if (options.verbose) {
                        console.log('preserving non-empty module folder'.red, loc);
                      }
                    }
                  });
                }
              }
            }
          }
          catch(err) {
            callback(err);
          }
        }
      }
    }, bound, ignore);
  }
  else {
    callback(new Error('Specified directory ' + dir + ' is not exists!'))
  }
}

const re = /((@[^/]*)\/)?([^/]*)(?:\/package.json)/

function rootWalk(dir, done, bound, ignore, depth){
  depth = depth || 0;
  bound = bound || ((depth) => {
    return depth > 0;
  });

  let results = [];

  function recur(files, newDepth){
      files.forEach(file => {
        let full_file = dir + path.sep + file;
          let stat = fs.statSync(full_file)
          if (stat && stat.isDirectory()) {
            rootWalk(full_file, (err, res) => {
              results = results.concat(res)
            }, bound, ignore, newDepth)
          }
      });
  }
  
  try {
    let list = fs.readdirSync(dir)

    if (list.includes('package.json')){
      if (bound(depth)){
        if (!(ignore && ignore.test(dir))){
          let full_file = dir + path.sep + 'package.json';
          
          let parts = full_file.split(path.sep)
          let node_path = parts.slice(-3).reduce((res, elem) => res + '/' + elem)
          let match = re.exec(node_path)
          
          let location;
          let res = {}
          
          const path_join = (res, elem) => res + path.sep + elem
          if (match[2]){
            res.scope = match[2]
            res.location = parts.slice(0, -3).reduce(path_join)
            res.relPath  = parts.slice(-3, -1).reduce(path_join)
          } else {
            res.location = parts.slice(0, -2).reduce(path_join)
            res.relPath  = parts.slice(-2, -1).reduce(path_join)
          }
          
          res.dirname = match[3]
          res.packageJson = full_file
          res.depth = depth
          
          results.push(res);

        } else {
          console.log('Ignoring '.yellow + dir)
        }
      }
      
      recur(list, depth + 1)
      
    } else {
      recur(list, depth)
    }
    
  } catch (err){
    return done(err)
  }

  return done(null, results)
}