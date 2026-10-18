// Shared in-process event bus. Kiosk routes emit `order:new` after inserting;
// POS SSE clients subscribe and receive an immediate nudge.
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);
module.exports = bus;
