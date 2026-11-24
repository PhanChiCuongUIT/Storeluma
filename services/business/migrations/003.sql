ALTER TABLE dead_letters ADD COLUMN payload_hash text;
CREATE FUNCTION seal_parked_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.payload_hash := encode(sha256(convert_to(NEW.payload::text,'UTF8')),'hex');
 RETURN NEW;
END $$;
CREATE TRIGGER seal_dead_letter BEFORE INSERT ON dead_letters FOR EACH ROW EXECUTE FUNCTION seal_parked_event();
UPDATE dead_letters SET payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex') WHERE payload IS NOT NULL;
