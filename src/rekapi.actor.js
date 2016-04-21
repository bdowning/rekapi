rekapiModules.push(function (context) {

  'use strict';

  var DEFAULT_EASING = 'linear';
  var Rekapi = context.Rekapi;
  var Tweenable = Rekapi.Tweenable;
  var _ = Rekapi._;

  /*!
   * @param {Object} obj
   * @return {number} millisecond
   */
  function getMillisecond(obj) {
    return obj.millisecond;
  }

  /*!
   * @param {Rekapi.Actor} actor
   * @param {string} event
   * @param {any=} opt_data
   */
  function fireRekapiEventForActor (actor, event, opt_data) {
    if (actor.rekapi) {
      fireEvent(actor.rekapi, event, _, opt_data);
    }
  }

  /*!
   * Retrieves the most recent property cache entry for a given millisecond.
   * @param {Rekapi.Actor} actor
   * @param {number} millisecond
   * @return {Object|undefined} undefined if there is no property cache for
   * the millisecond (this should never happen).
   */
  function getPropertyCacheIndexForMillisecond (actor, millisecond) {
    var cache = actor._timelinePropertyCache;

    // If there is only one keyframe, use that
    if (cache.length === 1) {
      return 0;
    }

    var index = _.sortedIndex(cache, { millisecond: millisecond }, getMillisecond);

    if (cache[index] && cache[index].millisecond === millisecond) {
      return index;
    } else if (index >= 1) {
      return index - 1;
    }

    return -1;
  }

  /*!
   * Gets all of the current and most recent Rekapi.KeyframeProperties for a
   * given millisecond.
   * @param {Rekapi.Actor} actor
   * @param {number} forMillisecond
   * @return {Object} An Object containing Rekapi.KeyframeProperties
   */
  function getLatestPropeties (actor, forMillisecond) {
    var latestProperties = {};

    _.each(actor._propertyTracks, function (propertyTrack, propertyName) {
      var index = insertionPointInTrack(propertyTrack, forMillisecond);
      if (propertyTrack[index] && propertyTrack[index].millisecond === forMillisecond) {
        // Found forMillisecond exactly.
        latestProperties[propertyName] = propertyTrack[index];
      } else if (index >= 1) {
        // forMillisecond doesn't exist in the track and index is
        // where we'd need to insert it, therefore the previous
        // keyframe is the most recent one before forMillisecond.
        latestProperties[propertyName] = propertyTrack[index - 1];
      } else {
        // Return first property.  This is after forMillisecond.
        latestProperties[propertyName] = propertyTrack[0];
      }
    });

    return latestProperties;
  }

  /*!
   * Search property track `track` and find the correct index to insert a
   * new element at `millisecond`.
   * @param {Array(Rekapi.KeyframeProperty)} track
   * @param {number} millisecond
   * @return {number} index
   */
  function insertionPointInTrack (track, millisecond) {
    return _.sortedIndex(track, { millisecond: millisecond }, getMillisecond);
  }

  /*!
   * Search property track `track` and find the index to the element that is
   * at `millisecond`.  Returns `undefined` if not found.
   * @param {Array(Rekapi.KeyframeProperty)} track
   * @param {number} millisecond
   * @return {number|undefined} index or undefined if not present
   */
  function propertyIndexInTrack (track, millisecond) {
    var index = insertionPointInTrack(track, millisecond);
    if (track[index] && track[index].millisecond === millisecond) {
      return index;
    }
  }

  /*!
   * Mark the cache of internal KeyframeProperty data as invalid.  The cache
   * will be rebuilt on the next call to ensurePropertyCacheValid.
   * @param {Rekapi.Actor}
   */
  function invalidatePropertyCache (actor) {
    actor._killRetweenTask();
    actor._timelinePropertyCacheValid = false;
  }

  /*!
   * Empty out and rebuild the cache of internal KeyframeProperty data if it
   * has been marked as invalid.
   * @param {Rekapi.Actor}
   */
  function ensurePropertyCacheValid (actor) {
    if (actor._timelinePropertyCacheValid) {
      return;
    }

    actor._timelinePropertyCache = [];
    actor._timelineFunctionCache = [];
    var timelinePropertyCache = actor._timelinePropertyCache;

    // Build the cache map
    var props = _.values(actor._keyframeProperties);
    props.sort(function (a, b) { return a.millisecond - b.millisecond });

    var curCacheEntry = {
      millisecond: 0,
      properties: getLatestPropeties(actor, 0)
    };
    timelinePropertyCache.push(curCacheEntry);
    _.each(props, function (property) {
      if (property.millisecond !== curCacheEntry.millisecond) {
        curCacheEntry = {
          millisecond: property.millisecond,
          properties: _.clone(curCacheEntry.properties)
        };
        timelinePropertyCache.push(curCacheEntry);
      }
      curCacheEntry.properties[property.name] = property;
      if (property.name === 'function') {
        actor._timelineFunctionCache.push(property);
      }
    });

    actor._timelinePropertyCacheValid = true;
  }

  /*!
   * Remove any property tracks that are empty.
   *
   * @param {Rekapi.Actor} actor
   */
  function removeEmptyPropertyTracks (actor) {
    var trackNameRemovalList = [];
    var propertyTracks = actor._propertyTracks;

    _.each(propertyTracks, function (propertyTrack, trackName) {
      if (!propertyTrack.length) {
        trackNameRemovalList.push(trackName);
      }
    });

    _.each(trackNameRemovalList, function (trackName) {
      delete propertyTracks[trackName];
      fireRekapiEventForActor(actor, 'removeKeyframePropertyTrack', trackName);
    });
  }

  /*!
   * Updates internal Rekapi and Actor data after a KeyframeProperty
   * modification method is called.
   *
   * TODO: This should be moved to core.
   *
   * @param {Rekapi.Actor} actor
   */
  function cleanupAfterKeyframeModification (actor) {
    invalidatePropertyCache(actor);
    invalidateAnimationLength(actor.rekapi);
    fireRekapiEventForActor(actor, 'timelineModified');
  }

  /**
   * An actor represents an individual component of an animation.  An animation
   * may have one or many actors.
   *
   * @class Rekapi.Actor
   * @param {Object=} opt_config Valid properties:
   *   - __context__ (_Object|CanvasRenderingContext2D|HTMLElement_): The
   *   rendering context for this actor. If omitted, this Actor gets the parent
   *   `{{#crossLink "Rekapi"}}{{/crossLink}}` instance's `context` when it is
   *   added with `{{#crossLink "Rekapi/addActor:method"}}{{/crossLink}}`.
   *   - __setup__ (_Function_): A function that gets called when the actor is
   *     added to an animation with
   *     `{{#crossLink "Rekapi/addActor:method"}}{{/crossLink}}`.
   *   - __render__ (_Function(Object, Object)_): A function that gets called
   *   every time the actor's state is updated (once every frame). This
   *   function should do something meaningful with state of the actor (for
   *   example, visually rendering to the screen).  This function receives two
   *   parameters: The first is a reference to the actor's `context` and the
   *   second is an Object containing the current state properties.
   *   - __teardown__ (_Function_): A function that gets called when the actor
   *   is removed from an animation with
   *   `{{#crossLink "Rekapi/removeActor:method"}}{{/crossLink}}`.
   * @constructor
   */
  Rekapi.Actor = function (opt_config) {

    opt_config = opt_config || {};

    // Steal the `Tweenable` constructor.
    Tweenable.call(this);

    _.extend(this, {
      '_propertyTracks': {}
      ,'_timelinePropertyCache': []
      ,'_timelineFunctionCache': []
      ,'_timelinePropertyCacheValid': false
      ,'_keyframeProperties': {}
      ,'id': _.uniqueId()
      ,'context': opt_config.context // This may be undefined
      ,'setup': opt_config.setup || noop
      ,'render': opt_config.render || noop
      ,'teardown': opt_config.teardown || noop
      ,'data': {}
      ,'wasActive': true
    });

    return this;
  };
  var Actor = Rekapi.Actor;

  // Kind of a fun way to set up an inheritance chain.  `ActorMethods` prevents
  // methods on `Actor.prototype` from polluting `Tweenable`'s prototype with
  // `Actor` specific methods.
  var ActorMethods = function () {};
  ActorMethods.prototype = Tweenable.prototype;
  Actor.prototype = new ActorMethods();
  // But the magic doesn't stop here!  `Actor`'s constructor steals the
  // `Tweenable` constructor.

  /**
   * Create a keyframe for the actor.  The animation timeline begins at `0`.
   * The timeline's length will automatically "grow" to accommodate new
   * keyframes as they are added.
   *
   * `state` should contain all of the properties that define this
   * keyframe's state.  These properties can be any value that can be tweened
   * by [Shifty](http://jeremyckahn.github.io/shifty/) (numbers,
   * RGB/hexadecimal color strings, and CSS property strings).  `state` can
   * also be a function, but this works differently (see "Function keyframes"
   * below).
   *
   * __Note:__ Internally, this creates `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s and places them on a "track."
   * These `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s are
   * managed for you by the `{{#crossLink "Rekapi.Actor"}}{{/crossLink}}` APIs.
   *
   * ## Keyframe inheritance
   *
   * Keyframes always inherit missing properties from the previous keyframe.
   * For example:
   *
   *     actor.keyframe(0, {
   *       'x': 100
   *     }).keyframe(1000, {
   *       // Implicitly specifies the `x: 100` from above
   *       'y': 50
   *     });
   *
   * Keyframe `1000` will have a `y` of `50`, and an `x` of `100`, because `x`
   * was inherited from keyframe `0`.
   *
   * ## Function keyframes
   *
   * Instead of providing an Object to be used to interpolate state values, you
   * can provide a function to be called at a specific point on the timeline.
   * This function does not need to return a value, as it does not get used to
   * render the actor state.  Function keyframes are called once per animation
   * loop and do not have any tweening relationship with one another.  This is
   * a primarily a mechanism for scheduling arbitrary code to be executed at
   * specific points in an animation.
   *
   *     // drift is the number of milliseconds that this function was executed
   *     // after the scheduled time.  There is typically some amount of delay
   *     // due to the nature of JavaScript timers.
   *     actor.keyframe(1000, function (drift) {
   *       console.log(this); // Logs the actor instance
   *     });
   *
   * ## Easing
   *
   * `opt_easing`, if provided, can be a string or an Object.  If `opt_easing`
   * is a string, all animated properties will have the same easing curve
   * applied to them.  For example:
   *
   *     actor.keyframe(1000, {
   *         'x': 100,
   *         'y': 100
   *       }, 'easeOutSine');
   *
   * Both `x` and `y` will have `easeOutSine` applied to them.  You can also
   * specify multiple easing curves with an Object:
   *
   *     actor.keyframe(1000, {
   *         'x': 100,
   *         'y': 100
   *       }, {
   *         'x': 'easeinSine',
   *         'y': 'easeOutSine'
   *       });
   *
   * `x` will ease with `easeInSine`, and `y` will ease with `easeOutSine`.
   * Any unspecified properties will ease with `linear`.  If `opt_easing` is
   * omitted, all properties will default to `linear`.
   * @method keyframe
   * @param {number} millisecond Where on the timeline to set the keyframe.
   * @param {Object|Function(number)} state The state properties of the
   * keyframe.  If this is an Object, the properties will be interpolated
   * between this and those of the following keyframe for a given point on the
   * animation timeline.  If this is a function, it will be executed at the
   * specified keyframe.  The function will receive a number that represents
   * the delay between when the function is called and when it was scheduled.
   * @param {string|Object=} opt_easing Optional easing string or Object.  If
   * `state` is a function, this is ignored.
   * @chainable
   */
  Actor.prototype.keyframe = function keyframe (
    millisecond, state, opt_easing) {

    if (state instanceof Function) {
      state = { 'function': state };
    }

    opt_easing = opt_easing || DEFAULT_EASING;
    var easing = Tweenable.composeEasingObject(state, opt_easing);
    var newKeyframeProperty;

    // Create and add all of the KeyframeProperties
    _.each(state, function (value, name) {
      newKeyframeProperty = new Rekapi.KeyframeProperty(
        millisecond, name, value, easing[name]);

      this._addKeyframeProperty(newKeyframeProperty);
    }, this);

    if (this.rekapi) {
      invalidateAnimationLength(this.rekapi);
    }

    invalidatePropertyCache(this);
    fireRekapiEventForActor(this, 'timelineModified');

    return this;
  };

  /**
   * @method hasKeyframeAt
   * @param {number} millisecond Point on the timeline to query.
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {boolean} Whether or not the actor has any `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set at `millisecond`.
   */
  Actor.prototype.hasKeyframeAt = function (millisecond, opt_trackName) {
    var tracks = this._propertyTracks;

    if (opt_trackName) {
      if (!_.has(tracks, opt_trackName)) {
        return false;
      }
      tracks = _.pick(tracks, opt_trackName);
    }

    // Search through the tracks and determine if a property can be found.
    var track;
    for (track in tracks) {
      if (tracks.hasOwnProperty(track)
         && this.getKeyframeProperty(track, millisecond)) {
        return true;
      }
    }

    return false;
  };

  /**
   * Copies all of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s from one point on the actor's
   * timeline to another. This is particularly useful for animating an actor
   * back to its original position.
   *
   *     actor
   *       .keyframe(0, {
   *         x: 10,
   *         y: 15
   *       }).keyframe(1000, {
   *         x: 50,
   *         y: 75
   *       });
   *
   *     // Return the actor to its original position
   *     actor.copyKeyframe(2000, 0);
   *
   * __[Example](../../../../docs/examples/actor_copy_keyframe.html)__
   * @method copyKeyframe
   * @param {number} copyTo The timeline millisecond to copy KeyframeProperties
   * to.
   * @param {number} copyFrom The timeline millisecond to copy
   * KeyframeProperties from.
   * @chainable
   */
  Actor.prototype.copyKeyframe = function (copyTo, copyFrom) {
    // Build the configuation objects to be passed to Actor#keyframe
    var sourcePositions = {};
    var sourceEasings = {};

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var keyframeProperty =
      this.getKeyframeProperty(trackName, copyFrom);

      if (keyframeProperty) {
        sourcePositions[trackName] = keyframeProperty.value;
        sourceEasings[trackName] = keyframeProperty.easing;
      }
    }, this);

    this.keyframe(copyTo, sourcePositions, sourceEasings);
    return this;
  };

  /**
   * Moves all of the
   * `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s from one
   * point on the actor's timeline to another.  Although this method does error
   * checking for you to make sure the operation can be safely performed, an
   * effective pattern is to use `{{#crossLink
   * "Rekapi.Actor/hasKeyframeAt:method"}}{{/crossLink}}` to see if there is
   * already a keyframe at the requested `to` destination.
   *
   * __[Example](../../../../docs/examples/actor_move_keyframe.html)__
   * @method moveKeyframe
   * @param {number} from The millisecond of the keyframe to be moved.
   * @param {number} to The millisecond of where the keyframe should be moved
   * to.
   * @return {boolean} Whether or not the keyframe was successfully moved.
   */
  Actor.prototype.moveKeyframe = function (from, to) {
    if (!this.hasKeyframeAt(from) || this.hasKeyframeAt(to)) {
      return false;
    }

    // Move each of the relevant KeyframeProperties to the new location in the
    // timeline
    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var oldIndex = propertyIndexInTrack(propertyTrack, from);
      if (typeof oldIndex !== 'undefined') {
        var property = propertyTrack[oldIndex];
        this._deleteKeyframePropertyAt(propertyTrack, oldIndex);
        property.millisecond = to;
        var newIndex = insertionPointInTrack(propertyTrack, to);
        this._insertKeyframePropertyAt(property, propertyTrack, newIndex);
      }
    }, this);

    cleanupAfterKeyframeModification(this);

    return true;
  };

  /**
   * Augment the `value` or `easing` of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}`s at a given millisecond.  Any
   * `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s omitted in
   * `stateModification` or `opt_easing` are not modified.
   *
   *     actor.keyframe(0, {
   *       'x': 10,
   *       'y': 20
   *     }).keyframe(1000, {
   *       'x': 20,
   *       'y': 40
   *     }).keyframe(2000, {
   *       'x': 30,
   *       'y': 60
   *     })
   *
   *     // Changes the state of the keyframe at millisecond 1000.
   *     // Modifies the value of 'y' and the easing of 'x.'
   *     actor.modifyKeyframe(1000, {
   *       'y': 150
   *     }, {
   *       'x': 'easeFrom'
   *     });
   *
   * __[Example](../../../../docs/examples/actor_modify_keyframe.html)__
   * @method modifyKeyframe
   * @param {number} millisecond
   * @param {Object} stateModification
   * @param {Object=} opt_easingModification
   * @chainable
   */
  Actor.prototype.modifyKeyframe = function (
    millisecond, stateModification, opt_easingModification) {
    opt_easingModification = opt_easingModification || {};

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var property = this.getKeyframeProperty(trackName, millisecond);

      if (property) {
        property.modifyWith({
          'value': stateModification[trackName]
          ,'easing': opt_easingModification[trackName]
        });
      } else if (typeof stateModification[trackName] !== 'undefined') {
        property = new Rekapi.KeyframeProperty(
          millisecond, trackName,
          stateModification[trackName],
          opt_easingModification[trackName]);

        this._addKeyframeProperty(property);
      }
    }, this);

    cleanupAfterKeyframeModification(this);

    return this;
  };

  /**
   * Remove all `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set
   * on the actor at a given millisecond in the animation.
   *
   * __[Example](../../../../docs/examples/actor_remove_keyframe.html)__
   * @method removeKeyframe
   * @param {number} millisecond The location on the timeline of the keyframe
   * to remove.
   * @chainable
   */
  Actor.prototype.removeKeyframe = function (millisecond) {
    var propertyTracks = this._propertyTracks;

    _.each(this._propertyTracks, function (propertyTrack, propertyName) {
      var index = propertyIndexInTrack(propertyTrack, millisecond);
      if (typeof index !== 'undefined') {
        var keyframeProperty = propertyTrack[index];
        this._deleteKeyframePropertyAt(propertyTrack, index);
        keyframeProperty.detach();
        removeEmptyPropertyTracks(this);
      }
    }, this);

    if (this.rekapi) {
      invalidateAnimationLength(this.rekapi);
    }

    invalidatePropertyCache(this);
    fireRekapiEventForActor(this, 'timelineModified');

    return this;
  };

  /**
   * Remove all `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s set
   * on the actor.
   *
   * **NOTE**: This method does _not_ fire the `beforeRemoveKeyframeProperty`
   * or `removeKeyframePropertyComplete` events.  This method is a bulk
   * operation that is more efficient than calling `{{#crossLink
   * "Rekapi.Actor/removeKeyframeProperty:method"}}{{/crossLink}}` many times
   * individually, but foregoes firing events.
   *
   * __[Example](../../../../docs/examples/actor_remove_all_keyframes.html)__
   * @method removeAllKeyframes
   * @chainable
   */
  Actor.prototype.removeAllKeyframes = function () {
    _.each(this._propertyTracks, function (propertyTrack) {
      propertyTrack.length = 0;
    });

    _.each(this._keyframeProperties, function (keyframeProperty) {
      keyframeProperty.detach();
      removeEmptyPropertyTracks(this);
    }, this);

    this._keyframeProperties = {};

    // Calling removeKeyframe performs some necessary post-removal cleanup, the
    // earlier part of this method skipped all of that for the sake of
    // efficiency.
    return this.removeKeyframe(0);
  };

  /**
   * @method getKeyframeProperty
   * @param {string} property The name of the property track.
   * @param {number} millisecond The millisecond of the property in the
   * timeline.
   * @return {Rekapi.KeyframeProperty|undefined} A `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` that is stored on the actor, as
   * specified by the `property` and `millisecond` parameters. This is
   * `undefined` if no properties were found.
   */
  Actor.prototype.getKeyframeProperty = function (property, millisecond) {
    var propertyTrack = this._propertyTracks[property];
    var index = propertyIndexInTrack(propertyTrack, millisecond);
    if (typeof index !== 'undefined') {
      return propertyTrack[index];
    }
  };

  /**
   * Modify a `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}` stored
   * on an actor.  Internally, this calls `{{#crossLink
   * "Rekapi.KeyframeProperty/modifyWith:method"}}{{/crossLink}}` and then
   * performs some cleanup.
   *
   * __[Example](../../../../docs/examples/actor_modify_keyframe_property.html)__
   * @method modifyKeyframeProperty
   * @param {string} property The name of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to modify.
   * @param {number} millisecond The timeline millisecond of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to modify.
   * @param {Object} newProperties The properties to augment the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` with.
   * @chainable
   */
  Actor.prototype.modifyKeyframeProperty = function (
    property, millisecond, newProperties) {

    var keyframeProperty = this.getKeyframeProperty(property, millisecond);
    if (keyframeProperty) {
      keyframeProperty.modifyWith(newProperties);
      cleanupAfterKeyframeModification(this);
    }

    return this;
  };

  /**
   * Remove a single `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`
   * from the actor.
   * @method removeKeyframeProperty
   * @param {string} property The name of the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to remove.
   * @param {number} millisecond Where in the timeline the `{{#crossLink
   * "Rekapi.KeyframeProperty"}}{{/crossLink}}` to remove is.
   * @return {Rekapi.KeyframeProperty|undefined} The removed KeyframeProperty,
   * if one was found.
   */
  Actor.prototype.removeKeyframeProperty = function (property, millisecond) {
    var propertyTracks = this._propertyTracks;

    if (typeof propertyTracks[property] !== 'undefined') {
      var propertyTrack = propertyTracks[property];
      var index = propertyIndexInTrack(propertyTrack, millisecond);
      var keyframeProperty = propertyTrack[index];
      fireEvent(this.rekapi, 'beforeRemoveKeyframeProperty', _, keyframeProperty);
      this._deleteKeyframePropertyAt(propertyTrack, index);
      keyframeProperty.detach();

      removeEmptyPropertyTracks(this);
      cleanupAfterKeyframeModification(this);
      fireEvent(this.rekapi, 'removeKeyframePropertyComplete', _, keyframeProperty);

      return keyframeProperty;
    }
  };

  /**
   *
   * @method getTrackNames
   * @return {Array(string)} A list of all the track names for an actor.
   */
  Actor.prototype.getTrackNames = function () {
    return _.keys(this._propertyTracks);
  };

  /**
   * Get all of the `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s
   * for a track.
   * @method getPropertiesInTrack
   * @param {string} trackName The track name to query.
   * @return {Rekapi.KeyframeProperty[]|undefined}
   */
  Actor.prototype.getPropertiesInTrack = function (trackName) {
    var propertyTrack = this._propertyTracks[trackName];

    if (propertyTrack) {
      return propertyTrack.slice(0);
    }
  };

  /**
   * @method getStart
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {number} The millisecond of the first animating state of an actor
   * (for instance, if the actor's first keyframe is later than millisecond
   * `0`).  If there are no keyframes, this returns `0`.
   */
  Actor.prototype.getStart = function (opt_trackName) {
    if (!opt_trackName && this._timelinePropertyCacheValid) {
      return this._timelinePropertyCache[0] ?
        this._timelinePropertyCache[0].millisecond : 0;
    }

    var starts = [];
    var propertyTracks = this._propertyTracks;

    // Null check to see if opt_trackName was provided and is valid
    if (propertyTracks.hasOwnProperty(opt_trackName)) {
      var firstKeyframeProperty = propertyTracks[opt_trackName][0];

      if (firstKeyframeProperty) {
        starts.push(firstKeyframeProperty.millisecond);
      }
    } else {
      // Loop over all property tracks and accumulate the first
      // keyframeProperties from non-empty tracks
      _.each(propertyTracks, function (propertyTrack) {
        if (propertyTrack.length) {
          starts.push(propertyTrack[0].millisecond);
        }
      });
    }

    if (starts.length === 0) {
      starts = [0];
    }

    var start;
    if (starts.length > 0) {
      start = Math.min.apply(Math, starts);
    } else {
      start = 0;
    }

    return start;
  };

  /**
   * @method getEnd
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * keyframe track.
   * @return {number} The millisecond of the last state of an actor (the point
   * in the timeline in which it is done animating).  If there are no
   * keyframes, this is `0`.
   */
  Actor.prototype.getEnd = function (opt_trackName) {
    if (!opt_trackName && this._timelinePropertyCacheValid) {
      var last = this._timelinePropertyCache.length - 1;
      return last >= 0 ? this._timelinePropertyCache[last].millisecond : 0;
    }

    var latest = 0;
    var tracksToInspect = this._propertyTracks;

    if (opt_trackName) {
      tracksToInspect = {};
      tracksToInspect[opt_trackName] = this._propertyTracks[opt_trackName];
    }

    _.each(tracksToInspect, function (propertyTrack) {
      if (propertyTrack.length) {
        var trackLength = _.last(propertyTrack).millisecond;

        if (trackLength > latest) {
          latest = trackLength;
        }
      }
    }, this);

    return latest;
  };

  /**
   * @method getLength
   * @param {string=} opt_trackName Optionally scope the lookup to a particular
   * track.
   * @return {number} The length of time in milliseconds that the actor
   * animates for.
   */
  Actor.prototype.getLength = function (opt_trackName) {
    return this.getEnd(opt_trackName) - this.getStart(opt_trackName);
  };

  /**
   * Extend the last state on this actor's timeline to simulate a pause.
   * Internally, this method copies the final state of the actor in the
   * timeline to the millisecond defined by `until`.
   *
   * __[Example](../../../../docs/examples/actor_wait.html)__
   * @method wait
   * @param {number} until At what point in the animation the Actor should wait
   * until (relative to the start of the animation timeline).  If this number
   * is less than the value returned from `{{#crossLink
   * "Rekapi.Actor/getLength:method"}}{{/crossLink}}`, this method does
   * nothing.
   * @chainable
   */
  Actor.prototype.wait = function (until) {
    var length = this.getEnd();

    if (until <= length) {
      return this;
    }

    var end = this.getEnd();
    var latestProps = getLatestPropeties(this, this.getEnd());
    var serializedProps = {};
    var serializedEasings = {};

    _.each(latestProps, function (latestProp, propName) {
      serializedProps[propName] = latestProp.value;
      serializedEasings[propName] = latestProp.easing;
    });

    this.modifyKeyframe(end, serializedProps, serializedEasings);
    this.keyframe(until, serializedProps, serializedEasings);

    return this;
  };

  /*!
   * Insert a `KeyframeProperty` into a property track at `index`.  The linked
   * list structure of the property track is maintained.
   * @method _insertKeyframePropertyAt
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @param {Array(Rekapi.KeyframeProperty} propertyTrack
   * @param {number} index
   */
  Actor.prototype._insertKeyframePropertyAt = function (keyframeProperty, propertyTrack, index) {
    propertyTrack.splice(index, 0, keyframeProperty);
    // Maintain property linked list
    if (index >= 1) {
      propertyTrack[index - 1].linkToNext(keyframeProperty);
    }
    keyframeProperty.linkToNext(propertyTrack[index + 1]);
  };

  /*!
   * Remove the `KeyframeProperty` at `index` from a property track.  The linked
   * list structure of the property track is maintained.  The removed property
   * is not modified or unlinked internally.
   * @method _deleteKeyframePropertyAt
   * @param {Array(Rekapi.KeyframeProperty} propertyTrack
   * @param {number} index
   */
  Actor.prototype._deleteKeyframePropertyAt = function (propertyTrack, index) {
    if (index >= 1) {
      propertyTrack[index - 1].linkToNext(propertyTrack[index + 1]);
    }
    propertyTrack.splice(index, 1);
  };

  /*!
   * Associate a `Rekapi.KeyframeProperty` to this actor.  Augments the
   * `Rekapi.KeyframeProperty` to maintain a link between the two objects.
   * @method _addKeyframeProperty
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @chainable
   */
  Actor.prototype._addKeyframeProperty = function (keyframeProperty) {
    if (this.rekapi) {
      fireEvent(this.rekapi, 'beforeAddKeyframeProperty', _, keyframeProperty);
    }

    keyframeProperty.actor = this;
    this._keyframeProperties[keyframeProperty.id] = keyframeProperty;

    var name = keyframeProperty.name;
    var propertyTracks = this._propertyTracks;

    if (typeof this._propertyTracks[name] === 'undefined') {
      propertyTracks[name] = [keyframeProperty];
      if (this.rekapi) {
        fireEvent(this.rekapi, 'addKeyframePropertyTrack', _, keyframeProperty);
      }
    } else {
      var index = insertionPointInTrack(propertyTracks[name], keyframeProperty.millisecond);
      this._insertKeyframePropertyAt(keyframeProperty, propertyTracks[name], index);
    }

    if (this.rekapi) {
      fireEvent(this.rekapi, 'addKeyframeProperty', _, keyframeProperty);
    }

    return this;
  };

  /*!
   * Set the actor to be active or inactive stating at `millisecond`.
   * @method setActive
   * @param {boolean} isActive Whether the actor should be active or inactive
   * @param {number} millisecond The time at which to change the actor's active state
   * @chainable
   */
  Actor.prototype.setActive = function (isActive, millisecond) {
    var activeProperty = this._propertyTracks._active
        && this.getKeyframeProperty('_active', millisecond);

    if (activeProperty) {
      activeProperty.value = isActive;
    } else {
      activeProperty = new Rekapi.KeyframeProperty(
        millisecond, '_active', isActive, DEFAULT_EASING);
      this._addKeyframeProperty(activeProperty);
    }

    return this;
  };

  Actor.prototype._killRetweenTask = function () {
    if (this._retweenTask) {
      clearTimeout(this._retweenTask);
      this._retweenTask = undefined;
    }
  };

  Actor.prototype._ensureCacheRetween = function (index) {
    if (!this._getNextCacheEntry) {
      var getNextCacheEntry = (function (index, skipTask) {
        var entry = this._timelinePropertyCache[index];
        if (!entry || entry.retween) {
          this._retweenTask = undefined;
          return;
        }
        var out = Rekapi._retweenPreprocessor(
          _.mapValues(entry.properties, function (p) { return p.value }),
          _.mapValues(entry.properties, function (p) { return p.easing })
        );
        entry.retween = {
          state: out[0],
          easing: out[1],
          decode: out[2]
        };
        entry.retween.interpolator = Retween.createInterpolator(
          entry.retween.state,
          entry.retween.easing
        );
        if (!skipTask) {
          this._retweenTask = setTimeout(function () { getNextCacheEntry(index + 1) }, 0);
        }
      }).bind(this);
      this._getNextCacheEntry = getNextCacheEntry;
    }

    var cache = this._timelinePropertyCache;
    if (!cache[index].retween || (cache[index + 1] && !cache[index + 1].retween)) {
      this._killRetweenTask();
      this._getNextCacheEntry(index, true);
      this._getNextCacheEntry(index + 1);
    }
    
    return index;
  };

  /*!
   * Calculate and set the actor's position at `millisecond` in the animation.
   * @method _updateState
   * @param {number} millisecond
   * @param {boolean=} opt_doResetLaterFnKeyframes If true, allow all function
   * keyframes later in the timeline to be run again.
   * @chainable
   */
  Actor.prototype._updateState = function (millisecond, opt_doResetLaterFnKeyframes) {
    var startMs = this.getStart();
    var endMs = this.getEnd();
    var interpolatedObject;

    millisecond = Math.min(endMs, millisecond);

    ensurePropertyCacheValid(this);
    var index = getPropertyCacheIndexForMillisecond(this, millisecond);
    this._ensureCacheRetween(index);
    var entry = this._timelinePropertyCache[index];
    var nextEntry = this._timelinePropertyCache[index + 1];
    var properties = entry.properties;

    // All actors are active at time 0 unless otherwise specified;
    // make sure a future time deactivation doesn't deactive the actor
    // by default.
    if (properties._active && millisecond >= properties._active.millisecond) {
      this.wasActive = properties._active.getValueAt(millisecond);
      if (!this.wasActive)
        return this;
    } else {
      this.wasActive = true;
    }

    if (startMs === endMs) {

      // If there is only one keyframe, use that for the state of the actor
      _.each(properties, function (keyframeProperty, propName) {
        if (keyframeProperty.shouldInvokeForMillisecond(millisecond)) {
          keyframeProperty.invoke();
          keyframeProperty.hasFired = false;
          return;
        }
      }, this);

      interpolatedObject = entry.retween.decode(entry.retween.state);

    } else {

      _.each(properties, function (keyframeProperty, propName) {
        if (this._beforeKeyframePropertyInterpolate !== noop) {
          this._beforeKeyframePropertyInterpolate(keyframeProperty);
        }

        if (keyframeProperty.shouldInvokeForMillisecond(millisecond)) {
          keyframeProperty.invoke();
          return;
        }
      }, this);

      if (nextEntry) {
        const delta = nextEntry.millisecond - entry.millisecond;
        const position = (millisecond - entry.millisecond) / delta;
        const state = nextEntry.retween.interpolator(
            entry.retween.state,
            nextEntry.retween.state,
            position
          );
        interpolatedObject = nextEntry.retween.decode(state);
      } else {
        interpolatedObject = entry.retween.decode(entry.retween.state);
      }

      _.each(properties, function (keyframeProperty, propName) {
        if (this._afterKeyframePropertyInterpolate !== noop) {
          this._afterKeyframePropertyInterpolate(
            keyframeProperty, interpolatedObject);
        }
      }, this);
    }

    this.set(interpolatedObject);

    if (!opt_doResetLaterFnKeyframes) {
      this._resetFnKeyframesFromMillisecond(millisecond);
    }

    return this;
  };

  /*!
   * @method _resetFnKeyframesFromMillisecond
   * @param {number} millisecond
   */
  Actor.prototype._resetFnKeyframesFromMillisecond = function (millisecond) {
    var cache = this._timelineFunctionCache;
    var index = _.sortedIndex(cache, { millisecond: millisecond }, getMillisecond);
    var len = cache.length;

    while (index < len) {
      cache[index++].hasFired = false;
    }
  };

  /*!
   * @method _beforeKeyframePropertyInterpolate
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @abstract
   */
  Actor.prototype._beforeKeyframePropertyInterpolate = noop;

  /*!
   * @method _afterKeyframePropertyInterpolate
   * @param {Rekapi.KeyframeProperty} keyframeProperty
   * @param {Object} interpolatedObject
   * @abstract
   */
  Actor.prototype._afterKeyframePropertyInterpolate = noop;

  /**
   * __[Example](../../../../docs/examples/actor_export_timeline.html)__
   * @method exportTimeline
   * @return {Object} A serializable Object of this actor's timeline property
   * tracks and `{{#crossLink "Rekapi.KeyframeProperty"}}{{/crossLink}}`s.
   */
  Actor.prototype.exportTimeline = function () {
    var exportData = {
      'start': this.getStart()
      ,'end': this.getEnd()
      ,'trackNames': this.getTrackNames()
      ,'propertyTracks': {}
    };

    _.each(this._propertyTracks, function (propertyTrack, trackName) {
      var trackAlias = exportData.propertyTracks[trackName] = [];
      _.each(propertyTrack, function (keyframeProperty) {
        trackAlias.push(keyframeProperty.exportPropertyData());
      });
    });

    return exportData;
  };

  /**
   * Import an Object to augment this actor's state.  This does not remove
   * keyframe properties before importing new ones.
   *
   * @method importTimeline
   * @param {Object} actorData Any object that has the same data format as the
   * object generated from `{{#crossLink
   * "Rekapi.Actor/exportTimeline:method"}}{{/crossLink}}`.
   */
  Actor.prototype.importTimeline = function (actorData) {
    _.each(actorData.propertyTracks, function (propertyTrack) {
      _.each(propertyTrack, function (property) {
        var obj = {};
        obj[property.name] = property.value;
        this.keyframe(property.millisecond, obj, property.easing);
      }, this);
    }, this);
  };

});
