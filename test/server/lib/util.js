let util = {};

function recursiveStringify(obj) {
    var objString = '';
    var isFirstProperty = true;
    if (typeof obj === 'object' && obj !== null && obj.constructor === Object) {
        objString += '{';
        for (var property of Object.keys(obj)) {
            if (isFirstProperty) {
                isFirstProperty = false;
            }
            else {
                objString += ',';
            }
            objString += property + ':' + recursiveStringify(obj[ property ]);
        }
        objString += '}';
    }
    else if (typeof obj === 'object' && obj !== null && obj.constructor === Array) {
        objString += '[';
        for (var element of obj) {
            if (isFirstProperty) {
                isFirstProperty = false;
            }
            else {
                objString += ',';
            }
            objString += recursiveStringify(element);
        }
        objString += ']';
    }
    else if (typeof obj === 'string') {
        objString = '\'' + obj + '\'';
    }
    else {
        objString = obj + '';
    }
    return objString;
}

util.recursiveStringify = recursiveStringify;

export default util;