-- Room QR labels (decided 12.11.2026): a room number per location and a per-project label format
-- (grid, sizes, which lines) that the Leitung can change; the QR leads to the room in the app.
ALTER TABLE location ADD COLUMN nummer text;
ALTER TABLE project ADD COLUMN etiketten_format jsonb;
GRANT UPDATE (etiketten_format) ON project TO bap_app;
