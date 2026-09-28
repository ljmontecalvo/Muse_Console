-- Every receipt and its effects commit together in D1.
CREATE TABLE balances (
 visitor_id TEXT NOT NULL, venue_id TEXT NOT NULL,
 balance INTEGER NOT NULL CHECK(balance >= 0), PRIMARY KEY(visitor_id,venue_id)
);
CREATE TABLE awards (
 attempt_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, venue_id TEXT NOT NULL,
 hunt_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0),
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TRIGGER apply_award AFTER INSERT ON awards BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM balances WHERE visitor_id=NEW.visitor_id AND venue_id=NEW.venue_id)
 THEN RAISE(ABORT,'missing_balance') END;
 UPDATE balances SET balance=balance+NEW.amount WHERE visitor_id=NEW.visitor_id AND venue_id=NEW.venue_id;
END;
CREATE TABLE item_counts (item_id TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count >= 0));
CREATE TABLE visitor_item_counts (
 visitor_id TEXT NOT NULL, item_id TEXT NOT NULL, count INTEGER NOT NULL CHECK(count >= 0), PRIMARY KEY(visitor_id,item_id)
);
CREATE TABLE redemptions (
 id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, venue_id TEXT NOT NULL, item_id TEXT NOT NULL,
 item_name TEXT NOT NULL, item_kind TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost >= 0),
 code_secret TEXT NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
 total_limit INTEGER NOT NULL DEFAULT 0, visitor_limit INTEGER NOT NULL DEFAULT 0,
 completed_at INTEGER, staff_id TEXT, remaining_balance INTEGER
);
CREATE INDEX redemptions_by_venue ON redemptions(venue_id,expires_at);
CREATE TRIGGER guard_redemption BEFORE UPDATE OF status ON redemptions
WHEN NEW.status='completed' AND OLD.status='pending' BEGIN
 SELECT CASE WHEN OLD.expires_at <= unixepoch() THEN RAISE(ABORT,'expired') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM balances WHERE visitor_id=OLD.visitor_id AND venue_id=OLD.venue_id AND balance >= OLD.cost)
 THEN RAISE(ABORT,'insufficient_balance') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM item_counts WHERE item_id=OLD.item_id)
 OR NOT EXISTS(SELECT 1 FROM visitor_item_counts WHERE item_id=OLD.item_id AND visitor_id=OLD.visitor_id)
 THEN RAISE(ABORT,'missing_counts') END;
 SELECT CASE WHEN NEW.total_limit > 0 AND (SELECT count FROM item_counts WHERE item_id=OLD.item_id) >= NEW.total_limit
 THEN RAISE(ABORT,'item_limit_reached') END;
 SELECT CASE WHEN NEW.visitor_limit > 0 AND (SELECT count FROM visitor_item_counts WHERE item_id=OLD.item_id AND visitor_id=OLD.visitor_id) >= NEW.visitor_limit
 THEN RAISE(ABORT,'visitor_limit_reached') END;
END;
CREATE TRIGGER apply_redemption AFTER UPDATE OF status ON redemptions
WHEN NEW.status='completed' AND OLD.status='pending' BEGIN
 UPDATE balances SET balance=balance-OLD.cost WHERE visitor_id=OLD.visitor_id AND venue_id=OLD.venue_id;
 UPDATE item_counts SET count=count+1 WHERE item_id=OLD.item_id;
 UPDATE visitor_item_counts SET count=count+1 WHERE item_id=OLD.item_id AND visitor_id=OLD.visitor_id;
 UPDATE redemptions SET remaining_balance=(SELECT balance FROM balances WHERE visitor_id=OLD.visitor_id AND venue_id=OLD.venue_id) WHERE id=OLD.id;
END;
