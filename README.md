# Zotero Obsidian Companion

Zotero-side companion plugin for receiving requests from Obsidian and creating or resolving native Zotero objects.

## Goal

Provide a small, explicit bridge into Zotero so an Obsidian-centric workflow can reuse Zotero's native reference and annotation capabilities without writing directly to Zotero's database.

The companion should stay intentionally thin. Synchronization policy, mapping decisions, and conflict handling belong primarily to the Obsidian-side bridge.

## High-level architecture

```text
Obsidian
└─ Obsidian Zotero Bridge
   ├─ Bridge Core
   ├─ Mapping Registry
   └─ Zotero Client
            │
            │ localhost API / IPC
            ▼
Zotero Obsidian Companion
├─ Request Handler
├─ Zotero API Wrapper
├─ Annotation Operations
├─ Note Operations
└─ Obsidian Link Handler
            │
            ▼
Zotero internal APIs
            │
            ├─ items / attachments
            ├─ native annotations
            └─ notes
```

This repository contains the **Zotero-side plugin**. The main integration and mapping logic lives in `obsidian-zotero-bridge`.

## Responsibilities

### Receive local requests

Expose a local interface that the Obsidian bridge can call.

The transport has not been finalized yet. Candidate mechanisms include localhost HTTP, WebSocket, or another local IPC mechanism appropriate for Zotero and Obsidian.

### Resolve Zotero objects

Given native Zotero identifiers, the companion should resolve objects such as:

```text
item key
attachment key
annotation key
note key
```

The companion should not require the Obsidian bridge to understand Zotero's internal database schema.

### Create native annotations

The initial core operation is to accept normalized annotation data from Obsidian and create a native Zotero annotation associated with the correct PDF attachment.

Expected input includes at least:

```text
attachment key
page / page index
selected text
annotation geometry
color
comment
Obsidian-side annotation reference
```

The companion then returns the Zotero annotation key and enough information for the bridge to construct or store the corresponding deep link.

Example conceptual request:

```json
{
  "action": "create_annotation",
  "attachmentKey": "ABCD1234",
  "pageIndex": 6,
  "text": "Visual tracking degrades under rapid motion...",
  "rects": [[120, 300, 420, 325]],
  "color": "#ffd400",
  "comment": "",
  "obsidianAnnotationId": "obs-ann-42"
}
```

Conceptual response:

```json
{
  "annotationKey": "XYZ98765"
}
```

## Bidirectional navigation

The integration should support navigation in both directions.

### Obsidian → Zotero

The Obsidian bridge can open a native Zotero annotation using a deep link of the form:

```text
zotero://open-pdf/library/items/<ATTACHMENT_KEY>?page=<PAGE>&annotation=<ANNOTATION_KEY>
```

### Zotero → Obsidian

The companion should retain or resolve an Obsidian counterpart reference so Zotero can provide an `Open in Obsidian` action for a mapped annotation or note.

The exact storage mechanism for that reference is still to be designed.

## Identity model

Obsidian and Zotero keep their own native IDs. The companion does not impose a shared global identifier.

Mappings are maintained by the Obsidian bridge:

```text
Obsidian PDF            ↔ Zotero attachment
Obsidian annotation     ↔ Zotero annotation
Obsidian note           ↔ Zotero note
```

The companion only needs enough counterpart information to support requests and reverse navigation.

## Notes

Note support is planned, but annotation creation is the first priority.

The intended relationship is:

```text
Obsidian note ID ↔ Zotero note key
```

Each side keeps a unique native note. Later synchronization can update content while preserving the one-to-one mapping.

## MVP

The first milestone should provide only the minimum Zotero-side capabilities required to prove the architecture:

1. Load as a Zotero plugin.
2. Accept a local request from the Obsidian bridge.
3. Resolve a PDF attachment by Zotero attachment key.
4. Create a native Zotero highlight annotation.
5. Return the created annotation key.
6. Allow the resulting annotation to be opened normally in Zotero.
7. Provide a path toward `Open in Obsidian` for the mapped object.

## Later capabilities

After the basic annotation round trip works, the companion may add:

```text
get annotation
update annotation
delete annotation
note read/create/update
Zotero-side change events
reverse synchronization support
```

These should remain API operations; synchronization policy belongs to the bridge core.

## Design principles

- Keep the Zotero plugin thin.
- Use Zotero's APIs instead of directly modifying `zotero.sqlite`.
- Preserve native Zotero annotation behavior.
- Keep IDs native to each application.
- Make every cross-application relationship explicitly mappable.
- Do not duplicate PDF rendering, citation management, or synchronization logic unnecessarily.

## Bridge repository

The Obsidian-side integration, mapping registry, and sync coordinator live in:

`obsidian-zotero-bridge`

## Status

Architecture and API research phase. The initial implementation will focus on native highlight creation from Obsidian requests.
