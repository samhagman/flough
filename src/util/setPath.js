/**
 * Duplicates functionality of _.set() but allows you to use dot notation with integer keys.
 * Ex. x.1.1.2
 * @param {object} obj
 * @param {string} str
 * @param {*} val
 */
export default function setPath(obj, str, val) {
    const strPrts = str.split('.');

    let curPath = obj;
    strPrts.forEach(function(k, i) {
        if (!curPath[ k.toString() ]) {
            if (i + 1 === strPrts.length) {
                curPath[ k.toString() ] = val;
            } else {
                curPath[ k.toString() ] = {};
            }
        }

        curPath = curPath[ k.toString() ];
    });

    return obj;
}