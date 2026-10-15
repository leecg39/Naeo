export const billingRecoveryMigration={version:28,name:'durable_payment_and_refund_intents',sql:`
 ALTER TABLE payments ADD COLUMN confirm_started_at INTEGER;
 ALTER TABLE refunds ADD COLUMN provider_started_at INTEGER;
 ALTER TABLE refunds ADD COLUMN cancel_base INTEGER CHECK(cancel_base IS NULL OR cancel_base>=0);
 UPDATE refunds SET provider_started_at=coalesce(decided_at,created_at) WHERE status IN ('approved','failed');
 CREATE TRIGGER payments_bound_key BEFORE UPDATE OF payment_key ON payments
 WHEN OLD.payment_key IS NOT NULL AND NEW.payment_key IS NOT OLD.payment_key BEGIN
   SELECT RAISE(ABORT,'payment key is immutable once bound');
 END;
 CREATE TRIGGER refunds_immutable_request BEFORE UPDATE OF payment_id,amount,reason,created_at ON refunds BEGIN
   SELECT RAISE(ABORT,'refund requests are immutable');
 END;
 CREATE TRIGGER refunds_bound_intent BEFORE UPDATE OF cancel_base,provider_started_at ON refunds
 WHEN OLD.provider_started_at IS NOT NULL AND (NEW.cancel_base IS NOT OLD.cancel_base OR NEW.provider_started_at IS NOT OLD.provider_started_at) BEGIN
   SELECT RAISE(ABORT,'refund provider intent is immutable');
 END;
`};
