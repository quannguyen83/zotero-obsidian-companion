var endpoints = {};
var VERSION = "0.1.8";
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

async function listPDFAttachments() {
  var result = [];
  var libraryIDs = allLibraryIDs();

  for (var i = 0; i < libraryIDs.length; i++) {
    var search = new Zotero.Search();
    search.libraryID = libraryIDs[i];
    search.addCondition("itemType", "is", "attachment");

    var itemIDs = await search.search();
    if (!itemIDs || itemIDs.length === 0) continue;

    var items = await Zotero.Items.getAsync(itemIDs);
    if (!Array.isArray(items)) items = [items];

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (!item || !item.isPDFAttachment || !item.isPDFAttachment()) continue;

      var parentTitle = "";
      if (item.parentItemID) {
        var parent = Zotero.Items.get(item.parentItemID);
        if (parent) parentTitle = String(parent.getField("title") || "");
      }

      result.push({
        key: item.key,
        title: String(item.getField("title") || "PDF"),
        parentTitle: parentTitle,
        libraryID: item.libraryID,
      });
    }
  }

  result.sort(function (a, b) {
    var aName = (a.parentTitle || a.title || a.key).toLowerCase();
    var bName = (b.parentTitle || b.title || b.key).toLowerCase();
    return aName.localeCompare(bName);
  });

  return { attachments: result };
}

async function getAttachmentFileInfo(data) {
  var attachment = findAttachmentByKey(data.attachmentKey);
  var path = "";

  if (attachment.getFilePathAsync) {
    path = await attachment.getFilePathAsync();
  } else if (attachment.getFilePath) {
    path = attachment.getFilePath();
  }

  if (!path) {
    throw new Error("PDF attachment file is not available locally: " + attachment.key);
  }

  var parentTitle = "";
  if (attachment.parentItemID) {
    var parent = Zotero.Items.get(attachment.parentItemID);
    if (parent) parentTitle = String(parent.getField("title") || "");
  }

  return {
    attachmentKey: attachment.key,
    path: String(path),
    title: String(attachment.getField("title") || "PDF"),
    parentTitle: parentTitle,
    libraryID: attachment.libraryID,
  };
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

function finiteRects(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return false;
  for (var i = 0; i < rects.length; i++) {
    var rect = rects[i];
    if (!Array.isArray(rect) || rect.length !== 4) return false;
    for (var j = 0; j < rect.length; j++) {
      if (typeof rect[j] !== "number" || !Number.isFinite(rect[j])) return false;
    }
  }
  return true;
}

async function annotationToJSON(annotation) {
  if (Zotero.Annotations && Zotero.Annotations.toJSON) {
    return await Zotero.Annotations.toJSON(annotation);
  }
  if (annotation && annotation.toJSON) return annotation.toJSON();
  return {};
}

async function listAttachmentAnnotations(data) {
  var attachment = findAttachmentByKey(data.attachmentKey);
  var source = attachment.getAnnotations ? attachment.getAnnotations() : [];
  var result = [];

  for (var i = 0; i < source.length; i++) {
    var annotation = source[i];
    if (!annotation) continue;

    var json = await annotationToJSON(annotation);
    var type = String(json.type || json.annotationType || annotation.annotationType || "");
    if (type !== "highlight") continue;

    var position = json.position || json.annotationPosition || annotation.annotationPosition;
    if (typeof position === "string") {
      try {
        position = JSON.parse(position);
      } catch (error) {
        continue;
      }
    }

    var pageIndex = Number(position && position.pageIndex);
    var rects = position && position.rects;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || !finiteRects(rects)) continue;

    var key = String(json.key || annotation.key || "");
    if (!key) continue;

    result.push({
      annotationKey: key,
      attachmentKey: attachment.key,
      pageIndex: pageIndex,
      rects: rects,
      text: String(json.text || json.annotationText || annotation.annotationText || ""),
      comment: String(json.comment || json.annotationComment || annotation.annotationComment || ""),
      color: String(json.color || json.annotationColor || annotation.annotationColor || Zotero.Annotations.DEFAULT_COLOR),
      pageLabel: String(json.pageLabel || json.annotationPageLabel || annotation.annotationPageLabel || (pageIndex + 1)),
    });
  }

  log("listed " + result.length + " highlight annotations for attachment " + attachment.key);
  return {
    attachmentKey: attachment.key,
    annotations: result,
  };
}

async function deleteAnnotation(data) {
  var attachment = findAttachmentByKey(data.attachmentKey);
  var annotationKey = String(data.annotationKey || "");
  if (!annotationKey) throw new Error("annotationKey is required");

  var source = attachment.getAnnotations ? attachment.getAnnotations() : [];
  var annotation = null;
  for (var i = 0; i < source.length; i++) {
    if (source[i] && String(source[i].key || "") === annotationKey) {
      annotation = source[i];
      break;
    }
  }

  if (!annotation) {
    return { deleted: false, annotationKey: annotationKey, attachmentKey: attachment.key };
  }

  if (annotation.eraseTx) await annotation.eraseTx();
  else if (annotation.erase) await annotation.erase();
  else throw new Error("annotation cannot be deleted with this Zotero version");

  log("deleted annotation " + annotationKey + " for attachment " + attachment.key);
  return { deleted: true, annotationKey: annotationKey, attachmentKey: attachment.key };
}

function install() {}
function uninstall() {}

function startup() {
  register(PREFIX + "/ping", ["GET"], async function () {
    return { ok: true, version: VERSION };
  });

  register(PREFIX + "/attachments", ["GET"], async function () {
    return await listPDFAttachments();
  });

  register(PREFIX + "/attachment-file", ["POST"], async function (data) {
    return await getAttachmentFileInfo(data);
  });

  register(PREFIX + "/annotations", ["POST"], async function (data) {
    return createHighlight(data);
  });

  register(PREFIX + "/attachment-annotations", ["POST"], async function (data) {
    return await listAttachmentAnnotations(data);
  });

  register(PREFIX + "/delete-annotation", ["POST"], async function (data) {
    return await deleteAnnotation(data);
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
