# Zotero PDF import endpoint

The companion exposes `POST /obsidian-bridge/attachment-file` for the desktop bridge.

Input:

```json
{ "attachmentKey": "ABCD1234" }
```

The companion resolves the real local PDF attachment path through Zotero and returns the path plus attachment metadata. The Obsidian bridge then copies that file into its vault and stores the mapping between the vault path and Zotero attachment key.

This endpoint is intended for the current desktop MVP where Zotero and Obsidian run on the same machine. A future cross-device transport can replace the local-path handoff without changing the mapping model.
