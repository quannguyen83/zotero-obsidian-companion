var endpoints = {};
var VERSION = "0.1.3";
var PREFIX = "/obsidian-bridge";

function log(message) {
  Zotero.debug("[zotero-obsidian-companion] " + message);
}

function normalizeData(data) {
  if (!data) return {};
  if (typeof data === "object") return data;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }
  return {};
}

function register(path, methods, handler) {
  endpoints[path] = function () {};
  endpoints[path].prototype = {
    supportedMethods: methods,
    supportedDataTypes: ["application/json"],
    init: async function (data, sendResponseCallback) {
      try {
        var output = await handler(normalizeData(data));
        sendResponseCallback(200, "application/json", JSON.stringify(output));
      } catch (error) {
        log("error on " + path + ": " + (error && error.stack ? error.stack : error));
        sendResponseCallback(500, "application/json", JSON.stringify({
          error: String((error && error.message) || error),
        }));
      }
    },
  };
  Zotero.Server.Endpoints[path] = endpoints[path];
}

function allLibraryIDs() {
  try {
    return Zotero.Libraries.getAll().map(function (library) {
      return library.libraryID;
    });
  } catch (error) {
    return [Zotero.Libraries.userLibraryID];
  }
}

function findAttachmentByKey(key) {
  if (!key) throw new Error("attachmentKey is required");

  var libraryIDs = allLibraryIDs();
  for (var i = 0; i < libraryIDs.length; i++) {
    var item = Zotero.Items.getByLibraryAndKey(libraryIDs[i], key);
    if (item) {
      if (!item.isPDFAttachment || !item.isPDFAttachment()) {
        throw new Error("item " + key + " is not a PDF attachment");
      }
      return item;
    }
  }

  throw new Error("PDF attachment not found: " + key);
}

function validateRects(rects) {
  if (!Array.isArray(rects) || rects.length === 0) {
    throw new Error("rects must contain at least one rectangle");
  }

  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    if (!Array.isArray(rect) || rect.length !== 4) {
      throw new Error("each rect must contain 4 numbers");
    }
    for (var j = 0; j < rect.length; j++) {
      if (typeof rect[j] !== "number" || !Number.isFinite(rect[j])) {
        throw new Error("rect values must be finite numbers");
      }
    }
  }
}

function makeSortIndex(pageIndex, rects) {
  var firstRect = rects[0] || [0, 0, 0, 0];
  var x = Math.max(0, Math.floor(firstRect[0] || 0));
  var y = Math.max(0, Math.floor(firstRect[1] || 0));
  return String(pageIndex).padStart(5, "0") + "|" +
    String(y).padStart(6, "0") + "|" +
    String(x).padStart(5, "0");
}

async function createHighlight(data) {
  var pageIndex = Number(data.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    throw new Error("pageIndex must be a non-negative integer");
  }

  validateRects(data.rects);

  var attachment = findAttachmentByKey(data.attachmentKey);
  var position = {
    pageIndex: pageIndex,
    rects: data.rects,
  };

  var json = {
    key: Zotero.DataObjectUtilities.generateKey(),
    type: "highlight",
    text: String(data.text || ""),
    comment: String(data.comment || ""),
    color: data.color || Zotero.Annotations.DEFAULT_COLOR,
    pageLabel: String(pageIndex + 1),
    sortIndex: makeSortIndex(pageIndex, data.rects),
    position: position,
  };

  var annotation = await Zotero.Annotations.saveFromJSON(attachment, json);
  var zoteroUrl = "zotero://open-pdf/library/items/" + attachment.key +
    "?page=" + (pageIndex + 1) + "&annotation=" + annotation.key;

  log("created annotation " + annotation.key + " for attachment " + attachment.key);

  return {
    annotationKey: annotation.key,
    attachmentKey: attachment.key,
    zoteroUrl: zoteroUrl,
  };
}

function install() {}
function uninstall() {}

function startup() {
  register(PREFIX + "/ping", ["GET"], async function () {
    return { ok: true, version: VERSION };
  });

  register(PREFIX + "/annotations", ["POST"], async function (data) {
    return createHighlight(data);
  });

  log("local endpoints registered");
}

function shutdown() {
  for (var path in endpoints) {
    delete Zotero.Server.Endpoints[path];
  }
  endpoints = {};
  log("local endpoints removed");
}
