/**
 * QUAKE LIVE HOOK MANAGER
 * Version: 0.1
 */

// called in ql.Init
function main_hook() {
  console.log("main_hook called");
  if (quakelive.mod_legals !== quakelive.activeModule) HOOK_MANAGER.init();
}


(function(aWin, undefined) {
/**
 * IMPORTANT:  Unless you really know what you're doing, the "config" properties below should be all
 * you need to change in this file.
 */
var config = {
    BASE_URL: "http://qlhm.phob.net/"
  , manual: []
  , debug: false
};

// !!!
// IMPORTANT:  Changing anything below this point might break things!
// !!!


// This is the service that acts as a proxy to retrieve userscripts.  It also does some extra work,
// such as pre-parsing of the userscript metadata block.
var JSONP_PROXY_TEMPLATE = config.BASE_URL + "uso/{{id}}";

// This is used to determine whether `hook.js` and the proxy service are on the same version.
var VERSION_CHECK_URL = config.BASE_URL + "versioncheck";


// Local reference to jQuery (set during initialization)
var $;


/**
 * Helpers
 */
// Defines a read-only property on an object (enumerable by default)
function readOnly(aObj, aProp, aVal, aEnum) {
  aEnum = undefined === aEnum ? true : !!aEnum;
  Object.defineProperty(aObj, aProp, {get: function() { return aVal }, enumerable: aEnum});
}

// Simple extend with exceptions
function extend(aTarget, aSource, aProtect) {
  aProtect = Array.isArray(aProtect) ? aProtect : [];
  for (var p in aSource) {
    if (-1 === aProtect.indexOf(p)) {
      aTarget[p] = aSource[p];
    }
  }
}

function injectStyle(aStyle) {
  var s = document.createElement("style");
  s.type = "text/css";
  s.textContent = Array.isArray(aStyle) ? aStyle.join("") : aStyle;
  document.body.appendChild(s);
}

function injectScript(aScript) {
  var s = document.createElement("script");
  s.type = "text/javascript";
  s.innerHTML = aScript;
  document.body.appendChild(s);
  document.body.removeChild(s);
}


/**
 * localStorage Manager
 */
var storage = Object.create(null);
readOnly(storage, "root", "qlhm");
readOnly(storage, "init", function storageInit(aCallback, aForceReset) {
  var STORAGE_TEMPLATE = {settings: {}, scripts: {available: [], enabled: [], cache: {}}};

  if (aForceReset) console.log("^1WARNING: ^7resetting QLHM localStorage");

  if (!aForceReset && storage.root in localStorage) {
    try {
      var tmp = JSON.parse(localStorage[storage.root]);
      extend(storage, {settings: tmp.settings, scripts: tmp.scripts});
    }
    catch(e) {}
  }

  if (aForceReset || !storage.settings || !jQuery.isPlainObject(storage.settings)) {
    storage.scripts = STORAGE_TEMPLATE.scripts;
    storage.settings = STORAGE_TEMPLATE.settings;
    storage.save();
  }

  aCallback();
});
readOnly(storage, "save", function storageSave() {
  setTimeout(function() {
    localStorage[storage.root] = JSON.stringify({settings: storage.settings, scripts: storage.scripts});
  }, 0);
});


/**
 * HUD Manager
 */
function HudManager(aHookManager) {
  readOnly(this, "hm", aHookManager);
  readOnly(this, "width", 800);

  quakelive.AddHook("OnLayoutLoaded", this.OnLayoutLoaded.bind(this));

  // 2013-11-23 window.alert is currently unhandled... remove this if native (i.e. non-JS) option
  // is enabled.
  if ("function alert() { [native code] }" != (aWin.alert+"")) {
    aWin.alert = function(aMsg) {
      console.log("ALERT: " + aMsg);
    }
  }
}

HudManager.prototype.alert = function(aOptions) {
  var self = this;
  var opts = $.extend({title: self.hm.name}, aOptions, {alert: true});
  qlPrompt(opts);
}

HudManager.prototype.OnLayoutLoaded = function() {
  var layout = quakelive.activeModule ? quakelive.activeModule.GetLayout() : "";
  // Proper layout and no existing menu?
  if ("bare" !== layout && "postlogin_bare" !== layout && !$("#hooka").length) {
    this.injectMenuEntry();
  }
}

HudManager.prototype.injectMenuEntry = function() {
  var self = this;

  injectStyle([
      "#hooka { position: relative; bottom: 20px; left: 10px; z-index: 99999; font-weight: bold; padding: 2px; text-shadow: 0 0 10px #000; }"
    , "#hooka:hover { cursor: pointer; text-shadow: 0 0 10px yellow; }"
    , "#qlhm_console { text-align: left !important; width: 100%;}"
    , "#qlhm_console strong, #qlhm_console legend { font-weight: bold; }"
    , "#qlhm_console fieldset { margin: 10px 0 20px 0; padding: 5px; }"
    , "#qlhm_console ul { list-style: none; }"
    , "#qlhm_console input.userscript-new { width: 500px }"
    , "#qlhm_console a.del { text-decoration: none; }"
    , "#qlhm_console .strike { text-decoration: line-through; }"
  ]);

  $("#qlv_mainLogo").append($("<a id='hooka'>HOOK</a>").click(function() { self.showConsole.call(self); return false; }));
}

HudManager.prototype.scriptRowFromScript = function(aScript) {
  var id = aScript._meta.id;
  var enabled = -1 !== storage.scripts.enabled.indexOf(id);
  return "<li id='userscript" + id + "' data-id='" + id + "'>"
       + "<input type='checkbox' class='userscript-state' " + (enabled ? "checked" : "") + ">"
       + " <label for='userscript" + id + "'>" + aScript.headers.name[0] + " <small>(ID: " + id
       + ")</small></label> &hellip; <a href='javascript:void(0)' class='del'>[DELETE]</a></li>";
}

HudManager.prototype.showConsole = function() {
  var self = this;

  // Get and sort all scripts
  var scripts = [];
  for (var i = 0, e = storage.scripts.available.length; i < e; ++i) {
    scripts.push(storage.scripts.cache[storage.scripts.available[i]]);
  }
  scripts.sort(function(a, b) {
    a = a.headers.name[0].toLowerCase(), b = b.headers.name[0].toLowerCase();
    return (a < b ? -1 : a > b ? 1 : 0);
  });

  // Generate the console
  var out = [];
  out.push("<div id='qlhm_console'>");
  out.push("<fieldset><legend>New <em>(<code>/web_reload</code> after adding)</legend>");
  out.push("<input type='text' class='userscript-new' placeholder='Enter a userscripts.org script ID (e.g. 111519)'>");
  out.push("</fieldset>");
  out.push("<fieldset><legend>Installed Scripts</legend>");
  out.push("<ul id='userscripts'>");
  $.each(scripts, function(i, script) {
    out.push(self.scriptRowFromScript(script));
  });
  out.push("</ul>");
  out.push("</fieldset>");
  out.push("</div>");

  // Inject the console
  qlPrompt({
      title: self.hm.name + " <small>(v" + self.hm.version + ")</small>"
    , customWidth: self.width
    , ok: self.handleConsoleOk.bind(self)
    , okLabel: "Save"
    , cancel: function() { $("#prompt").jqmHide(); }
    , cancelLabel: "Close"
    , body: out.join("")
  });

  // Wait for the prompt to get inserted then do stuff...
  setTimeout(function() {
    $("#modal-cancel").focus();

    $("#qlhm_console")
    // Suppress backtick (99.999% intended for the QL console)
    .on("keydown", function(ev) {
      if (192 == ev.keyCode) ev.preventDefault();
    })
    // Toggle a userscript being marked as deleted
    .on("click", "#userscripts a.del", function() {
      var $this = $(this)
        , id = $this.closest("li").data("id")
        , $item = $("#userscript" + id)
        ;
      if ($item.data("toDelete")) {
        $item.data("toDelete", false).find("label").removeClass("strike");
        $this.text("[DELETE]");
        console.log("final result will be to NOT delete " + id);
      }
      else {
        $item.data("toDelete", true).find("label").addClass("strike");
        $this.text("[UNDELETE]");
        console.log("final result will be to delete " + id);
      }
    });
  }, 0);
}

HudManager.prototype.handleConsoleOk = function() {
  var self = this
    , $con = $("#qlhm_console")
    , $uNew = $con.find("input.userscript-new")
    , ids = $uNew.val()
    ;

  ids = ids.replace(/https:\/\/userscripts\.org\/scripts\/[a-z]+\//g, "").replace(/[^\d,]/g, "");
  ids = ids.split(",").map(function(id) { return parseInt(id.trim()); });

  $.each(ids, function(i, id) {
    // New userscript?
    if (id && !isNaN(id)) {
      if (self.hm.hasUserScript(id)) {
        console.log("The userscript with ID " + id + " already exists.  Try removing it first.");
      }
      else {
        console.log("Trying to fetch userscript with ID '" + id + "'");
        self.hm.fetchScript(id, function(aScript) {
          // TODO: manage the userscript list better... this won't necessarily be in the correct position
          $con.find("#userscripts").append(self.scriptRowFromScript(aScript));
        });
      }
    }
  });

  $uNew.val("");

  // Check userscript states
  $con.find("input.userscript-state").each(function() {
    var $input = $(this)
      , $item = $input.closest("li")
      , id = parseInt($item.data("id"))
      ;

    // Should this userscript be deleted
    if ($item.data("toDelete")) {
      self.hm.removeUserScript(id);
      $item.remove();
    }
    // ... otherwise just check if disabled or enabled
    else {
      self.hm.toggleUserScript(id, $input.prop("checked"));
    }
  });
}


/**
 * Hook Manager
 */
function HookManager(aProps) {
  readOnly(this, "name", "Quake Live Hook Manager");
  readOnly(this, "version", 0.1);
  readOnly(this, "debug", !!aProps.debug);
}

HookManager.prototype.init = function() {
  console.log("^2Initializing " + this.name + " v" + this.version);

  $ = aWin.jQuery;

  if (this.debug) {
    console.debug("^3DEBUG ENABLED.  Press F12 to open Firebug Lite.");
    // Firebug Lite (F12 to open)
    $("body").append("<script type='text/javascript' src='https://getfirebug.com/firebug-lite.js'>");
  }

  readOnly(this, "hud", new HudManager(this));
  storage.init(this.loadScripts.bind(this));
  setTimeout(this.versionCheck.bind(this), 5E3);
}

HookManager.prototype.versionCheck = function() {
  var self = this;
  $.ajax({
      url: VERSION_CHECK_URL
    , data: {currentVersion: self.version}
    , dataType: "jsonp"
  }).done(function(data) {
    if (data.new) {
      console.log("New version found: " + data.new.version);
      var out = "A new version (" + data.new.version + ") of " + self.name + " is available @ <a href='"
              + data.new.url + "'>" + data.new.url + "</a>.<br><br>You will need to manually update your "
              + "\"hook.js\" file, which is currently at version " + self.version + ".";
      self.hud.alert({
          title: self.name + " Update Available"
        , body: out
      });
    }
    else {
      console.log("On the latest client release");
    }
  });
}

HookManager.prototype.loadScripts = function() {
  var self = this;

  // Fire off requests for each script
  $.each(storage.scripts.enabled, function(i, scriptID) {
    var script = storage.scripts.cache[scriptID];

    // TODO: re-enable loading from cache once expiration stuff is in place...
    var USE_CACHE = false;

    // Serve from cache?
    if (USE_CACHE && script) {
      console.log("^7Retrieving '^5" + script.headers.name[0] + "^7' (ID '^5" + scriptID + "^7') from cache");
      self.injectUserScript(script);
    }
    // ... or pull fresh data
    else {
      console.log("^7Attempting fresh retrieval of script with ID '^5" + scriptID + "^7'");
      self.fetchScript(scriptID);
    }
  });

  // User-specified scripts
  $.each(config.manual, function(i, scriptURL) {
    console.log("^7Attempting fresh retrieval of script with URL '^5" + scriptURL + "^7'");
    $.ajax({
      url: scriptURL
    , dataType: "jsonp"
    }).done(function(aData) {
      injectScript(";(function() {" + self.getUserScriptGM(-1) + ";" + aData + "})();");
    });
  });
}

HookManager.prototype.fetchScript = function(aScriptID, aCB) {
  var self = this
    , handleScriptSuccess = this.handleScriptSuccess.bind(this)
    ;

  $.ajax({
      url: JSONP_PROXY_TEMPLATE.replace("{{id}}", aScriptID)
    , headers: {"Accept-Version": "~1"}
    , dataType: "jsonp"
  })
  .done(function(aData) {
    if (aCB) setTimeout(function() { aCB.call(null, aData); }, 0);
    handleScriptSuccess(aData);
  })
  .fail(self.handleScriptError.bind(self, aScriptID));
}

HookManager.prototype.handleScriptSuccess = function(aData) {
  console.log("^2Successfully retrieved script with ID '^5" + aData._meta.id + "^2' '^5" + aData.headers.name[0] + "^2'");
  this.addUserScript(aData);
}

HookManager.prototype.handleScriptError = function(aScriptID, jqXHR, settings, err) {
  console.log("^1Failed to retrieve script with ID '^5" + aScriptID + "^1' : ^7" + err);
}

HookManager.prototype.hasUserScript = function(aID) {
  return -1 != storage.scripts.available.indexOf(aID);
}

HookManager.prototype.addUserScript = function(aScript) {
  var id = aScript._meta.id;
  // Only add entries if this is a new script...
  if (!this.hasUserScript(id)) {
    storage.scripts.available.push(id);
    storage.scripts.enabled.push(id);
  }
  storage.scripts.cache[id] = aScript;
  storage.save();
  this.injectUserScript(storage.scripts.cache[id]);
}

HookManager.prototype.removeUserScript = function(aID) {
  var avIndex = storage.scripts.available.indexOf(aID)
    , enIndex = storage.scripts.enabled.indexOf(aID)
    , name
    ;

  if (-1 == avIndex) return false;
  name = storage.scripts.cache[aID].headers.name[0];
  storage.scripts.available.splice(avIndex, 1);

  if (-1 != enIndex) storage.scripts.enabled.splice(enIndex, 1);
  delete storage.scripts.cache[aID];

  storage.save();

  console.log("^7'^5" + name + "^7' has been removed, but you must restart QUAKE LIVE for the change to take effect.");

  return true;
}

HookManager.prototype.toggleUserScript = function(aID, aEnable) {
  var enable = true === aEnable ? aEnable : false
    , enIndex = storage.scripts.enabled.indexOf(aID)
    , script = storage.scripts.cache[aID]
    , name
    ;

  if (!script) return;
  name = script.headers.name[0];

  if (enable && -1 == enIndex) {
    storage.scripts.enabled.push(aID);
    storage.save();
    this.injectUserScript(script);
    console.log("^7'^5" + name + "^7' has been enabled and injected.  You might need to restarted QUAKE LIVE to get the expected behaviour.");
  }
  else if (!enable && -1 != enIndex) {
    storage.scripts.enabled.splice(enIndex, 1);
    storage.save();
    console.log("^7'^5" + name + "^7' has been disabled, but you must restart QUAKE LIVE for the change to take effect.");
  }
}

HookManager.prototype.injectUserScript = function(aScript) {
  console.log("^7Loading userscript '^5" + aScript.headers.name[0] + "^7' (ID '^5" + aScript._meta.id + "^7')");
  injectScript(";(function() {" + this.getUserScriptGM(aScript._meta.id) + ";" + aScript.content + "})();");
}

HookManager.prototype.getUserScriptGM = function(aScriptID) {
  var out = "";
  return out;
}

// Make init available
var hm = new HookManager({debug: config.debug});
aWin.HOOK_MANAGER = {init: hm.init.bind(hm)};

})(window);
