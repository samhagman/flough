/**
 * Duplicates functionality of _.set() but allows you to use dot notation with integer keys.
 * Ex. x.1.1.2
 * @param {object} obj
 * @param {string} str
 * @param {*} val
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
exports['default'] = setPath;

function setPath(obj, str, val) {
    var strPrts = str.split('.');

    var curPath = obj;
    strPrts.forEach(function (k, i) {
        if (!curPath[k.toString()]) {
            if (i + 1 === strPrts.length) {
                curPath[k.toString()] = val;
            } else {
                curPath[k.toString()] = {};
            }
        }

        curPath = curPath[k.toString()];
    });

    return obj;
}

module.exports = exports['default'];