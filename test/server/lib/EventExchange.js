var events = require('events');

class EventExchange {

    constructor() {
        events.EventEmitter.call(this);
    }
}

EventExchange.prototype.__proto__ = events.EventEmitter.prototype;

let eventExchange = new EventExchange();

export default eventExchange