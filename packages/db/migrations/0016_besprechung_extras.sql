-- Besprechung extras (docs/fachkonzept/09): general remarks (Bemerkungen) printed with the protocol.
-- Attendance (besprechung_teilnehmer.anwesend) and next date (besprechung.next_at) came with 0013.
ALTER TABLE besprechung ADD COLUMN bemerkung text;
