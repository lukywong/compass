var View = require('ampersand-view');
var SidebarView = require('./sidebar');
var BehaviorStateMachine = require('./behavior');
var ConnectionCollection = require('../models/connection-collection');
var ConnectFormView = require('./connect-form-view');
var Connection = require('../models/connection');
var debug = require('debug')('scout:connect:index');
var _ = require('lodash');
var app = require('ampersand-app');
var format = require('util').format;

/**
 * AuthenticationOptionCollection
 */
var authMethods = require('./authentication');

/**
 * SslOptionCollection
 */
var sslMethods = require('./ssl');

var ConnectView = View.extend({
  template: require('./index.jade'),
  props: {
    form: 'state',
    stateMachine: 'state',
    connection: 'state',
    message: {
      type: 'string',
      default: ''
    },
    showFavoriteButtons: {
      type: 'boolean',
      default: false
    },
    showSaveButton: {
      type: 'boolean',
      default: false
    },
    connectionName: {
      type: 'string',
      default: ''
    },
    nameConflict: {
      type: 'boolean',
      default: false
    },
    authMethod: {
      type: 'string',
      default: 'MONGODB'
    },
    previousAuthMethod: {
      type: 'string',
      default: null
    },
    sslMethod: {
      type: 'string',
      default: 'NONE'
    },
    previousSslMethod: {
      type: 'string',
      default: null
    }
  },
  derived: {
    hasError: {
      deps: ['message'],
      fn: function() {
        return this.message !== '';
      }
    },
    connectionNameEmpty: {
      deps: ['connectionName'],
      fn: function() {
        return this.connectionName === '';
      }
    },
    isFavorite: {
      deps: ['stateMachine.state'],
      fn: function() {
        return _.startsWith(this.stateMachine.state, 'FAV_');
      }
    }
  },
  collections: {
    connections: ConnectionCollection
  },
  events: {
    'change select[name=authentication]': 'onAuthMethodChanged',
    'change select[name=ssl]': 'onSslMethodChanged',
    'click [data-hook=create-favorite-button]': 'onCreateFavoriteClicked',
    'click [data-hook=remove-favorite-button]': 'onRemoveFavoriteClicked',
    'click [data-hook=save-changes-button]': 'onSaveChangesClicked',
    'input input[name=name]': 'onNameInputChanged',
    'change input[name=name]': 'onNameInputChanged',
    'input input': 'onAnyInputChanged',
    'change select': 'onAnyInputChanged'
  },

  /**
   * Event handlers listening to UI events. These are very lightweight
   * methods that simply set a property or dispatch an action. The heavy
   * lifting is done in @see ./querybuilder.js.
   *
   * @see `events` above
   */

  onAuthMethodChanged: function(evt) {
    this.authMethod = evt.target.value;
  },

  onSslMethodChanged: function(evt) {
    this.sslMethod = evt.target.value;
  },

  onNameInputChanged: function(evt) {
    this.connectionName = evt.target.value;
    var nameField = this.form.getField('name');
    this.nameConflict = Boolean(nameField.value && !nameField.valid);
  },

  onAnyInputChanged: function() {
    this.form.checkValid();
    this.dispatch('any field changed');
  },

  onCreateFavoriteClicked: function() {
    this.dispatch('create favorite clicked');
  },

  onRemoveFavoriteClicked: function() {
    this.dispatch('remove favorite clicked');
  },

  onSaveChangesClicked: function() {
    this.dispatch('save changes clicked');
  },

  bindings: {
    // show error div
    hasError: {
      type: 'toggle',
      hook: 'message-div',
      mode: 'visibility'
    },
    // show message in error div
    message: {
      hook: 'message'
    },
    isFavorite: {
      type: 'toggle',
      yes: '[data-hook=remove-favorite-button]',
      no: '[data-hook=create-favorite-button]'
    },
    showFavoriteButtons: {
      type: 'toggle',
      hook: 'favorite-buttons'
    },
    showSaveButton: {
      type: 'toggle',
      hook: 'save-changes-button'
    },
    nameConflict: [
      {
        type: 'booleanAttribute',
        hook: 'save-changes-button',
        yes: 'disabled'
      },
      {
        type: 'booleanAttribute',
        hook: 'create-favorite-button',
        yes: 'disabled'
      }
    ],
    connectionNameEmpty: [
      {
        type: 'booleanAttribute',
        hook: 'save-changes-button',
        yes: 'disabled'
      },
      {
        type: 'booleanAttribute',
        hook: 'create-favorite-button',
        yes: 'disabled'
      }
    ]
  },
  subviews: {
    sidebar: {
      hook: 'sidebar-subview',
      waitFor: 'connections',
      prepareView: function(el) {
        return new SidebarView({
          el: el,
          parent: this,
          collection: this.connections
        });
      }
    }
  },
  initialize: function() {
    document.title = 'Connect to MongoDB';
    this.connections.on('sync', this.updateConflictingNames.bind(this));
    this.connections.fetch();
    this.stateMachine = new BehaviorStateMachine(this);
    this.on('change:connectionNameEmpty',
      this.connectionNameEmptyChanged.bind(this));
  },
  render: function() {
    this.renderWithTemplate({
      authMethods: authMethods.serialize(),
      sslMethods: sslMethods.serialize()
    });

    this.form = new ConnectFormView({
      parent: this,
      el: this.queryByHook('connect-form'),
      autoRender: true,
      autoAppend: false
    });

    this.registerSubview(this.form);
    this.listenToAndRun(this, 'change:authMethod',
      this.replaceAuthMethodFields.bind(this));
    this.listenToAndRun(this, 'change:sslMethod',
      this.replaceSslMethodFields.bind(this));

    // always start in NEW_EMPTY state
    this.dispatch('new connection clicked');
  },

  connectionNameEmptyChanged: function() {
    if (this.connectionNameEmpty) {
      this.dispatch('name removed');
    } else {
      this.dispatch('name added');
    }
  },


  // === External hooks

  /**
   * called by SidebarView#onNewConnectionClicked
   * @see ./sidebar.js
   */
  createNewConnection: function() {
    this.dispatch('new connection clicked');
    this.connection = new Connection();
  },

  /**
   * called by SidebarView#onItemClick
   * @param {Object} connection   the selected connection model
   * @see ./sidebar.js
   */
  selectExistingConnection: function(connection) {
    this.connection = connection;
    this.updateForm();
    if (connection.is_favorite) {
      this.dispatch('favorite connection clicked');
    } else {
      this.dispatch('history connection clicked');
    }
  },

  /**
   * called by SidebarView#submitCallback
   * @param {Object} obj   the submitted data
   * @see ./sidebar.js
   */
  submitForm: function() {
    this.dispatch('connect clicked');
  },

  /**
   * convenience method that dispatches an action with the state machine.
   *
   * @param  {String} action  the action to dispatch
   */
  dispatch: function(action) {
    this.stateMachine.dispatch(action);
  },

  /**
   * Update the form's state based on an existing connection. This will update
   * the auth fields and populate all fields with the connection details.
   *
   * Called by `this._stateFavUnchanged` and `this._stateHistoryUnchanged`.
   *
   * @param {Connection} connection
   */
  updateConnection: function() {
    if (this.connection) {
      debug('updating existing connection from form data');
      // set previous auth fields
      var authFields = Connection.getFieldNames(this.previousAuthMethod);
      debug('authFields', authFields);
      this.connection.set(this.form.data);
      debug('after', this.connection.serialize());
    } else {
      debug('creating new connection from form data');
      this.connection = new Connection(this.form.data);
    }
    this.connection.is_favorite = true;
    this.connection.save(null, {validate: false});
    this.connections.add(this.connection, {
      merge: true
    });
  },

  /**
   *
   * remove favorite, then saves the connection (if it has been used before)
   * or destroys it (if it was never used).
   *
   * @param {Connection} connection
   */
  removeFavoriteConnection: function() {
    this.connection.is_favorite = false;
    if (this.connection.last_used === null) {
      this.connection.destroy();
    } else {
      this.connection.save();
    }
    this.sidebar.activeItemView = null;
    this.sidebar.collection.deactivateAll();
  },

  /**
   * Runs a validation on the connection. If it fails, show error banner.
   *
   * @param {Connection} connection
   */
  validateConnection: function(connection) {
    if (!connection.isValid()) {
      this.onError(connection.validationError);
      this.dispatch('error received');
      return;
    }
    app.statusbar.show();
    debug('trying to connect with URL %s and options %j',
      connection.driver_url,
      connection.driver_options
    );

    connection.test(function(err) {
      app.statusbar.hide();
      if (!err) {
        // now save connection
        this.connection = connection;
        this.connection.last_used = new Date();
        this.connection.save();
        this.connections.add(this.connection, {
          merge: true
        });
        this.sidebar.render();
        this.useConnection();
      } else {
        this.onError(err, connection);
        this.dispatch('error received');
        return;
      }
    }.bind(this));
  },

  /**
   * Will open a new schema window with the connection details and close the
   * connection dialog
   *
   * @param {Object} connection    can also be externally called (e.g.
   * Sidebar#onItemDoubleClick)
   */
  useConnection: function(connection) {
    connection = connection || this.connection;
    app.statusbar.hide();
    /**
     * @todo (imlucas): So we can see what auth mechanisms
     * and accoutrement people are actually using IRL.
     *
     *   metrics.trackEvent('connect success', {
     *     authentication: model.authentication,
     *     ssl: model.ssl
     *   });
     */

    /**
     * @see ./src/app.js `params.connection_id`
     */
    window.open(
      format('%s?connection_id=%s#schema',
      window.location.origin,
      connection.getId())
    );
    setTimeout(this.set.bind(this, {
      message: ''
    }), 500);
    setTimeout(window.close, 1000);
  },

  /**
   * Updates the input field view responsible for the friendly name. Provides
   * a list of existing connection names so that the field can validate against
   * them. We want to avoid creating connection favorites with duplicate names.
   */
  updateConflictingNames: function() {
    var conflicts = this.connections.filter(function(model) {
      if (this.connection && this.connection.getId() === model.getId()) {
        return false;
      }
      return model.is_favorite;
    }.bind(this));
    var nameField = this.form.getField('name');
    nameField.conflicting = _.pluck(conflicts, 'name');
  },

  /**
   * Fill in the form based on this.connection, also adds/removes the auth
   * and ssl fields.
   */
  updateForm: function() {
    this.updateConflictingNames();

    // If the new model has auth, expand the auth settings container and select
    // the correct tab.
    this.authMethod = this.connection.authentication;
    this.sslMethod = this.connection.ssl;

    // Changing `this.authMethod` and `this.sslMethod` dynamically updates
    // the form fields so we need to get a list of what keys are currently
    // available to set.
    var keys = ['name', 'port', 'hostname', 'authentication', 'ssl'];
    if (this.connection.authentication !== 'NONE') {
      keys.push.apply(keys, _.pluck(authMethods.get(this.authMethod).fields, 'name'));
    }
    if (this.connection.ssl !== 'NONE') {
      keys.push.apply(keys, _.pluck(sslMethods.get(this.sslMethod).fields, 'name'));
    }

    // make connection active, and (implicitly) all others inactive
    this.connection.active = true;

    // populate the form from values in the model.
    var values = _.pick(this.connection, keys);
    this.form.setValues(values);

    this.connectionName = values.name;
  },

  /**
   * If there is a validation or connection error show a nice message.
   *
   * @param {Error} err
   * @param {Connection} connection
   * @api private
   */
  onError: function(err, connection) {
    // @todo (imlucas): `metrics.trackEvent('connect error', authentication
    // + ssl boolean)`
    debug('showing error message', {
      err: err,
      model: connection
    });
    this.message = err.message;
  },

  /**
   * called when this.authMethod changes. Replaces the fields in `this.form`.
   */
  replaceAuthMethodFields: function() {
    // remove and unregister old fields
    var oldFields = _.get(authMethods.get(this.previousAuthMethod), 'fields', []);
    _.each(oldFields, function(field) {
      this.form.removeField(field.name);
      if (this.connection) {
        this.connection.unset(field.name);
      }
    }.bind(this));

    // register new with form, render, append to DOM
    var newFields = authMethods.get(this.authMethod).fields;
    _.each(newFields, function(field) {
      this.form.addField(field.render());
      this.query('#auth-' + this.authMethod).appendChild(field.el);
    }.bind(this));

    this.previousAuthMethod = this.authMethod;
  },

  /**
   * called when this.sslMethod changes. Replaces the fields in `this.form`.
   */
  replaceSslMethodFields: function() {
    // remove and unregister old fields
    var oldFields = _.get(sslMethods.get(this.previousSslMethod), 'fields', []);
    _.each(oldFields, function(field) {
      this.form.removeField(field.name);
    }.bind(this));

    // register new with form, render, append to DOM
    var newFields = sslMethods.get(this.sslMethod).fields;
    _.each(newFields, function(field) {
      this.form.addField(field.render());
      this.query('#ssl-' + this.sslMethod).appendChild(field.el);
    }.bind(this));

    this.previousSslMethod = this.sslMethod;
  }

});

module.exports = ConnectView;
