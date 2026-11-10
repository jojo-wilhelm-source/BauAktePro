-- Documents offline on the device (docs/fachkonzept/05): documents and released revisions are synced to
-- the app (folder was already published in 0009). Visibility in infra/powersync/sync-config.yaml mirrors
-- the RLS of 0009/0010.
ALTER PUBLICATION powersync ADD TABLE document, document_revision;
