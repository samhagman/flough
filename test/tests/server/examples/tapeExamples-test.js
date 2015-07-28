const test = require('tape-catch');



// Uncomment to see example tests run
runExampleTests();

function runExampleTests() {
    test('basic arithmetic', function(t) {
        t.plan(2);

        t.equal(2 + 3, 5);
        t.equal(7 * 8 + 9, 65);

        t.end();
    });


    test('deep equality', function(t) {
        t.plan(2);

        t.deepEqual([ 3, 4, 5 ], [ 3, 4, 2 + 3 ]);
        t.deepEqual(
            { a: 7, b: [ 8, 9 ] },
            { a: 3 + 4, b: [ 4 * 2 ].concat(3 * 3) }
        );
    });


    test('comparing booleans', function(t) {
        t.plan(1);

        t.ok(3 > 4 || 5 > 2);
    });


    test('negatives', function(t) {
        t.plan(3);
        t.notEqual(1 + 2, 5);
        t.notDeepEqual([ 1, 2 ], [ 12 ]);
        t.notOk(false);
    });


    test('empty map', function(t) {
        [].map(function(x) {
            t.fail('this callback should never fire');
        });

        t.end();
    });


    test('more info', function(t) {
        t.plan(2);

        t.equal(1 + 2, 3, 'basic arithmetic still works');
        t.ok(3 + 4 > 5, 'inequalities are as we might expect');
    });


    test('basic arithmetic', function(t) {
        t.plan(2);

        t.equal(2 + 3, 5);
        t.equal(7 * 8 + 9, 65);

        t.end();
    });


    test('deep equality', function(t) {
        t.plan(2);

        t.deepEqual([ 3, 4, 5 ], [ 3, 4, 2 + 3 ]);
        t.deepEqual(
            { a: 7, b: [ 8, 9 ] },
            { a: 3 + 4, b: [ 4 * 2 ].concat(3 * 3) }
        );
    });


    test('comparing booleans', function(t) {
        t.plan(1);

        t.ok(3 > 4 || 5 > 2);
    });

    test('negatives', function(t) {
        t.plan(3);
        t.notEqual(1 + 2, 5);
        t.notDeepEqual([ 1, 2 ], [ 12 ]);
        t.notOk(false);
    });


    test('empty map', function(t) {
        [].map(function(x) {
            t.fail('this callback should never fire');
        });

        t.end();
    });

    test('more info', function(t) {
        t.plan(2);

        t.equal(1 + 2, 3, 'basic arithmetic still works');
        t.ok(3 + 4 > 5, 'inequalities are as we might expect');
    });
}
