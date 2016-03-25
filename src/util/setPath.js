/**
 * Duplicates functionality of _.set() but allows you to use dot notation with integer keys.
 * Ex. x.1.1.2
 * @param {object} obj
 * @param {string} str
 * @param {*} val
 */
function setPath(obj, str, val) {
    const paths = str.split('.');

    let curPath = obj;
    paths.forEach(function(k, i) {
        if (!curPath[ k.toString() ]) {
            if (i + 1 === paths.length) {
                curPath[ k.toString() ] = val;
            } else {
                curPath[ k.toString() ] = {};
            }
        }

        curPath = curPath[ k.toString() ];
    });

    return obj;
}

export default setPath;
