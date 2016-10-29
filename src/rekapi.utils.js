// REKAPI-GLOBALS
// These are global in development, but get wrapped in a closure at build-time.

// A hack for UglifyJS defines.  Gets removes in the build process.
export const REKAPI_DEBUG = true;

/*!
 * Fire an event bound to a Rekapi.
 * @param {Rekapi} rekapi
 * @param {string} eventName
 * @param {Underscore} _ A reference to the scoped Underscore/Lo-Dash
 * dependency
 * @param {Object=} opt_data Optional event-specific data
 */
export function fireEvent (rekapi, eventName, _, opt_data) {
  var events = rekapi._events[eventName];
  var numEvents = events.length
  for (var i = 0; i < numEvents; ++i) {
    events[i](rekapi, opt_data);
  }
}

/*!
 * @param {Rekapi} rekapi
 * @param {Underscore} _
 */
export function invalidateAnimationLength (rekapi) {
  rekapi._animationLengthValid = false;
}

/*!
 * Does nothing.  Absolutely nothing at all.
 */
export function noop () {
  // NOOP!
}

